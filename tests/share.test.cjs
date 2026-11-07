const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

function loadPage(name, failSharing = false) {
  const menus = []
  const warnings = []
  let definition
  const state = {
    user: { uid: '5370e36f5ccc' },
    settings: { name: '早睡伙伴', targetSleepMinute: 1350 },
    loading: false, error: null
  }
  const context = vm.createContext({
    exports: {},
    console: { warn: (...args) => warnings.push(args) },
    wx: {
      showShareMenu(options) {
        menus.push(Array.from(options.menus))
        if (failSharing) options.fail({ errMsg: 'showShareMenu:fail unavailable' })
      }
    },
    Page: options => { definition = options }
  })
  const output = process.env.BEDTIME_TEST_OUTPUT
  vm.runInContext(fs.readFileSync(path.join(output, 'utils/share.js'), 'utf8'), context)
  const sharing = context.exports
  context.exports = {}
  context.require = id => {
    if (id === '../../utils/share') return sharing
    if (id === '../../state/app-data') return {
      getAppData: () => state,
      subscribeAppData: () => () => {},
      refreshAppData: async () => {}
    }
    if (id === '../../services/index') return {}
    if (id === '../../utils/storage') return { readFriends: () => [], DEFAULT_USER_NAME: '早睡伙伴', DEFAULT_SLEEP_MINUTE: 1350 }
    if (id === '../../utils/time') return { formatMinutesToTime: () => '22:30' }
    if (id === './view-model') return { createHomeView: () => ({ uid: state.user.uid, todayKey: '20261107' }) }
    if (id === './goodnight-controller') return {
      initialGoodnightView: () => ({}),
      GoodnightController: class { sync() {} }
    }
    throw new Error(`Unexpected dependency: ${id}`)
  }
  vm.runInContext(fs.readFileSync(path.join(output, `pages/${name}/index.js`), 'utf8'), context)
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) }
  }
  page.onLoad()
  return { page, menus, warnings }
}

test('三个原生页面加载时开启好友与朋友圈入口，并保留分享内容', () => {
  for (const name of ['home', 'friends', 'profile']) {
    const { page, menus } = loadPage(name)
    assert.deepEqual(menus, [['shareAppMessage', 'shareTimeline']], name)
    const appMessage = page.onShareAppMessage()
    const timeline = page.onShareTimeline()
    assert.equal(appMessage.path, '/pages/home/index?ref=5370e36f5ccc')
    assert.equal(timeline.query, 'ref=5370e36f5ccc')
    assert.equal(appMessage.title, timeline.title)
  }
})

test('分享菜单不可用时页面仍能完成资料显示', () => {
  const { page, warnings } = loadPage('profile', true)
  assert.equal(page.data.uid, '5370e36f5ccc')
  assert.equal(page.data.nameDraft, '早睡伙伴')
  assert.equal(warnings.length, 1)
})
