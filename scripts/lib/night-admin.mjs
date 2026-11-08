import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import time from '../../cloudfunctions/common/night-time.js'
export const { isNightId, nightDay, DAY } = time
export const dayKey = at => new Date(at).toISOString().slice(0, 10).replaceAll('-', '')
export const beijingDay = at => dayKey(at + 8 * 3600000)
export const addDays = (night, count) => dayKey(nightDay(night) + count * DAY)
export function parseArgs(args) {
  const result = {}
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw new Error(`非法参数 ${args[i]}`)
    const key = args[i].slice(2)
    if (Object.hasOwn(result, key)) throw new Error(`重复参数 ${key}`)
    result[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true
  }
  return result
}
export function assert(value, message) { if (!value) throw new Error(message) }
export function asOf(value) {
  assert(typeof value === 'string' && /T\d\d:\d\d:\d\d(?:\.\d+)?\+08:00$/.test(value) && Number.isFinite(Date.parse(value)), '--as-of 必须显式包含北京时间 +08:00')
  return Date.parse(value)
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export function privatePath(value) {
  assert(typeof value === 'string' && value.length > 0, '必须提供私有文件路径')
  const resolved = path.resolve(value)
  // Resolve the existing ancestor too, so a symlink cannot place exports in Git.
  let ancestor = resolved
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const real = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved))
  assert(real !== repo && !real.startsWith(repo + path.sep), '个人导出和维护清单必须位于仓库之外')
  return resolved
}
export function loadExport(input, names) {
  const root = privatePath(input)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  assert(manifest.version === 1 && typeof manifest.env === 'string' && Number.isFinite(Date.parse(manifest.exportedAt)), '导出清单格式无效')
  const collections = {}
  for (const name of names) {
    const meta = manifest.collections?.[name]
    assert(meta && meta.file === `${name}.jsonl` && Number.isInteger(meta.count) && Array.isArray(meta.fields), `缺少 ${name} 导出清单`)
    const buffer = fs.readFileSync(path.join(root, meta.file))
    assert(createHash('sha256').update(buffer).digest('hex') === meta.sha256, `${name} 文件摘要不匹配`)
    const rows = buffer.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    assert(rows.length === meta.count, `${name} 条数不匹配`)
    const unique = new Map()
    for (const row of rows) {
      assert(row && typeof row._id === 'string' && row._id, `${name} 缺少文档 ID`)
      assert(meta.fields.every(key => Object.hasOwn(row, key)), `${name} 缺少已声明字段`)
      const previous = unique.get(row._id)
      assert(!previous || JSON.stringify(previous) === JSON.stringify(row), `${name} 重复文档冲突`)
      unique.set(row._id, row)
    }
    collections[name] = [...unique.values()]
  }
  return { manifest, collections }
}
export function writePrivate(file, value) {
  privatePath(file); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, value, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
