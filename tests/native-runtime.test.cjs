const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

// Node's resolver accepts directory/index.js imports that a native loader may not.
// This loader accepts explicit relative JS modules only and exposes no Node globals.
test('原生模块图不依赖 Node 全局、裸包或目录补全，App 与所有页面可加载', async () => {
  const output = process.env.BEDTIME_TEST_OUTPUT
  const routes = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'miniprogram/app.json'), 'utf8')).pages
  const modules = new Map()
  const pages = []
  let app
  const context = vm.createContext({
    App: definition => { app = definition },
    Page: definition => { pages.push(definition) },
    wx: { getStorageSync() {}, setStorageSync() {}, showToast() {} },
    console: { warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, setInterval, clearInterval
  })

  function load(relative) {
    const filename = path.resolve(output, relative)
    assert.ok(filename.startsWith(`${path.resolve(output)}${path.sep}`), `模块不能越出小程序目录：${relative}`)
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const requireLocal = specifier => {
      assert.ok(specifier.startsWith('.'), `未打包的模块：${specifier}`)
      const resolved = path.resolve(path.dirname(filename), specifier.endsWith('.js') ? specifier : `${specifier}.js`)
      return load(path.relative(output, resolved))
    }
    const source = fs.readFileSync(filename, 'utf8')
    vm.runInContext(`(function(require, module, exports) {\n${source}\n})`, context, { filename })(requireLocal, module, module.exports)
    return module.exports
  }

  load('app.js')
  assert.equal(typeof app.onLaunch, 'function')
  app.onLaunch()
  app.onShow()
  for (const page of routes) load(`${page}.js`)
  assert.equal(pages.length, routes.length)
  assert.equal(vm.runInContext('typeof process !== "undefined" || typeof Buffer !== "undefined"', context), false)

  const store = load('state/app-data.js')
  await store.refreshAppData()
  assert.equal(store.getAppData().ready, true)
  assert.equal(store.getAppData().loading, false)
  assert.match(store.getAppData().error, /不支持微信云开发/)
})
