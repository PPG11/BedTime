const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const Module = require('node:module')
const { createNightDatabase } = require('./helpers/night-db.cjs')
const { createNightActions, validateNightRequest } = require('../cloudfunctions/common/nights')
const { phraseForNight } = require('../cloudfunctions/common/night-phrases')
const serverTime = require('../cloudfunctions/common/night-time')
const clientTime = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'utils/night-time.js'))
const cases = require('./fixtures/night-time.json')
let database, identity
const originalLoad = Module._load
Module._load = function(name, parent, isMain) {
  if (name === 'wx-server-sdk') return { init() {}, database: () => database, getWXContext: () => ({ OPENID: identity }) }
  return originalLoad.call(this, name, parent, isMain)
}
const { expose } = require('../cloudfunctions/common/response')
Module._load = originalLoad
const at = value => Date.parse(value + '+08:00')
function setup() {
  database = createNightDatabase()
  const clock = { now: at('2026-11-07T22:30:00') }
  const actions = createNightActions({ now: () => clock.now })
  const main = expose(actions, { validate: validateNightRequest })
  const call = (action, fields = {}, user = 'alice') => { identity = user; return main({ action, ...fields }) }
  const close = (night = '20261107', method = 'hold', user = 'alice') => call('closeLight', { clientNightId: night, method }, user)
  return { db: database, clock, call, close }
}

test('M1 前后端共用日期场景：窗口、中午、午夜、跨月年和闰日', () => {
  for (const [when, nightId, phase] of cases) {
    const now = Date.parse(when)
    const expected = serverTime.resolveNight(now)
    assert.equal(expected.nightId, nightId); assert.equal(expected.phase, phase)
    assert.deepEqual(clientTime.resolveNight(now), expected)
    assert.ok(expected.nextOpenAt > now)
    assert.ok(clientTime.nextNightBoundary(now) > now)
  }
  for (const value of ['20260229', '20261301', '20261131', '00000101', '2026-1107', null, 20261107]) {
    assert.equal(serverTime.isNightId(value), false); assert.equal(clientTime.isNightId(value), false)
  }
})

test('首次 getState 并发建档不重置偏好；所有返回带服务端时间', async () => {
  const { call, db } = setup()
  const replies = await Promise.all([call('getState'), call('getState')])
  assert.deepEqual(replies[0], replies[1]); assert.equal(db.rows('n_users').length, 1)
  assert.equal(replies[0].data.userId, 'alice'); assert.equal(replies[0].data.record, null)
  await call('setPrefs', { prefs: { sound: true } })
  const state = (await call('getState')).data
  assert.deepEqual(state.prefs, { sound: true, haptics: true, reduceMotion: false })
  assert.equal(typeof state.serverNow, 'number')
  const injected = await call('getState', { userInfo: { openId: 'bob', appId: 'transport-only' }, tcbContext: { OPENID: 'bob' } })
  assert.equal(injected.data.userId, 'alice', '平台附加字段不参与鉴权')
})

test('双提交只创建一条记录，原句、方式、时间和首次摘要保持一致', async () => {
  const { close, call, db } = setup()
  const [a, b] = await Promise.all([close(), close('20261107', 'tap')])
  assert.equal(a.code, 'OK'); assert.equal(b.code, 'OK')
  assert.equal(Number(a.data.created) + Number(b.data.created), 1)
  assert.deepEqual(a.data.record, b.data.record)
  assert.equal(a.data.isFirstEver, true); assert.equal(b.data.isFirstEver, true)
  assert.equal(db.rows('n_nights').length, 1); assert.equal(db.rows('n_phrases').length, 1)
  const state = (await call('getState')).data
  assert.deepEqual(state.record, state.lastRecord)
  assert.equal(state.firstNightId, '20261107'); assert.equal(state.lastNightId, '20261107')
  assert.deepEqual(Object.keys(state.record).sort(), ['confirmedAt', 'method', 'nightId', 'phraseId', 'phraseText', 'phraseVersion'])
})

test('未开放、窗口关闭与跨夜均拒绝新建；已有记录优先于这些限制', async () => {
  const { clock, close, db } = setup()
  clock.now = at('2026-11-07T19:59:59')
  assert.equal((await close()).code, 'WINDOW_NOT_OPEN')
  clock.now = at('2026-11-07T20:00:00')
  const first = (await close()).data
  for (const when of ['2026-11-08T06:00:00', '2026-11-08T12:00:00', '2026-11-08T20:00:00']) {
    clock.now = at(when)
    const repeated = (await close()).data
    assert.equal(repeated.created, false); assert.deepEqual(repeated.record, first.record)
  }
  assert.equal((await close('20261107', 'tap', 'bob')).code, 'NIGHT_CHANGED')
  assert.equal(db.rows('n_nights').length, 1)
})

test('非事务读空后，事务内发现另一请求记录：过关窗和跨夜仍返回原回执', async () => {
  for (const when of ['2026-11-08T06:00:00', '2026-11-08T12:00:00']) {
    const { db, clock, close } = setup()
    db.controls.beforeTransaction = async () => {
      const other = await close()
      assert.equal(other.data.created, true)
      clock.now = at(when)
    }
    const result = await close()
    assert.equal(result.code, 'OK'); assert.equal(result.data.created, false)
    assert.equal(db.rows('n_nights').length, 1)
  }
})

test('事务重试重新读取时间：跨过 06:00 后不能提交旧尝试的写入', async () => {
  const { db, clock, close } = setup()
  clock.now = at('2026-11-08T05:59:59')
  db.controls.conflictOnce = true
  db.controls.onConflict = () => { clock.now = at('2026-11-08T06:00:00') }
  const reply = await close()
  assert.equal(reply.code, 'WINDOW_NOT_OPEN'); assert.equal(reply.data.phase, 'closed')
  assert.equal(db.rows('n_nights').length, 0); assert.equal(db.rows('n_phrases').length, 0)
})

test('部分失败整体回滚，丢失提交回执只能核对后返回 created false', async t => {
  const { db, close, call } = setup()
  await call('getState')
  db.controls.failWrite = 3
  t.mock.method(console, 'error', () => {})
  assert.equal((await close()).code, 'INTERNAL')
  assert.equal(db.rows('n_nights').length, 0); assert.equal(db.rows('n_phrases').length, 0)
  assert.equal(db.inspect('n_users', 'alice').lastNightId, null)
  db.controls.failWrite = 0; db.controls.loseAck = true
  const recovered = await close()
  assert.equal(recovered.code, 'OK'); assert.equal(recovered.data.created, false)
  assert.equal(db.rows('n_nights').length, 1)
})

test('同夜句子共享冻结稿，私人记录不因发布稿后续变化而重算', async () => {
  const { close, call, db } = setup()
  const original = phraseForNight('20261107', 1)
  db.seed('n_phrases', '20261107', { ...original, text: '已经冻结的句子。', phraseVersion: 2 })
  const [a, b] = await Promise.all([close(), close('20261107', 'tap', 'bob')])
  assert.equal(a.data.record.phraseText, '已经冻结的句子。')
  assert.equal(b.data.record.phraseText, a.data.record.phraseText)
  db.seed('n_phrases', '20261107', { ...original, text: '仅用于测试的外部修改。' })
  assert.equal((await call('getNight', { nightId: '20261107' })).data.record.phraseText, '已经冻结的句子。')
})

test('30 句轮换锚点、负余数、跨年和 30 夜重复周期正确', () => {
  assert.equal(phraseForNight('20261107', 1).phraseId, 'p001')
  assert.equal(phraseForNight('20261106', 1).phraseId, 'p030')
  assert.equal(phraseForNight('20261207', 1).phraseId, 'p001')
  const ids = new Set()
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.UTC(2026, 10, 7 + i)).toISOString().slice(0, 10).replaceAll('-', '')
    const phrase = phraseForNight(date, 1)
    assert.ok(phrase.text.length <= 40); ids.add(phrase.phraseId)
  }
  assert.equal(ids.size, 30)
})

test('鉴权与允许字段：不同用户不可读，伪造身份、日期、类型和超长请求被拒绝', async () => {
  const { call, close } = setup()
  await close()
  assert.equal((await call('getNight', { nightId: '20261107' }, 'bob')).data.record, null)
  assert.equal((await call('getState', {}, null)).code, 'UNAUTHORIZED')
  for (const [action, fields] of [
    ['constructor', {}], ['getState', { uid: 'bob' }], ['getNight', { nightId: '20260229' }],
    ['getNight', { nightId: '20261108' }], ['closeLight', { clientNightId: '20261107', method: 'tap', uid: 'bob' }],
    ['setPrefs', { prefs: {} }], ['setPrefs', { prefs: { sound: 'true' } }],
    ['setPrefs', { prefs: { dimScreen: true } }], ['getState', { extra: 'x'.repeat(16384) }]
  ]) assert.equal((await call(action, fields)).code, 'INVALID_ARG', action + JSON.stringify(fields).slice(0, 60))
})

test('不同偏好字段并发更新不互相覆盖，建档与关灯不重置设置', async () => {
  const { call, close, db } = setup()
  await Promise.all([call('setPrefs', { prefs: { sound: true } }), call('setPrefs', { prefs: { haptics: false } }), call('getState')])
  await close()
  assert.deepEqual(db.inspect('n_users', 'alice').prefs, { sound: true, haptics: false, reduceMotion: false })
  assert.equal((await call('getState')).data.lastNightId, '20261107')
})

test('私有归档游标分页稳定，不读他人记录，不返回内部字段', async () => {
  const { call, db } = setup()
  for (let i = 1; i <= 31; i++) {
    const nightId = `202610${String(i).padStart(2, '0')}`
    for (const uid of ['alice', 'bob']) db.seed('n_nights', `${uid}_${nightId}`, { uid, nightId, confirmedAt: 1, method: 'tap', phraseId: 'p001', phraseText: uid, phraseVersion: 1, poolVersion: 1 })
  }
  const first = (await call('getArchive')).data
  assert.equal(first.items.length, 30); assert.equal(first.nextCursor, '20261002')
  assert.ok(first.items.every(row => row.phraseText === 'alice' && !('uid' in row) && !('poolVersion' in row)))
  db.seed('n_nights', 'alice_20261107', { uid: 'alice', nightId: '20261107', phraseText: 'new' })
  const last = (await call('getArchive', { cursor: first.nextCursor })).data
  assert.deepEqual(last.items.map(row => row.nightId), ['20261001']); assert.equal(last.nextCursor, null)
  for (const fields of [{ limit: 31 }, { limit: 0 }, { cursor: '20260229' }, { uid: 'bob' }]) assert.equal((await call('getArchive', fields)).code, 'INVALID_ARG')
})

const event = (id, name = 'ceremony_done_view', props = {}) => ({ eventId: id.toString(16).padStart(32, '0'), name, props })
test('事件严格校验、同批去重与跨请求幂等，不覆盖已存事件', async () => {
  const { call, db } = setup()
  const a = event(1)
  const first = (await call('track', { events: [a, a, event(2)] })).data
  assert.equal(first.acceptedIds.length, 2)
  const again = (await call('track', { events: [event(1, 'exit_tap'), event(3)] })).data
  assert.deepEqual(again.duplicateIds, [a.eventId]); assert.equal(again.acceptedIds.length, 1)
  assert.equal(db.rows('n_events').find(row => row.eventId === a.eventId).name, 'ceremony_done_view')
  assert.equal(db.inspect('n_users', 'alice').eventBudget.accepted, 3)
  assert.ok(db.rows('n_events').every(row => row.receivedDateKey === '20261107' && !('receivedAt' in row)))
  for (const events of [[], Array.from({ length: 11 }, () => a), [{ ...a, uid: 'bob' }], [event(1, 'unknown')], [event(2, 'night_view', { phase: 'open', hasRecord: false, phrase: 'secret' })], [event(3, 'card_export_result', { stage: 'render', ok: false, code: 'OK' })]]) {
    assert.equal((await call('track', { events })).code, 'INVALID_ARG')
  }
  assert.equal(db.rows('n_events').length, 3)
})

test('事件预算在事务内收敛，超额整批拒绝、部分失败回滚，下一夜重置', async t => {
  const { call, db, clock } = setup()
  await call('getState')
  db.seed('n_users', 'alice', { ...db.inspect('n_users', 'alice'), eventBudget: { nightId: '20261107', accepted: 99 } })
  const replies = await Promise.all([call('track', { events: [event(1)] }), call('track', { events: [event(2)] })])
  assert.deepEqual(replies.map(reply => reply.code).sort(), ['OK', 'RATE_LIMITED'])
  assert.equal(db.rows('n_events').length, 1); assert.equal(db.inspect('n_users', 'alice').eventBudget.accepted, 100)
  assert.equal((await call('track', { events: [event(3), event(4)] })).code, 'RATE_LIMITED')
  clock.now = at('2026-11-08T12:00:00')
  db.controls.failWrite = 2; t.mock.method(console, 'error', () => {})
  assert.equal((await call('track', { events: [event(3), event(4)] })).code, 'INTERNAL')
  assert.equal(db.rows('n_events').length, 1)
  db.controls.failWrite = 0
  assert.equal((await call('track', { events: [event(3), event(4)] })).code, 'OK')
  assert.equal(db.inspect('n_users', 'alice').eventBudget.accepted, 2)
})
