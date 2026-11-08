const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { test } = require('node:test')
test('构建环境、失败保护与监听新增/修改/删除', { timeout: 30000 }, async () => {
  const repository = process.cwd()
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bedtime-build-'))
  let watcher
  try {
    fs.cpSync(path.join(repository, 'miniprogram'), path.join(temporary, 'miniprogram'), { recursive: true })
    fs.cpSync(path.join(repository, 'scripts'), path.join(temporary, 'scripts'), { recursive: true })
    fs.copyFileSync(path.join(repository, 'tsconfig.json'), path.join(temporary, 'tsconfig.json'))
    fs.symlinkSync(path.join(repository, 'node_modules'), path.join(temporary, 'node_modules'))
    const environment = { ...process.env, CLOUD_ENV_ID: 'bedtime-build-test', TARO_APP_CLOUD_ENV_ID: 'ignored-legacy', ENABLE_CLOUD: 'false' }
    const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: temporary, env: environment, encoding: 'utf8' })
    assert.equal(build.status, 0, build.stderr)
    const runtimePath = path.join(temporary, 'dist/config/runtime.js')
    const runtime = fs.readFileSync(runtimePath, 'utf8')
    assert.match(runtime, /bedtime-build-test/)
    assert.match(runtime, /"cloudEnabled":false/)
    assert.doesNotMatch(runtime, /ignored-legacy/)
    // A manual verification build can overlap an already running dev watcher.
    // Both must finish with one complete package, without deleting each other's
    // staging files. Exercise real child processes, not a mocked file lock.
    const concurrentBuild = () => new Promise((resolve, reject) => {
      let messages = ''
      const child = spawn(process.execPath, ['scripts/build.mjs'], { cwd: temporary, env: environment })
      child.stdout.on('data', chunk => { messages += chunk })
      child.stderr.on('data', chunk => { messages += chunk })
      child.on('error', reject)
      child.on('exit', status => status === 0 ? resolve() : reject(new Error(messages)))
    })
    await Promise.all([concurrentBuild(), concurrentBuild()])
    assert.ok(fs.existsSync(path.join(temporary, 'dist/app.js')))
    assert.equal(fs.existsSync(path.join(temporary, '.native-build.lock')), false)
    const missing = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: temporary, env: { ...environment, CLOUD_ENV_ID: '', ENABLE_CLOUD: 'true' }, encoding: 'utf8' })
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /缺少 CLOUD_ENV_ID/)
    assert.equal(fs.readFileSync(runtimePath, 'utf8'), runtime)
    const release = spawnSync(process.execPath, ['scripts/build.mjs', '--release'], { cwd: temporary, env: environment, encoding: 'utf8' })
    assert.equal(release.status, 1)
    assert.match(release.stderr, /必须启用云开发/)
    assert.equal(fs.readFileSync(runtimePath, 'utf8'), runtime)
    const sourceFile = path.join(temporary, 'miniprogram/app.ts')
    const original = fs.readFileSync(sourceFile, 'utf8')
    fs.appendFileSync(sourceFile, '\nconst broken: number = "not a number"\n')
    const invalid = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: temporary, env: environment, encoding: 'utf8' })
    assert.equal(invalid.status, 1)
    assert.equal(fs.readFileSync(runtimePath, 'utf8'), runtime)
    fs.writeFileSync(sourceFile, original)
    let output = ''
    const localConfig = path.join(temporary, '.env.local')
    fs.writeFileSync(localConfig, 'CLOUD_ENV_ID=bedtime-local-first\n')
    const watchEnvironment = { ...environment }
    delete watchEnvironment.CLOUD_ENV_ID
    delete watchEnvironment.ENABLE_CLOUD
    watcher = spawn(process.execPath, ['scripts/build.mjs', '--watch'], { cwd: temporary, env: watchEnvironment })
    watcher.stdout.on('data', chunk => { output += chunk })
    watcher.stderr.on('data', chunk => { output += chunk })
    const waitFor = async predicate => {
      const started = Date.now()
      while (!predicate()) {
        if (Date.now() - started > 10000) throw new Error(output)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    await waitFor(() => output.includes('正在监听'))
    assert.match(fs.readFileSync(runtimePath, 'utf8'), /bedtime-local-first/)
    fs.writeFileSync(`${localConfig}.replacement`, 'CLOUD_ENV_ID=bedtime-local-second\n')
    fs.renameSync(`${localConfig}.replacement`, localConfig)
    await waitFor(() => fs.existsSync(runtimePath) && fs.readFileSync(runtimePath, 'utf8').includes('bedtime-local-second'))
    const probe = path.join(temporary, 'miniprogram/watch-probe.json')
    const emitted = path.join(temporary, 'dist/watch-probe.json')
    fs.writeFileSync(probe, '{"value":1}')
    await waitFor(() => fs.existsSync(emitted))
    fs.writeFileSync(probe, '{"value":2}')
    await waitFor(() => fs.existsSync(emitted) && fs.readFileSync(emitted, 'utf8').includes(':2'))
    fs.unlinkSync(probe)
    await waitFor(() => !fs.existsSync(emitted))
    const configPath = path.join(temporary, 'tsconfig.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const sourceMap = path.join(temporary, 'dist/app.js.map')
    for (const enabled of [false, true]) {
      config.compilerOptions.sourceMap = enabled
      fs.writeFileSync(`${configPath}.replacement`, JSON.stringify(config))
      fs.renameSync(`${configPath}.replacement`, configPath)
      await waitFor(() => fs.existsSync(sourceMap) === enabled)
    }

  } finally {
    if (watcher) {
      if (watcher.exitCode === null && watcher.signalCode === null) {
        const finished = new Promise(resolve => watcher.once('exit', resolve))
        watcher.kill('SIGTERM')
        await finished
      }
    }
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
