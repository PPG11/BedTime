const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = process.env.BEDTIME_TEST_OUTPUT
require.cache[require.resolve(path.join(root, 'config/runtime.js'))] = { exports: { runtime: { cloudEnvId: 'test-only', cloudEnabled: true } } }
const { nightApi } = require(path.join(root, 'services/night.js'))
const { resolveNight } = require(path.join(root, 'utils/night-time.js'))
const serverNow = Date.parse('2026-11-07T22:30:00+08:00')
const confirmed = { nightId: '20261107', confirmedAt: serverNow, method: 'hold', phraseId: 'p001', phraseText: '今天就到这里。', phraseVersion: 1 }
const state = () => ({ serverNow, ...resolveNight(serverNow), userId: 'alice', prefs: { sound: false, haptics: true, reduceMotion: false }, record: null, lastRecord: null, firstNightId: null, lastNightId: null })
function transport(handler) { global.wx = { cloud: { init() {}, callFunction: handler } } }
function reply(data) { return { result: { code: 'OK', data } } }

test('M1 只调用 bedtimeNight，返回投影不泄漏后端私有字段', async () => {
  const calls = []
  transport(async options => {
    calls.push(options)
    if (options.data.action === 'getState') return reply(state())
    return reply({ serverNow, record: { ...confirmed, uid: 'private-id', poolVersion: 1 }, created: true, isFirstEver: true })
  })
  assert.equal((await nightApi.getState()).userId, 'alice')
  const result = await nightApi.closeLight('20261107', 'hold')
  assert.deepEqual(result.record, confirmed)
  assert.deepEqual(calls, [
    { name: 'bedtimeNight', data: { action: 'getState' } },
    { name: 'bedtimeNight', data: { action: 'closeLight', clientNightId: '20261107', method: 'hold' } }
  ])
})

test('拒绝不一致夜晚、坏记录、缺失偏好与错误摘要，不能将坏响应显示为成功', async () => {
  for (const patch of [
    { userId: '' }, { phase: 'closed' }, { nextOpenAt: serverNow }, { prefs: { sound: false } },
    { record: { ...confirmed, nightId: '20261106' } }, { record: { ...confirmed, phraseText: '' } },
    { lastNightId: '20261106', lastRecord: null }
  ]) {
    transport(async () => reply({ ...state(), ...patch }))
    await assert.rejects(nightApi.getState(), error => error.code === 'INTERNAL')
  }
  transport(async () => reply({ serverNow, record: { ...confirmed, nightId: '20261106' }, created: true, isFirstEver: true }))
  await assert.rejects(nightApi.closeLight('20261107', 'hold'), e => e.code === 'INTERNAL')
})

test('平台网络错误与业务拒绝分开，窗口错误保留服务端规则', async () => {
  transport(async () => { throw new Error('network unavailable') })
  await assert.rejects(nightApi.getState(), e => e.code === 'NETWORK')
  const details = { serverNow, ...resolveNight(serverNow) }
  transport(async () => ({ result: { code: 'WINDOW_NOT_OPEN', message: 'closed', data: details } }))
  await assert.rejects(nightApi.closeLight('20261107', 'tap'), e => e.code === 'WINDOW_NOT_OPEN' && e.data.serverNow === serverNow)
})

test('8 秒到达未知阈值会释放等待；底层迟到成功不能再兑现原 Promise', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finish
  transport(() => new Promise(resolve => { finish = resolve }))
  const result = nightApi.closeLight('20261107', 'tap')
  const rejected = assert.rejects(result, e => e.code === 'TIMEOUT')
  t.mock.timers.tick(8000); await rejected
  finish(reply({ serverNow, record: confirmed, created: true, isFirstEver: true }))
  await Promise.resolve()
  transport(async () => reply({ serverNow, record: confirmed }))
  assert.deepEqual((await nightApi.getNight('20261107')).record, confirmed)
})
