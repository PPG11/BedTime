import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseArgs, assert, asOf, privatePath, loadExport, writePrivate, addDays, beijingDay, isNightId } from './lib/night-admin.mjs'

export function planMaintenance({ manifest, collections }, { env, action, uid, cutoff }) {
  assert(env && env === manifest.env, '环境必须与导出清单一致')
  assert(['expire-events', 'delete-user'].includes(action), '--action 必须为 expire-events 或 delete-user')
  const dateBefore = addDays(beijingDay(cutoff), -29), entries = []
  const names = action === 'expire-events' ? ['n_events'] : ['n_nights', 'n_events', 'n_users']
  if (action === 'delete-user') assert(typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid), '必须提供经核对的单个 OPENID')
  for (const collection of names) {
    const meta = manifest.collections[collection]
    assert(meta?.complete === true, `${collection} 导出不完整`)
    assert(meta.scope === 'all' || (action === 'delete-user' && meta.scope === 'user' && meta.uid === uid), `${collection} 导出范围无效`)
    for (const row of collections[collection]) {
      if (collection === 'n_events') assert(isNightId(row.receivedDateKey), '事件接收日期无效')
      if (action === 'delete-user' && row.uid !== uid) continue
      if (action === 'expire-events' && row.receivedDateKey >= dateBefore) continue
      assert(typeof row._id === 'string' && row._id.length > 0, '维护文档缺少 ID')
      entries.push({ collection, id: row._id })
    }
  }
  return { version: 1, env, action, ...(action === 'delete-user' ? { uid } : { dateBefore }),
    asOf: new Date(cutoff).toISOString(), sourceExportedAt: manifest.exportedAt, entries, batches: [], status: 'planned' }
}
function unpack(result) {
  if (result?.content) {
    const text = result.content.find(item => item.type === 'text')?.text
    if (text) { try { return JSON.parse(text) } catch { /* Continue to validate the original response. */ } }
  }
  return result
}
export function officialTool(name, parameters) {
  const executable = process.env.WECHATIDE_BIN || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
  const args = ['-c', 'Codex', name]
  for (const [key, value] of Object.entries(parameters)) { args.push(`--${key}`); if (value !== true) args.push(String(value)) }
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024 })
  assert(!result.error && result.status === 0, `微信管理工具未成功：${name}（${result.error?.code || `exit ${result.status}`}）；先核对原操作结果，不要盲目重发`)
  const start = result.stdout.indexOf('{')
  assert(start >= 0, '管理工具没有返回 JSON')
  let parsed
  try { parsed = JSON.parse(result.stdout.slice(start)) }
  catch { throw new Error(`管理工具响应不完整：${name}；未确认操作结果，先核对原任务`) }
  assert(parsed.ok === true, parsed.message || '管理工具返回失败')
  return unpack(parsed.result)
}

export async function executePlan(plan, { appid, tool = officialTool, save = () => {} }) {
  assert(plan.version === 1 && typeof plan.env === 'string' && plan.env && Array.isArray(plan.entries) && Array.isArray(plan.batches), '维护清单无效')
  assert(/^wx[a-f0-9]{16}$/.test(appid), '必须提供明确 AppID')
  const allowed = plan.action === 'expire-events' ? ['n_events'] : plan.action === 'delete-user' ? ['n_nights', 'n_events', 'n_users'] : []
  assert(allowed.length && (plan.action !== 'delete-user' || /^[A-Za-z0-9_-]{1,128}$/.test(plan.uid)) && (plan.action !== 'expire-events' || isNightId(plan.dateBefore)), '维护范围无效')
  assert(plan.entries.every(row => allowed.includes(row.collection) && typeof row.id === 'string' && row.id.length), '清单包含越界集合或文档')
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bedtime-maintenance-'))
  const call = async (name, params, query) => {
    if (query) { const file = path.join(folder, 'query.json'); fs.writeFileSync(file, JSON.stringify(query), { mode: 0o600 }); params['query-file'] = file }
    return unpack(await tool(name, params))
  }
  const scope = collection => plan.action === 'expire-events' ? { receivedDateKey: { $lt: plan.dateBefore } } : collection === 'n_users' ? { _id: plan.uid, uid: plan.uid } : { uid: plan.uid }
  try {
    if (!plan.batches.length) {
      for (const collection of allowed) {
        const ids = [...new Set(plan.entries.filter(row => row.collection === collection).map(row => row.id))]
        for (let start = 0; start < ids.length; start += 100) plan.batches.push({ collection, ids: ids.slice(start, start + 100), status: 'new' })
      }
      save(plan)
    }
    for (const batch of plan.batches) {
      assert(allowed.includes(batch.collection) && Array.isArray(batch.ids) && batch.ids.length > 0 && batch.ids.length <= 100 && batch.ids.every(id => plan.entries.some(row => row.collection === batch.collection && row.id === id)), '删除批次超出原预演清单')
      if (batch.status === 'done') continue
      if (batch.status === 'requesting' && !batch.taskId) throw new Error('上次提交回执不明，请先核对云端，禁止盲目重发')
      if (['failed', 'cancelled', 'expired'].includes(batch.status)) throw new Error('原任务未成功；重新导出并预演后再操作')
      let result
      if (batch.taskId) {
        result = await call('polling_task_result', { 'task-id': batch.taskId })
        if (result.status === 'pending') { plan.status = 'awaiting-platform'; save(plan); return plan }
        if (result.status !== 'success') { batch.status = result.status || 'failed'; save(plan); throw new Error('云端确认任务未成功') }
        result = unpack(result.result)
      } else {
        batch.status = 'requesting'; save(plan)
        result = await call('cloud_db_write_doc', { appid, env: plan.env, action: 'delete', 'collection-name': batch.collection, 'is-multi': true }, { ...scope(batch.collection), _id: { $in: batch.ids } })
        if (result.status === 'pending' && result.taskId) { batch.taskId = result.taskId; batch.status = 'pending'; plan.status = 'awaiting-platform'; save(plan); return plan }
      }
      assert(result?.success === true, '云端删除没有明确成功回执')
      batch.status = 'done'; batch.deleted = result.deleted ?? result.deletedCount ?? result.stats?.removed ?? null; save(plan)
    }
    plan.remaining = {}
    for (const collection of allowed) {
      const result = await call('cloud_db_read_doc', { appid, env: plan.env, 'collection-name': collection, limit: 1, projection: JSON.stringify({ _id: 1 }) }, scope(collection))
      assert(result?.success === true && Array.isArray(result.data), '无法复核删除结果')
      plan.remaining[collection] = result.data.length > 0
    }
    plan.status = Object.values(plan.remaining).some(Boolean) ? 'remaining-data' : 'verified-empty'
    plan.verifiedAt = new Date().toISOString(); save(plan); return plan
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.execute) {
      const file = privatePath(args.plan), plan = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert(args.env === plan.env, '执行环境必须再次与计划匹配')
      assert(plan.action !== 'delete-user' || args['owner-paused'] === true, '删除个人数据前须本人核验并暂停使用，传入 --owner-paused')
      const result = await executePlan(plan, { appid: args.appid, save: value => writePrivate(file, JSON.stringify(value, null, 2) + '\n') })
      console.log(`维护状态：${result.status}；清单：${file}`)
      if (result.status !== 'verified-empty') process.exitCode = 2
    } else {
      const names = args.action === 'expire-events' ? ['n_events'] : ['n_users', 'n_nights', 'n_events']
      const plan = planMaintenance(loadExport(args.input, names), { env: args.env, action: args.action, uid: args.uid, cutoff: asOf(args['as-of']) })
      const file = privatePath(args.out); writePrivate(file, JSON.stringify(plan, null, 2) + '\n')
      console.log(`仅预演：${plan.entries.length} 条，未删除。清单：${file}`)
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
