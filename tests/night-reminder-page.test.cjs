const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const output = process.env.BEDTIME_TEST_OUTPUT
const { CloudError } = require(path.join(output, 'services/cloud.js'))
function fixture() {
  let definition, uid = 'alice', consent, saves = 0, grants = 0, cancelCalls = 0
  let scheduleError = null, record = null
  const now = Date.parse('2026-11-08T21:00:00+08:00')
  const reply = { serverNow: now, userId: uid, enabled: true, templateId: 'test_template_123456', reminder: null, lastAttemptNightId: null }
  const inputs = []
  const store = { get: () => ({ snapshot: { userId: uid, record } }), activate: async () => true, hide() {} }
  const api = {
    get: async () => ({ ...reply, userId: uid }),
    schedule: async input => {
      saves++; inputs.push({ ...input })
      if (scheduleError) throw scheduleError
      reply.reminder = { requestId: input.requestId, revision: input.revision + 1, nightId: input.nightId, time: input.time, dueAt: Date.parse('2026-11-08T22:30:00+08:00'), status: 'pending' }
      return { ...reply }
    },
    cancel: async (requestId, revision) => { cancelCalls++; reply.reminder = { ...reply.reminder, requestId, revision: revision + 1, status: 'cancelled' }; return { ...reply } }
  }
  const context = { Page: value => { definition = value }, exports: {}, Date, Math,
    wx: { requestSubscribeMessage(options) { grants++; consent = options } },
    require(name) {
      if (name === '../../state/night-store') return { nightStore: store }
      if (name === '../../services/reminder') return { reminderApi: api }
      if (name === '../../utils/night-platform') return { restoreTabBar() {} }
      return require(path.resolve(output, 'pages/reminder', name + '.js'))
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(output, 'pages/reminder/index.js'), 'utf8'), context)
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  page.visible = true
  return { page, reply, api, inputs, saves: () => saves, grants: () => grants, cancels: () => cancelCalls,
    consent: value => consent.success({ [reply.templateId]: value }), failConsent: () => consent.fail({ errMsg: 'requestSubscribeMessage:fail cancel' }),
    uid: value => { uid = value }, error: value => { scheduleError = value }, record: value => { record = value } }
}
test('临时测试默认选到今晚两分钟后，仍需主动同意；许可到期恢复正常日期', async () => {
  const f = fixture(); f.record({ nightId: '20261108' }); f.reply.testUntil = f.reply.serverNow + 30 * 60000
  await f.page.reload()
  assert.equal(f.page.data.time, '21:02'); assert.equal(f.page.data.targetNightId, '20261108'); assert.equal(f.page.data.testing, true)
  assert.equal(f.grants(), 0)
  const saving = f.page.onSubscribe(); f.consent('accept'); await saving
  assert.equal(f.inputs[0].nightId, '20261108'); assert.equal(f.inputs[0].time, '21:02')
  const g = fixture(); g.record({ nightId: '20261108' }); g.reply.testUntil = g.reply.serverNow - 1
  await g.page.reload(); assert.equal(g.page.data.testing, false); assert.equal(g.page.data.targetNightId, '20261109')
})
test('订阅由主动点击同步触发，重复点击只弹一次，同意后才安排并可取消', async () => {
  const f = fixture(); await f.page.reload()
  const saving = f.page.onSubscribe()
  assert.equal(f.grants(), 1); assert.equal(f.saves(), 0)
  await f.page.onSubscribe(); assert.equal(f.grants(), 1)
  f.consent('accept'); await saving
  assert.equal(f.saves(), 1); assert.equal(f.page.data.canCancel, true); assert.equal(f.page.data.canSchedule, false)
  await f.page.onCancel(); assert.equal(f.cancels(), 1); assert.equal(f.page.data.canSchedule, true)
})
test('拒绝、取消、后台返回和身份切换均不能从授权回调偷偷创建预约', async () => {
  for (const outcome of ['reject', 'ban', 'filter', 'cancel', 'hidden', 'identity']) {
    const f = fixture(); await f.page.reload(); const pending = f.page.onSubscribe()
    if (outcome === 'hidden') f.page.deactivate()
    if (outcome === 'identity') f.uid('bob')
    if (outcome === 'cancel') f.failConsent()
    else f.consent(['hidden', 'identity'].includes(outcome) ? 'accept' : outcome)
    await pending; assert.equal(f.saves(), 0, outcome)
  }
})
test('预约超时保留原请求，回读查空不当失败；重试不再订阅也不更改时间', async () => {
  const f = fixture(); await f.page.reload(); f.error(new CloudError('TIMEOUT', 'unknown'))
  const first = f.page.onSubscribe(); f.consent('accept'); await first
  assert.equal(f.page.data.unknown, true); assert.equal(f.page.data.canSchedule, false)
  await f.page.reload(); assert.equal(f.page.data.canRetry, true); assert.equal(f.page.data.canSchedule, false)
  f.page.onTimeChange({ detail: { value: '23:30' } }); assert.equal(f.page.data.time, '22:30')
  f.error(null); await f.page.savePending(f.page.generation)
  assert.deepEqual(f.inputs[0], f.inputs[1]); assert.equal(f.grants(), 1); assert.equal(f.page.pending, null)
})
test('晚到的保存响应不更新隐藏页；新身份不重试旧用户的预约', async () => {
  const f = fixture(); await f.page.reload(); let resolve
  f.api.schedule = () => new Promise(done => { resolve = done })
  const saving = f.page.onSubscribe(); f.consent('accept'); await Promise.resolve(); await Promise.resolve()
  f.page.deactivate(); f.uid('bob')
  resolve({ ...f.reply, reminder: null }); await saving
  assert.equal(f.page.data.scheduledAt, '')
  f.page.visible = true; await f.page.reload(); assert.equal(f.page.pending, null)
})
test('未配置、读取失败与时间过近都不弹订阅；取消超时不假报已取消', async () => {
  const f = fixture(); f.reply.enabled = false; f.reply.templateId = null; await f.page.reload(); await f.page.onSubscribe(); assert.equal(f.grants(), 0)
  const g = fixture(); await g.page.reload(); g.page.data.targetAt = g.reply.serverNow
  await g.page.onSubscribe(); assert.equal(g.grants(), 0); assert.match(g.page.data.notice, /确认新的提醒日期/)
  const h = fixture(); await h.page.reload(); const save = h.page.onSubscribe(); h.consent('accept'); await save
  h.api.cancel = async () => { throw new CloudError('TIMEOUT', 'unknown') }
  await h.page.onCancel(); assert.equal(h.page.data.canSchedule, false); assert.match(h.page.data.notice, /仍可能收到提醒/)
})
