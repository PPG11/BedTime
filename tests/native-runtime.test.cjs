const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

// Node's resolver accepts directory/index.js imports that a native loader may not.
// This loader accepts explicit relative JS modules only and exposes no Node globals.
for (const enabled of [false, true]) test(`原生模块图与生命周期可运行（云连接 ${enabled ? '受控模拟' : '关闭'}）`, async () => {
  const output = process.env.BEDTIME_TEST_OUTPUT
  const routes = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'miniprogram/app.json'), 'utf8')).pages
  const modules = new Map()
  const pages = []
  const components = []
  const cloudCalls = []
  let initializations = 0
  let app
  const context = vm.createContext({
    App: definition => { app = definition },
    Page: definition => { pages.push(definition) },
    Component: definition => { components.push(definition) },
    wx: { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {}, showToast() {}, showTabBar() {}, cloud: {
      init() { initializations++ },
      async callFunction(options) {
        cloudCalls.push(options)
        const serverNow = Date.parse('2026-11-07T22:30:00+08:00')
        return { result: { code: 'OK', data: { userId: 'runtime-test', serverNow, nightId: '20261107', phase: 'open',
          windowOpenAt: Date.parse('2026-11-07T20:00:00+08:00'), windowCloseAt: Date.parse('2026-11-08T06:00:00+08:00'), nextOpenAt: Date.parse('2026-11-08T20:00:00+08:00'),
          record: null, lastRecord: null, firstNightId: null, lastNightId: null, prefs: { sound: false, haptics: true, reduceMotion: false } } } }
      }
    } },
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
    const source = relative === 'config/runtime.js' ? `exports.runtime = { cloudEnvId: 'runtime-test', cloudEnabled: ${enabled} }` : fs.readFileSync(filename, 'utf8')
    vm.runInContext(`(function(require, module, exports) {\n${source}\n})`, context, { filename })(requireLocal, module, module.exports)
    return module.exports
  }

  load('app.js')
  assert.equal(typeof app.onLaunch, 'function')
  app.onLaunch()
  app.onShow()
  const seenComponents = new Set()
  for (const page of routes) {
    load(`${page}.js`)
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'miniprogram', `${page}.json`), 'utf8'))
    for (const component of Object.values(config.usingComponents || {})) {
      if (seenComponents.has(component)) continue
      seenComponents.add(component)
      load(`${component.slice(1)}.js`)
    }
  }
  assert.equal(pages.length, routes.length)
  assert.equal(vm.runInContext('typeof process !== "undefined" || typeof Buffer !== "undefined"', context), false)

  for (const definition of pages) {
    const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data || {})), setData(patch) { Object.assign(this.data, patch) } }
    page.onLoad?.({})
    page.onShow?.()
    for (let i = 0; i < 16; i++) await Promise.resolve()
    assert.doesNotThrow(() => JSON.stringify(page.data))
    if ('ready' in page.data) assert.equal(page.data.ready, enabled)
    if ('canEdit' in page.data) assert.equal(page.data.canEdit, enabled)
    page.onHide?.()
    page.onUnload?.()
  }
  assert.equal(components.length, 3)
  assert.equal(initializations, enabled ? 1 : 0)
  assert.ok(enabled ? cloudCalls.length >= 3 : cloudCalls.length === 0)
  for (const call of cloudCalls) {
    assert.equal(call.name, 'bedtimeNight')
    assert.ok(['getState', 'getArchive', 'track'].includes(call.data.action), '页面生命周期不提交关灯或接入旧业务')
  }
})
