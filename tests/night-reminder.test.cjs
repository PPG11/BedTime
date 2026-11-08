const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createHash } = require('node:crypto')
const { createNightActions, validateNightRequest } = require('../cloudfunctions/common/nights')
const { dispatchReminders, dueAtFor, validateConfig } = require('../cloudfunctions/common/night-reminders')
const { createNightDatabase } = require('./helpers/night-db.cjs')
const clientTime = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'utils/night-reminder.js'))
const at = value => Date.parse(value + '+08:00')
const config = { enabled: true, templateId: 'test_template_123456', miniprogramState: 'trial', fields: [{ key: 'time10', source: 'dueAt' }, { key: 'thing3', text: '今天可以慢慢收尾了，来关一盏灯。' }] }
const input = (changes = {}) => ({ requestId: 'request_alice_000001', revision: 0, nightId: '20261108', time: '22:30', templateId: config.templateId, ...changes })
function fixture(initial = '2026-11-08T21:00:00', reminderConfig = config) {
  const db = createNightDatabase(); let clock = at(initial)
  const actions = createNightActions({ now: () => clock, reminderConfig })
  return { db, actions, now: () => clock, setTime: value => { clock = at(value) }, call: (action, data = {}, uid = 'alice') => {
    const event = { action, ...data }; validateNightRequest(event); return actions[action](db, uid, event)
  } }
}
test('提醒只在有效配置下开放，拒绝伪造身份、模板、任意日期和窗口外时间', async () => {
  const f = fixture()
  for (const patch of [{ uid: 'bob' }, { testMode: true }, { time: '06:00' }, { time: '19:59' }, { nightId: '20260230' }, { revision: -1 }, { requestId: 1234567890123456 }]) {
    assert.throws(() => f.call('scheduleReminder', input(patch)), error => error.code === 'INVALID_ARG')
  }
  await assert.rejects(f.call('scheduleReminder', input({ templateId: 'wrong' })), error => error.code === 'REMINDER_UNAVAILABLE')
  await assert.rejects(f.call('scheduleReminder', input({ nightId: '20261110' })), error => error.code === 'INVALID_ARG')
  const disabled = createNightActions({ now: f.now, reminderConfig: { enabled: false } })
  assert.equal((await disabled.getState(f.db, 'bob')).reminderAvailable, false)
  assert.equal((await disabled.getReminder(f.db, 'bob')).templateId, null)
  await assert.rejects(disabled.scheduleReminder(f.db, 'bob', input()), error => error.code === 'REMINDER_UNAVAILABLE')
  const invalid = { ...config, fields: [{ key: 'thing3', text: '字'.repeat(21) }] }
  assert.throws(() => validateConfig(invalid))
  const broken = createNightActions({ now: f.now, reminderConfig: invalid })
  assert.equal((await broken.getState(f.db, 'bob')).reminderAvailable, false, '可选配置出错不影响核心关灯')
})
test('临时测试只对指定账号开放半小时，保留真实关灯记录，发送一次标记明确的开发版提醒', async () => {
  const testConfig = { ...config, quickTest: { userHash: createHash('sha256').update('alice').digest('hex'), until: at('2026-11-08T21:30:00') } }
  const f = fixture('2026-11-08T21:00:00', testConfig)
  const closed = await f.call('closeLight', { clientNightId: '20261108', method: 'tap' })
  assert.equal((await f.call('getReminder')).testUntil, testConfig.quickTest.until)
  assert.equal((await f.call('getReminder', {}, 'bob')).testUntil, null)
  await f.call('closeLight', { clientNightId: '20261108', method: 'tap' }, 'bob')
  await assert.rejects(f.call('scheduleReminder', input({ time: '21:02' }), 'bob'), error => error.code === 'REMINDER_NIGHT_DONE')
  await assert.rejects(f.call('scheduleReminder', input({ time: '21:31' })), error => error.code === 'REMINDER_NIGHT_DONE')
  await f.call('scheduleReminder', input({ time: '21:02' }))
  assert.equal(f.db.inspect('n_users', 'alice').reminder.testMode, true)
  f.setTime('2026-11-08T21:02:00')
  const sent = [], options = { now: f.now, config: testConfig, send: async message => { sent.push(message); return { errCode: 0 } } }
  await dispatchReminders(f.db, options); await dispatchReminders(f.db, options)
  assert.equal(sent.length, 1); assert.match(sent[0].data.thing3.value, /测试提醒/); assert.equal(sent[0].miniprogramState, 'developer')
  assert.deepEqual((await f.call('getState')).record, closed.record)
  await assert.rejects(f.call('scheduleReminder', input({ requestId: 'request_alice_000002', revision: 1, time: '21:05' })), error => error.code === 'REMINDER_ALREADY_ATTEMPTED')
  f.setTime('2026-11-08T21:30:00'); assert.equal((await f.call('getReminder')).testUntil, null)
})
test('测试许可到期或撤销后不再发送测试预约，普通已关灯预约仍被拒绝', async () => {
  for (const expired of [false, true]) {
    const testConfig = { ...config, quickTest: { userHash: createHash('sha256').update('alice').digest('hex'), until: at('2026-11-08T21:30:00') } }
    const f = fixture('2026-11-08T21:00:00', testConfig)
    await f.call('scheduleReminder', input({ time: '21:29' }))
    f.setTime(expired ? '2026-11-08T21:30:00' : '2026-11-08T21:29:00')
    const counts = await dispatchReminders(f.db, { now: f.now, config: expired ? testConfig : config, send: async () => assert.fail('测试已停用，不得发送') })
    assert.equal(counts.skipped, 1)
  }
  const normal = fixture()
  assert.equal((await normal.call('getReminder')).testUntil, null)
  await normal.call('closeLight', { clientNightId: '20261108', method: 'tap' })
  await assert.rejects(normal.call('scheduleReminder', input()), error => error.code === 'REMINDER_NIGHT_DONE')
})
test('北京时间预约跨午夜、正午与月末，前后端选时一致；不偷偷把过期请求排到明天', async () => {
  assert.equal(dueAtFor('20261108', '00:30'), at('2026-11-09T00:30:00'))
  for (const [date, time, expected] of [
    ['2026-11-08T19:59:00', '20:00', '20261108'], ['2026-11-08T20:00:00', '20:00', '20261109'],
    ['2026-11-08T23:59:59', '00:30', '20261108'], ['2026-11-09T05:59:00', '05:59', '20261109'],
    ['2026-11-09T06:00:00', '20:00', '20261109'], ['2026-11-09T11:59:59', '20:00', '20261109'],
    ['2026-11-09T12:00:00', '20:00', '20261109'], ['2026-12-31T23:59:59', '00:30', '20261231']
  ]) {
    const choice = clientTime.nextReminderChoice(at(date), time, null, null)
    assert.equal(choice.nightId, expected)
    assert.equal(choice.dueAt, dueAtFor(choice.nightId, time))
    const f = fixture(date)
    assert.equal((await f.call('scheduleReminder', input({ nightId: choice.nightId, time }))).reminder.dueAt, choice.dueAt)
  }
  const f = fixture('2026-11-08T22:29:01')
  await assert.rejects(f.call('scheduleReminder', input()), error => error.code === 'REMINDER_TIME_PASSED')
  assert.equal(f.db.rows('n_users').length, 0)
  assert.equal(clientTime.nextReminderChoice(at('2026-11-08T21:00:00'), '22:30', '20261108', null).nightId, '20261109')
})
test('双提交只有一个预约；本人隔离，关灯和偏好不覆盖提醒', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([f.call('scheduleReminder', input()), f.call('scheduleReminder', input())])
  assert.deepEqual(a.reminder, b.reminder); assert.equal(f.db.rows('n_users').length, 1)
  assert.equal((await f.call('getReminder', {}, 'bob')).reminder, null)
  assert.deepEqual(Object.keys(a.reminder).sort(), ['dueAt', 'nightId', 'requestId', 'revision', 'status', 'time'])
  await f.call('setPrefs', { prefs: { sound: true } })
  await f.call('closeLight', { clientNightId: '20261108', method: 'tap' })
  assert.deepEqual((await f.call('getReminder')).reminder, a.reminder)
  assert.equal((await f.call('getState')).prefs.sound, true)
})
test('取消幂等、旧重试不复活预约，旧取消不能取消另一条安排', async () => {
  const f = fixture(), saved = (await f.call('scheduleReminder', input())).reminder
  const cancel = { requestId: saved.requestId, revision: saved.revision }
  const a = await f.call('cancelReminder', cancel), b = await f.call('cancelReminder', cancel)
  assert.deepEqual(a, b); assert.equal(a.reminder.status, 'cancelled')
  assert.equal((await f.call('scheduleReminder', input())).reminder.status, 'cancelled')
  await f.call('scheduleReminder', input({ requestId: 'request_alice_000002', revision: 2, time: '23:00' }))
  await assert.rejects(f.call('cancelReminder', cancel), error => error.code === 'REMINDER_CHANGED')
  await assert.rejects(f.call('scheduleReminder', input()), error => error.code === 'REMINDER_CHANGED')
  await assert.rejects(f.call('cancelReminder', { ...cancel, revision: 3 }, 'bob'), error => error.code === 'REMINDER_CHANGED')
})
test('预约写入丢回执可以回读和原请求重试；重试不变更原时间', async () => {
  const f = fixture(); f.db.controls.loseAck = true
  await assert.rejects(f.call('scheduleReminder', input()))
  assert.equal((await f.call('getReminder')).reminder.status, 'pending')
  assert.equal((await f.call('scheduleReminder', input())).reminder.revision, 1)
  await assert.rejects(f.call('scheduleReminder', input({ time: '23:00' })), error => error.code === 'INVALID_ARG')
})
test('重复与并发定时调用只发送一次，模板数据固定，不携带私人夜句或关灯时间', async () => {
  const f = fixture(); await f.call('scheduleReminder', input()); f.setTime('2026-11-08T22:30:00')
  const sent = [], options = { now: f.now, config, send: async value => { sent.push(value); return { errCode: 0 } } }
  await Promise.all([dispatchReminders(f.db, options), dispatchReminders(f.db, options)])
  await dispatchReminders(f.db, options)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], { touser: 'alice', templateId: config.templateId, page: 'pages/night/index', miniprogramState: 'trial', lang: 'zh_CN', data: { time10: { value: '2026-11-08 22:30' }, thing3: { value: config.fields[1].text } } })
  assert.equal((await f.call('getReminder')).reminder.status, 'sent')
  await assert.rejects(f.call('scheduleReminder', input({ requestId: 'request_alice_000002', revision: 1, time: '23:30' })), error => error.code === 'REMINDER_ALREADY_ATTEMPTED')
})
test('发送前跳过已关灯、已取消和过期安排，06:00 后不补发', async () => {
  for (const kind of ['closed', 'cancelled', 'expired', 'window-closed']) {
    const f = fixture(), time = kind === 'window-closed' ? '05:59' : '22:30'
    const saved = await f.call('scheduleReminder', input({ time }))
    if (kind === 'closed') await f.call('closeLight', { clientNightId: '20261108', method: 'tap' })
    if (kind === 'cancelled') await f.call('cancelReminder', { requestId: saved.reminder.requestId, revision: 1 })
    f.setTime(kind === 'window-closed' ? '2026-11-09T06:00:00' : kind === 'expired' ? '2026-11-08T22:35:00' : '2026-11-08T22:30:00')
    let sends = 0
    await dispatchReminders(f.db, { now: f.now, config, send: async () => { sends++; return { errCode: 0 } } })
    assert.equal(sends, 0, kind)
    assert.equal((await f.call('getReminder')).reminder.status, kind === 'closed' ? 'skipped' : kind === 'cancelled' ? 'cancelled' : 'expired')
  }
})
test('取消与领取发送竞争只收敛为取消或一次发送，发送开始后不能假报取消成功', async () => {
  const f = fixture(); await f.call('scheduleReminder', input()); f.setTime('2026-11-08T22:30:00')
  let release, sends = 0
  const sending = dispatchReminders(f.db, { now: f.now, config, send: () => { sends++; return new Promise(resolve => { release = resolve }) } })
  while (!release) await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.call('cancelReminder', { requestId: input().requestId, revision: 1 }), error => error.code === 'REMINDER_TOO_LATE')
  release({ errCode: 0 }); await sending
  assert.equal(sends, 1); assert.equal((await f.call('getReminder')).reminder.status, 'sent')
})
test('领取事务回执不明时不发送；网络超时与平台拒绝不重发', async () => {
  const f = fixture(); await f.call('scheduleReminder', input()); f.setTime('2026-11-08T22:30:00')
  f.db.controls.loseAck = true; let sends = 0
  const options = { now: f.now, config, send: async () => { sends++; return { errCode: 0 } } }
  await dispatchReminders(f.db, options); await dispatchReminders(f.db, options)
  assert.equal(sends, 0)
  f.setTime('2026-11-08T22:35:00'); assert.equal((await f.call('getReminder')).reminder.status, 'unknown')
  for (const failure of ['timeout', 'refused']) {
    const g = fixture(); await g.call('scheduleReminder', input()); g.setTime('2026-11-08T22:30:00')
    let count = 0
    const opts = { now: g.now, config, sendTimeoutMs: 2, send: () => { count++; return failure === 'timeout' ? new Promise(() => {}) : Promise.reject({ errCode: 43101 }) } }
    await dispatchReminders(g.db, opts); await dispatchReminders(g.db, opts)
    assert.equal(count, 1); assert.equal((await g.call('getReminder')).reminder.status, failure === 'timeout' ? 'unknown' : 'failed')
  }
})
test('发送回写不覆盖新预约，定时入口拒绝小程序伪造 timer 参数', async () => {
  const f = fixture(); await f.call('scheduleReminder', input()); f.setTime('2026-11-08T22:30:00')
  await dispatchReminders(f.db, { now: f.now, config, send: async () => {
    const user = f.db.inspect('n_users', 'alice')
    f.db.seed('n_users', 'alice', { ...user, reminder: { ...user.reminder, requestId: 'request_alice_000002', revision: 2, status: 'pending' } })
    return { errCode: 0 }
  } })
  assert.equal(f.db.inspect('n_users', 'alice').reminder.requestId, 'request_alice_000002')
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/bedtimeReminderDispatch/index.js'), 'utf8')
  for (const [trigger, openid, platformSource, timerTicket, allowed] of [
    ['', 'alice', 'wx_client', '', false], ['timer', 'alice', 'wx_client', '', false],
    ['', '', '', '', false], ['timer', '', '', '', true],
    // Observed WeChat IDE timer: non-SCF source, no user, platform timer ticket.
    ['other', '', 'wx_trigger', 'platform-test-ticket', true],
    ['other', 'alice', 'wx_trigger', 'platform-test-ticket', false],
    ['other', '', 'wx_trigger', '', false], ['other', '', 'wx_client', 'platform-test-ticket', false]
  ]) {
    let called = 0
    const context = { exports: {}, process: { env: { TRIGGER_SRC: trigger, TCB_SOURCE: platformSource, WX_TRIGGER_API_TOKEN_V0: timerTicket } }, console, require(name) {
      if (name === 'common/cloud') return { cloud: { getWXContext: () => ({ OPENID: openid }), openapi: { subscribeMessage: { send() {} } } }, getDb: () => ({}) }
      return { dispatchReminders: async () => { called++; return {} } }
    } }
    vm.runInNewContext(source, context)
    const result = await context.exports.main({ Type: 'Timer', TriggerName: 'nightReminderMinute', TCB_SOURCE: 'wx_trigger', WX_TRIGGER_API_TOKEN_V0: 'forged-ticket',
      tcbContext: { TCB_SOURCE: 'wx_trigger', WX_TRIGGER_API_TOKEN_V0: 'forged-ticket' } })
    assert.equal(called, allowed ? 1 : 0); assert.equal(result.code, allowed ? 'OK' : 'UNAUTHORIZED')
  }
})
