const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const reportModule = import('../scripts/night-report.mjs')
const maintenanceModule = import('../scripts/night-maintenance.mjs')
const adminModule = import('../scripts/lib/night-admin.mjs')
const exportModule = import('../scripts/night-export.mjs')
const at = value => Date.parse(value + '+08:00')
function sample() {
  const users = [{ _id: 'alice', uid: 'alice', firstNightId: '20261101', lastNightId: '20261107' }, { _id: 'author', uid: 'author', firstNightId: '20261101', lastNightId: '20261101' }]
  const nights = ['20261101', '20261103', '20261107'].map(nightId => ({ _id: `alice_${nightId}`, uid: 'alice', nightId, confirmedAt: at(`${nightId.slice(0,4)}-${nightId.slice(4,6)}-${nightId.slice(6)}T22:30:00`), method: 'hold' }))
  nights.push({ ...nights[0], uid: 'author', _id: 'author_20261101' })
  return { manifest: { version: 1, env: 'test', exportedAt: '2026-11-08T12:00:00+08:00', collections: { n_users: { scope: 'all', complete: true }, n_nights: { scope: 'all', from: '20261101', to: '20261107', complete: true } } }, collections: { n_users: users, n_nights: nights } }
}

test('3/7仅在A+6夜06:00关闭后进入分母，作者剔除，未成熟比例为null', async () => {
  const { buildReport } = await reportModule
  for (const [time, mature] of [['2026-11-08T05:59:59', 0], ['2026-11-08T06:00:00', 1]]) {
    const report = buildReport(sample(), { from: '20261101', to: '20261101', cutoff: at(time), exclude: ['author'] })
    assert.equal(report.cohorts[0].activated, 1); assert.equal(report.cohorts[0].mature, mature)
    assert.equal(report.cohorts[0].ratio, mature ? 1 : null); assert.equal(report.methods.hold, 3)
    assert.equal(report.consistent, true)
  }
})

test('汇总拒绝不完整范围，摘要不一致时保留问题并暂停比例解释', async () => {
  const { buildReport } = await reportModule, options = { from: '20261101', to: '20261101', cutoff: at('2026-11-08T06:00:00'), exclude: [] }
  const incomplete = sample(); incomplete.manifest.collections.n_nights.to = '20261106'
  assert.throws(() => buildReport(incomplete, options), /范围不足/)
  const inconsistent = sample(); inconsistent.collections.n_users[0].lastNightId = '20261106'
  const report = buildReport(inconsistent, options)
  assert.equal(report.consistent, false); assert.equal(report.cohorts[0].ratio, null)
  assert.throws(() => buildReport(sample(), { ...options, exclude: undefined }), /排除名单/)
  const scoped = sample(); scoped.manifest.collections.n_nights.scope = 'user'
  assert.throws(() => buildReport(scoped, options), /所有用户/)
})

test('事件清理按北京日历日边界；个人删除只列本人三集合，不触及公共夜句', async () => {
  const { planMaintenance } = await maintenanceModule
  const data = sample()
  data.manifest.collections.n_nights.scope = 'all'
  data.manifest.collections.n_events = { complete: true, scope: 'all' }
  data.collections.n_events = [{ _id: 'old', uid: 'alice', receivedDateKey: '20261009' }, { _id: 'keep', uid: 'alice', receivedDateKey: '20261010' }, { _id: 'other', uid: 'bob', receivedDateKey: '20261101' }]
  const expired = planMaintenance(data, { env: 'test', action: 'expire-events', cutoff: at('2026-11-08T00:00:00') })
  assert.equal(expired.dateBefore, '20261010'); assert.deepEqual(expired.entries, [{ collection: 'n_events', id: 'old' }])
  const user = planMaintenance(data, { env: 'test', action: 'delete-user', uid: 'alice', cutoff: at('2026-11-08T00:00:00') })
  assert.equal(user.entries.length, 6); assert.ok(user.entries.every(row => row.id !== 'other' && row.collection !== 'n_phrases'))
  assert.throws(() => planMaintenance(data, { env: 'wrong', action: 'expire-events', cutoff: Date.now() }), /环境/)
})

test('维护执行保留确认任务，恢复查询旧任务而不重发；末尾重新查询验证', async () => {
  const { executePlan } = await maintenanceModule
  const plan = { version: 1, env: 'test', action: 'expire-events', dateBefore: '20261010', entries: [{ collection: 'n_events', id: 'old' }], batches: [], status: 'planned' }
  const calls = [], queries = []
  const tool = async (name, params) => {
    calls.push(name)
    if (params['query-file']) queries.push(JSON.parse(fs.readFileSync(params['query-file'])))
    if (name === 'cloud_db_write_doc') return { success: true, status: 'pending', taskId: 'task1' }
    if (name === 'polling_task_result') return { success: true, status: 'success', result: { success: true, deleted: 1 } }
    return { success: true, data: [] }
  }
  const options = { appid: 'wx0123456789abcdef', tool }
  assert.equal((await executePlan(plan, options)).status, 'awaiting-platform')
  assert.equal((await executePlan(plan, options)).status, 'verified-empty')
  assert.deepEqual(calls, ['cloud_db_write_doc', 'polling_task_result', 'cloud_db_read_doc'])
  assert.deepEqual(queries[0], { receivedDateKey: { $lt: '20261010' }, _id: { $in: ['old'] } })
  assert.equal(plan.batches[0].deleted, 1)
})

test('导出生成可校验清单，条数与文件摘要不符时停止；文件不进入仓库', async t => {
  const { exportNightData } = await exportModule, { loadExport, privatePath } = await adminModule
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bedtime-report-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const data = sample(), calls = []
  const manifest = await exportNightData({ env: 'test', appid: 'wx0123456789abcdef', out: dir, from: '20261101', to: '20261107' }, async (name, params) => { calls.push(name); return { success: true, data: data.collections[params['collection-name']] } })
  assert.equal(manifest.collections.n_nights.count, 4)
  assert.equal(loadExport(dir, ['n_users', 'n_nights']).collections.n_nights.length, 4)
  assert.ok(calls.every(name => name === 'cloud_db_read_doc'))
  fs.appendFileSync(path.join(dir, 'n_nights.jsonl'), '{}\n')
  assert.throws(() => loadExport(dir, ['n_nights']), /摘要不匹配/)
  assert.throws(() => privatePath(process.cwd() + '/export'), /仓库之外/)
})
