const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = name => require(path.join(process.env.BEDTIME_TEST_OUTPUT, name))
const platform = load('utils/night-platform.js')

function fixture(t) {
  let now = 0, seq = 0, boundsCallback, definition
  const tasks = new Map(), events = []
  t.mock.method(Date, 'now', () => now)
  t.mock.method(platform.localClock, 'now', () => now)
  t.mock.method(platform.localClock, 'schedule', (callback, delay) => { const id = ++seq; tasks.set(id, { at: now + delay, callback }); return id })
  t.mock.method(platform.localClock, 'clear', id => tasks.delete(id))
  global.Component = value => { definition = value }
  const file = path.join(process.env.BEDTIME_TEST_OUTPUT, 'components/hold-button/index.js')
  delete require.cache[require.resolve(file)]; require(file)
  const instance = {
    ...definition.methods, data: { held: false, enabled: true, surface: 'main' },
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { events.push({ name, detail }) },
    createSelectorQuery() { return { select() { return this }, boundingClientRect(callback) { boundsCallback = callback; return this }, exec() {} } }
  }
  definition.lifetimes.attached.call(instance)
  return {
    instance, events, hide: () => definition.pageLifetimes.hide.call(instance),
    rectangle: () => boundsCallback({ left: 0, right: 100, top: 0, bottom: 60 }),
    advance(ms) {
      const end = now + ms
      for (;;) {
        const entry = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry || entry[1].at > end) break
        const [id, task] = entry; now = task.at; tasks.delete(id); task.callback()
      }
      now = end
    }
  }
}
const touch = { touches: [{ clientX: 20, clientY: 20 }] }

test('lifting before asynchronous bounds resolution cannot start a ghost hold', t => {
  const f = fixture(t); f.instance.onTouchStart(touch); f.instance.onTouchEnd(); f.rectangle(); f.advance(2000)
  assert.deepEqual(f.events, []); assert.equal(f.instance.data.held, false)
})
test('bounds resolution preserves the original touch clock and commits without touchend', t => {
  const f = fixture(t); f.instance.onTouchStart(touch); f.advance(790); f.rectangle(); f.advance(10)
  assert.equal(f.events.filter(event => event.name === 'holdcommit').length, 1)
  f.instance.onTouchEnd(); assert.equal(f.events.filter(event => event.name === 'holdcommit').length, 1)
})
test('component hide cancels a hold and invalidates pending selector callbacks', t => {
  const f = fixture(t); f.instance.onTouchStart(touch); f.rectangle(); f.advance(400); f.hide(); f.advance(1000)
  assert.equal(f.events.filter(event => event.name === 'holdcommit').length, 0)
  assert.equal(f.events.filter(event => event.name === 'holdcancel').length, 1)
  f.instance.onTouchStart(touch); f.hide(); f.rectangle(); f.advance(1000)
  assert.equal(f.events.filter(event => event.name === 'holdcommit').length, 0)
})
