const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const time = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'utils/checkin.js'))

const options = { targetSleepMinute: 22 * 60 + 30 }
const local = value => new Date(value + '+08:00')

for (const [instant, target, key, open] of [
  ['2026-11-07T10:29:00', 1350, '20261107', false],
  ['2026-11-07T10:30:00', 1350, '20261107', true],
  ['2026-11-07T22:30:00', 1350, '20261107', true],
  ['2026-11-08T00:00:00', 1350, '20261107', true],
  ['2026-11-08T04:29:59', 1350, '20261107', true],
  ['2026-11-08T04:30:00', 1350, '20261108', false],
  ['2026-11-07T12:29:00', 30, '20261108', false],
  ['2026-11-07T12:30:00', 30, '20261108', true],
  ['2026-11-07T23:30:00', 30, '20261108', true],
  ['2026-11-08T00:30:00', 30, '20261108', true],
  ['2026-11-08T06:29:00', 30, '20261108', true],
  ['2026-11-08T06:30:00', 30, '20261109', false]
]) {
  test(`打卡周期 ${instant}，目标 ${target} 分钟`, () => {
    const date = local(instant)
    const opts = { targetSleepMinute: target }
    assert.equal(time.resolveCheckInCycle(date, target, opts).dateKey, key)
    assert.equal(time.formatDateKey(date, opts), key)
    assert.equal(time.isCheckInWindowOpen(time.getMinutesSinceMidnight(date), target, opts), open)
    assert.equal(time.formatDateKey(time.parseDateKey(key, opts), opts), key)
  })
}

test('凌晨统计、历史和目标时刻都以同一晚计算', () => {
  const now = local('2026-11-08T01:00:00')
  const records = { '20261106': local('2026-11-06T22:00:00').getTime(), '20261107': now.getTime() }
  assert.equal(time.computeCurrentStreak(records, now, options), 2)
  assert.equal(time.computeBestStreak(records, options), 2)
  assert.equal(time.computeCompletionRate(records, now, options), 100)
  assert.equal(time.getRecentDays(records, now, 7, options).at(-1).key, '20261107')
  assert.equal(time.computeRecommendedBedTime(now, 1350, options).getTime(), local('2026-11-07T22:30:00').getTime())
})

test('月末和跨年不会生成无效日期', () => {
  assert.equal(time.formatDateKey(local('2027-01-01T01:00:00'), options), '20261231')
  assert.equal(time.formatDateKey(local('2026-03-01T01:00:00'), options), '20260228')
  assert.equal(time.normalizeDateKey('2026-02-30'), null)
})

test('未加载或不合法的时间使用默认22:30，合法午夜仍是0', () => {
  const { parseTimeStringToMinutes } = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'utils/time.js'))
  assert.equal(parseTimeStringToMinutes('', 1350), 1350)
  assert.equal(parseTimeStringToMinutes('invalid', 1350), 1350)
  assert.equal(parseTimeStringToMinutes('00:00', 1350), 0)
})
