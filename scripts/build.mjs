import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import cloudEnvironment from './cloud-env.cjs'

const { LOCAL_ENV_FILE, resolveCloudEnvironment } = cloudEnvironment

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'miniprogram')
const output = path.join(root, 'dist')

export function compileSources(destination) {
  const configFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root)
  const program = ts.createProgram(config.fileNames, { ...config.options, outDir: destination })
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)]
  if (diagnostics.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root, getCanonicalFileName: value => value, getNewLine: () => '\n'
    }))
  }
  const result = program.emit()
  if (result.emitSkipped) throw new Error('TypeScript 编译未完成')
}

function copyAssets(directory, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const from = path.join(directory, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyAssets(from, to)
    else if (!entry.name.endsWith('.ts')) fs.copyFileSync(from, to)
  }
}

export function verifyPackage(directory) {
  const readJson = relative => JSON.parse(fs.readFileSync(path.join(directory, relative), 'utf8'))
  const app = readJson('app.json')
  const requireFile = relative => {
    if (!fs.existsSync(path.join(directory, relative))) throw new Error(`小程序文件缺失: ${relative}`)
  }
  requireFile('app.js')
  requireFile('app.wxss')
  requireFile(app.sitemapLocation)
  for (const page of app.pages) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) requireFile(`${page}.${extension}`)
    const config = readJson(`${page}.json`)
    for (const component of Object.values(config.usingComponents ?? {})) {
      const target = component.startsWith('/') ? component.slice(1) : path.join(path.dirname(page), component)
      for (const extension of ['js', 'json', 'wxml', 'wxss']) requireFile(`${target}.${extension}`)
    }
  }
  // Native require must resolve to an actual script; Node's directory lookup
  // and bare-package resolution are not part of our mini-program build contract.
  const verifyImports = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) verifyImports(file)
      else if (entry.name.endsWith('.js')) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/require\(["']([^"']+)["']\)/g)) {
          const dependency = match[1]
          const target = path.resolve(path.dirname(file), dependency.endsWith('.js') ? dependency : `${dependency}.js`)
          if (!dependency.startsWith('.') || !fs.existsSync(target)) {
            throw new Error(`无法打包的小程序模块: ${path.relative(directory, file)} → ${dependency}`)
          }
        }
      }
    }
  }
  verifyImports(directory)
  for (const tab of app.tabBar.list) {
    if (!app.pages.includes(tab.pagePath)) throw new Error(`未注册的导航页: ${tab.pagePath}`)
    requireFile(tab.iconPath)
    requireFile(tab.selectedIconPath)
  }
}

export function build({ release = false } = {}) {
  // Resolve first so a missing environment cannot replace a working package.
  const runtime = resolveCloudEnvironment(root, { requireCloud: release })
  const staging = path.join(root, '.native-build')
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  compileSources(staging)
  copyAssets(source, staging)
  const runtimePath = path.join(staging, 'config', 'runtime.js')
  fs.writeFileSync(runtimePath, `'use strict';\nexports.runtime = ${JSON.stringify(runtime)};\n`)
  fs.rmSync(`${runtimePath}.map`, { force: true })
  verifyPackage(staging)
  // Replace only generated output, after the complete package passes validation.
  fs.rmSync(output, { recursive: true, force: true })
  fs.renameSync(staging, output)
  console.info(`原生小程序已构建到 dist/（云环境：${runtime.cloudEnabled ? runtime.cloudEnvId : '未启用'}）`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const watchMode = process.argv.includes('--watch')
  const release = process.argv.includes('--release')
  const run = () => {
    try { build({ release }); return true } catch (error) { console.error(error.message); return false }
  }
  const success = run()
  if (!watchMode) process.exitCode = success ? 0 : 1
  else {
    let timer
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(run, 150)
    }
    const watchers = []
    let polling
    const fingerprint = () => {
      const entries = []
      const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const file = path.join(directory, entry.name)
          if (entry.isDirectory()) visit(file)
          else {
            const stat = fs.statSync(file)
            entries.push(`${file}:${stat.size}:${stat.mtimeMs}`)
          }
        }
      }
      visit(source)
      return entries.join('|')
    }
    const poll = error => {
      if (polling) return
      watchers.forEach(watcher => watcher.close())
      let previous = fingerprint()
      polling = setInterval(() => {
        try {
          const current = fingerprint()
          if (current !== previous) { previous = current; schedule() }
        } catch {
          // An editor may briefly replace a directory; retry on the next tick.
        }
      }, 500)
      schedule()
      console.info(`文件事件监听不可用（${error.code || error.message}），已切换到定期检查。`)
    }
    try {
      watchers.push(fs.watch(source, { recursive: true }, schedule))
      watchers.forEach(watcher => watcher.on('error', poll))
    } catch (error) { poll(error) }
    // watchFile survives editors replacing tsconfig with an atomic rename.
    const configPaths = ['tsconfig.json', LOCAL_ENV_FILE].map(file => path.join(root, file))
    configPaths.forEach(file => fs.watchFile(file, { interval: 500 }, schedule))
    const stop = () => {
      clearTimeout(timer)
      clearInterval(polling)
      configPaths.forEach(file => fs.unwatchFile(file, schedule))
      watchers.forEach(watcher => watcher.close())
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    console.info('正在监听 miniprogram/、tsconfig.json 与 .env.local；终端环境变量变化后请重启。')
  }
}
