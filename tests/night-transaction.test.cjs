const { test } = require('node:test')
const assert = require('node:assert/strict')
const { transact } = require('../cloudfunctions/common/night-transaction')
const { createNightActions } = require('../cloudfunctions/common/nights')
const { createNightDatabase } = require('./helpers/night-db.cjs')
const conflict = () => Object.assign(new Error('document.set:fail -501001 [ResourceUnavailable.TransactionConflict]'), { code: -501001 })

test('真实 SDK 包装的冲突会退避重试；普通资源错误与未知提交不自动重发', async () => {
  const delays = [], options = { sleep: async ms => delays.push(ms), random: () => 0 }
  let attempts = 0
  const db = { async runTransaction(operation) { if (++attempts < 3) throw conflict(); return operation() } }
  assert.equal(await transact(db, () => 'saved', options), 'saved')
  assert.deepEqual(delays, [40, 80])
  for (const error of [new Error('commit acknowledgement lost'), Object.assign(new Error('resource unavailable'), { code: -501001 })]) {
    attempts = 0
    await assert.rejects(transact({ runTransaction() { attempts++; throw error } }, () => {}, options), value => value === error)
    assert.equal(attempts, 1)
  }
  attempts = 0
  await assert.rejects(transact({ runTransaction() { attempts++; throw conflict() } }, () => {}, options))
  assert.equal(attempts, 4)
})

test('外层冲突重试也重新判定关窗；偏好与事件使用同一重试边界', async () => {
  const db = createNightDatabase(), original = db.runTransaction
  let now = Date.parse('2026-11-08T05:59:59+08:00'), fail = true
  const actions = createNightActions({ now: () => now })
  db.runTransaction = operation => {
    if (fail) { fail = false; now = Date.parse('2026-11-08T06:00:00+08:00'); throw conflict() }
    return original(operation)
  }
  await assert.rejects(actions.closeLight(db, 'test', { clientNightId: '20261107', method: 'tap' }), e => e.code === 'WINDOW_NOT_OPEN')
  assert.equal(db.rows('n_nights').length, 0)
  fail = true
  assert.equal((await actions.setPrefs(db, 'test', { prefs: { sound: true } })).prefs.sound, true)
  fail = true
  assert.equal((await actions.track(db, 'test', { events: [{ eventId: 'a'.repeat(32), name: 'exit_tap', props: {} }] })).acceptedIds.length, 1)
})
