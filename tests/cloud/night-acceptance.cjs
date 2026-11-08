// Deployed only as an expiring, token-gated acceptance function. Never registered
// in the mini-program or packaged as a business action. All rows are disposable.
const cloud = require('wx-server-sdk')
const crypto = require('node:crypto')
const { createNightActions } = require('common/nights')
const config = require('./qa-config.json')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database({ throwOnNotFound: false })
const base = Date.parse('1980-01-01T22:00:00+08:00'), DAY = 86400000
const uid = suffix => `qa_${config.namespace}_${suffix}`
const date = i => new Date(Date.UTC(1980, 0, 1 + i)).toISOString().slice(0, 10).replace(/-/g, '')
function wrap(source) {
  return { command: db.command, collection(name) {
    const collection = source.collection(name)
    return name === 'n_phrases' ? { doc(id) { return collection.doc(`qa_${config.namespace}_${id}`) } } : collection
  }, runTransaction(fn) { return db.runTransaction(tx => fn(wrap(tx))) } }
}
function check(value, message) { if (!value) throw new Error(message) }
const event = n => ({ eventId: n.toString(16).padStart(32, '0'), name: 'exit_tap', props: {} })
exports.main = async input => {
  const wxUser = cloud.getWXContext().OPENID
  if (!wxUser || Date.now() > config.expiresAt || typeof input.token !== 'string' || crypto.createHash('sha256').update(input.token).digest('hex') !== config.tokenHash) return { code: 'UNAUTHORIZED' }
  try {
    let now = base
    const actions = createNightActions({ now: () => now }), scoped = wrap(db), a = uid('a'), b = uid('b')
    if (input.action === 'concurrency') {
      await actions.getState(scoped, a)
      const outcomes = await Promise.all([actions.closeLight(scoped, a, { clientNightId: date(0), method: 'hold' }), actions.closeLight(scoped, a, { clientNightId: date(0), method: 'tap' })])
      check(outcomes.filter(x => x.created).length === 1, 'concurrent close')
      check(JSON.stringify(outcomes[0].record) === JSON.stringify(outcomes[1].record), 'stable receipt')
      check((await actions.getNight(scoped, b, { nightId: date(0) })).record === null, 'identity isolation')
      await Promise.all([actions.setPrefs(scoped, a, { prefs: { sound: true } }), actions.setPrefs(scoped, a, { prefs: { haptics: false } })])
      const state = await actions.getState(scoped, a)
      check(state.prefs.sound && !state.prefs.haptics, 'concurrent preferences')
      return { code: 'OK', checks: ['one-record', 'same-receipt', 'identity-isolation', 'prefs-merge'] }
    }
    if (input.action === 'seed') {
      check(Number.isInteger(input.batch) && input.batch >= 0 && input.batch <= 10, 'batch')
      for (let i = input.batch * 3 + 1; i <= input.batch * 3 + 3; i++) {
        now = base + i * DAY
        await actions.closeLight(scoped, a, { clientNightId: date(i), method: 'tap' })
      }
      return { code: 'OK', batch: input.batch }
    }
    if (input.action === 'verify') {
      now = base + 34 * DAY
      const first = await actions.getArchive(scoped, a, {})
      const second = await actions.getArchive(scoped, a, { cursor: first.nextCursor })
      check(first.items.length === 30 && second.items.length === 4 && second.nextCursor === null, 'pagination')
      check(new Set([...first.items, ...second.items].map(row => row.nightId)).size === 34, 'unique archive')
      check((await actions.getArchive(scoped, b, {})).items.length === 0, 'archive isolation')
      const recovered = await actions.closeLight(scoped, a, { clientNightId: date(0), method: 'tap' })
      check(!recovered.created, 'old-night recovery')
      const snapshot = await actions.getState(scoped, a)
      check(snapshot.firstNightId === date(0) && snapshot.lastNightId === date(33), 'summary')
      now = base - 3 * 3600000
      let denied = false
      try { await actions.closeLight(scoped, b, { clientNightId: date(0), method: 'tap' }) } catch (error) { denied = error.code === 'WINDOW_NOT_OPEN' }
      check(denied, 'window enforcement')
      return { code: 'OK', checks: ['30-plus-4-pagination', 'archive-isolation', 'old-night-recovery', 'summary', 'window-rejection'], sample: recovered.record }
    }
    if (input.action === 'events') {
      const result = await actions.track(scoped, a, { events: [event(1), event(1), event(2)] })
      check(result.acceptedIds.length === 2, 'batch dedupe')
      const again = await actions.track(scoped, a, { events: [event(1), event(3)] })
      check(again.duplicateIds.length === 1 && again.acceptedIds.length === 1, 'retry dedupe')
      // Test the final concurrent budget edge without generating 100 noisy rows.
      await db.collection('n_users').doc(a).update({ data: { eventBudget: { nightId: date(0), accepted: 99 } } })
      const outcomes = await Promise.allSettled([actions.track(scoped, a, { events: [event(4)] }), actions.track(scoped, a, { events: [event(5)] })])
      check(outcomes.filter(x => x.status === 'fulfilled').length === 1, 'concurrent budget')
      check(outcomes.some(x => x.status === 'rejected' && x.reason.code === 'RATE_LIMITED'), 'budget rejection')
      return { code: 'OK', checks: ['event-dedupe', 'concurrent-event-budget'] }
    }
    if (input.action === 'cleanup') {
      const removed = {}
      for (const name of ['n_nights', 'n_events', 'n_users']) {
        for (const user of [a, b]) {
          const result = await db.collection(name).where({ uid: user }).remove()
          removed[name] = (removed[name] || 0) + result.stats.removed
        }
        const remaining = await db.collection(name).where({ uid: db.command.in([a, b]) }).count()
        check(remaining.total === 0, 'cleanup ' + name)
      }
      const phraseIds = Array.from({ length: 34 }, (_, i) => `qa_${config.namespace}_${date(i)}`)
      const result = await db.collection('n_phrases').where({ _id: db.command.in(phraseIds) }).remove()
      removed.n_phrases = result.stats.removed
      check((await db.collection('n_phrases').where({ _id: db.command.in(phraseIds) }).count()).total === 0, 'cleanup phrases')
      return { code: 'OK', removed, clean: true }
    }
    return { code: 'INVALID_ARG' }
  } catch (error) { return { code: 'QA_FAILED', message: error.message, detail: error.code || error.errCode || null } }
}
