const assert = require('node:assert/strict')
const { test } = require('node:test')
const Module = require('node:module')
const path = require('node:path')

const NOW = Date.parse('2026-11-08T01:00:00+08:00')
const DB = {
  and: values => ({ and: values }),
  or: values => ({ or: values }),
  in: values => value => values.includes(value),
  gt: expected => value => value > expected,
  lt: expected => value => value < expected,
  gte: expected => value => value >= expected,
  neq: expected => value => value !== expected
}
function matches(data, query) {
  if (query.and) return query.and.every(condition =>
    typeof condition === 'function' ? condition(data) : matches(data, condition))
  if (query.or) return query.or.some(condition => matches(data, condition))
  return Object.entries(query).every(([key, filter]) => {
    if (typeof filter === 'function') return filter(data[key])
    if (filter?.and) return filter.and.every(fn => fn(data[key]))
    return data[key] === filter
  })
}

function createDatabase() {
  let state = new Map()
  let queued = Promise.resolve()
  let failCollection
  function connect(store) {
    return {
      command: DB,
      collection(name) {
        const records = () => {
          const collections = store()
          if (!collections.has(name)) collections.set(name, new Map())
          return collections.get(name)
        }
        function query(filter, order, max) {
          return {
            where: next => query(next, order, max),
            orderBy: (key, direction) => query(filter, { key, direction }, max),
            limit: size => query(filter, order, size),
            async get() {
              const rows = [...records()].map(([_id, value]) => ({ ...structuredClone(value), _id }))
                .filter(value => !filter || matches(value, filter))
              if (order) {
                const { key, direction } = order
                rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) *
                  (direction === 'desc' ? -1 : 1))
              }
              return { data: rows.slice(0, max) }
            }
          }
        }
        return {
          ...query(),
          doc(id) {
            return {
              async get() {
                const data = records().get(id)
                return { data: data ? { ...structuredClone(data), _id: id } : null }
              },
              async set({ data }) { records().set(id, structuredClone(data)) },
              async update({ data }) {
                if (failCollection === name) throw new Error('simulated write failure')
                records().set(id, { ...records().get(id), ...structuredClone(data) })
              },
              async remove() { records().delete(id) }
            }
          }
        }
      }
    }
  }
  const db = connect(() => state)
  db.runTransaction = operation => {
    const pending = queued.then(async () => {
      const next = structuredClone(state)
      const result = await operation(connect(() => next))
      state = next
      return result
    })
    queued = pending.catch(() => undefined)
    return pending
  }
  db.failWritesTo = name => { failCollection = name }
  return db
}

let database
let identity
let suggest
const sdk = {
  init() {},
  database: () => database,
  getWXContext: () => ({ OPENID: identity }),
  openapi: { security: { msgSecCheck: async () => ({ result: { suggest } }) } }
}
const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
  if (request === 'wx-server-sdk') return sdk
  // file: dependencies can be stale copies in node_modules after source edits.
  if (request.startsWith('common/')) {
    return originalLoad.call(this, path.join(__dirname, '../cloudfunctions', request), parent, isMain)
  }
  return originalLoad.call(this, request, parent, isMain)
}
const handlers = Object.fromEntries(['User', 'Checkin', 'Friends', 'Goodnight'].map(domain => [
  domain, require('../cloudfunctions/bedtime' + domain).main
]))
Module._load = originalLoad

function call(domain, action, caller, data = {}) {
  identity = caller
  return handlers[domain]({ ...data, action })
}

async function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  database = createDatabase()
  suggest = 'pass'
  const [alice, bob, outsider] = await Promise.all(['alice', 'bob', 'outsider'].map(
    caller => call('User', 'bootstrap', caller, { tzOffset: 480 })
  ))
  return { alice: alice.data, bob: bob.data, outsider: outsider.data }
}

test('云端周期覆盖跨午夜、左右边界以及 00:30 的目标日', () => {
  const { resolveCycle } = require('../cloudfunctions/common/time')
  const cases = [
    ['22:30', '2026-11-07T10:29:59', '20261107', false, 'hit'],
    ['22:30', '2026-11-07T10:30:00', '20261107', true, 'hit'],
    ['22:30', '2026-11-07T22:30:00', '20261107', true, 'hit'],
    ['22:30', '2026-11-08T00:00:00', '20261107', true, 'late'],
    ['22:30', '2026-11-08T04:29:59', '20261107', true, 'late'],
    ['22:30', '2026-11-08T04:30:00', '20261108', false, 'hit'],
    ['00:30', '2026-11-07T23:30:00', '20261108', true, 'hit'],
    ['00:30', '2026-11-08T06:29:59', '20261108', true, 'late'],
    ['00:30', '2026-11-08T06:30:00', '20261109', false, 'hit']
  ]
  for (const [targetHM, when, date, open, status] of cases) {
    assert.deepEqual(resolveCycle({ targetHM, tzOffset: 480 }, Date.parse(when + '+08:00')), { date, open, status })
  }
})

test('注册并发返回同一档案，资料更新不接受伪造 UID、统计或身份', async t => {
  const { alice } = await setup(t)
  const first = call('User', 'bootstrap', 'new', { tzOffset: 480 })
  const second = call('User', 'bootstrap', 'new', { tzOffset: 0 })
  assert.deepEqual((await first).data, (await second).data)
  assert.equal((await call('User', 'bootstrap', null, { OPENID: 'alice', tzOffset: 480 })).code, 'UNAUTHORIZED')
  assert.equal((await call('User', 'constructor', 'alice')).code, 'INVALID_ARG')
  const result = await call('User', 'updateProfile', 'alice', {
    nickname: ' 新昵称 ', targetHM: '00:30', uid: 'changed', OPENID: 'outsider', streak: 999
  })
  assert.equal(result.data.nickname, '新昵称')
  assert.equal(result.data.uid, alice.uid)
  assert.equal(result.data.streak, 0)
  assert.equal(result.data.tzOffset, 480)
  assert.equal((await call('Checkin', 'status', 'alice')).data.date, '20261108')
})

test('打卡事务失败可重试，并发提交只写一次且使用服务端状态与奖励', async t => {
  await setup(t)
  await call('Goodnight', 'submit', 'alice', { date: '20261107', text: '自己的心语' })
  const message = await call('Goodnight', 'submit', 'bob', { date: '20261107', text: '朋友的心语' })
  const input = { date: '20261107', status: 'hit', gnMsgId: '伪造消息' }
  assert.equal((await call('Checkin', 'submit', 'alice', { date: '20261108' })).code, 'CYCLE_CHANGED')
  database.failWritesTo('users')
  const muted = t.mock.method(console, 'error', () => {})
  assert.equal((await call('Checkin', 'submit', 'alice', input)).code, 'INTERNAL')
  muted.mock.restore()
  assert.equal((await call('Checkin', 'status', 'alice')).data.record, null)
  database.failWritesTo(undefined)
  const results = await Promise.all([call('Checkin', 'submit', 'alice', input), call('Checkin', 'submit', 'alice', input)])
  assert.equal(results.filter(result => result.data.created).length, 1)
  assert.deepEqual(results[0].data.record, results[1].data.record)
  assert.equal(results[0].data.record.status, 'late')
  assert.equal(results[0].data.record.goodnightMessageId, message.data._id)
  const replay = await call('Checkin', 'submit', 'alice', input)
  assert.equal(replay.data.created, false)
  assert.equal((await call('User', 'bootstrap', 'alice', { tzOffset: 480 })).data.totalDays, 1)
  assert.equal((await call('Checkin', 'history', 'alice', { uid: 'outsider' })).data.list.length, 1)
  assert.equal((await call('Checkin', 'history', 'outsider', { uid: 'alice' })).data.list.length, 0)
})

test('心语只向领取人开放，审核拒绝不入库，投票重复和事务失败不重复计分', async t => {
  await setup(t)
  suggest = 'review'
  assert.equal((await call('Goodnight', 'submit', 'bob', { date: '20261107', text: '未通过' })).code, 'CONTENT_REJECTED')
  assert.equal((await call('Goodnight', 'ownSubmission', 'bob', { date: '20261107' })).data, null)
  suggest = 'pass'
  const posted = await call('Goodnight', 'submit', 'bob', { date: '20261107', text: '晚安' })
  assert.equal((await call('Goodnight', 'submit', 'bob', { date: '20261107', text: '重试文本' })).data.content, '晚安')
  await call('Checkin', 'submit', 'alice', { date: '20261107' })
  assert.equal((await call('Goodnight', 'reward', 'outsider', { date: '20261107', messageId: posted.data._id })).data, null)
  assert.equal((await call('Goodnight', 'vote', 'outsider', { date: '20261107', value: 1 })).code, 'FORBIDDEN')

  database.failWritesTo('goodnight_messages')
  const muted = t.mock.method(console, 'error', () => {})
  assert.equal((await call('Goodnight', 'vote', 'alice', { date: '20261107', value: 1 })).code, 'INTERNAL')
  muted.mock.restore()
  assert.equal((await call('Goodnight', 'reward', 'alice', { date: '20261107' })).data.voted, false)
  database.failWritesTo(undefined)
  const first = await call('Goodnight', 'vote', 'alice', { date: '20261107', value: 1 })
  const retry = await call('Goodnight', 'vote', 'alice', { date: '20261107', value: -1 })
  assert.deepEqual(first, retry)
  assert.equal(first.data.likes, 1)
  assert.equal(first.data.dislikes, 0)
  assert.equal((await call('Goodnight', 'reward', 'alice', { date: '20261107' })).data.voted, true)
})

test('好友申请按关系去重，只有接收方能接受，解除后旧请求不能恢复关系', async t => {
  const { alice, bob } = await setup(t)
  const [first, second] = await Promise.all([1, 2].map(() =>
    call('Friends', 'send', 'alice', { toUid: bob.uid })))
  const { requestId } = first.data
  assert.equal(second.data.requestId, requestId)
  assert.equal((await call('Friends', 'send', 'bob', { toUid: alice.uid })).code, 'INCOMING_REQUEST')
  const pending = (await call('Friends', 'overview', 'bob')).data.requests.incoming[0]
  assert.equal(pending.requestId, requestId)
  assert.equal('targetHM' in pending, false)
  const acceptance = { requestId, decision: 'accepted' }
  assert.equal((await call('Friends', 'respond', 'outsider', acceptance)).code, 'FORBIDDEN')
  assert.equal((await call('Friends', 'respond', 'alice', acceptance)).code, 'FORBIDDEN')
  assert.equal((await call('Friends', 'respond', 'bob', acceptance)).data.status, 'accepted')
  assert.equal((await call('Friends', 'overview', 'alice')).data.list[0].uid, bob.uid)
  const removal = { targetUid: alice.uid, relationshipId: requestId }
  await call('Friends', 'remove', 'bob', removal)
  assert.equal((await call('Friends', 'respond', 'bob', acceptance)).code, 'NOT_FOUND')
  assert.deepEqual((await call('Friends', 'overview', 'alice')).data.list, [])
  const newRequest = (await call('Friends', 'send', 'alice', { toUid: bob.uid })).data.requestId
  await call('Friends', 'respond', 'bob', { requestId: newRequest, decision: 'accepted' })
  await call('Friends', 'remove', 'bob', removal)
  assert.equal((await call('Friends', 'overview', 'alice')).data.list[0].relationshipId, newRequest)
})

test('本人及好友连胜跨午夜保留，跳过完整周期后只在读取时归零', async t => {
  const { bob } = await setup(t)
  await database.collection('users').doc('alice').update({ data: {
    lastCheckinDate: '20261106', todayStatus: 'hit', streak: 3, totalDays: 5
  } })
  const { data: request } = await call('Friends', 'send', 'alice', { toUid: bob.uid })
  await call('Friends', 'respond', 'bob', { requestId: request.requestId, decision: 'accepted' })

  const cases = [
    ['2026-11-06T23:59:59', 3, 'hit'],
    ['2026-11-07T00:00:00', 3, 'hit'],
    ['2026-11-07T04:30:00', 3, 'pending'],
    ['2026-11-08T04:29:59', 3, 'pending'],
    ['2026-11-08T04:30:00', 0, 'pending']
  ]
  for (const [when, streak, todayStatus] of cases) {
    t.mock.timers.setTime(Date.parse(when + '+08:00'))
    const own = (await call('User', 'bootstrap', 'alice', { tzOffset: 480 })).data
    const friend = (await call('Friends', 'overview', 'bob')).data.list[0]
    for (const summary of [own, friend]) {
      assert.equal(summary.streak, streak, when)
      assert.equal(summary.todayStatus, todayStatus, when)
      assert.equal(summary.totalDays, 5)
    }
  }
  const saved = await call('User', 'updateProfile', 'alice', { nickname: '新的称呼' })
  assert.equal(saved.data.streak, 0)
  assert.equal((await database.collection('users').doc('alice').get()).data.streak, 3)
})

test('凌晨目标以前夜为开放时段，连胜到该目标周期窗口结束才失效', async t => {
  const { bob } = await setup(t)
  await call('User', 'updateProfile', 'alice', { targetHM: '00:30' })
  await database.collection('users').doc('alice').update({ data: {
    lastCheckinDate: '20261107', todayStatus: 'hit', streak: 2, totalDays: 2
  } })
  const { data: request } = await call('Friends', 'send', 'alice', { toUid: bob.uid })
  await call('Friends', 'respond', 'bob', { requestId: request.requestId, decision: 'accepted' })

  for (const [when, streak] of [
    ['2026-11-07T23:30:00', 2],
    ['2026-11-08T06:29:59', 2],
    ['2026-11-08T06:30:00', 0]
  ]) {
    t.mock.timers.setTime(Date.parse(when + '+08:00'))
    const own = (await call('User', 'bootstrap', 'alice', { tzOffset: 480 })).data
    const friend = (await call('Friends', 'overview', 'bob')).data.list[0]
    assert.equal(own.streak, streak, when)
    assert.equal(friend.streak, streak, when)
  }
})

test('晚打卡中断连胜，跨周期重试与修改目标后的重复提交不改旧记录或统计', async t => {
  const { bob } = await setup(t)
  const { data: request } = await call('Friends', 'send', 'alice', { toUid: bob.uid })
  await call('Friends', 'respond', 'bob', { requestId: request.requestId, decision: 'accepted' })

  t.mock.timers.setTime(Date.parse('2026-11-06T22:00:00+08:00'))
  assert.equal((await call('Checkin', 'submit', 'alice', { date: '20261106' })).data.record.status, 'hit')
  t.mock.timers.setTime(NOW)
  const late = await call('Checkin', 'submit', 'alice', { date: '20261107' })
  assert.equal(late.data.record.status, 'late')
  assert.equal((await call('User', 'bootstrap', 'alice', { tzOffset: 480 })).data.streak, 0)
  assert.equal((await call('Friends', 'overview', 'bob')).data.list[0].streak, 0)

  t.mock.timers.setTime(Date.parse('2026-11-08T22:40:00+08:00'))
  const replay = await call('Checkin', 'submit', 'alice', { date: '20261107' })
  assert.equal(replay.data.created, false)
  assert.deepEqual(replay.data.record, late.data.record)
  await call('User', 'updateProfile', 'alice', { targetHM: '22:45' })
  const next = await call('Checkin', 'submit', 'alice', { date: '20261108' })
  assert.equal(next.data.record.status, 'hit')
  await call('User', 'updateProfile', 'alice', { targetHM: '22:00' })
  const duplicate = await call('Checkin', 'submit', 'alice', { date: '20261108' })
  assert.equal(duplicate.data.created, false)
  assert.deepEqual(duplicate.data.record, next.data.record)
  const own = (await call('User', 'bootstrap', 'alice', { tzOffset: 480 })).data
  const friend = (await call('Friends', 'overview', 'bob')).data.list[0]
  assert.equal(own.streak, 1)
  assert.equal(friend.streak, 1)
  assert.equal(own.totalDays, 3)
  assert.equal(friend.totalDays, 3)
})
