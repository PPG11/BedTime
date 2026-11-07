const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const output = process.env.BEDTIME_TEST_OUTPUT
const compiled = name => path.join(output, name)
const services = {}
const appState = {}
require.cache[require.resolve(compiled('services/index.js'))] = { exports: services }
require.cache[require.resolve(compiled('state/app-data.js'))] = { exports: appState }
const { GoodnightController, initialGoodnightView } = require(compiled('pages/home/goodnight-controller.js'))
const { createHomeView } = require(compiled('pages/home/view-model.js'))

const settle = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const message = (id, content = id) => ({ _id: id, uid: 'partner', content, likes: 0, dislikes: 0, date: '20261107', voted: false })
const context = (date, rewardId = '') => ({ uid: '12345678', date, checkedIn: Boolean(rewardId), rewardId })
function controllerFixture() {
  let view = initialGoodnightView()
  let renders = 0
  const controller = new GoodnightController(patch => { view = { ...view, ...patch }; renders += 1 })
  return { controller, view: () => view, renders: () => renders }
}
function snapshot() {
  return {
    ready: true, loading: false, error: null,
    user: { uid: '12345678', nickname: '测试伙伴', targetHM: '22:30', tzOffset: 480 },
    settings: { name: '测试伙伴', targetSleepMinute: 22 * 60 + 30 },
    records: {}, onTimeRecords: {}, totalDays: 0, streak: 0, lastCheckinDate: '', todayStatus: null
  }
}

test.beforeEach(() => {
  const storage = new Map()
  global.wx = {
    showToast() {}, stopPullDownRefresh() {}, showShareMenu() {},
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value)
  }
  Object.assign(services, {
    fetchOwnGoodnightMessage: async () => null,
    fetchGoodnightReward: async () => message('assigned')
  })
})

test('assigned reward survives failed reads without drawing a replacement', async () => {
  let attempts = 0
  services.fetchGoodnightReward = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('offline')
    return message('assigned')
  }
  const fixture = controllerFixture()
  fixture.controller.sync(context('20261107', 'assigned'))
  await settle()
  assert.equal(fixture.view().rewardMessage, null)
  fixture.controller.sync(context('20261107', 'assigned'), true)
  await settle()
  assert.equal(fixture.view().rewardMessage._id, 'assigned')
  fixture.controller.dispose()
})

test('a response for an earlier nightly cycle cannot replace the current submission', async () => {
  const earlier = deferred()
  const current = deferred()
  services.fetchOwnGoodnightMessage = (date) => date === '20261107' ? earlier.promise : current.promise
  const fixture = controllerFixture()
  fixture.controller.sync(context('20261107'))
  fixture.controller.sync(context('20261108'))
  current.resolve(message('today', '新的祝福'))
  await settle()
  earlier.resolve(message('yesterday', '昨天的祝福'))
  await settle()
  assert.equal(fixture.view().submittedMessage._id, 'today')
  assert.equal(fixture.view().goodnightInput, '新的祝福')
  fixture.controller.dispose()
})

test('a newly assigned reward ID supersedes an earlier in-flight read within the same cycle', async () => {
  const oldRead = deferred()
  let reads = 0
  services.fetchGoodnightReward = () => reads++ === 0 ? oldRead.promise : Promise.resolve(message('assigned'))
  const fixture = controllerFixture()
  fixture.controller.sync(context('20261107', 'old'))
  fixture.controller.sync(context('20261107', 'assigned'))
  await settle()
  oldRead.resolve(message('old'))
  await settle()
  assert.equal(fixture.view().rewardMessage._id, 'assigned')
  fixture.controller.dispose()
})

test('rapid repeated submission sends once and a slow initial read cannot erase success', async () => {
  const initialRead = deferred()
  const submission = deferred()
  let calls = 0
  services.fetchOwnGoodnightMessage = () => initialRead.promise
  services.submitGoodnightMessage = () => { calls += 1; return submission.promise }
  const fixture = controllerFixture()
  fixture.controller.sync(context('20261107'))
  fixture.controller.setInput('今晚好梦')
  const first = fixture.controller.submit()
  const duplicate = fixture.controller.submit()
  assert.equal(calls, 1)
  submission.resolve(message('sent', '今晚好梦'))
  await Promise.all([first, duplicate])
  initialRead.resolve(null)
  await settle()
  assert.equal(fixture.view().hasSubmitted, true)
  assert.equal(fixture.view().submittedMessage._id, 'sent')
  fixture.controller.dispose()
})

test('disposing a page controller suppresses pending asynchronous renders', async () => {
  const read = deferred()
  services.fetchOwnGoodnightMessage = () => read.promise
  const fixture = controllerFixture()
  fixture.controller.sync(context('20261107'))
  fixture.controller.dispose()
  const renders = fixture.renders()
  read.resolve(message('late'))
  await settle()
  assert.equal(fixture.renders(), renders)
})

test('a repeated server submission displays the original saved message', async () => {
  services.submitGoodnightMessage = async () => message('saved', '原来的心语')
  const fixture = controllerFixture()
  fixture.controller.sync(context('20261107'))
  await settle()
  fixture.controller.setInput('晚安')
  await fixture.controller.submit()
  assert.equal(fixture.view().hasSubmitted, true)
  assert.equal(fixture.view().goodnightInput, '原来的心语')
  fixture.controller.dispose()
})

test('view model ignores previous-cycle status and contains only JSON display data', () => {
  const state = snapshot()
  state.todayStatus = { checkedIn: true, date: '20261106', status: 'hit', timestamp: new Date('2026-11-06T13:00:00Z'), goodnightMessageId: 'old' }
  const view = createHomeView(state, new Date('2026-11-07T13:00:00Z'))
  assert.equal(view.checkedIn, false)
  assert.equal(view.goodnightId, '')
  assert.equal(view.todayKey, '20261107')
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view)
})

function pageFixture() {
  let state = snapshot()
  const listeners = new Set()
  Object.assign(appState, {
    getAppData: () => state,
    subscribeAppData(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener) },
    refreshAppData: async () => undefined,
    patchCheckins(document) {
      state = { ...state, records: { ...state.records, [document.date]: document.ts.getTime() },
        onTimeRecords: document.status === 'hit' ? { ...state.onTimeRecords, [document.date]: document.ts.getTime() } : state.onTimeRecords,
        totalDays: state.totalDays + (state.records[document.date] ? 0 : 1),
        todayStatus: { checkedIn: true, date: document.date, status: document.status, timestamp: document.ts, goodnightMessageId: document.goodnightMessageId } }
      listeners.forEach(listener => listener(state))
    }
  })
  let definition
  global.Page = options => { definition = options }
  delete require.cache[require.resolve(compiled('pages/home/index.js'))]
  require(compiled('pages/home/index.js'))
  let renders = 0
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { this.data = { ...this.data, ...patch }; renders += 1 } }
  page.onLoad()
  return { page, state: () => state, renders: () => renders, listenerCount: () => listeners.size }
}

test('successful native check-in publishes the record and prevents duplicate taps', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-07T13:00:00Z') })
  const submitted = deferred()
  let calls = 0
  services.submitCheckinRecord = async date => { assert.equal(date, '20261107'); calls += 1; return submitted.promise }
  const fixture = pageFixture()
  const first = fixture.page.onCheckin()
  await fixture.page.onCheckin()
  await settle()
  assert.equal(calls, 1)
  submitted.resolve({ created: true, document: { _id: 'checkin', uid: '12345678', date: '20261107', status: 'hit', ts: new Date(), tzOffset: 480, goodnightMessageId: 'assigned' } })
  await first
  assert.equal(fixture.page.data.checkedIn, true)
  assert.equal(fixture.page.data.isSyncing, false)
  assert.equal(fixture.page.data.modalMessage._id, 'assigned')
  assert.equal(fixture.state().todayStatus.goodnightMessageId, 'assigned')
  fixture.page.onUnload()
  assert.equal(fixture.listenerCount(), 0)
})

test('completed check-in after unload updates shared state without touching the destroyed page', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-07T13:00:00Z') })
  const submitted = deferred()
  services.submitCheckinRecord = () => submitted.promise
  const fixture = pageFixture()
  const pending = fixture.page.onCheckin()
  await settle()
  fixture.page.onUnload()
  const renders = fixture.renders()
  submitted.resolve({ created: true, document: { _id: 'checkin', uid: '12345678', date: '20261107', status: 'hit', ts: new Date(), tzOffset: 480 } })
  await pending
  assert.equal(fixture.state().todayStatus.checkedIn, true)
  assert.equal(fixture.renders(), renders)
})
