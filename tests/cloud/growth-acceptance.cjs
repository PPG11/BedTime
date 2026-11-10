// Temporary, token-gated real-cloud acceptance. Deploy only outside the repo as
// bedtimeGrowthAcceptance, then clean its exact namespace and replace with RETIRED.
const cloud = require('wx-server-sdk')
const crypto = require('node:crypto')
const { createPublicActions } = require('common/night-public')
const { createGrowthAnalyticsActions, hashUid } = require('common/night-growth-analytics')
const { scanRows } = require('common/night-growth-query')
const config = require('./qa-config.json')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database({ throwOnNotFound: false })
const DAY = 86400000, base = Date.parse('1980-01-01T22:00:00+08:00'), nightId = '19800101'
const validConfig = config && /^[a-f0-9]{8,16}$/.test(config.namespace) && /^[a-f0-9]{64}$/.test(config.tokenHash) && Number.isFinite(config.expiresAt)
const users = ['a', 'b', 'c', 'd'].map(suffix => `qa_growth_${config.namespace}_${suffix}`)
const admin = `qa_growth_${config.namespace}_admin`, channelCode = `qa_${config.namespace}`
const keyFor = user => crypto.createHash('sha256').update(`${user}\0${nightId}`).digest('hex')
const keyIds = users.map(keyFor), recordIds = users.map(user => `${user}_${nightId}`)
function check(condition, name) { if (!condition) { const error = new Error(name); error.qaCheck = name; throw error } }

// Queries are scoped before they reach the database. This harness never scans or
// returns production people when its injected 1980 clock is used for analytics.
function scope(name) {
  if (['n_users', 'n_nights', 'n_attributions', 'n_cards', 'n_card_keys'].includes(name)) return { uid: db.command.in(users) }
  if (name === 'n_channels') return { code: channelCode }
  check(false, 'QA_COLLECTION_SCOPE')
}
function scoped(source) {
  return {
    command: db.command,
    collection(name) {
      const collection = source.collection(name), filter = scope(name)
      return {
        where(query) { return collection.where(db.command.and([query, filter])) },
        doc(id) {
          check(name === 'n_cards' ? /^[a-f0-9]{32}$/.test(id) : name === 'n_card_keys' ? keyIds.includes(id) : name === 'n_nights' ? recordIds.includes(id) : name === 'n_channels' ? id === channelCode : users.includes(id), 'QA_DOCUMENT_SCOPE')
          const doc = collection.doc(id)
          return {
            async get() {
              const result = await doc.get()
              check(!result.data || (name === 'n_channels' ? result.data.code === channelCode : users.includes(result.data.uid)), 'QA_DOCUMENT_OWNER')
              return result
            },
            async set(options) { check(name === 'n_channels' ? options.data.code === channelCode : users.includes(options.data.uid), 'QA_WRITE_OWNER'); return doc.set(options) },
            update(options) { return doc.update(options) },
            remove() { return doc.remove() }
          }
        }
      }
    },
    runTransaction(operation) { return db.runTransaction(tx => operation(scoped(tx))) }
  }
}

const RUN_PHASES = ['users', 'attribution', 'records', 'lights', 'cards-create', 'cards-revoke', 'dashboard', 'delete-source']
const CLEANUP_PHASES = ['cards', 'keys', 'nights', 'attributions', 'users', 'channels', 'verify']
async function cleanupPhase(phase) {
  const removals = [], removed = {}
  if (phase === 'cards') {
    // Keep keys until the following batch: a lost delete reply can always find
    // the same random ID, and repeated cleanup cannot lose an orphaned card.
    for (const user of users) {
      const key = (await db.collection('n_card_keys').doc(keyFor(user)).get()).data
      if (key) {
        check(key.uid === user && key.nightId === nightId && /^[a-f0-9]{32}$/.test(key.cardId), 'QA_CLEANUP_KEY')
        removals.push(['n_cards', key.cardId])
      }
    }
  } else if (phase === 'keys') {
    check((await db.collection('n_cards').where(scope('n_cards')).count()).total === 0, 'QA_CARDS_FIRST')
    removals.push(...keyIds.map(id => ['n_card_keys', id]))
  } else if (phase === 'nights') removals.push(...recordIds.map(id => ['n_nights', id]))
  else if (phase === 'attributions') removals.push(...users.map(id => ['n_attributions', id]))
  else if (phase === 'users') removals.push(...users.map(id => ['n_users', id]))
  else if (phase === 'channels') removals.push(['n_channels', channelCode])
  else if (phase === 'verify') {
    for (const name of ['n_users', 'n_nights', 'n_cards', 'n_card_keys', 'n_attributions', 'n_channels']) check((await db.collection(name).where(scope(name)).count()).total === 0, 'QA_CLEANUP_EMPTY')
    return { clean: true, removed }
  }
  for (const [name, id] of removals) {
    const current = (await db.collection(name).doc(id).get()).data
    check(!current || (name === 'n_channels' ? current.code === channelCode : users.includes(current.uid)), 'QA_CLEANUP_OWNER')
    if (current) { await db.collection(name).doc(id).remove(); removed[name] = (removed[name] || 0) + 1 }
    check(!(await db.collection(name).doc(id).get()).data, 'QA_CLEANUP_RECHECK')
  }
  return { clean: false, removed }
}

async function runPhase(phase) {
  let now = base - 60000
  const isolated = scoped(db), checks = [], pub = createPublicActions({ now: () => now })
  const analytics = createGrowthAnalyticsActions({ now: () => now, config: { adminHashes: [hashUid(admin)], excludeHashes: [] }, scan: scanRows })
  if (phase === 'users') {
    for (const user of users) {
      const previous = (await isolated.collection('n_users').doc(user).get()).data
      if (!previous) await isolated.collection('n_users').doc(user).set({ data: { uid: user, prefs: { sound: false, haptics: true, reduceMotion: false }, firstNightId: null, lastNightId: null, eventBudget: { nightId: null, accepted: 0 }, createdAt: now, updatedAt: now } })
    }
  } else if (phase === 'attribution') {
    await analytics.saveChannel(isolated, admin, { code: channelCode, label: '隔离云验收渠道', enabled: true })
    const entry = await analytics.captureEntry(isolated, users[0], { ref: channelCode })
    check(entry.source === channelCode, 'QA_CHANNEL_CAPTURE')
    const repeated = await analytics.captureEntry(isolated, users[0], { ref: 'invalid_qa_source' })
    check(!repeated.captured && repeated.source === channelCode, 'QA_SOURCE_FROZEN')
    check((await analytics.captureEntry(isolated, users[3], { ref: 'invalid!qa' })).source === 'unknown', 'QA_UNKNOWN_SOURCE')
    let adminDenied = false
    try { await analytics.getDashboard(isolated, users[0], { from: nightId, to: nightId }) } catch (error) { adminDenied = error.code === 'UNAUTHORIZED' }
    check(adminDenied, 'QA_ADMIN_REJECTION')
    checks.push('channel-capture', 'source-frozen', 'unknown-source', 'admin-rejection')
  } else if (phase === 'records') {
    for (let index = 0; index < 3; index++) {
      const user = users[index], confirmedAt = base + index * 60000
      const record = { uid: user, nightId, confirmedAt, method: index ? 'tap' : 'hold', phraseId: `qa_${config.namespace}`, phraseText: `隔离验收 ${config.namespace}，今天先到这里。`, phraseVersion: 1, poolVersion: 1, ruleVersion: 1 }
      await isolated.collection('n_nights').doc(`${user}_${nightId}`).set({ data: record })
      await isolated.collection('n_users').doc(user).update({ data: { firstNightId: nightId, lastNightId: nightId, updatedAt: confirmedAt } })
    }
  } else if (phase === 'lights') {
    now = Date.parse('1980-01-02T06:05:00+08:00')
    const lights = await pub.getLights(isolated, users[0], { nightId })
    check(lights.total === 3 && !lights.suppressed && lights.buckets.length === 1 && lights.buckets[0].count === 3, 'QA_LIGHTS_AGGREGATION')
    check(lights.ownRecord && !('uid' in lights.ownRecord), 'QA_OWN_PROJECTION')
    checks.push('lights-three-person-threshold', 'private-own-projection')
  } else if (phase === 'cards-create') {
    now = Date.parse('1980-01-02T06:05:00+08:00')
    const outcomes = await Promise.all([pub.createPublicCard(isolated, users[0], { nightId }), pub.createPublicCard(isolated, users[0], { nightId })])
    check(outcomes.every(result => result.status === 'active') && outcomes.filter(result => result.created).length <= 1 && outcomes[0].card.cardId === outcomes[1].card.cardId, 'QA_CONCURRENT_CARD')
    check((await isolated.collection('n_cards').where({ uid: users[0] }).count()).total === 1, 'QA_ONE_CARD')
    const cardId = outcomes[0].card.cardId
    const visible = await pub.getPublicCard(isolated, users[1], { cardId })
    check(visible.status === 'active' && Object.keys(visible.card).sort().join() === 'cardId,expiresAt,nightId,phraseText', 'QA_PUBLIC_PROJECTION')
    check((await pub.revokePublicCard(isolated, users[1], { nightId, cardId })).status === 'unavailable', 'QA_REVOKE_ISOLATION')
    checks.push('concurrent-card-once', 'public-projection', 'revoke-isolation')
  } else if (phase === 'cards-revoke') {
    now = Date.parse('1980-01-02T06:05:00+08:00')
    const key = (await isolated.collection('n_card_keys').doc(keyFor(users[0])).get()).data
    check(key && typeof key.cardId === 'string', 'QA_REVOKE_KEY')
    const cardId = key.cardId
    check((await pub.revokePublicCard(isolated, users[0], { nightId, cardId })).status === 'revoked', 'QA_CARD_REVOKED')
    check((await pub.getPublicCard(isolated, users[1], { cardId })).status === 'unavailable' && (await pub.createPublicCard(isolated, users[0], { nightId })).status === 'revoked', 'QA_NO_RESURRECTION')
    checks.push('revoke-no-resurrection')
  } else if (phase === 'dashboard') {
    now = base + 8 * DAY
    const dashboard = await analytics.getDashboard(isolated, admin, { from: nightId, to: nightId })
    const channel = dashboard.channels.find(value => value.code === channelCode)
    check(dashboard.totals.records === 3 && dashboard.totals.activations === 3 && dashboard.retention.mature === 3 && dashboard.retention.reachedThree === 0 && channel.arrivals === 1 && channel.activations === 1 && channel.conversionRate === 1, 'QA_DASHBOARD_COUNTS')
    checks.push('scoped-dashboard-mature-cohort', 'scoped-channel-conversion')
  } else if (phase === 'delete-source') {
    now = Date.parse('1980-01-02T06:05:00+08:00')
    let key = (await isolated.collection('n_card_keys').doc(keyFor(users[1])).get()).data
    if (!key) {
      const second = await pub.createPublicCard(isolated, users[1], { nightId })
      check(second.status === 'active', 'QA_SECOND_CARD')
      key = { cardId: second.card.cardId }
    }
    await isolated.collection('n_nights').doc(`${users[1]}_${nightId}`).remove()
    check((await pub.getPublicCard(isolated, users[2], { cardId: key.cardId })).status === 'unavailable', 'QA_SOURCE_DELETE_INVALIDATES')
    const hidden = await pub.getLights(isolated, users[0], { nightId })
    check(hidden.suppressed && hidden.total === null && hidden.buckets.length === 0, 'QA_LIGHTS_SUPPRESSION')
    checks.push('source-delete-invalidates-card', 'lights-under-three-hidden')
  }
  return { checks, cleanupRequired: true }
}

exports.main = async input => {
  const realNow = Date.now(), wxUser = cloud.getWXContext().OPENID
  const allowed = input && ['run', 'cleanup'].includes(input.action) && Object.keys(input).every(key => ['action', 'phase', 'token', 'userInfo', 'tcbContext'].includes(key))
  if (!validConfig || !wxUser || !allowed || typeof input.token !== 'string' || input.token.length > 256 || config.expiresAt > realNow + 2 * 3600000 || realNow > config.expiresAt + (input.action === 'cleanup' ? 2 * 3600000 : 0)) return { code: 'UNAUTHORIZED' }
  const tokenHash = crypto.createHash('sha256').update(input.token).digest()
  if (!crypto.timingSafeEqual(tokenHash, Buffer.from(config.tokenHash, 'hex'))) return { code: 'UNAUTHORIZED' }
  const phases = input.action === 'run' ? RUN_PHASES : CLEANUP_PHASES
  if (input.phase === undefined) return { code: 'OK', phases, controlledClock: true, scopedAnalytics: true }
  if (!phases.includes(input.phase)) return { code: 'INVALID_ARG' }
  try {
    const result = input.action === 'cleanup' ? await cleanupPhase(input.phase) : await runPhase(input.phase)
    return { code: 'OK', phase: input.phase, ...result, controlledClock: true, scopedAnalytics: true, realWechatMessages: 0 }
  } catch (error) { return { code: 'QA_FAILED', check: error.qaCheck || 'QA_CLOUD_OPERATION', controlledClock: true, scopedAnalytics: true, cleanupRequired: true } }
}
