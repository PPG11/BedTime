import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseArgs, assert, privatePath, writePrivate } from './lib/night-admin.mjs'
import { officialTool } from './night-maintenance.mjs'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
try {
  if (args.prepare) {
    const base = privatePath(args.out || fs.mkdtempSync(path.join(os.tmpdir(), 'bedtime-qa-'))), name = 'bedtimeNightAcceptance'
    const folder = path.join(base, name), token = randomBytes(32).toString('hex'), namespace = randomBytes(8).toString('hex')
    assert(!fs.existsSync(folder), '验收目录已存在')
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
    fs.copyFileSync(path.join(repo, 'tests/cloud/night-acceptance.cjs'), path.join(folder, 'index.js'))
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'bedtime-night-acceptance', version: '1.0.0', dependencies: { 'wx-server-sdk': '^3.0.1' } }))
    fs.cpSync(path.join(repo, 'cloudfunctions/bedtimeNight/node_modules'), path.join(folder, 'node_modules'), { recursive: true, filter: () => true, mode: fs.constants.COPYFILE_FICLONE })
    const expiresAt = Date.now() + 3600000
    writePrivate(path.join(folder, 'qa-config.json'), JSON.stringify({ tokenHash: createHash('sha256').update(token).digest('hex'), namespace, expiresAt }))
    writePrivate(path.join(base, 'session.json'), JSON.stringify({ name, token, namespace, expiresAt, folder }))
    console.log(`限时验收函数已准备：${folder}；令牌仅在私有 session.json 中。`)
  } else {
    const session = JSON.parse(fs.readFileSync(privatePath(args.session), 'utf8'))
    assert(Date.now() < session.expiresAt, '验收已过期，禁止重复使用')
    const allowed = ['concurrency', 'seed', 'verify', 'events', 'cleanup']
    assert(allowed.includes(args.action), '验收动作无效')
    const param = { action: args.action, ...(args.batch === undefined ? {} : { batch: Number(args.batch) }), token: session.token }
    const source = `async function(name,data){const r=await wx.cloud.callFunction({name,data});return r.result;}`
    const paramFile = path.join(path.dirname(privatePath(args.session)), 'call.json')
    writePrivate(paramFile, JSON.stringify([session.name, param]))
    const result = officialTool('automation_evaluate', { project: repo, 'fn-source': source, 'args-file': paramFile })
    const reply = result.result?.result || result.result
    assert(reply && reply.code === 'OK', JSON.stringify(reply || result))
    const evidence = path.join(path.dirname(paramFile), `result-${args.action}${args.batch === undefined ? '' : '-' + args.batch}.json`)
    writePrivate(evidence, JSON.stringify(reply, null, 2) + '\n')
    console.log(JSON.stringify(reply))
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
