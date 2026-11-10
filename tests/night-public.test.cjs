const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createNightDatabase } = require('./helpers/night-db.cjs')
const { createPublicActions, validatePublicRequest } = require('../cloudfunctions/common/night-public')
const at = value => Date.parse(value + '+08:00')
const NIGHT = '20261107'

function setup(time = '2026-11-08T06:05:00') {
  const db = createNightDatabase(), clock = { now: at(time) }
  let id = 0
  const actions = createPublicActions({ now: () => clock.now, randomId: () => (++id).toString(16).padStart(32, '0') })
  const call = (action, fields = {}, uid = 'alice') => {
    const event = { action, ...fields }; validatePublicRequest(event)
    return actions[action](db, uid, event)
  }
  const seed = (uid = 'alice', hour = '22:30:00', nightId = NIGHT) => {
    const date = `${nightId.slice(0, 4)}-${nightId.slice(4, 6)}-${nightId.slice(6)}`
    const record = { uid, nightId, confirmedAt: at(`${date}T${hour}`), method: 'tap', phraseId: 'p001', phraseText: '今天就到这里。', phraseVersion: 1, poolVersion: 1 }
    db.seed('n_nights', `${uid}_${nightId}`, record); return record
  }
  return { db, clock, call, seed }
}

test('公共输入只接受声明字段、有效日期和128位随机编号', () => {
  for (const event of [
    { action: 'getLights', uid: 'someone' }, { action: 'getLights', nightId: '20260229' },
    { action: 'createPublicCard' }, { action: 'getPublicCard', cardId: 'alice_20261107' },
    { action: 'revokePublicCard', nightId: NIGHT, cardId: 'a'.repeat(32), owner: 'alice' },
    { action: 'getLights', userInfo: 'x'.repeat(16384) }
  ]) assert.throws(() => validatePublicRequest(event), error => error.code === 'INVALID_ARG')
  validatePublicRequest({ action: 'getLights', userInfo: { openId: 'ignored' }, tcbContext: {} })
})

test('灯迹06:05才展示已结束夜，只可查看最近7夜；本人当前夜与公共人数分开', async () => {
  const { clock, call, seed } = setup('2026-11-08T06:04:59')
  seed()
  const before = await call('getLights')
  assert.equal(before.nightId, '20261106'); assert.equal(before.currentNightId, NIGHT)
  assert.equal(before.ownRecord.nightId, NIGHT); assert.equal(before.total, null)
  assert.ok(!('uid' in before.ownRecord)); assert.equal(before.availableNightIds.length, 7)
  await assert.rejects(call('getLights', { nightId: NIGHT }), error => error.code === 'INVALID_ARG')
  clock.now = at('2026-11-08T06:05:00')
  const after = await call('getLights')
  assert.equal(after.nightId, NIGHT); assert.equal(after.settledAt, clock.now)
  assert.equal(after.suppressed, true); assert.equal(after.total, null); assert.deepEqual(after.buckets, [])
  assert.equal((await call('getLights', {}, 'bob')).ownRecord, null)
  await assert.rejects(call('getLights', { nightId: '20261031' }), error => error.code === 'INVALID_ARG')
})

test('少于3人不披露总数；零散时段合并为每桶至少3人且不泄露私人字段', async () => {
  const { db, call, seed } = setup()
  seed('a', '20:00:00'); seed('b', '22:00:00')
  assert.equal((await call('getLights')).total, null)
  seed('c', '23:59:59')
  const nextDate = '2026-11-08'
  for (const [uid, time] of [['d', '00:30:00'], ['e', '02:30:00'], ['f', '03:00:00'], ['g', '05:00:00']]) {
    db.seed('n_nights', `${uid}_${NIGHT}`, { uid, nightId: NIGHT, confirmedAt: at(`${nextDate}T${time}`) })
  }
  const result = await call('getLights')
  assert.equal(result.total, 7); assert.equal(result.suppressed, false)
  assert.deepEqual(result.buckets, [{ startHour: 20, endHour: 24, count: 3 }, { startHour: 24, endHour: 30, count: 4 }])
  assert.ok(result.buckets.every(row => Object.keys(row).sort().join() === 'count,endHour,startHour'))
})

test('灯迹跨正午读取仍使用同一时间样本，当前夜和本人投影保持一致', async () => {
  const { db, clock, call, seed } = setup('2026-11-08T11:59:59')
  seed()
  const startedAt = clock.now, original = db.collection.bind(db)
  db.collection = name => {
    const collection = original(name), count = collection.count.bind(collection)
    collection.count = async () => {
      const result = await count()
      clock.now = at('2026-11-08T12:00:01')
      return result
    }
    return collection
  }
  const result = await call('getLights')
  assert.equal(result.serverNow, startedAt)
  assert.equal(result.currentNightId, NIGHT)
  assert.equal(result.ownRecord.nightId, result.currentNightId)
  assert.equal(result.nightId, NIGHT)
})

test('灯迹完整分页超过单页限制，超过10000条拒绝而不返回部分人数', async () => {
  const { call, seed } = setup()
  for (let i = 0; i < 205; i++) seed(`u${String(i).padStart(5, '0')}`)
  assert.equal((await call('getLights')).total, 205)
  for (let i = 205; i < 10001; i++) seed(`u${String(i).padStart(5, '0')}`)
  await assert.rejects(call('getLights'), error => error.code === 'INTERNAL')
})

test('灯迹扫描中途缺页不会静默发布部分汇总', async () => {
  const { db, call, seed } = setup()
  for (let i = 0; i < 105; i++) seed(`u${String(i).padStart(5, '0')}`)
  const original = db.collection.bind(db)
  let pages = 0
  db.collection = name => {
    const collection = original(name), get = collection.get.bind(collection), count = collection.count.bind(collection)
    collection.get = async () => {
      const result = await get()
      if (result.data.length <= 1) return result
      return { ...result, data: pages++ === 0 ? result.data.slice(0, 50) : [] }
    }
    collection.count = async () => {
      const truncated = collection.get; collection.get = get
      try { return await count() } finally { collection.get = truncated }
    }
    return collection
  }
  await assert.rejects(call('getLights'), error => error.code === 'INTERNAL')
})

test('并发创建与丢失回执通过业务键复用同一张卡，公开只含批准字段', async () => {
  const { db, call, seed } = setup()
  seed()
  const [a, b] = await Promise.all([call('createPublicCard', { nightId: NIGHT }), call('createPublicCard', { nightId: NIGHT })])
  assert.equal(Number(a.created) + Number(b.created), 1)
  assert.deepEqual(a.card, b.card)
  assert.equal(db.rows('n_cards').length, 1); assert.equal(db.rows('n_card_keys').length, 1)
  const viewed = await call('getPublicCard', { cardId: a.card.cardId }, 'visitor')
  assert.equal(viewed.status, 'active')
  assert.deepEqual(Object.keys(viewed.card).sort(), ['cardId', 'expiresAt', 'nightId', 'phraseText'])
  assert.equal((await call('getOwnedCard', { nightId: NIGHT }, 'visitor')).status, 'none')
  seed('bob'); db.controls.loseAck = true
  const recovered = await call('createPublicCard', { nightId: NIGHT }, 'bob')
  assert.equal(recovered.created, false); assert.equal(recovered.status, 'active')
  assert.equal(db.rows('n_cards').length, 2); assert.equal(db.rows('n_card_keys').length, 2)
})

test('未有关灯记录不能创建；部分事务失败不会留下公开孤卡', async () => {
  const { db, call, seed } = setup()
  await assert.rejects(call('createPublicCard', { nightId: NIGHT }), error => error.code === 'INVALID_ARG')
  seed(); db.controls.failWrite = 2
  await assert.rejects(call('createPublicCard', { nightId: NIGHT }))
  assert.equal(db.rows('n_cards').length, 0); assert.equal(db.rows('n_card_keys').length, 0)
  db.controls.failWrite = 0
  assert.equal((await call('createPublicCard', { nightId: NIGHT })).created, true)
})

test('撤销只允许本人，丢回执可恢复；已撤销同夜不能重新创建', async () => {
  const { db, call, seed } = setup()
  seed(); const created = await call('createPublicCard', { nightId: NIGHT })
  const args = { nightId: NIGHT, cardId: created.card.cardId }
  assert.equal((await call('revokePublicCard', args, 'visitor')).status, 'unavailable')
  assert.equal((await call('getPublicCard', { cardId: args.cardId })).status, 'active')
  db.controls.loseAck = true
  assert.equal((await call('revokePublicCard', args)).status, 'revoked')
  const repeated = await call('createPublicCard', { nightId: NIGHT })
  assert.equal(repeated.created, false); assert.equal(repeated.status, 'revoked'); assert.equal(repeated.card, null)
  assert.equal(db.rows('n_cards').length, 1)
  assert.deepEqual(await call('getPublicCard', { cardId: args.cardId }), await call('getPublicCard', { cardId: 'f'.repeat(32) }))
})

test('30天到期不自动续期；删除本人原记录后卡立即失效且重建记录不复活旧卡', async () => {
  const { db, clock, call, seed } = setup()
  const original = seed(); const created = await call('createPublicCard', { nightId: NIGHT })
  const id = created.card.cardId
  clock.now = created.card.expiresAt - 1
  assert.equal((await call('getPublicCard', { cardId: id })).status, 'active')
  clock.now++
  assert.equal((await call('getOwnedCard', { nightId: NIGHT })).status, 'expired')
  assert.equal((await call('createPublicCard', { nightId: NIGHT })).status, 'expired')
  assert.equal((await call('getPublicCard', { cardId: id })).status, 'unavailable')
  assert.equal(db.rows('n_cards').length, 1)
  clock.now = at('2026-11-08T06:05:00')
  await db.collection('n_nights').doc(`alice_${NIGHT}`).remove()
  assert.equal((await call('getPublicCard', { cardId: id })).status, 'unavailable')
  db.seed('n_nights', `alice_${NIGHT}`, { ...original, confirmedAt: original.confirmedAt + 1 })
  assert.equal((await call('getPublicCard', { cardId: id })).status, 'unavailable')
})

test('临时云验收隔离真实资料，token/时限拒绝越界且过期宽限只允许精确清理', async t => {
  const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), crypto = require('node:crypto')
  const db = createNightDatabase(), token = 'only-for-memory-qa', start = Date.now()
  const config = { namespace: '1234abcd', tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: start + 1000 }
  const production = { uid: 'production-owner', firstNightId: '20261107', lastNightId: '20261107', updatedAt: start }
  db.seed('n_users', production.uid, production)
  db.seed('n_nights', `${production.uid}_20261107`, { uid: production.uid, nightId: '20261107', confirmedAt: start, method: 'tap' })
  db.seed('n_channels', 'existing', { code: 'existing', label: '实际渠道', enabled: true, createdAt: start, updatedAt: start })
  const file = path.resolve(__dirname, 'cloud/growth-acceptance.cjs'), module = new Module(file)
  let wxUser = 'authenticated-owner', clock = start
  t.mock.method(Date, 'now', () => clock)
  module.filename = file
  module.require = name => name === 'wx-server-sdk' ? { init() {}, database: () => db, getWXContext: () => ({ OPENID: wxUser }) } : name === './qa-config.json' ? config : name.startsWith('common/') ? require(path.resolve(__dirname, '../cloudfunctions', name)) : require(name)
  module._compile(fs.readFileSync(file, 'utf8'), file)
  const main = module.exports.main
  assert.equal((await main({ action: 'run', token: 'incorrect' })).code, 'UNAUTHORIZED')
  wxUser = null; assert.equal((await main({ action: 'run', token })).code, 'UNAUTHORIZED'); wxUser = 'authenticated-owner'
  const plan = await main({ action: 'run', token }), checks = []
  assert.equal(plan.code, 'OK'); assert.equal(plan.phases.length, 8)
  for (const phase of plan.phases) {
    const result = await main({ action: 'run', phase, token })
    assert.equal(result.code, 'OK', phase); assert.equal(result.scopedAnalytics, true); checks.push(...result.checks)
    // A lost reply can replay the same batch without resetting the namespace.
    assert.equal((await main({ action: 'run', phase, token })).code, 'OK', `repeat ${phase}`)
  }
  assert.equal(checks.length, 14)
  assert.deepEqual(db.inspect('n_users', production.uid), production)
  clock = config.expiresAt + 1
  assert.equal((await main({ action: 'run', token })).code, 'UNAUTHORIZED')
  const cleanupPlan = await main({ action: 'cleanup', token })
  let cleaned
  for (const phase of cleanupPlan.phases) {
    cleaned = await main({ action: 'cleanup', phase, token })
    assert.equal(cleaned.code, 'OK', phase)
    assert.equal((await main({ action: 'cleanup', phase, token })).code, 'OK', `repeat cleanup ${phase}`)
  }
  assert.equal(cleaned.clean, true)
  assert.deepEqual(db.rows('n_users'), [production]); assert.equal(db.rows('n_nights').length, 1)
  assert.equal(db.rows('n_channels').length, 1); assert.equal(db.rows('n_cards').length, 0); assert.equal(db.rows('n_card_keys').length, 0)
  clock = config.expiresAt + 2 * 3600000 + 1
  assert.equal((await main({ action: 'cleanup', token })).code, 'UNAUTHORIZED')
})
