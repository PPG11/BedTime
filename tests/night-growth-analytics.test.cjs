const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createNightDatabase } = require('./helpers/night-db.cjs')
const { createGrowthAnalyticsActions, validateGrowthAnalyticsRequest, hashUid } = require('../cloudfunctions/common/night-growth-analytics')
const { resolveConfig } = require('../cloudfunctions/common/night-growth-config')
const { scanRows } = require('../cloudfunctions/common/night-growth-query')
const { DAY, nightDay } = require('../cloudfunctions/common/night-time')

const at = value => Date.parse(`${value}+08:00`)
const admin = 'administrator-private-id'
const config = { adminHashes: [hashUid(admin)], excludeHashes: [hashUid('test-private-id')] }
function setup(initial = '2026-11-17T13:00:00', extra = {}) {
  const db = createNightDatabase(), clock = { now: at(initial) }
  const actions = createGrowthAnalyticsActions({ now: () => clock.now, config, ...extra })
  const call = (action, fields = {}, uid = admin) => {
    const event = { action, ...fields }
    validateGrowthAnalyticsRequest(event)
    return actions[action](db, uid, event)
  }
  return { db, clock, actions, call }
}
function user(db, uid, ids = [], method = 'hold') {
  const ordered = [...ids].sort()
  const updatedAt = ordered.length ? nightDay(ordered.at(-1)) + 14 * 3600000 : at('2026-11-06T12:00:00')
  db.seed('n_users', uid, { uid, firstNightId: ordered[0] || null, lastNightId: ordered.at(-1) || null, updatedAt })
  for (const nightId of ordered) db.seed('n_nights', `${uid}_${nightId}`, { uid, nightId, confirmedAt: nightDay(nightId) + 14 * 3600000, method })
}
const fails = (operation, code) => assert.rejects(operation, error => error.code === code)

test('M2 管理权限仅取服务端哈希配置，默认拒绝且平台附加身份不生效', async () => {
  const { db, call } = setup()
  assert.equal((await call('getGrowthAccess', {}, admin)).isAdmin, true)
  assert.equal((await call('getGrowthAccess', { userInfo: { openId: admin }, tcbContext: { OPENID: admin } }, 'visitor')).isAdmin, false)
  for (const [action, fields] of [['getChannels', {}], ['saveChannel', { code: 'source', label: '登记来源', enabled: true }], ['getDashboard', { from: '20261107', to: '20261117' }]]) {
    await fails(() => call(action, fields, 'visitor'), 'UNAUTHORIZED')
  }
  assert.throws(() => validateGrowthAnalyticsRequest({ action: 'getDashboard', from: '20261107', to: '20261117', isAdmin: true }), error => error.code === 'INVALID_ARG')
  assert.throws(() => validateGrowthAnalyticsRequest({ action: 'getGrowthAccess', uid: admin }), error => error.code === 'INVALID_ARG')
  const empty = createGrowthAnalyticsActions({ config: { adminHashes: [], excludeHashes: [] } })
  assert.equal((await empty.getGrowthAccess(db, admin)).isAdmin, false)
  await fails(() => empty.getChannels(db, admin), 'UNAUTHORIZED')
})

test('M2 部署私有配置与环境优先级明确；损坏配置关闭权限或拒绝指标', async () => {
  const names = ['NIGHT_ADMIN_OPENID_HASHES', 'NIGHT_ANALYTICS_EXCLUDE_HASHES']
  const old = names.map(name => process.env[name])
  try {
    names.forEach(name => delete process.env[name])
    assert.deepEqual(resolveConfig(config), config)
    process.env.NIGHT_ADMIN_OPENID_HASHES = '[]'
    assert.deepEqual(resolveConfig(config).adminHashes, [])
    process.env.NIGHT_ADMIN_OPENID_HASHES = '{bad'
    assert.equal(resolveConfig(config).adminHashes, null)
    delete process.env.NIGHT_ADMIN_OPENID_HASHES
    process.env.NIGHT_ANALYTICS_EXCLUDE_HASHES = '["not-a-hash"]'
    const resolved = resolveConfig(config)
    const { call } = setup(undefined, { config: resolved })
    assert.equal((await call('getGrowthAccess')).isAdmin, true)
    await fails(() => call('getDashboard', { from: '20261107', to: '20261117' }), 'INTERNAL')
    assert.deepEqual(resolveConfig({ adminHashes: config.adminHashes, userId: admin }), { adminHashes: null, excludeHashes: null })
  } finally {
    names.forEach((name, index) => { if (old[index] === undefined) delete process.env[name]; else process.env[name] = old[index] })
  }
})

test('M2 渠道登记严格校验；内置分享渠道可停用，未知参数不保存自由文本', async () => {
  const { db, call } = setup()
  assert.deepEqual((await call('getChannels')).channels.map(row => row.code), ['share'])
  for (const fields of [{ code: 'a', label: '名称', enabled: true }, { code: 'unknown', label: '名称', enabled: true }, { code: 'source', label: ' 名称', enabled: true }, { code: 'source', label: 'a'.repeat(25), enabled: true }, { code: 'share', label: '改名', enabled: true }, { code: 'source', label: '两\n行', enabled: true }]) {
    assert.throws(() => validateGrowthAnalyticsRequest({ action: 'saveChannel', ...fields }), error => error.code === 'INVALID_ARG')
  }
  const saved = (await call('saveChannel', { code: 'red-note', label: '内容账号', enabled: true })).channel
  assert.equal(saved.code, 'red-note'); assert.equal(saved.enabled, true)
  await call('saveChannel', { code: 'share', label: '句子卡分享', enabled: false })
  const off = await call('captureEntry', { ref: 'share' }, 'from-share')
  assert.equal(off.source, 'unknown')
  const unknown = await call('captureEntry', { ref: '私人邮箱@example.test' }, 'unknown-visitor')
  assert.equal(unknown.source, 'unknown')
  assert.ok(!JSON.stringify(db.rows('n_attributions')).includes('私人邮箱'))
  assert.equal(db.rows('n_events').length, 0)
})

test('M2 首访固定来源；无参数、未登记、停用与已激活用户均有明确归属', async () => {
  const { db, clock, call } = setup('2026-11-07T20:00:00')
  await call('saveChannel', { code: 'source-a', label: '来源甲', enabled: true })
  await call('saveChannel', { code: 'source-b', label: '来源乙', enabled: true })
  const first = await call('captureEntry', { ref: 'source-a' }, 'new-user')
  clock.now += 5000
  const later = await call('captureEntry', { ref: 'source-b' }, 'new-user')
  assert.equal(first.captured, true); assert.equal(later.captured, false); assert.equal(later.source, 'source-a')
  const entry = db.inspect('n_attributions', 'new-user')
  assert.equal(entry.arrivedAt, first.serverNow); assert.equal(entry.attributionUntil, first.serverNow + DAY)
  assert.equal(entry.uid, 'new-user'); assert.equal(entry.firstNightIdAtEntry, null)
  await call('captureEntry', {}, 'no-ref')
  assert.equal((await call('captureEntry', { ref: 'source-a' }, 'no-ref')).source, 'unknown')
  assert.equal((await call('captureEntry', { ref: 'not-registered' }, 'missing')).source, 'unknown')
  user(db, 'existing', ['20261106'])
  await call('captureEntry', { ref: 'source-a' }, 'existing')
  assert.equal(db.inspect('n_attributions', 'existing').firstNightIdAtEntry, '20261106')
})

test('M2 并发首次到达只建立一份来源，未知提交重试不会改写', async () => {
  const { db, call } = setup()
  const [first, second] = await Promise.all([call('captureEntry', { ref: 'share' }, 'visitor'), call('captureEntry', {}, 'visitor')])
  assert.equal(Number(first.captured) + Number(second.captured), 1)
  assert.equal(first.source, second.source); assert.equal(db.rows('n_attributions').length, 1)
  db.controls.loseAck = true
  await assert.rejects(() => call('captureEntry', { ref: 'share' }, 'lost-ack'))
  assert.equal((await call('captureEntry', {}, 'lost-ack')).source, 'share')
  assert.equal(db.rows('n_attributions').length, 2)
})

test('M2 渠道转化按24小时首次真实激活计算；旧用户、迟到激活、未成熟到达分开', async () => {
  const { db, clock, call } = setup('2026-11-07T21:00:00')
  user(db, 'old-user', ['20261106'])
  for (const id of ['converted', 'late', 'old-user', 'no-close', 'test-private-id', admin]) await call('captureEntry', { ref: 'share' }, id)
  user(db, 'converted', ['20261107'])
  user(db, 'late', ['20261108']) // Exactly 25 hours after arrival: too late.
  user(db, 'old-user', ['20261106', '20261107'])
  user(db, 'test-private-id', ['20261107']); user(db, admin, ['20261107'])
  user(db, 'pre-collection', ['20261107']) // Never captured: no arrival fabricated.
  clock.now = at('2026-11-08T23:00:00')
  await call('captureEntry', { ref: 'share' }, 'recent')
  clock.now = at('2026-11-09T01:00:00')
  const result = await call('getDashboard', { from: '20261107', to: '20261108' })
  const share = result.channels.find(row => row.code === 'share')
  assert.deepEqual({ ...share, label: undefined, enabled: undefined, code: undefined }, { code: undefined, label: undefined, enabled: undefined, arrivals: 5, matureArrivals: 4, immatureArrivals: 1, activations: 1, convertedMature: 1, conversionRate: 0.25 })
  assert.equal(result.excludedAccounts, 2)
  assert.equal(result.totals.activations, 3) // converted, late, pre-collection.
  assert.equal(result.totals.users, 4)
  for (const secret of ['converted', 'old-user', 'no-close', admin, 'test-private-id', 'pre-collection']) assert.ok(!JSON.stringify(result).includes(`"${secret}"`))
})

test('M2 24小时到达窗口不含结束点；未成熟转化不混入成熟转化分母', async () => {
  const { db, clock, call } = setup('2026-11-07T22:00:00')
  await call('captureEntry', {}, 'boundary')
  user(db, 'boundary', ['20261108'])
  clock.now = at('2026-11-08T21:00:00')
  await call('captureEntry', {}, 'fresh')
  user(db, 'fresh', ['20261108'])
  clock.now = at('2026-11-08T22:00:00')
  const result = await call('getDashboard', { from: '20261107', to: '20261108' })
  const unknown = result.channels.find(row => row.code === 'unknown')
  assert.equal(unknown.arrivals, 2); assert.equal(unknown.matureArrivals, 1); assert.equal(unknown.immatureArrivals, 1)
  assert.equal(unknown.activations, 1); assert.equal(unknown.convertedMature, 0); assert.equal(unknown.conversionRate, 0)
})

test('M2 成熟3/7按公共夜晚和06:00边界计算，管理员测试账号从所有指标排除', async () => {
  const { db, clock, call } = setup('2026-11-14T05:59:59')
  user(db, 'returning', ['20261107', '20261108', '20261113'], 'tap')
  user(db, 'once', ['20261107'])
  user(db, 'newer', ['20261108'])
  user(db, admin, ['20261107', '20261108', '20261109'])
  user(db, 'test-private-id', ['20261107'])
  const before = await call('getDashboard', { from: '20261107', to: '20261113' })
  assert.deepEqual([before.retention.mature, before.retention.immature, before.retention.ratio], [0, 3, null])
  clock.now = at('2026-11-14T06:00:00')
  const after = await call('getDashboard', { from: '20261107', to: '20261113' })
  assert.deepEqual([after.retention.activated, after.retention.mature, after.retention.immature, after.retention.reachedThree, after.retention.ratio], [3, 2, 1, 1, 0.5])
  assert.equal(after.totals.records, 5); assert.equal(after.totals.tap, 3); assert.equal(after.totals.hold, 2)
  assert.equal(after.daily.length, 7); assert.equal(after.daily.find(row => row.nightId === '20261110').users, 0)
  assert.equal(after.retention.cohorts[0].activationWeek, '20261102')
  assert.ok(after.channels.every(channel => channel.arrivals === 0 && channel.conversionRate === null))
})

test('M2 日期范围拒绝未来、非法日期及超过31夜；空样本比例为空', async () => {
  const { call } = setup()
  for (const fields of [{ from: '20261001', to: '20261101' }, { from: '20260229', to: '20260301' }, { from: '20261108', to: '20261107' }]) {
    assert.throws(() => validateGrowthAnalyticsRequest({ action: 'getDashboard', ...fields }), error => error.code === 'INVALID_ARG')
  }
  await fails(() => call('getDashboard', { from: '20261117', to: '20261118' }), 'INVALID_ARG')
  const empty = await call('getDashboard', { from: '20261117', to: '20261117' })
  assert.equal(empty.retention.ratio, null); assert.equal(empty.totals.users, 0); assert.equal(empty.consistency, 'checked')
})

test('M2 摘要缺记录、孤立记录、异常时间及读取期间变化都拒绝给出指标', async () => {
  for (const kind of ['missing', 'orphan', 'future', 'closed']) {
    const { db, call } = setup()
    user(db, 'person', ['20261107'])
    if (kind === 'missing') db.seed('n_users', 'person', { uid: 'person', firstNightId: '20261106', lastNightId: '20261107', updatedAt: at('2026-11-07T22:00:00') })
    if (kind === 'orphan') db.seed('n_nights', 'orphan_20261107', { uid: 'orphan', nightId: '20261107', confirmedAt: at('2026-11-07T22:00:00'), method: 'hold' })
    if (kind === 'future') db.seed('n_users', 'person', { uid: 'person', firstNightId: '20261107', lastNightId: '20261107', updatedAt: at('2026-11-17T14:00:00') })
    if (kind === 'closed') db.seed('n_nights', 'person_20261107', { uid: 'person', nightId: '20261107', confirmedAt: at('2026-11-08T06:00:00'), method: 'hold' })
    await fails(() => call('getDashboard', { from: '20261107', to: '20261117' }), 'INTERNAL')
  }
  let reads = 0
  const changed = setup(undefined, { scan: async (db, name, where, options) => {
    if (name === 'n_users' && ++reads === 2) user(db, 'newly-arrived')
    return scanRows(db, name, where, options)
  } })
  user(changed.db, 'person', ['20261107'])
  await fails(() => changed.call('getDashboard', { from: '20261107', to: '20261117' }), 'INTERNAL')
})

test('M2 固定上界游标完整读取多页，超限或扫描期间新增不返回部分数据', async () => {
  const db = createNightDatabase()
  for (let i = 0; i < 205; i++) db.seed('rows', String(i).padStart(4, '0'), { value: i })
  const rows = await scanRows(db, 'rows', {}, { maxRows: 205, pageSize: 30, fields: { value: true } })
  assert.equal(rows.length, 205); assert.equal(new Set(rows.map(row => row._id)).size, 205); assert.equal(rows.at(-1).value, 204)
  await fails(() => scanRows(db, 'rows', {}, { maxRows: 204 }), 'INTERNAL')
  const original = db.collection.bind(db)
  let pages = 0
  db.collection = name => {
    const query = original(name), get = query.get.bind(query)
    query.get = async () => {
      const result = await get()
      if (name === 'rows' && ++pages === 2) db.seed('rows', '9999', { value: 9999 })
      return result
    }
    return query
  }
  await fails(() => scanRows(db, 'rows', {}, { maxRows: 300, pageSize: 30 }), 'INTERNAL')
  const limited = setup(undefined, { maxRows: 1 })
  user(limited.db, 'one'); user(limited.db, 'two')
  await fails(() => limited.call('getDashboard', { from: '20261107', to: '20261117' }), 'INTERNAL')
})
