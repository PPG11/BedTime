const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const Module = require('node:module')
const { createNightDatabase } = require('./helpers/night-db.cjs')
const { createNightActions, validateNightRequest } = require('../cloudfunctions/common/nights')
const { phraseForNight, PHRASE_SEGMENTS, PHRASE_CATALOG } = require('../cloudfunctions/common/night-phrases')
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

test('池 1 的 30 句轮换：锚点、负余数与切换前的周期保持不变', () => {
  assert.equal(phraseForNight('20261107', 1).phraseId, 'p001')
  assert.equal(phraseForNight('20261106', 1).phraseId, 'p030')
  assert.equal(phraseForNight('20261110', 1).phraseId, 'p004')
  const ids = new Set()
  for (let i = 0; i < 30; i++) {
    const phrase = phraseForNight(nightAfter('20261008', i), 1)
    assert.equal(phrase.poolVersion, 1); assert.equal(phrase.phraseVersion, 1)
    assert.equal(phrase.phraseId, `p${String(i + 1).padStart(3, '0')}`)
    const previousCycle = phraseForNight(nightAfter('20261008', i - 30), 1)
    assert.equal(phrase.phraseId, previousCycle.phraseId)
    assert.equal(phrase.text, previousCycle.text)
    ids.add(phrase.phraseId)
  }
  assert.equal(ids.size, 30)
})

function nightAfter(nightId, days) {
  const at = Date.UTC(Number(nightId.slice(0, 4)), Number(nightId.slice(4, 6)) - 1, Number(nightId.slice(6, 8)) + days)
  return new Date(at).toISOString().slice(0, 10).replaceAll('-', '')
}

test('句池按未来生效版本接续：切换夜之前沿用池 1，之后使用池 2，并支持特殊日期', () => {
  const [one, two] = PHRASE_SEGMENTS
  assert.equal(two.poolVersion, 2); assert.equal(two.effectiveNightId, '20261111')
  assert.equal(phraseForNight('20261110', 1).poolVersion, 1)
  const first = phraseForNight(two.effectiveNightId, 1)
  assert.deepEqual([first.poolVersion, first.phraseVersion, first.source, first.phraseId], [2, 2, 'rotation', two.pool[0].id])
  assert.equal(phraseForNight(nightAfter(two.effectiveNightId, two.pool.length), 1).phraseId, two.pool[0].id)
  assert.equal(phraseForNight('20261231', 1).source, 'special')
  assert.equal(phraseForNight('20261231', 1).text, two.specials['20261231'].text)
  assert.ok(one.pool.length === 30)
})

test('版本切换后优先使用已冻结的旧版发布稿，历史记录与后续新夜互不改写', async () => {
  const { db, clock, close, call } = setup()
  clock.now = at('2026-11-10T22:30:00')
  const history = (await close('20261110')).data.record
  assert.equal(history.phraseVersion, 1)
  assert.equal(history.phraseText, '不用替今天再补一个结尾。')

  // A prior deployment may already have frozen this night using v1. The new
  // selector would choose q001, but new users must still receive the shared row.
  const frozen = {
    nightId: '20261111', phraseId: 'p005', text: '待办清单翻到背面，也是一张白纸。',
    phraseVersion: 1, poolVersion: 1, source: 'rotation', frozenAt: at('2026-11-11T20:00:00')
  }
  db.seed('n_phrases', '20261111', frozen)
  clock.now = at('2026-11-11T22:30:00')
  assert.equal(phraseForNight('20261111', clock.now).phraseVersion, 2)
  const [a, b] = await Promise.all([close('20261111'), close('20261111', 'tap', 'bob')])
  for (const reply of [a, b]) {
    assert.equal(reply.code, 'OK')
    assert.equal(reply.data.record.phraseText, frozen.text)
    assert.equal(reply.data.record.phraseId, frozen.phraseId)
    assert.equal(reply.data.record.phraseVersion, 1)
  }
  assert.deepEqual(db.inspect('n_phrases', '20261111'), frozen)

  clock.now = at('2026-11-12T22:30:00')
  const next = (await close('20261112')).data.record
  assert.equal(next.phraseVersion, 2)
  assert.equal(next.phraseId, 'q002')
  assert.equal(db.inspect('n_phrases', '20261112').poolVersion, 2)
  assert.deepEqual((await call('getNight', { nightId: '20261110' })).data.record, history)
  assert.deepEqual((await close('20261110', 'tap')).data.record, history)
  assert.deepEqual((await call('getNight', { nightId: '20261111' })).data.record, a.data.record)
  assert.deepEqual(db.inspect('n_phrases', '20261111'), frozen)
})

test('句池质量约束：长度、唯一 id、任意连续 30 夜不重复句子，含切换边界与特殊日期', () => {
  const [one, two] = PHRASE_SEGMENTS
  assert.equal(Object.keys(PHRASE_CATALOG).length, 106)
  assert.equal(new Set(Object.values(PHRASE_CATALOG)).size, 106)
  for (const segment of PHRASE_SEGMENTS) {
    const ids = new Set(), texts = new Set()
    for (const entry of [...segment.pool, ...Object.values(segment.specials)]) {
      assert.ok(entry.text.length > 0 && entry.text.length <= 40, entry.text)
      assert.equal(entry.text, entry.text.trim())
      assert.ok(!ids.has(entry.id) && !texts.has(entry.text), `重复 ${entry.id}`)
      ids.add(entry.id); texts.add(entry.text)
    }
  }
  // Ids that exist in both pools must carry the same text (pool 2 reuses pool 1 lines).
  const oneById = new Map(one.pool.map(entry => [entry.id, entry.text]))
  for (const entry of two.pool) if (oneById.has(entry.id)) assert.equal(entry.text, oneById.get(entry.id))
  for (const entry of Object.values(two.specials)) assert.ok(!two.pool.some(item => item.text === entry.text))
  const nights = Array.from({ length: 800 }, (_, i) => phraseForNight(nightAfter(two.effectiveNightId, i - 30), 1))
  for (let i = 0; i < nights.length; i++) {
    for (let j = i + 1; j < Math.min(nights.length, i + 30); j++) {
      assert.notEqual(nights[i].phraseId, nights[j].phraseId, `${nights[i].nightId} 与 ${nights[j].nightId}`)
      assert.notEqual(nights[i].text, nights[j].text)
    }
  }
  for (const night of Object.keys(two.specials)) assert.ok(night >= two.effectiveNightId)
  const newCount = two.pool.filter(entry => entry.id.startsWith('q')).length
  assert.ok(newCount >= 60, '池 2 应以新句为主')
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
