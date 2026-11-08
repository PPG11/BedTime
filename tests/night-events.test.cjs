const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { NightEvents } = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'state/night-events.js'))
const { CloudError } = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'services/cloud.js'))
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function clock() {
  let now = 0, id = 0; const jobs = new Map()
  return { now: () => now, schedule(fn, delay) { jobs.set(++id, { fn, at: now + delay }); return id }, clear(id) { jobs.delete(id) },
    tick(ms) { now += ms; for (const [key, job] of jobs) if (job.at <= now) { jobs.delete(key); job.fn() } }, count: () => jobs.size }
}
const data = { name: 'exit_tap', props: {} }
const ack = events => ({ serverNow: 1, acceptedIds: events.map(e => e.eventId), duplicateIds: [] })
const random = () => { let n = 0; return () => ((n++ * 13.47) % 997) / 997 }

test('事件只在身份确认后采集，5条立即或3秒发送，最多20条且每批最多10条', async () => {
  const time = clock(), calls = []; let release
  const events = new NightEvents(async batch => { calls.push(batch); await new Promise(resolve => { release = resolve }); return ack(batch) }, time, random())
  events.record(data); time.tick(3000); assert.equal(calls.length, 0)
  events.update('alice', true)
  for (let i = 0; i < 25; i++) events.record(data)
  assert.equal(calls.length, 1); assert.equal(calls[0].length, 5)
  release(); await settle(); time.tick(3000); assert.equal(calls[1].length, 10)
  release(); await settle(); time.tick(3000); assert.equal(calls[2].length, 5)
  release(); await settle(); time.tick(3000); assert.equal(calls.length, 3)
})

test('恢复身份刷新期间不发送；身份变化丢弃旧队列，旧回执不清新队列', async () => {
  const time = clock(), calls = []; let finish
  const events = new NightEvents(batch => { calls.push(batch); return new Promise(resolve => { finish = () => resolve(ack(batch)) }) }, time, random())
  events.update('alice', true); events.record(data)
  events.update('alice', false); time.tick(6000); assert.equal(calls.length, 0)
  events.update('alice', true); time.tick(3000); const old = finish
  events.update('bob', true); events.record(data)
  old(); await settle(); time.tick(3000); assert.equal(calls.length, 2)
  finish(); await settle(); time.tick(3000); assert.equal(calls.length, 2)
})

test('普通失败前台仅重试一次；限额拒绝直接丢弃；隐藏只尽力发一次', async () => {
  for (const code of ['NETWORK', 'RATE_LIMITED']) {
    const time = clock(); let calls = 0
    const events = new NightEvents(async () => { calls++; throw new CloudError(code, 'test') }, time, random())
    events.update('alice', true); events.record(data)
    for (let i = 0; i < 4; i++) { time.tick(3000); await settle() }
    assert.equal(calls, code === 'NETWORK' ? 2 : 1)
  }
  const time = clock(); let calls = 0
  const events = new NightEvents(async () => { calls++; throw new Error('offline') }, time, random())
  events.update('alice', true); events.record(data); events.update('alice', false, true)
  await settle(); time.tick(6000); assert.equal(calls, 1); assert.equal(time.count(), 0)
})
