const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const { resolveCloudEnvironment } = require('../scripts/cloud-env.cjs')

function inWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bedtime-cloud-env-'))
  try { run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('构建与部署读取本地环境，终端配置优先且不改写进程环境', () => inWorkspace(root => {
  fs.writeFileSync(path.join(root, '.env.local'), '# local target\nCLOUD_ENV_ID="bedtime-local"\nENABLE_CLOUD=true\n')
  const env = { CLOUD_ENV_ID: 'bedtime-override' }
  assert.deepEqual(resolveCloudEnvironment(root, { env }), { cloudEnvId: 'bedtime-override', cloudEnabled: true })
  assert.deepEqual(env, { CLOUD_ENV_ID: 'bedtime-override' })
  assert.deepEqual(resolveCloudEnvironment(root, { env: {}, requireCloud: true }), { cloudEnvId: 'bedtime-local', cloudEnabled: true })
  assert.throws(() => resolveCloudEnvironment(root, { env: { CLOUD_ENV_ID: '' } }), /缺少 CLOUD_ENV_ID/)
}))

test('缺少环境时拒绝构建，仅显式离线可继续，发布与部署拒绝离线', () => inWorkspace(root => {
  assert.throws(() => resolveCloudEnvironment(root, { env: {} }), /缺少 CLOUD_ENV_ID/)
  assert.deepEqual(resolveCloudEnvironment(root, { env: { ENABLE_CLOUD: 'false' } }), { cloudEnvId: '', cloudEnabled: false })
  assert.throws(() => resolveCloudEnvironment(root, { env: { ENABLE_CLOUD: 'false' }, requireCloud: true }), /必须启用云开发/)
  assert.throws(() => resolveCloudEnvironment(root, { env: { ENABLE_CLOUD: 'yes' } }), /true 或 false/)
  assert.throws(() => resolveCloudEnvironment(root, { env: { CLOUD_ENV_ID: 'invalid env' } }), /格式无效/)
}))

test('部署从同一配置预演；缺少必需依赖时不会调用上传工具', () => inWorkspace(root => {
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.copyFileSync(path.join(process.cwd(), 'scripts/cloud-env.cjs'), path.join(root, 'scripts/cloud-env.cjs'))
  fs.mkdirSync(path.join(root, 'cloudfunctions/example'), { recursive: true })
  fs.copyFileSync(path.join(process.cwd(), 'cloudfunctions/deploy.js'), path.join(root, 'cloudfunctions/deploy.js'))
  fs.writeFileSync(path.join(root, 'cloudfunctions/example/index.js'), 'exports.main = () => {}')
  fs.writeFileSync(path.join(root, 'cloudfunctions/example/package.json'), JSON.stringify({name:'example', dependencies:{common:'file:../common','missing-required-package':'1.0.0'}}))
  fs.mkdirSync(path.join(root, 'cloudfunctions/common'))
  fs.writeFileSync(path.join(root, 'cloudfunctions/common/package.json'), '{"name":"common","version":"1.0.0"}')
  fs.writeFileSync(path.join(root, '.env.local'), 'CLOUD_ENV_ID=bedtime-local\nENABLE_CLOUD=true\n')
  const marker = path.join(root, 'uploaded')
  const cli = path.join(root, 'fake-cli')
  fs.writeFileSync(cli, '#!/bin/sh\ntouch "' + marker + '"\n', {mode:0o755})
  const env = {...process.env, WECHAT_CLI_PATH:cli}
  delete env.CLOUD_ENV_ID
  delete env.ENABLE_CLOUD
  const preview = spawnSync(process.execPath, ['cloudfunctions/deploy.js','--dry-run','example'], {cwd:root,env,encoding:'utf8'})
  assert.equal(preview.status, 0, preview.stderr)
  assert.match(preview.stdout, /bedtime-local/)
  assert.equal(fs.existsSync(marker), false)
  const prepare = spawnSync(process.execPath, ['cloudfunctions/deploy.js','--prepare-only','--skip-focus','example'], {cwd:root,env,encoding:'utf8'})
  assert.equal(prepare.status, 1)
  assert.match(prepare.stderr, /Missing required dependency missing-required-package/)
  assert.equal(fs.existsSync(marker), false)
  assert.equal(fs.readdirSync(path.join(root, 'cloudfunctions')).some(name => name.startsWith('.deploy-cache.')), false)
  const deploy = spawnSync(process.execPath, ['cloudfunctions/deploy.js','--skip-focus','example'], {cwd:root,env,encoding:'utf8'})
  assert.equal(deploy.status, 1)
  assert.match(deploy.stderr, /Missing required dependency missing-required-package/)
  assert.equal(fs.existsSync(marker), false)
}))

test('仅准备刷新共享源码和生产依赖，保留锁及部署缓存且完全不上传', () => inWorkspace(root => {
  const write = (name, content) => {
    const filename = path.join(root, name)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, content)
  }
  write('scripts/cloud-env.cjs', fs.readFileSync(path.join(process.cwd(), 'scripts/cloud-env.cjs')))
  write('cloudfunctions/deploy.js', fs.readFileSync(path.join(process.cwd(), 'cloudfunctions/deploy.js')))
  write('.env.local', 'CLOUD_ENV_ID=bedtime-local\nENABLE_CLOUD=true\n')
  write('cloudfunctions/example/index.js', 'exports.main = () => {}')
  write('cloudfunctions/example/package.json', JSON.stringify({
    name: 'example', dependencies: { common: 'file:../common', 'example-sdk': '1.0.0' },
    devDependencies: { 'uninstalled-dev-tool': '1.0.0' }
  }))
  write('cloudfunctions/example/package-lock.json', 'keep this lock')
  write('cloudfunctions/example/node_modules/common/index.js', 'module.exports = "old copy"')
  write('cloudfunctions/common/package.json', '{"name":"common","version":"1.0.0"}')
  write('cloudfunctions/common/index.js', 'module.exports = "latest source"')
  write('node_modules/example-sdk/package.json', JSON.stringify({name:'example-sdk',version:'1.0.0',dependencies:{'example-transitive':'1.0.0'}}))
  write('node_modules/example-sdk/index.js', 'module.exports = require("example-transitive")')
  write('node_modules/example-transitive/package.json', '{"name":"example-transitive","version":"1.0.0"}')
  write('node_modules/example-transitive/index.js', 'module.exports = 42')

  const cacheName = '.deploy-cache.' + createHash('sha256').update('bedtime-local').digest('hex') + '.json'
  const cache = JSON.stringify({version:1,entries:{example:{signature:'unchanged',updatedAt:'2020-01-01'}}})
  write('cloudfunctions/' + cacheName, cache)
  const marker = path.join(root, 'uploaded')
  const cli = path.join(root, 'fake-cli')
  write('fake-cli', '#!/bin/sh\ntouch "' + marker + '"\n')
  fs.chmodSync(cli, 0o755)
  const env = { ...process.env, WECHAT_CLI_PATH: cli }
  delete env.CLOUD_ENV_ID
  delete env.ENABLE_CLOUD
  const command = ['cloudfunctions/deploy.js', '--prepare-only', '--skip-focus', '--keep-lock', '--require-target']
  const run = (names = ['example'], targetEnv = env) => spawnSync(process.execPath, [...command, ...names], {cwd:root,env:targetEnv,encoding:'utf8'})

  const prepared = run()
  assert.equal(prepared.status, 0, prepared.stderr)
  assert.match(prepared.stdout, /bedtime-local/)
  const packaged = path.join(root, 'cloudfunctions/example/node_modules')
  assert.equal(fs.readFileSync(path.join(packaged, 'common/index.js'), 'utf8'), 'module.exports = "latest source"')
  assert.equal(require(path.join(packaged, 'example-sdk')), 42)
  assert.equal(fs.existsSync(path.join(packaged, 'uninstalled-dev-tool')), false)
  assert.equal(fs.existsSync(marker), false)
  assert.equal(fs.readFileSync(path.join(root, 'cloudfunctions/example/package-lock.json'), 'utf8'), 'keep this lock')
  assert.equal(fs.readFileSync(path.join(root, 'cloudfunctions', cacheName), 'utf8'), cache)

  write('cloudfunctions/common/index.js', 'module.exports = "updated again"')
  const noCli = run(['example'], {...env, WECHAT_CLI_PATH:path.join(root, 'does-not-exist')})
  assert.equal(noCli.status, 0, noCli.stderr)
  assert.equal(fs.readFileSync(path.join(packaged, 'common/index.js'), 'utf8'), 'module.exports = "updated again"')
  assert.equal(fs.existsSync(marker), false)
  assert.deepEqual(fs.readdirSync(path.join(root, 'cloudfunctions')).filter(name => name.startsWith('.deploy-cache.')), [cacheName])
  assert.equal(fs.readFileSync(path.join(root, 'cloudfunctions', cacheName), 'utf8'), cache)

  assert.equal(run([]).status, 1)
  assert.equal(run(['unknown']).status, 1)
  assert.equal(run(['example'], {...env, CLOUD_ENV_ID:''}).status, 1)
  assert.equal(run(['example'], {...env, ENABLE_CLOUD:'false'}).status, 1)
  assert.equal(run(['--skip-npm', 'example']).status, 1)
}))
