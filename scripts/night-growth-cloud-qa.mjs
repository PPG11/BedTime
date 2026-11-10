import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs, assert, privatePath, writePrivate } from './lib/night-admin.mjs'
import { officialTool } from './night-maintenance.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NAME = 'bedtimeGrowthAcceptance'
const hash = data => createHash('sha256').update(data).digest('hex')
const json = (file, value) => writePrivate(file, JSON.stringify(value, null, 2) + '\n')
function privateFile(file) {
  file = privatePath(file)
  assert((fs.statSync(file).mode & 0o777) === 0o600, '私有文件权限必须为 600')
  return file
}

export function prepareGrowthQa({ out, appid, env, minutes = 60 }) {
  assert(/^wx[a-f0-9]{16}$/.test(appid) && typeof env === 'string' && /^[A-Za-z0-9_-]+$/.test(env), '准备时必须明确 --appid 与 --env')
  minutes = Number(minutes)
  assert(Number.isInteger(minutes) && minutes >= 5 && minutes <= 120, '有效时间 --minutes 必须为 5 至 120 分钟')
  const base = privatePath(out || fs.mkdtempSync(path.join(os.tmpdir(), 'bedtime-growth-qa-')))
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  fs.chmodSync(base, 0o700)
  const folder = path.join(base, NAME), sessionFile = path.join(base, 'session.json')
  assert(!fs.existsSync(folder) && !fs.existsSync(sessionFile), '该验收目录已有会话，请使用新的私有目录')
  const dependencies = path.join(repo, 'cloudfunctions/bedtimeGrowth/node_modules')
  assert(fs.existsSync(path.join(dependencies, 'wx-server-sdk/package.json')), '缺少已准备依赖，请先运行 yarn cloud:prepare bedtimeGrowth')
  fs.mkdirSync(folder, { mode: 0o700 })
  fs.cpSync(dependencies, path.join(folder, 'node_modules'), { recursive: true, dereference: true, filter: () => true, mode: fs.constants.COPYFILE_FICLONE })
  const commonSource = path.join(repo, 'cloudfunctions/common')
  // Always replace the prepared common copy with current source; dependency
  // preparation alone is not proof that subsequent business edits were packaged.
  fs.rmSync(path.join(folder, 'node_modules/common'), { recursive: true, force: true })
  const filter = source => !['node_modules', 'private-config.json', '.DS_Store'].includes(path.basename(source))
  fs.cpSync(commonSource, path.join(folder, 'common'), { recursive: true, filter })
  fs.cpSync(commonSource, path.join(folder, 'node_modules/common'), { recursive: true, filter })
  writePrivate(path.join(folder, 'index.js'), fs.readFileSync(path.join(repo, 'tests/cloud/growth-acceptance.cjs')))
  json(path.join(folder, 'package.json'), { name: 'bedtime-growth-acceptance', version: '1.0.0', private: true, main: 'index.js', dependencies: { common: 'file:./common', 'wx-server-sdk': '^3.0.1' } })
  const require = createRequire(path.join(folder, 'index.js'))
  assert(typeof require('wx-server-sdk').init === 'function' && typeof require('common/night-public').createPublicActions === 'function' && typeof require('common/night-growth-analytics').createGrowthAnalyticsActions === 'function', '验收包依赖不可加载')
  const sourceHashes = {}
  for (const entry of fs.readdirSync(commonSource, { withFileTypes: true })) {
    if (!entry.isFile() || !filter(entry.name)) continue
    const source = fs.readFileSync(path.join(commonSource, entry.name)), packed = fs.readFileSync(path.join(folder, 'node_modules/common', entry.name))
    assert(source.equals(packed), '验收包共享代码与源码不同')
    sourceHashes[`common/${entry.name}`] = hash(source)
  }
  sourceHashes['index.js'] = hash(fs.readFileSync(path.join(folder, 'index.js')))
  const token = randomBytes(32).toString('hex'), namespace = randomBytes(8).toString('hex'), expiresAt = Date.now() + minutes * 60000
  json(path.join(folder, 'qa-config.json'), { tokenHash: hash(token), namespace, expiresAt })
  const retiredFolder = path.join(base, 'retired', NAME)
  writePrivate(path.join(retiredFolder, 'index.js'), "exports.main = async () => ({ code: 'RETIRED', message: '临时验收已停用' })\n")
  json(path.join(retiredFolder, 'package.json'), { name: 'bedtime-growth-acceptance-retired', version: '1.0.0', private: true, main: 'index.js' })
  const session = { version: 1, name: NAME, appid, env, token, namespace, expiresAt, cleanupUntil: expiresAt + 2 * 3600000, folder, retiredFolder, sourceHashes, clean: false, preparedAt: new Date().toISOString(), retirement: null }
  json(sessionFile, session)
  return { folder, sessionFile, retiredFolder, expiresAt, sourceFiles: Object.keys(sourceHashes).length }
}

function unwrap(value) {
  for (let depth = 0; depth < 8 && value; depth++) {
    if (typeof value.code === 'string' || value.taskId || value.status) return value
    if (value.content) {
      const block = value.content.find(item => item.type === 'text')?.text
      if (block) { try { value = JSON.parse(block); continue } catch { /* Try another known response envelope. */ } }
    }
    if (value.result !== undefined) { value = value.result; continue }
    if (value.data?.result !== undefined) { value = value.data.result; continue }
    return value
  }
  return value
}

export async function actOnGrowthQa({ session: sessionPath, action }, tool = officialTool) {
  const sessionFile = privateFile(sessionPath), session = JSON.parse(fs.readFileSync(sessionFile, 'utf8')), base = path.dirname(sessionFile)
  assert(session.version === 1 && session.name === NAME && /^wx[a-f0-9]{16}$/.test(session.appid) && typeof session.env === 'string' && /^[a-f0-9]{64}$/.test(session.token) && Number.isFinite(session.expiresAt), '验收会话无效')
  assert(['run', 'cleanup', 'retire'].includes(action), '--action 只接受 run、cleanup、retire')
  assert(path.resolve(privatePath(session.folder)) === path.join(base, NAME) && path.resolve(privatePath(session.retiredFolder)) === path.join(base, 'retired', NAME), '验收包路径与会话不一致')
  const save = () => json(sessionFile, session)
  const call = async payload => {
    const file = path.join(base, 'call.json')
    json(file, [NAME, payload, session.env])
    const source = 'async function(name,data,env){const reply=await wx.cloud.callFunction({name,data,config:{env}});return reply.result;}'
    return unwrap(await tool('automation_evaluate', { project: repo, 'fn-source': source, 'args-file': file }))
  }
  if (action !== 'retire') {
    assert(!session.retirement, '验收已开始停用，禁止再次执行 run 或 cleanup')
    assert(Date.now() <= session.expiresAt + (action === 'cleanup' ? 2 * 3600000 : 0), action === 'cleanup' ? '清理宽限已过，请核对原 namespace 后人工清理' : '验收已过期，禁止运行')
    session.progress ||= {}
    const batches = async kind => {
      const plan = await call({ action: kind, token: session.token })
      assert(plan?.code === 'OK' && Array.isArray(plan.phases) && plan.phases.length > 0 && plan.phases.every(phase => typeof phase === 'string' && /^[a-z-]+$/.test(phase)), '未取得有效的验收批次清单')
      let progress = session.progress[kind]
      if (!progress) progress = session.progress[kind] = { phases: plan.phases, completed: [], checks: [], removed: {} }
      assert(JSON.stringify(progress.phases) === JSON.stringify(plan.phases), '部署的验收批次已改变，请核对原会话后清理')
      for (const phase of progress.phases) {
        if (progress.completed.includes(phase)) continue
        session.clean = false; session.lastAction = { action: kind, phase, requestedAt: new Date().toISOString(), status: 'requesting' }; save()
        const reply = await call({ action: kind, phase, token: session.token })
        json(path.join(base, `result-${kind}-${phase}.json`), reply || { code: 'NO_CONFIRMED_REPLY' })
        session.lastAction.status = reply?.code === 'OK' ? 'complete' : 'unconfirmed'; save()
        assert(reply?.code === 'OK' && reply.phase === phase, `验收批次未确认：${kind}/${phase} ${reply?.code || 'NO_CONFIRMED_REPLY'} / ${reply?.check || 'UNKNOWN'}；重跑同一命令可继续，或执行 cleanup`)
        progress.completed.push(phase)
        progress.checks = [...new Set([...progress.checks, ...(reply.checks || [])])]
        for (const [name, count] of Object.entries(reply.removed || {})) progress.removed[name] = (progress.removed[name] || 0) + count
        if (kind === 'cleanup' && reply.clean === true) session.clean = true
        save()
      }
      const result = { code: 'OK', checks: progress.checks, completedPhases: progress.completed, controlledClock: true, scopedAnalytics: true, ...(kind === 'cleanup' ? { clean: session.clean, removed: progress.removed } : { cleanupRequired: true }) }
      json(path.join(base, `result-${kind}.json`), result)
      return result
    }
    if (action === 'cleanup') {
      const result = await batches('cleanup')
      assert(result.clean, '清理批次未完成最终空集合回读')
      session.progress.run = null; save()
      return result
    }
    assert(!session.progress.run || !session.progress.cleanup, '已开始清理，须先完成 cleanup；不能继续已被清理的验收批次')
    if (!session.progress.run) {
      const cleaned = await batches('cleanup')
      assert(cleaned.clean, '运行前清理未确认完成')
      session.progress.cleanup = null; session.clean = false; save()
    }
    return batches('run')
  }
  assert(session.clean === true, '只有 cleanup 明确回读为空后才能停用验收函数')
  if (!session.retirement) {
    session.retirement = { status: 'requesting', requestedAt: new Date().toISOString() }; save()
    const reply = unwrap(await tool('cloud_fn_deploy', { appid: session.appid, env: session.env, path: session.retiredFolder }))
    json(path.join(base, 'result-retire-deploy.json'), reply || { status: 'unconfirmed' })
    if (reply?.taskId && reply.status === 'pending') session.retirement = { ...session.retirement, status: 'pending', taskId: reply.taskId }
    else session.retirement.status = 'awaiting-verification'
    save()
  } else if (session.retirement.status === 'pending') {
    const result = unwrap(await tool('polling_task_result', { 'task-id': session.retirement.taskId }))
    json(path.join(base, 'result-retire-poll.json'), result || { status: 'unconfirmed' })
    if (result?.status === 'pending') return { code: 'RETIRE_PENDING', taskId: session.retirement.taskId }
    assert(result?.status === 'success', '原停用任务未确认成功，禁止自动重新部署；请核对原任务')
    session.retirement.status = 'awaiting-verification'; save()
  }
  if (session.retirement.status === 'pending') return { code: 'RETIRE_PENDING', taskId: session.retirement.taskId }
  // An uncertain deployment is verified by a real call, never blindly resent.
  const reply = await call({ action: 'retiredProbe' })
  json(path.join(base, 'result-retire-verify.json'), reply || { code: 'NO_CONFIRMED_REPLY' })
  assert(reply?.code === 'RETIRED', '尚未确认函数已停用，请核对原部署任务，不要重新运行验收')
  session.retirement.status = 'retired'; session.retirement.verifiedAt = new Date().toISOString(); save()
  return { code: 'RETIRED', clean: true }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.prepare) {
      const result = prepareGrowthQa(args)
      console.log(`仅本地准备，未部署：${result.folder}\n私有会话：${result.sessionFile}\n停用包：${result.retiredFolder}\n有效期至：${new Date(result.expiresAt).toISOString()}；已核对 ${result.sourceFiles} 个源码文件。`)
    } else console.log(JSON.stringify(await actOnGrowthQa(args)))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
