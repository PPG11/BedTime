import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { officialTool } from './night-maintenance.mjs'
import { assert, parseArgs, privatePath, writePrivate, isNightId } from './lib/night-admin.mjs'
const FIELDS = {
  n_users: ['_id', 'uid', 'firstNightId', 'lastNightId'],
  n_nights: ['_id', 'uid', 'nightId', 'confirmedAt', 'method'],
  n_events: ['_id', 'uid', 'eventId', 'name', 'props', 'receivedNightId', 'receivedDateKey']
}
// The official CLI truncates large result payloads. Keep each page well below
// its response limit, even for the largest allowed event properties.
const PAGE_SIZE = 25
export async function exportNightData({ env, appid, out, uid, from, to, events = false, all = false }, tool = officialTool) {
  assert(typeof env === 'string' && env && /^wx[a-f0-9]{16}$/.test(appid), '请明确提供环境和 AppID')
  assert(all || (isNightId(from) && isNightId(to) && from <= to), '请提供完整日期范围，或显式 --all 用于维护')
  if (uid) assert(/^[A-Za-z0-9_-]{1,128}$/.test(uid) && all, '按用户导出仅用于 --all 维护')
  out = privatePath(out)
  assert(!fs.existsSync(path.join(out, 'manifest.json')), '输出目录已有导出清单，请使用新的私有目录')
  const manifest = { version: 1, env, appid, exportedAt: new Date().toISOString(), collections: {} }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedtime-export-'))
  try {
    for (const name of ['n_users', 'n_nights', ...(events || all ? ['n_events'] : [])]) {
      let after = null; const rows = [], ids = new Set()
      for (;;) {
        const query = { ...(uid ? { uid } : {}), ...(name === 'n_nights' && !all ? { nightId: { $gte: from, $lte: to } } : {}), ...(after ? { _id: { $gt: after } } : {}) }
        const queryFile = path.join(temp, 'query.json'); fs.writeFileSync(queryFile, JSON.stringify(query), { mode: 0o600 })
        const result = await tool('cloud_db_read_doc', { appid, env, 'collection-name': name, 'query-file': queryFile,
          projection: JSON.stringify(Object.fromEntries(FIELDS[name].map(key => [key, 1]))), sort: JSON.stringify([{ key: '_id', direction: 1 }]), limit: PAGE_SIZE })
        assert(result?.success === true && Array.isArray(result.data), `读取 ${name} 失败`)
        const data = result.data.map(row => typeof row === 'string' ? JSON.parse(row) : row)
        assert(data.every(row => typeof row._id === 'string' && !ids.has(row._id) && (!after || row._id > after)), '导出分页没有前进')
        for (const row of data) { ids.add(row._id); rows.push(row) }
        if (data.length < PAGE_SIZE) break
        after = data[data.length - 1]._id
      }
      const content = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
      writePrivate(path.join(out, `${name}.jsonl`), content)
      manifest.collections[name] = { file: `${name}.jsonl`, count: rows.length, fields: FIELDS[name], sha256: createHash('sha256').update(content).digest('hex'), complete: true,
        scope: uid ? 'user' : 'all', ...(uid ? { uid } : {}), ...(name === 'n_nights' ? { from: all ? '19000101' : from, to: all ? '99991231' : to } : {}) }
    }
    manifest.finishedAt = new Date().toISOString()
    writePrivate(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    return manifest
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const manifest = await exportNightData({ ...args, events: args.events === true, all: args.all === true })
    console.log(`私有导出已完成：${Object.entries(manifest.collections).map(([name, meta]) => `${name} ${meta.count}`).join('；')}。不要提交这些文件。`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
