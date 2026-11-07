const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { createAppDataStore } = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'state/create-app-store.js'))
const user = { _id: 'owner', uid: '12345678', nickname: '晚安', targetHM: '22:30' }
const timestamp = new Date('2026-11-07T23:00:00+08:00')
const record = { _id: '12345678_20261107', uid: user.uid, date: '20261107', status: 'late', ts: timestamp, goodnightMessageId: 'message-a' }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function setup(overrides = {}) {
  return createAppDataStore({
    supportsCloud: () => true,
    ensureCurrentUser: async () => user,
    updateCurrentUser: async patch => ({ ...user, ...patch }),
    fetchTodayCheckinStatus: async () => ({ date: '20261107', checkedIn: false, timestamp: null }),
    fetchCheckins: async () => [],
    ...overrides
  })
}

test('并发页面刷新合并为一次请求，保留服务端周期', async () => {
  const gate = deferred(); let calls = 0
  const store = setup({ ensureCurrentUser: async () => { calls++; await gate.promise; return user }, fetchTodayCheckinStatus: async () => ({ date: '20261107', checkedIn: false, timestamp: null }) })
  const first = store.refreshAppData(); const second = store.refreshAppData()
  assert.equal(first, second)
  gate.resolve(); await first
  assert.equal(calls, 1)
  assert.equal(store.getAppData().todayStatus.date, '20261107')
  assert.equal(store.getAppData().loading, false)
})

test('刷新中的旧结果不能覆盖刚成功的打卡和关联心语', async () => {
  const gate = deferred()
  const store = setup({ fetchCheckins: () => gate.promise })
  const pending = store.refreshAppData()
  store.patchCheckins(record)
  gate.resolve([]); await pending
  assert.equal(store.getAppData().records['20261107'], timestamp.getTime())
  assert.equal(store.getAppData().todayStatus.goodnightMessageId, 'message-a')
})

test('网络失败保留已加载资料和打卡，下次刷新可恢复', async () => {
  let fail = false
  const store = setup({ ensureCurrentUser: async () => { if (fail) throw new Error('网络暂不可用'); return user } })
  await store.refreshAppData(); store.patchCheckins(record)
  fail = true; await store.refreshAppData()
  assert.equal(store.getAppData().user.uid, user.uid)
  assert.equal(store.getAppData().records['20261107'], timestamp.getTime())
  assert.equal(store.getAppData().error, '网络暂不可用')
  fail = false; await store.refreshAppData()
  assert.equal(store.getAppData().error, null)
})

test('取消订阅后不再通知卸载页面', async () => {
  const store = setup(); let calls = 0
  const unsubscribe = store.subscribeAppData(() => { calls++ })
  unsubscribe(); await store.refreshAppData()
  assert.equal(calls, 1)
})

test('连续资料编辑串行保存，失败不会阻断后一次修改', async () => {
  let active = 0; const order = []
  const store = setup({ updateCurrentUser: async patch => {
    assert.equal(active++, 0)
    await Promise.resolve(); active--; order.push(patch)
    if (patch.nickname === 'fail') throw new Error('保存失败')
    return { ...user, ...patch }
  } })
  const first = store.updateProfile({ nickname: 'fail' })
  const second = store.updateProfile({ targetHM: '00:30' })
  await assert.rejects(first, /保存失败/); await second
  assert.deepEqual(order, [{ nickname: 'fail' }, { targetHM: '00:30' }])
})

test('资料保存中的页面刷新等待写完成，再读取新目标周期', async () => {
  let current = user; const dates = []; const gate = deferred(); let writing
  const started = new Promise(resolve => { writing = resolve })
  const store = setup({
    ensureCurrentUser: async () => current,
    updateCurrentUser: async patch => { writing(); await gate.promise; current = { ...current, ...patch }; return current },
    fetchTodayCheckinStatus: async () => { const date = current.targetHM === '00:30' ? '20261108' : '20261107'; dates.push(date); return { date, checkedIn: false, timestamp: null } }
  })
  await store.refreshAppData()
  const write = store.updateProfile({ targetHM: '00:30' })
  await started
  const refresh = store.refreshAppData()
  gate.resolve(); await Promise.all([write, refresh])
  assert.deepEqual(dates, ['20261107', '20261108'])
  assert.equal(store.getAppData().todayStatus.date, '20261108')
})

test('资料修改等待旧资料读取完成，防止晚到的读取覆盖新设置', async () => {
  const gate = deferred(); let writeStarted = false; let readStarted
  const reading = new Promise(resolve => { readStarted = resolve })
  let current = user
  const store = setup({
    ensureCurrentUser: async () => { readStarted(); await gate.promise; return current },
    updateCurrentUser: async patch => { writeStarted = true; current = { ...current, ...patch }; return current }
  })
  const refresh = store.refreshAppData(); await reading
  const write = store.updateProfile({ nickname: 'new' })
  await Promise.resolve()
  assert.equal(writeStarted, false)
  gate.resolve(); await Promise.all([refresh, write])
  assert.equal(store.getAppData().user.nickname, 'new')
})
