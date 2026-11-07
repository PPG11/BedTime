const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')

const output = process.env.BEDTIME_TEST_OUTPUT
const transportPath = path.join(output, 'services/cloud.js')
require.cache[require.resolve(path.join(output, 'config/runtime.js'))] = {
  exports: { runtime: { cloudEnvId: 'bedtime-test', cloudEnabled: true } }
}

function transport(callFunction) {
  delete require.cache[require.resolve(transportPath)]
  let initialized = 0
  global.wx = { cloud: { init() { initialized++ }, callFunction } }
  return { cloud: require(transportPath), count: () => initialized }
}

test('云连接仅初始化一次，业务调用通过明确的函数和 action', async () => {
  const { cloud, count } = transport(async options => {
    assert.deepEqual(options, { name: 'bedtimeCheckin', data: { action: 'status' } })
    return { result: { code: 'OK', data: null } }
  })
  assert.deepEqual(await Promise.all([
    cloud.callCloud('bedtimeCheckin', 'status'), cloud.callCloud('bedtimeCheckin', 'status')
  ]), [null, null])
  assert.equal(count(), 1)
})

test('业务拒绝和缺失响应均抛出错误', async () => {
  const { cloud } = transport(async () => ({}))
  await assert.rejects(cloud.callCloud('bedtimeCheckin', 'status'), /未返回有效结果/)
  const denied = transport(async () => ({ result: { code: 'FORBIDDEN', message: '无权访问' } }))
  await assert.rejects(denied.cloud.callCloud('bedtimeGoodnight', 'vote'), error => error.code === 'FORBIDDEN')
})
