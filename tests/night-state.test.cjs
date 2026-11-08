const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = name => require(path.join(process.env.BEDTIME_TEST_OUTPUT, name + '.js'))
const { NightStore } = load('state/create-night-store')
const { NightController, initialNightInteraction } = load('pages/night/night-controller')
const { createNightView } = load('pages/night/night-view-model')
const { CloudError } = load('services/cloud')
const { resolveNight, formatConfirmedAt } = load('utils/night-time')
const { DEMO_PHRASE } = load('config/night-experience')
const at = value => Date.parse(value + '+08:00')
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fakeClock() {
  let time = at('2026-11-07T22:30:00'), serial = 0
  const tasks = new Map()
  return {
    now: () => time,
    schedule(callback, delay) { const id = ++serial; tasks.set(id, { at: time + delay, callback }); return id },
    clear(id) { tasks.delete(id) },
    advance(ms) {
      const end = time + ms
      for (;;) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        tasks.delete(next[0]); time = next[1].at; next[1].callback()
      }
      time = end
    },
    set(value) { time = value }, size: () => tasks.size
  }
}
function fixture() {
  const clock = fakeClock(), pending = new Map(), calls = [], records = new Map()
  const server = { userId: 'alice', prefs: { sound: false, haptics: true, reduceMotion: false } }
  const record = (nightId = '20261107', method = 'hold') => ({ nightId, method, confirmedAt: clock.now(), phraseId: 'p001', phraseText: '今天就到这里。剩下的，明天再说。', phraseVersion: 1 })
  const snapshot = () => {
    const rules = resolveNight(clock.now())
    const personal = [...records.values()].filter(r => r.userId === server.userId).map(r => r.record).sort((a, b) => a.nightId.localeCompare(b.nightId))
    return { userId: server.userId, serverNow: clock.now(), ...rules, prefs: { ...server.prefs }, record: personal.find(r => r.nightId === rules.nightId) || null,
      lastRecord: personal.at(-1) || null, firstNightId: personal[0]?.nightId || null, lastNightId: personal.at(-1)?.nightId || null }
  }
  const api = {
    async getState() { calls.push(['getState']); return snapshot() },
    async closeLight(nightId, method) {
      calls.push(['closeLight', nightId, method])
      const key = server.userId + nightId, previous = records.get(key)
      const confirmed = previous?.record || record(nightId, method)
      records.set(key, { userId: server.userId, record: confirmed })
      return { serverNow: clock.now(), record: confirmed, created: !previous, isFirstEver: true }
    },
    async getNight(nightId) { calls.push(['getNight', nightId]); return { serverNow: clock.now(), record: records.get(server.userId + nightId)?.record || null } },
    async setPrefs(patch) { calls.push(['setPrefs', patch]); server.prefs = { ...server.prefs, ...patch }; return { serverNow: clock.now(), prefs: { ...server.prefs } } }
  }
  const persistence = {
    getPending(uid) { calls.push(['getPending', uid]); return pending.get(uid) || null },
    setPending(uid, night) { calls.push(['setPending', uid, night]); if (night) pending.set(uid, night); else pending.delete(uid) }
  }
  const store = new NightStore(api, persistence, clock.now)
  const frames = [], effects = []
  const controller = new NightController(store, clock, {
    render: (view, state) => frames.push({ view, state }), enter: () => effects.push('enter'), restore: () => effects.push('restore'),
    feedback: (prefs, demo) => effects.push({ prefs, demo }), stop: () => effects.push('stop'), exit: failed => { effects.push('exit'); failed() }
  })
  return { clock, pending, calls, records, server, record, snapshot, api, persistence, store, controller, effects,
    view: () => frames.at(-1)?.view, count: name => calls.filter(c => c[0] === name).length }
}

test('冷启动先鉴权再读本人恢复标记，首次声音关闭，不能展示另一身份的回执', async () => {
  const f = fixture(), read = deferred()
  f.pending.set('alice', '20261107'); f.pending.set('bob', '20261106')
  f.api.getState = () => read.promise
  const shown = f.store.activate()
  assert.equal(f.store.get().snapshot, null); assert.equal(f.count('getPending'), 0)
  read.resolve(f.snapshot()); await shown
  assert.equal(f.store.get().pendingNightId, '20261107')
  assert.deepEqual(f.store.get().snapshot.prefs, { sound: false, haptics: true, reduceMotion: false })
  assert.deepEqual(f.calls.filter(c => c[0] === 'getPending'), [['getPending', 'alice']])
})

test('同次显示合并读取，隐藏与重新显示淘汰旧响应', async () => {
  const f = fixture(), old = deferred(); let reads = 0
  f.api.getState = async () => { reads++; return reads === 1 ? old.promise : f.snapshot() }
  const a = f.store.activate(), b = f.store.refresh()
  assert.equal(reads, 1); f.store.hide()
  f.server.userId = 'bob'; await f.store.activate()
  old.resolve({ ...f.snapshot(), userId: 'alice' }); await Promise.all([a, b])
  assert.equal(f.store.get().snapshot.userId, 'bob'); assert.equal(reads, 2)
})

test('成功关灯后旧读取不能清掉新回执，重复提交共用一个请求', async () => {
  const f = fixture(), close = deferred(), read = deferred()
  await f.store.activate()
  const oldSnapshot = f.snapshot()
  f.api.closeLight = async () => { f.calls.push(['closeLight']); return close.promise }
  const a = f.store.submit('hold', '20261107'), b = f.store.submit('tap', '20261107')
  assert.equal(f.count('closeLight'), 1)
  f.api.getState = () => read.promise
  const refresh = f.store.refresh(), confirmed = f.record()
  f.records.set('alice20261107', { userId: 'alice', record: confirmed })
  close.resolve({ serverNow: f.clock.now(), record: confirmed, created: true, isFirstEver: true })
  await Promise.all([a, b]); f.api.getState = async () => f.snapshot()
  read.resolve(oldSnapshot); await refresh
  assert.deepEqual(f.store.get().snapshot.record, confirmed); assert.equal(f.store.get().pendingNightId, null)
})

test('切换身份时在途提交与设置失效，新身份可立即提交且不会收到旧结果', async () => {
  const f = fixture(), close = deferred(), prefs = deferred()
  await f.store.activate()
  const aliceRecord = f.record()
  f.api.closeLight = () => close.promise
  f.api.setPrefs = () => prefs.promise
  const first = f.store.submit('hold', '20261107'), saving = f.store.setPrefs({ sound: true })
  f.server.userId = 'bob'; await f.store.refresh()
  let bobCalls = 0
  f.api.closeLight = async () => { bobCalls++; return { record: { ...f.record(), phraseText: '新身份的句子。' }, created: true, isFirstEver: true, serverNow: f.clock.now() } }
  await f.store.submit('tap', '20261107')
  close.resolve({ record: aliceRecord, created: true, isFirstEver: true, serverNow: f.clock.now() })
  prefs.resolve({ serverNow: f.clock.now(), prefs: { sound: true, haptics: true, reduceMotion: false } })
  await Promise.all([first, saving])
  assert.equal(bobCalls, 1); assert.equal(f.store.get().snapshot.userId, 'bob')
  assert.equal(f.store.get().snapshot.record.phraseText, '新身份的句子。')
  assert.equal(f.store.get().snapshot.prefs.sound, false); assert.equal(f.pending.get('alice'), '20261107')
})

test('五分钟旧快照或跨窗口先刷新，原意图夜晚不得被静默换成新夜', async () => {
  const f = fixture(); await f.store.activate()
  f.clock.set(at('2026-11-08T20:00:00'))
  await assert.rejects(f.store.submit('hold', '20261107'), e => e.code === 'NIGHT_CHANGED')
  assert.equal(f.count('closeLight'), 0); assert.equal(f.store.get().snapshot.nightId, '20261108')
  f.clock.advance(300000); await f.store.submit('hold', '20261108')
  assert.equal(f.count('getState'), 3); assert.equal(f.count('closeLight'), 1)
})

test('超时保留原夜标记，查空不是失败，重开查询原夜且不补播仪式', async () => {
  const f = fixture(); await f.controller.show()
  f.api.closeLight = async () => { throw new CloudError('TIMEOUT', 'timeout') }
  f.controller.submit('hold'); await flush()
  assert.equal(f.view().interaction, 'unknown'); assert.equal(f.pending.get('alice'), '20261107')
  await f.controller.checkResult()
  assert.equal(f.view().canRetry, true); assert.match(f.view().notice, /不能确定/)
  const confirmed = f.record(); f.records.set('alice20261107', { userId: 'alice', record: confirmed })
  f.controller.hide(); await f.controller.show()
  assert.equal(f.view().interaction, 'idle'); assert.equal(f.store.get().snapshot.record.nightId, '20261107')
  assert.equal(f.pending.has('alice'), false); assert.equal(f.effects.includes('enter'), false)
  f.controller.destroy(); assert.equal(f.clock.size(), 0)
})

test('八秒未知态以后即使迟到成功，也只显示普通回执且不触发反馈', async () => {
  const f = fixture(), close = deferred(); await f.controller.show()
  f.api.closeLight = () => close.promise
  f.controller.submit('tap'); f.clock.advance(8000)
  assert.equal(f.view().interaction, 'unknown')
  const confirmed = f.record(); f.records.set('alice20261107', { userId: 'alice', record: confirmed })
  close.resolve({ record: confirmed, serverNow: f.clock.now(), created: true, isFirstEver: true }); await flush()
  assert.equal(f.view().interaction, 'unknown'); assert.equal(f.effects.includes('enter'), false)
  await f.controller.checkResult(); assert.equal(f.view().interaction, 'idle')
  assert.equal(f.effects.some(e => typeof e === 'object'), false)
  f.controller.destroy()
})

test('未超时的新建结果用完整 400+800+400 时间线；已有记录不播，退出失败仍有返回路径', async () => {
  const f = fixture(); await f.controller.show()
  f.controller.submit('hold'); f.controller.submit('tap'); await flush()
  assert.equal(f.count('closeLight'), 1); assert.equal(f.view().interaction, 'dimming')
  f.clock.advance(399); assert.equal(f.view().interaction, 'dimming')
  f.clock.advance(1); assert.equal(f.view().interaction, 'blackout')
  f.clock.advance(800); assert.equal(f.view().interaction, 'revealing')
  f.clock.advance(400); assert.equal(f.view().interaction, 'done')
  f.controller.exit(); assert.match(f.view().notice, /右上角/)
  f.controller.returnHome(); f.controller.submit('tap'); await flush()
  assert.equal(f.view().interaction, 'idle'); assert.equal(f.effects.filter(e => e === 'enter').length, 1)
  f.controller.destroy()
})

test('后台完成提交不会播声或修改当前页，回前台只恢复真实回执', async () => {
  const f = fixture(), close = deferred(); await f.controller.show()
  f.api.closeLight = () => close.promise
  f.controller.submit('hold'); f.controller.hide()
  const confirmed = f.record(); f.records.set('alice20261107', { userId: 'alice', record: confirmed })
  close.resolve({ serverNow: f.clock.now(), record: confirmed, created: true, isFirstEver: true }); await flush()
  assert.equal(f.effects.includes('enter'), false)
  await f.controller.show(); assert.equal(f.view().interaction, 'idle'); assert.ok(f.store.get().snapshot.record)
  f.controller.destroy()
})

test('跨夜查询旧未知结果不会盖住新夜入口，查询为空也不锁住新夜', async () => {
  for (const found of [false, true]) {
    const f = fixture(); f.pending.set('alice', '20261106')
    if (found) f.records.set('alice20261106', { userId: 'alice', record: f.record('20261106') })
    await f.controller.show()
    const view = createNightView(f.store.get(), f.view())
    assert.equal(view.canPress, true); assert.equal(view.hasReceipt, false)
    assert.equal(view.isUnknown, false); assert.equal(f.effects.includes('enter'), false)
    assert.equal(f.store.get().pendingNightId, null); assert.equal(f.pending.has('alice'), false)
    if (!found) assert.deepEqual(f.calls.find(c => c[0] === 'getNight'), ['getNight', '20261106'])
    f.controller.destroy()
  }
})

test('用户明确重试仍提交原夜；原请求最终成功则返回已有记录', async () => {
  const f = fixture(); await f.controller.show()
  let attempts = 0
  f.api.closeLight = async (nightId, method) => {
    f.calls.push(['closeLight', nightId, method]); attempts++
    if (attempts === 1) throw new CloudError('TIMEOUT', 'unknown')
    return { record: f.record(nightId), created: false, isFirstEver: true, serverNow: f.clock.now() }
  }
  f.controller.submit('hold'); await flush(); await f.controller.checkResult()
  f.controller.retry(); await flush()
  assert.deepEqual(f.calls.filter(c => c[0] === 'closeLight'), [['closeLight', '20261107', 'hold'], ['closeLight', '20261107', 'hold']])
  assert.equal(f.view().interaction, 'idle'); assert.equal(f.effects.includes('enter'), false)
  f.controller.destroy()
})

test('演示无提交和查询，采用固定句与减少动效分支，结束只返回普通首页', async () => {
  const f = fixture(); f.server.prefs.reduceMotion = true; await f.controller.show()
  const count = f.calls.length; f.controller.startDemo(); f.controller.submit('tap')
  assert.equal(f.view().phrase, DEMO_PHRASE); assert.equal(f.view().interaction, 'blackout')
  f.clock.advance(799); assert.equal(f.view().phraseOpacity, 0)
  f.clock.advance(1); assert.equal(f.view().interaction, 'done')
  assert.equal(f.calls.length, count); assert.equal(f.effects.find(e => typeof e === 'object').demo, true)
  f.controller.exit(); assert.equal(f.view().demo, false); assert.equal(f.effects.includes('exit'), false)
  f.controller.destroy()
})

test('偏好请求串行且合并最新选择，旧响应不能覆盖最后一次开关', async () => {
  const f = fixture(), first = deferred(), second = deferred(); await f.store.activate()
  const patches = []
  f.api.setPrefs = patch => { patches.push(structuredClone(patch)); return patches.length === 1 ? first.promise : second.promise }
  const saving = f.store.setPrefs({ sound: true })
  f.store.setPrefs({ sound: false }); f.store.setPrefs({ haptics: false })
  assert.deepEqual(patches, [{ sound: true }])
  first.resolve({ serverNow: f.clock.now(), prefs: { sound: true, haptics: true, reduceMotion: false } }); await flush()
  assert.equal(f.store.get().snapshot.prefs.sound, false)
  assert.deepEqual(patches[1], { sound: false, haptics: false })
  second.resolve({ serverNow: f.clock.now(), prefs: { sound: false, haptics: false, reduceMotion: false } }); await saving
  assert.equal(f.store.get().prefsSaving, false); assert.equal(f.store.get().snapshot.prefs.haptics, false)
})

test('偏好保存失败重新读取服务端并显示未保存，鉴权失效清掉私人状态', async () => {
  const f = fixture(); await f.store.activate()
  f.api.setPrefs = async () => { throw new CloudError('NETWORK', 'offline') }
  await f.store.setPrefs({ sound: true })
  assert.equal(f.store.get().snapshot.prefs.sound, false); assert.match(f.store.get().prefsError, /未保存/)
  await f.store.refresh(); assert.equal(f.store.get().prefsError, '', '主动重新读取成功后清除旧错误')
  f.api.getState = async () => { throw new CloudError('UNAUTHORIZED', 'invalid') }
  await f.store.refresh()
  assert.equal(f.store.get().snapshot, null); assert.equal(f.store.get().pendingNightId, null)
})

test('关窗后查空结束等待，重进不重复核对；迟到记录仍从正常状态恢复', async () => {
  const f = fixture(); f.clock.set(at('2026-11-08T08:00:00')); f.pending.set('alice', '20261107')
  await f.controller.show()
  assert.equal(f.view().interaction, 'idle'); assert.equal(f.store.get().pendingNightId, null)
  assert.equal(f.pending.has('alice'), false); assert.equal(f.count('getNight'), 1)
  f.controller.hide(); await f.controller.show(); assert.equal(f.count('getNight'), 1)
  f.records.set('alice20261107', { userId: 'alice', record: f.record('20261107') })
  await f.store.refresh(); assert.equal(f.store.get().snapshot.record.nightId, '20261107')
  assert.equal(f.effects.includes('enter'), false); f.controller.destroy()
})

test('关窗后的查询失败保留恢复标记，不把网络失败当成查空', async () => {
  const f = fixture(); f.clock.set(at('2026-11-08T08:00:00')); f.pending.set('alice', '20261107')
  f.api.getNight = async () => { throw new CloudError('NETWORK', 'offline') }
  await f.controller.show()
  assert.equal(f.pending.get('alice'), '20261107'); assert.equal(f.view().interaction, 'unknown')
  assert.equal(f.view().canRetry, false); f.controller.destroy()
})

test('设置超过八秒切换等待说明但不释放写队列，迟到完成后只保存最新选择', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(), first = deferred(), second = deferred(); await f.store.activate()
  const patches = []
  f.api.setPrefs = patch => { patches.push({ ...patch }); return patches.length === 1 ? first.promise : second.promise }
  const saving = f.store.setPrefs({ sound: true }); t.mock.timers.tick(8000)
  assert.equal(f.store.get().prefsDelayed, true)
  f.store.setPrefs({ sound: false }); f.store.setPrefs({ haptics: false })
  await f.store.refresh()
  assert.equal(patches.length, 1); assert.equal(f.store.get().snapshot.prefs.haptics, false)
  first.resolve({ serverNow: f.clock.now(), prefs: { sound: true, haptics: true, reduceMotion: false } }); await flush()
  assert.deepEqual(patches[1], { sound: false, haptics: false }); assert.equal(f.store.get().prefsDelayed, false)
  second.resolve({ serverNow: f.clock.now(), prefs: { sound: false, haptics: false, reduceMotion: false } }); await saving
  assert.equal(f.store.get().prefsSaving, false); assert.equal(f.store.get().snapshot.prefs.sound, false)
})

test('状态说明匹配操作，演示只在窗口外提供且主次入口互斥', async () => {
  const f = fixture(); await f.store.activate()
  const view = () => createNightView(f.store.get(), initialNightInteraction())
  assert.equal(view().showDemo, false); assert.match(view().subtext, /准备结束/)
  f.clock.set(at('2026-11-08T18:00:00')); await f.store.refresh()
  assert.equal(view().showDemo, true); assert.equal(view().demoPrimary, true); assert.match(view().subtext, /演示/)
  const read = deferred(); f.api.getState = () => read.promise
  const refreshing = f.store.refresh()
  assert.equal(view().showDemo, false); assert.equal(view().subtext, '正在读取，请稍候。')
  read.resolve(f.snapshot()); await refreshing
})

test('边界定时刷新改变首页，隐藏后停止计时；回执按北京时间格式化', async () => {
  const f = fixture(); f.clock.set(at('2026-11-08T05:59:59')); await f.controller.show()
  f.clock.advance(1050); await flush()
  assert.equal(f.store.get().snapshot.phase, 'closed'); assert.equal(f.count('getState'), 2)
  f.controller.hide(); assert.equal(f.clock.size(), 0)
  assert.equal(formatConfirmedAt(at('2026-11-08T00:04:00')), '11 月 8 日 00:04 关灯')
})

test('读取失败只展示同会话已确认回执并标注未刷新，不能显示可关灯', async () => {
  const f = fixture(); await f.store.activate(); await f.store.submit('hold', '20261107')
  f.api.getState = async () => { throw new CloudError('NETWORK', 'offline') }
  await f.store.refresh()
  const view = createNightView(f.store.get(), initialNightInteraction())
  assert.equal(view.hasReceipt, true); assert.equal(view.staleReceipt, true); assert.equal(view.canPress, false)
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view)
})

test('核对先读空、随后首页刷新查到提交：直接普通回执，不再允许重试', async () => {
  const f = fixture(); await f.controller.show()
  f.api.closeLight = async () => { throw new CloudError('TIMEOUT', 'unknown') }
  f.controller.submit('hold'); await flush()
  f.api.getNight = async () => {
    f.records.set('alice20261107', { userId: 'alice', record: f.record() })
    return { serverNow: f.clock.now(), record: null }
  }
  await f.controller.checkResult()
  assert.equal(f.view().interaction, 'idle'); assert.equal(f.view().canRetry, false)
  assert.equal(f.effects.includes('enter'), false); assert.ok(f.store.get().snapshot.record)
  f.controller.destroy()
})

test('旧夜查询晚于新夜刷新返回时，只缓存原回执，不能倒退服务端时钟与首页', async () => {
  const f = fixture(), lookup = deferred(); await f.controller.show()
  const oldNow = f.clock.now(), confirmed = f.record()
  f.api.getNight = () => lookup.promise
  const checking = f.store.lookup('20261107')
  f.clock.set(at('2026-11-08T20:00:00')); await f.store.refresh()
  const newNow = f.store.get().snapshot.serverNow
  lookup.resolve({ serverNow: oldNow, record: confirmed }); await checking
  const view = createNightView(f.store.get(), f.view())
  assert.equal(f.store.get().snapshot.serverNow, newNow)
  assert.equal(f.store.get().snapshot.nightId, '20261108')
  assert.equal(f.store.get().snapshot.record, null); assert.equal(view.canPress, true)
  assert.equal(view.hasReceipt, false); assert.equal(f.effects.includes('enter'), false)
  f.controller.destroy()
})
