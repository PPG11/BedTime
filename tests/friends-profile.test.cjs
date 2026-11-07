const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const output = process.env.BEDTIME_TEST_OUTPUT

function loadPage(name, services = {}, storeOverrides = {}) {
  let definition
  const toasts = []
  const aliases = [{ uid: '99999999', remark: '未加载的好友' }]
  const state = { user: { uid: '12345678' }, settings: { name: '旧昵称', targetSleepMinute: 1350 }, error: null }
  const listeners = new Set()
  const publish = () => listeners.forEach((fn) => fn(state))
  const store = {
    getAppData: () => state,
    subscribeAppData: (fn) => { listeners.add(fn); fn(state); return () => listeners.delete(fn) },
    refreshAppData: async () => {},
    ...storeOverrides
  }
  const context = {
    console: { warn() {} },
    wx: { showToast: (options) => toasts.push(options.title), stopPullDownRefresh() {}, setClipboardData() {} },
    Page: (options) => { definition = options },
    exports: {},
    require: (id) => {
      if (id === '../../services/index') return services
      if (id === '../../state/app-data') return store
      if (id === '../../utils/storage') return {
        DEFAULT_USER_NAME: '默认昵称', DEFAULT_SLEEP_MINUTE: 1350,
        readFriends: () => aliases.slice(), saveFriends: (items) => { aliases.splice(0, aliases.length, ...items) }
      }
      if (id === '../../utils/time') return {
        formatMinutesToTime: (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`,
        parseTimeStringToMinutes: (s) => s.split(':').map(Number).reduce((h, m) => h * 60 + m)
      }
      if (id === '../../utils/share') return { getShareAppMessageOptions() {}, getShareTimelineOptions() {}, showPageShareMenu() {} }
      if (id === './view-model') {
        const file = path.join(output, 'pages/friends/view-model.js')
        const exports = {}
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), { exports })
        return exports
      }
      throw new Error(id)
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(output, `pages/${name}/index.js`), 'utf8'), context)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad()
  return { page, aliases, state, publish, store, toasts, listeners }
}
const emptyOverview = () => ({ friends: [], requests: { incoming: [], outgoing: [] }, nextCursor: null })
const friend = (uid, nickname = '好友') => ({ uid, nickname, targetHM: '22:30', todayStatus: 'pending', streak: 2 })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

test('friends pagination deduplicates rows and preserves unloaded aliases', () => {
  const { page, aliases } = loadPage('friends')
  page.applyOverview({ ...emptyOverview(), friends: [friend('11111111')], nextCursor: 'page-2' })
  page.applyOverview({ ...emptyOverview(), friends: [friend('11111111', '新昵称'), friend('22222222')], nextCursor: 'page-3' }, true)
  assert.equal(page.data.friends.length, 2)
  assert.equal(page.data.friends[0].nickname, '新昵称')
  assert.equal(aliases[0].remark, '未加载的好友')
  page.applyOverview(emptyOverview(), true)
  assert.equal(page.data.nextCursor, null)
  assert.equal(page.data.friends.length, 2)
})

test('duplicate friend submission is blocked and post-write refresh failure is distinct', async () => {
  const gate = deferred()
  let calls = 0
  const { page, aliases, toasts } = loadPage('friends', {
    sendFriendRequest: async () => { calls++; await gate.promise },
    fetchFriendsOverview: async () => { throw new Error('network unavailable') }
  })
  page.setData({ uidInput: '87654321', aliasInput: '新备注' })
  const first = page.addFriend()
  await page.addFriend()
  assert.equal(calls, 1)
  gate.resolve()
  await first
  assert.equal(page.data.uidInput, '')
  assert.equal(aliases.find((item) => item.uid === '87654321').remark, '新备注')
  assert.equal(toasts.at(-1), '申请已发送，列表刷新失败，请下拉重试')
  assert.equal(page.data.syncing, false)
})

test('an accepted relationship appears directly in the refreshed overview', async () => {
  const { page } = loadPage('friends', {
    fetchFriendsOverview: async () => ({ ...emptyOverview(), friends: [friend('87654321')] })
  })
  await page.refreshOverview()
  assert.equal(page.data.friends[0].uid, '87654321')
  assert.equal(page.data.outgoing.length, 0)
})

test('profile serializes simultaneous edits and allows reversing an in-flight target', async () => {
  const gate = deferred()
  const patches = []
  const fixture = loadPage('profile')
  fixture.store.updateProfile = async (patch) => {
    patches.push(JSON.parse(JSON.stringify(patch)))
    if (patches.length === 1) await gate.promise
    if (patch.nickname) fixture.state.settings.name = patch.nickname
    if (patch.targetHM) fixture.state.settings.targetSleepMinute = patch.targetHM.split(':').map(Number).reduce((h, m) => h * 60 + m)
    fixture.publish()
  }
  const task = fixture.page.savePatch({ nickname: '新昵称' })
  fixture.page.onTargetTimeChange({ detail: { value: '23:30' } })
  fixture.page.onTargetTimeChange({ detail: { value: '22:30' } })
  assert.equal(patches.length, 1)
  gate.resolve()
  await task
  assert.deepEqual(patches, [{ nickname: '新昵称' }, { targetHM: '22:30' }])
  assert.equal(fixture.page.data.nameDraft, '新昵称')
  assert.equal(fixture.page.data.targetTimeText, '22:30')
  assert.equal(fixture.page.data.syncing, false)
})

test('unloaded pages unsubscribe and ignore delayed writes', async () => {
  const gate = deferred()
  const fixture = loadPage('profile', {}, { updateProfile: async () => gate.promise })
  const task = fixture.page.savePatch({ nickname: '新昵称' })
  fixture.page.onUnload()
  fixture.page.setData = () => { throw new Error('setData after unload') }
  fixture.publish()
  gate.resolve()
  await task
  assert.equal(fixture.listeners.size, 0)
})
