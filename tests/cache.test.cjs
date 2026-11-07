const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { createTimedCache } = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'utils/cache.js'))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('成功写入后，早先的读取不能把缓存回退为 null', async () => {
  const cache = createTimedCache(30000)
  const gate = deferred()
  const load = cache.getOrLoad('message', () => gate.promise)
  cache.set('message', { id: 'submitted' })
  gate.resolve(null); await load
  assert.deepEqual(cache.get('message'), { id: 'submitted' })
})

test('失效后重载不会被旧请求污染，待返回的key也可被失效', async () => {
  const cache = createTimedCache(30000)
  const oldGate = deferred(); const newGate = deferred()
  const oldLoad = cache.getOrLoad('record', () => oldGate.promise)
  assert.deepEqual([...cache.keys()], ['record'])
  cache.delete('record')
  const newLoad = cache.getOrLoad('record', () => newGate.promise)
  oldGate.resolve('old'); await oldLoad
  assert.equal(cache.get('record'), undefined)
  newGate.resolve('new'); await newLoad
  assert.equal(cache.get('record'), 'new')
})

test('清空缓存后，未完成请求不能恢复旧记录', async () => {
  const cache = createTimedCache(30000); const gate = deferred()
  const load = cache.getOrLoad('record', () => gate.promise)
  cache.clear(); gate.resolve('old'); await load
  assert.equal(cache.get('record'), undefined)
  assert.deepEqual([...cache.keys()], [])
})
