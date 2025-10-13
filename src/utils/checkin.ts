import { formatMinutesToTime } from './time'
import { CheckInMap } from './storage'

export type RecentDay = {
  key: string
  label: string
  weekday: string
  checked: boolean
}

export const CHECK_IN_START_MINUTE = 20 * 60 // 20:00
export const CHECK_IN_RESET_MINUTE = 4 * 60 // 04:00
export const ONE_DAY_MS = 24 * 60 * 60 * 1000

const CHECK_IN_RESET_MS = CHECK_IN_RESET_MINUTE * 60 * 1000

function shiftByReset(date: Date): Date {
  return new Date(date.getTime() - CHECK_IN_RESET_MS)
}

export function getCheckInDayStart(date: Date): Date {
  const shifted = shiftByReset(date)
  shifted.setHours(0, 0, 0, 0)
  return new Date(shifted.getTime() + CHECK_IN_RESET_MS)
}

export const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function formatDateKey(date: Date): string {
  const shifted = shiftByReset(date)
  const year = shifted.getFullYear()
  const month = `${shifted.getMonth() + 1}`.padStart(2, '0')
  const day = `${shifted.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return new Date(date.getTime() + CHECK_IN_RESET_MS)
}

export function getMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

export function formatCountdown(durationMs: number): string {
  if (durationMs <= 0) {
    return '已经超过推荐就寝时间'
  }
  const totalMinutes = Math.ceil(durationMs / (60 * 1000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) {
    return `${minutes} 分钟后`
  }

  if (minutes === 0) {
    return `${hours} 小时后`
  }

  return `${hours} 小时 ${minutes} 分钟后`
}

export function computeCurrentStreak(records: CheckInMap, today: Date): number {
  let streak = 0
  const cursor = getCheckInDayStart(today)

  while (true) {
    const key = formatDateKey(cursor)
    if (!records[key]) {
      break
    }
    streak += 1
    cursor.setTime(cursor.getTime() - ONE_DAY_MS)
  }

  return streak
}

export function computeBestStreak(records: CheckInMap): number {
  const keys = Object.keys(records)
  if (keys.length === 0) {
    return 0
  }

  const sorted = keys
    .map((key) => parseDateKey(key))
    .sort((a, b) => a.getTime() - b.getTime())

  let best = 1
  let streak = 1

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const current = sorted[i]
    const diffDays = Math.round((current.getTime() - prev.getTime()) / ONE_DAY_MS)
    if (diffDays === 1) {
      streak += 1
    } else {
      streak = 1
    }
    best = Math.max(best, streak)
  }

  return best
}

export function getRecentDays(records: CheckInMap, current: Date, length: number): RecentDay[] {
  const items: RecentDay[] = []
  const cursor = getCheckInDayStart(current)

  for (let i = length - 1; i >= 0; i -= 1) {
    const dayStart = new Date(cursor.getTime() - i * ONE_DAY_MS)
    const key = formatDateKey(dayStart)
    items.push({
      key,
      label: `${dayStart.getMonth() + 1}.${dayStart.getDate()}`,
      weekday: weekdayLabels[dayStart.getDay()],
      checked: Boolean(records[key])
    })
  }

  return items
}

export function computeCompletionRate(records: CheckInMap, today: Date): number {
  const keys = Object.keys(records)
  if (!keys.length) {
    return 0
  }

  const sorted = keys
    .map(parseDateKey)
    .sort((a, b) => a.getTime() - b.getTime())

  const first = sorted[0]
  const todayStart = getCheckInDayStart(today)
  const spanDays = Math.floor((todayStart.getTime() - first.getTime()) / ONE_DAY_MS) + 1
  if (spanDays <= 0) {
    return 100
  }
  const rate = Math.round((keys.length / spanDays) * 100)
  return Math.max(0, Math.min(100, rate))
}

export function formatWindowHint(
  currentTime: Date,
  targetTime: Date,
  isWindowOpen: boolean,
  targetMinutes: number
): string {
  if (!isWindowOpen) {
    const minutesNow = getMinutesSinceMidnight(currentTime)
    const diffMinutes = CHECK_IN_START_MINUTE - minutesNow
    const hours = Math.floor(diffMinutes / 60)
    const minutes = diffMinutes % 60
    if (hours === 0) {
      return `打卡将在 ${minutes} 分钟后开启`
    }
    return `打卡将在 ${hours} 小时 ${minutes} 分钟后开启`
  }

  if (targetTime.getTime() > currentTime.getTime()) {
    return `建议在 ${formatMinutesToTime(targetMinutes)} 前完成打卡`
  }

  return '已经超过目标入睡时间，尽快休息哦'
}

export function computeRecommendedBedTime(currentTime: Date, targetMinutes: number): Date {
  const dayStart = getCheckInDayStart(currentTime)
  const target = new Date(dayStart)
  const hours = Math.floor(targetMinutes / 60)
  const minutes = targetMinutes % 60
  target.setHours(hours, minutes, 0, 0)

  if (target.getTime() < dayStart.getTime()) {
    target.setTime(target.getTime() + ONE_DAY_MS)
  }

  return target
}

export function isCheckInWindowOpen(minutesNow: number, targetSleepMinute: number): boolean {
  if (targetSleepMinute < CHECK_IN_START_MINUTE) {
    return true
  }
  return minutesNow >= CHECK_IN_START_MINUTE || minutesNow < CHECK_IN_RESET_MINUTE
}
