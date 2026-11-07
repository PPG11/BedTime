const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const output = process.env.BEDTIME_TEST_OUTPUT
const { createAppDataStore } = require(path.join(output, 'state/create-app-store.js'))
const { createHomeView } = require(path.join(output, 'pages/home/view-model.js'))

const user = { uid: '123456789abc', nickname: '早睡伙伴', targetHM: '22:30', tzOffset: 480, totalDays: 0, streak: 0, lastCheckinDate: '' }
const record = (date, status = 'hit', timestamp) => ({
  _id: `${user.uid}#${date}`, uid: user.uid, date, status, goodnightMessageId: null,
  ts: new Date(timestamp || `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${status === 'hit' ? '21' : '23'}:00:00+08:00`)
})
const statusFor = (item, date = '20261107') => ({
  date: item?.date || date, checkedIn: Boolean(item), status: item?.status || null,
  timestamp: item?.ts || null, goodnightMessageId: null
})
function fixture({ profile = user, history = [], current = null, date } = {}) {
  let saved = profile
  let rows = history
  let today = statusFor(current, date)
  const store = createAppDataStore({
    supportsCloud: () => true,
    ensureCurrentUser: async () => saved,
    updateCurrentUser: async patch => (saved = { ...saved, ...patch }),
    fetchCheckins: async () => rows,
    fetchTodayCheckinStatus: async () => today
  })
  return {
    store,
    replace(profile, history, current, date) { saved = profile; rows = history; today = statusFor(current, date) }
  }
}
const viewAt = (store, instant) => createHomeView(store.getAppData(), new Date(instant))
const stats = view => Object.fromEntries(view.stats.map(item => [item.label, Number.parseInt(item.value)]))

test('迟到仍算已打卡和累计次数，但不计连续早睡与最佳记录', async () => {
  const late = record('20261107', 'late')
  const { store } = fixture({ history: [late], current: late })
  await store.refreshAppData()
  const view = viewAt(store, '2026-11-08T01:00:00+08:00')
  assert.deepEqual(stats(view), { 连续早睡天数: 0, 累计打卡次数: 1, 近期最佳连续: 0, 坚持完成率: 100 })
  assert.equal(view.checkedIn, true)
  assert.equal(view.recentDays.at(-1).checked, true)
  assert.equal(view.statusTone, 'late')
  assert.deepEqual(store.getAppData().onTimeRecords, {})
})

test('按时连续在迟到后重新开始，最佳记录仅统计按时日期', async () => {
  const history = [record('20261105'), record('20261106'), record('20261107', 'late'), record('20261108')]
  const { store } = fixture({ history, current: history.at(-1) })
  await store.refreshAppData()
  const result = stats(viewAt(store, '2026-11-08T22:00:00+08:00'))
  assert.equal(result.连续早睡天数, 1)
  assert.equal(result.近期最佳连续, 2)
  assert.equal(result.累计打卡次数, 4)
})

test('本晚未打卡时保留前一晚连续，错过完整窗口后清零', async () => {
  const { store } = fixture({ history: [record('20261106'), record('20261107')], date: '20261108' })
  await store.refreshAppData()
  assert.equal(stats(viewAt(store, '2026-11-08T21:00:00+08:00')).连续早睡天数, 2)
  assert.equal(stats(viewAt(store, '2026-11-09T04:29:59+08:00')).连续早睡天数, 2)
  assert.equal(stats(viewAt(store, '2026-11-09T04:30:00+08:00')).连续早睡天数, 0)
})

test('当前状态能补齐未返回的历史，也以服务端迟到状态修正旧历史', async () => {
  const hit = record('20261107')
  const state = fixture({ current: hit })
  await state.store.refreshAppData()
  assert.equal(stats(viewAt(state.store, '2026-11-07T22:00:00+08:00')).连续早睡天数, 1)
  const late = record('20261107', 'late')
  state.replace(user, [hit], late)
  await state.store.refreshAppData()
  assert.equal(stats(viewAt(state.store, '2026-11-07T23:30:00+08:00')).连续早睡天数, 0)
  assert.equal(state.store.getAppData().records['20261107'], late.ts.getTime())
  assert.equal(state.store.getAppData().onTimeRecords['20261107'], undefined)
})

test('历史按服务端周期与状态计数，不因设备时区或新目标重判早睡', async () => {
  const hit = record('20261107', 'hit', '2026-11-08T03:00:00Z') // 用户 UTC-5 的 22:00
  const { store } = fixture({ profile: { ...user, tzOffset: -300, targetHM: '21:30' }, history: [hit], current: hit })
  await store.refreshAppData()
  const view = viewAt(store, '2026-11-08T04:00:00Z')
  assert.equal(view.todayKey, '20261107')
  assert.equal(view.statusTone, 'hit')
  assert.equal(stats(view).连续早睡天数, 1)
  assert.equal(stats(view).近期最佳连续, 1)
})

test('累计使用云端全量计数，新增打卡即时更新且重复和旧响应不重复累加', async () => {
  const previous = record('20261105')
  const state = fixture({ profile: { ...user, totalDays: 500, streak: 500, lastCheckinDate: previous.date }, history: [previous] })
  await state.store.refreshAppData()
  assert.equal(state.store.getAppData().totalDays, 500)
  const hit = record('20261106')
  state.store.patchCheckins(hit)
  state.store.patchCheckins(hit)
  state.store.patchCheckins(record('20261101'))
  assert.equal(state.store.getAppData().totalDays, 501)
  assert.equal(state.store.getAppData().streak, 501)
  assert.equal(state.store.getAppData().lastCheckinDate, hit.date)
  assert.equal(state.store.getAppData().onTimeRecords[hit.date], hit.ts.getTime())
  const late = record('20261107', 'late')
  state.store.patchCheckins(late)
  assert.equal(state.store.getAppData().totalDays, 502)
  assert.equal(stats(viewAt(state.store, '2026-11-07T23:30:00+08:00')).连续早睡天数, 0)
  state.replace({ ...user, totalDays: 502, streak: 0, lastCheckinDate: late.date }, [late, hit, previous], late)
  await state.store.refreshAppData()
  await state.store.updateProfile({ targetHM: '00:30' })
  assert.equal(state.store.getAppData().totalDays, 502)
})

test('bootstrap 后并发完成的打卡在历史与当前状态里只补计一次', async () => {
  const previous = record('20261106')
  const latest = record('20261107')
  const { store } = fixture({
    profile: { ...user, totalDays: 400, streak: 400, lastCheckinDate: previous.date },
    history: [latest, previous], current: latest
  })
  await store.refreshAppData()
  assert.equal(store.getAppData().totalDays, 401)
  assert.equal(store.getAppData().streak, 401)
  store.patchCheckins(latest)
  assert.equal(store.getAppData().totalDays, 401)
  assert.equal(store.getAppData().streak, 401)
})

test('只加载365次近期记录也保留服务端366天连续，页面跨周期重算失效', async () => {
  const last = '20261107'
  const history = Array.from({ length: 365 }, (_, index) => {
    const day = new Date(Date.parse('2026-11-07T00:00:00Z') - index * 86_400_000)
    return record(day.toISOString().slice(0, 10).replace(/-/g, ''))
  })
  const { store } = fixture({
    profile: { ...user, totalDays: 366, streak: 366, lastCheckinDate: last },
    history, current: history[0]
  })
  await store.refreshAppData()
  const current = stats(viewAt(store, '2026-11-07T22:00:00+08:00'))
  assert.equal(current.连续早睡天数, 366)
  assert.equal(current.累计打卡次数, 366)
  assert.equal(current.近期最佳连续, 365)
  assert.equal(stats(viewAt(store, '2026-11-08T21:00:00+08:00')).连续早睡天数, 366)
  assert.equal(stats(viewAt(store, '2026-11-09T04:30:00+08:00')).连续早睡天数, 0)
})
