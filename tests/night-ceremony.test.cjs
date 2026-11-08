const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = relative => require(path.join(process.env.BEDTIME_TEST_OUTPUT, relative))
const { HoldGesture } = load('utils/hold-gesture.js')
const { Ceremony, ceremonyFrame } = load('pages/night/ceremony.js')
const { NightNavigation, NightSound } = load('utils/night-platform.js')

function fakeClock() {
  let time = 0, serial = 0
  const tasks = new Map()
  const clock = {
    now: () => time,
    schedule(callback, delay) { const id = ++serial; tasks.set(id, { at: time + delay, callback }); return id },
    clear(id) { tasks.delete(id) },
    advance(ms) {
      const end = time + ms
      for (;;) {
        const entry = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry || entry[1].at > end) break
        const [id, task] = entry; time = task.at; tasks.delete(id); task.callback()
      }
      time = end
    },
    jump(ms) {
      time += ms
      const next = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (next) { tasks.delete(next[0]); next[1].callback() }
    },
    size: () => tasks.size
  }
  return clock
}
const bounds = { left: 10, right: 110, top: 10, bottom: 60 }
const origin = { x: 40, y: 30 }
function gestureFixture() {
  const clock = fakeClock(), log = []
  const gesture = new HoldGesture(clock, { progress: value => log.push(['progress', value]), commit: () => log.push(['commit']), cancel: () => log.push(['cancel']) })
  return { clock, log, gesture, count: name => log.filter(entry => entry[0] === name).length }
}

test('799ms release cancels, 800ms commits once without waiting for release', () => {
  const a = gestureFixture(); a.gesture.start(origin, bounds); a.clock.advance(799); a.gesture.release(); a.clock.advance(1000)
  assert.equal(a.count('commit'), 0); assert.equal(a.count('cancel'), 1); assert.equal(a.clock.size(), 0)
  const b = gestureFixture(); b.gesture.start(origin, bounds); b.clock.advance(800)
  assert.equal(b.count('commit'), 1)
  b.gesture.release(); b.gesture.cancel(); b.clock.advance(1000)
  assert.equal(b.count('commit'), 1); assert.equal(b.count('cancel'), 0)
})

test('exactly 24px is allowed; farther cancels permanently for this touch', () => {
  for (const point of [{ x: -14, y: 30 }, { x: 134, y: 30 }, { x: 40, y: -14 }, { x: 40, y: 84 }]) {
    const f = gestureFixture(); f.gesture.start(origin, bounds); f.gesture.move(point); f.clock.advance(800); assert.equal(f.count('commit'), 1)
  }
  const f = gestureFixture(); f.gesture.start(origin, bounds); f.gesture.move({ x: 134.01, y: 30 }); f.gesture.move(origin); f.clock.advance(800)
  assert.equal(f.count('commit'), 0); assert.equal(f.count('cancel'), 1)
})

test('touchcancel/background interruption and clock discontinuity cannot commit', () => {
  for (const interruption of ['cancel', 'backward', 'forward']) {
    const f = gestureFixture(); f.gesture.start(origin, bounds); f.clock.advance(400)
    if (interruption === 'cancel') f.gesture.cancel()
    else f.clock.jump(interruption === 'backward' ? -1000 : 3600000)
    f.clock.advance(2000); assert.equal(f.count('commit'), 0); assert.equal(f.count('cancel'), 1)
  }
})

test('the selected 800ms timeline and reduced motion have exact boundaries', () => {
  for (const ms of [800]) {
    assert.equal(ceremonyFrame(0, ms, false).maskOpacity, 0)
    assert.equal(ceremonyFrame(399, ms, false).phase, 'dimming')
    assert.equal(ceremonyFrame(400, ms, false).phase, 'blackout')
    assert.equal(ceremonyFrame(400 + ms - 1, ms, false).phraseOpacity, 0)
    assert.equal(ceremonyFrame(400 + ms, ms, false).phase, 'revealing')
    assert.equal(ceremonyFrame(800 + ms, ms, false).phase, 'done')
    assert.deepEqual(ceremonyFrame(0, ms, true), { phase: 'blackout', maskOpacity: 1, phraseOpacity: 0 })
    assert.equal(ceremonyFrame(799, ms, true).phraseOpacity, 0)
    assert.deepEqual(ceremonyFrame(800, ms, true), { phase: 'done', maskOpacity: 1, phraseOpacity: 1 })
  }
})

test('ceremony clock jumps safely end playback; stopping cancels scheduled callbacks', () => {
  for (const jump of [-1000, 3600000]) {
    const clock = fakeClock(), frames = []; let interruptions = 0
    const ceremony = new Ceremony(clock)
    ceremony.start(800, false, frame => frames.push(frame), () => interruptions++)
    clock.advance(100); clock.jump(jump)
    assert.equal(interruptions, 1); assert.equal(clock.size(), 0)
    assert.notEqual(frames.at(-1).phase, 'done')
  }
  const clock = fakeClock(); const ceremony = new Ceremony(clock); let frames = 0
  ceremony.start(800, false, () => frames++, () => {}); ceremony.stop(); clock.advance(5000)
  assert.equal(frames, 1)
})

test('黑色留白不重复发布同一帧，减少动效只发布开始和完成', () => {
  for (const reduced of [false, true]) {
    const clock = fakeClock(), frames = []
    new Ceremony(clock).start(800, reduced, frame => frames.push(frame), () => {})
    clock.advance(reduced ? 800 : 1600)
    assert.equal(frames.filter(frame => frame.phase === 'blackout').length, 1)
    assert.equal(frames.at(-1).phase, 'done')
    if (reduced) assert.equal(frames.length, 2)
  }
})

test('TabBar hide failure and a late hide callback cannot strand a returning page', () => {
  let callback, shows = 0
  const nav = new NightNavigation({ hide: options => { callback = options }, show: () => shows++ })
  nav.enter(); nav.restore(); callback.success(); assert.equal(shows, 2)
  nav.enter(); callback.fail(); nav.restore(); assert.equal(shows, 3)
  const failing = new NightNavigation({ hide() { throw new Error('unsupported') }, show() { shows++ } })
  assert.doesNotThrow(() => failing.enter()); failing.restore(); assert.equal(shows, 4)
})

test('sound opt-in never prewarms or plays after hide while audio configuration is pending', () => {
  let ready, plays = 0, creates = 0, destroys = 0
  global.wx = {
    setInnerAudioOption(options) { ready = options.success },
    createInnerAudioContext() { creates++; return { play() { plays++ }, stop() {}, destroy() { destroys++ }, onError() {} } }
  }
  const audio = new NightSound(); audio.play(false); assert.equal(creates, 0)
  audio.play(true); audio.stop(); ready(); assert.equal(creates, 0)
  audio.play(true); ready(); assert.equal(plays, 1); audio.stop(); assert.equal(destroys, 1)
})
