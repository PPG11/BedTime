import { formatMinutesToTime } from './time'
import type { CheckInMap } from './storage'

export type RecentDay = {
  key: string
  label: string
  weekday: string
  checked: boolean
}

export const CHECK_IN_WINDOW_OPEN_OFFSET_MINUTES = 12 * 60 // 最早打卡：目标睡眠时间前 12 小时
export const CHECK_IN_WINDOW_CLOSE_OFFSET_MINUTES = 6 * 60 // 最晚打卡：目标睡眠时间后 6 小时
export const ONE_DAY_MS = 24 * 60 * 60 * 1000

const MINUTES_PER_DAY = 24 * 60
const HALF_DAY_MINUTES = MINUTES_PER_DAY / 2
const MS_PER_MINUTE = 60 * 1000
const DEFAULT_TARGET_SLEEP_MINUTE = 22 * 60 + 30

export type CheckInWindowOptions = {
  targetSleepMinute?: number
  openOffsetMinutes?: number
  closeOffsetMinutes?: number
}

export const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

function normalizeMinute(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  const integer = Math.trunc(value) % MINUTES_PER_DAY
  return integer >= 0 ? integer : integer + MINUTES_PER_DAY
}

function formatAbsoluteDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function clampOffset(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const normalized = Math.abs(Math.trunc(value))
  if (normalized > MINUTES_PER_DAY) {
    return MINUTES_PER_DAY
  }
  return normalized
}

function resolveWindowOptions(
  targetOverride: number | undefined,
  options: CheckInWindowOptions | undefined
): { targetMinute: number; openOffsetMinutes: number; closeOffsetMinutes: number } {
  const targetCandidate =
    Number.isFinite(targetOverride) && targetOverride !== undefined
      ? targetOverride
      : options?.targetSleepMinute
  const targetMinute = normalizeMinute(
    Number.isFinite(targetCandidate) ? (targetCandidate as number) : DEFAULT_TARGET_SLEEP_MINUTE
  )
  const openOffsetMinutes = clampOffset(
    options?.openOffsetMinutes,
    CHECK_IN_WINDOW_OPEN_OFFSET_MINUTES
  )
  const closeOffsetMinutes = clampOffset(
    options?.closeOffsetMinutes,
    CHECK_IN_WINDOW_CLOSE_OFFSET_MINUTES
  )
  return { targetMinute, openOffsetMinutes, closeOffsetMinutes }
}

function resolveWindowBoundaries(
  targetOverride: number | undefined,
  options: CheckInWindowOptions | undefined
): { targetMinute: number; startMinute: number; resetMinute: number } {
  const { targetMinute, openOffsetMinutes, closeOffsetMinutes } = resolveWindowOptions(
    targetOverride,
    options
  )
  const startMinute = (targetMinute - openOffsetMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const resetMinute = (targetMinute + closeOffsetMinutes) % MINUTES_PER_DAY
  return { targetMinute, startMinute, resetMinute }
}

function shiftByReset(date: Date, resetMinute: number): Date {
  return new Date(date.getTime() - resetMinute * MS_PER_MINUTE)
}

export type CheckInCycleResolution = {
  date: Date
  dateKey: string
  isAfterWindow: boolean
  crossesMidnight: boolean
  minutesDelta: number
}

export function resolveCheckInCycle(
  currentTime: Date,
  targetSleepMinute: number,
  options?: CheckInWindowOptions
): CheckInCycleResolution {
  const { targetMinute, closeOffsetMinutes } = resolveWindowOptions(targetSleepMinute, options)
  const currentMinute = getMinutesSinceMidnight(currentTime)
  let minutesDelta = currentMinute - targetMinute
  if (minutesDelta > HALF_DAY_MINUTES) {
    minutesDelta -= MINUTES_PER_DAY
  } else if (minutesDelta < -HALF_DAY_MINUTES) {
    minutesDelta += MINUTES_PER_DAY
  }
  const isAfterWindow = minutesDelta > closeOffsetMinutes
  const simpleDiff = currentMinute - targetMinute
  const crossesMidnight = Math.abs(simpleDiff) > HALF_DAY_MINUTES

  const date = new Date(currentTime)
  date.setHours(0, 0, 0, 0)

  // 计算关闭时间（目标时间 + 关闭偏移）
  const resetMinute = (targetMinute + closeOffsetMinutes) % MINUTES_PER_DAY
  const resetCrossesMidnight = resetMinute < targetMinute

  if (crossesMidnight) {
    // 跨越午夜的情况（目标时间在凌晨或深夜）
    if (currentMinute < targetMinute) {
      // 当前时间在目标时间之前（比如21:34在00:30之前）
      // 目标是"明天"的，所以日期+1
      date.setTime(date.getTime() + ONE_DAY_MS)
    } else if (resetCrossesMidnight) {
      // 关闭时间跨越午夜（关闭时间在第二天）
      if (currentMinute < resetMinute) {
        // 当前时间在关闭时间之前（比如01:00在06:30之前，假设关闭时间是06:30）
        // 还在今天的目标窗口内，日期保持不变（目标是今天的）
      } else {
        // 当前时间在关闭时间之后（比如07:00在06:30之后）
        // 已经过了今天的目标窗口，目标是"明天"的，所以日期+1
        date.setTime(date.getTime() + ONE_DAY_MS)
      }
    } else {
      // 关闭时间不跨越午夜（在同一天）
      if (currentMinute > targetMinute + closeOffsetMinutes) {
        // 当前时间在关闭时间之后，目标是"明天"的，所以日期+1
        date.setTime(date.getTime() + ONE_DAY_MS)
      }
      // 否则：当前时间在目标时间和关闭时间之间，日期保持不变（目标是今天的）
    }
  } else {
    // 没有跨越午夜的情况（目标时间在白天）
    if (isAfterWindow) {
      // 当前时间在关闭时间之后，目标是"明天"的
      date.setTime(date.getTime() + ONE_DAY_MS)
    }
    // 否则：当前时间在窗口内，日期保持不变（目标是今天的）
  }

  return {
    date,
    dateKey: formatAbsoluteDateKey(date),
    isAfterWindow,
    crossesMidnight,
    minutesDelta
  }
}

export function getCheckInDayStart(date: Date, options?: CheckInWindowOptions): Date {
  const { resetMinute } = resolveWindowBoundaries(undefined, options)
  const shifted = shiftByReset(date, resetMinute)
  shifted.setHours(0, 0, 0, 0)
  return new Date(shifted.getTime() + resetMinute * MS_PER_MINUTE)
}

export function normalizeDateKey(input: string | null | undefined): string | null {
  if (typeof input !== 'string') {
    return null
  }
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  const digits = /^\d{8}$/.test(trimmed) ? trimmed : trimmed.replace(/\D/g, '')
  if (digits.length !== 8) {
    return null
  }
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }
  const candidate = new Date(year, month - 1, day)
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() + 1 !== month ||
    candidate.getDate() !== day
  ) {
    return null
  }
  const normalizedYear = String(year).padStart(4, '0')
  const normalizedMonth = String(month).padStart(2, '0')
  const normalizedDay = String(day).padStart(2, '0')
  return `${normalizedYear}${normalizedMonth}${normalizedDay}`
}

export function formatDateKey(date: Date, options?: CheckInWindowOptions): string {
  const shifted = shiftByReset(date, resolveWindowBoundaries(undefined, options).resetMinute)
  const year = String(shifted.getFullYear()).padStart(4, '0')
  const month = `${shifted.getMonth() + 1}`.padStart(2, '0')
  const day = `${shifted.getDate()}`.padStart(2, '0')
  return `${year}${month}${day}`
}

export function parseDateKey(key: string, options?: CheckInWindowOptions): Date {
  const normalized = normalizeDateKey(key)
  if (!normalized) {
    return getCheckInDayStart(new Date(), options)
  }
  const year = Number(normalized.slice(0, 4))
  const month = Number(normalized.slice(4, 6))
  const day = Number(normalized.slice(6, 8))
  const date = new Date(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  const { resetMinute } = resolveWindowBoundaries(undefined, options)
  return new Date(date.getTime() + resetMinute * MS_PER_MINUTE)
}

export function getMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

export function getCheckInWindowStartMinute(
  targetSleepMinute: number,
  options?: CheckInWindowOptions
): number {
  return resolveWindowBoundaries(targetSleepMinute, options).startMinute
}

export function getCheckInWindowEndMinute(
  targetSleepMinute: number,
  options?: CheckInWindowOptions
): number {
  return resolveWindowBoundaries(targetSleepMinute, options).resetMinute
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

export function computeCurrentStreak(
  records: CheckInMap,
  today: Date,
  options?: CheckInWindowOptions
): number {
  let streak = 0
  const cursor = getCheckInDayStart(today, options)

  while (true) {
    const key = formatDateKey(cursor, options)
    if (!records[key]) {
      break
    }
    streak += 1
    cursor.setTime(cursor.getTime() - ONE_DAY_MS)
  }

  return streak
}

export function computeBestStreak(
  records: CheckInMap,
  options?: CheckInWindowOptions
): number {
  const keys = Object.keys(records)
  if (keys.length === 0) {
    return 0
  }

  const sorted = keys
    .map((key) => parseDateKey(key, options))
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

export function getRecentDays(
  records: CheckInMap,
  current: Date,
  length: number,
  options?: CheckInWindowOptions
): RecentDay[] {
  const items: RecentDay[] = []
  const cursor = getCheckInDayStart(current, options)

  for (let i = length - 1; i >= 0; i -= 1) {
    const dayStart = new Date(cursor.getTime() - i * ONE_DAY_MS)
    const key = formatDateKey(dayStart, options)
    items.push({
      key,
      label: `${dayStart.getMonth() + 1}.${dayStart.getDate()}`,
      weekday: weekdayLabels[dayStart.getDay()],
      checked: Boolean(records[key])
    })
  }

  return items
}

export function computeCompletionRate(
  records: CheckInMap,
  today: Date,
  options?: CheckInWindowOptions
): number {
  const keys = Object.keys(records)
  if (!keys.length) {
    return 0
  }

  const sorted = keys
    .map((key) => parseDateKey(key, options))
    .sort((a, b) => a.getTime() - b.getTime())

  const first = sorted[0]
  const todayStart = getCheckInDayStart(today, options)
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
  targetMinutes: number,
  options?: CheckInWindowOptions
): string {
  const minutesNow = getMinutesSinceMidnight(currentTime)
  const boundaries = resolveWindowBoundaries(targetMinutes, options)

  if (!isWindowOpen) {
    const normalizedNow = normalizeMinute(minutesNow)
    const diffMinutes = (boundaries.startMinute - normalizedNow + MINUTES_PER_DAY) % MINUTES_PER_DAY
    const hours = Math.floor(diffMinutes / 60)
    const minutes = diffMinutes % 60
    if (hours === 0) {
      return `打卡将在 ${minutes} 分钟后开启`
    }
    return `打卡将在 ${hours} 小时 ${minutes} 分钟后开启`
  }

  if (targetTime.getTime() > currentTime.getTime()) {
    return `建议在 ${formatMinutesToTime(boundaries.targetMinute)} 前完成打卡`
  }

  return '已经超过目标入睡时间，尽快休息哦'
}

export function computeRecommendedBedTime(
  currentTime: Date,
  targetMinutes: number,
  options?: CheckInWindowOptions
): Date {
  const windowOptions: CheckInWindowOptions = {
    ...(options ?? {}),
    targetSleepMinute: targetMinutes
  }
  const { targetMinute } = resolveWindowOptions(targetMinutes, options)
  const dayStart = getCheckInDayStart(currentTime, windowOptions)
  const target = new Date(dayStart)
  const hours = Math.floor(targetMinute / 60)
  const minutes = targetMinute % 60
  target.setHours(hours, minutes, 0, 0)

  if (target.getTime() < dayStart.getTime()) {
    target.setTime(target.getTime() + ONE_DAY_MS)
  }

  return target
}

export function isCheckInWindowOpen(
  minutesNow: number,
  targetSleepMinute: number,
  options?: CheckInWindowOptions
): boolean {
  const currentMinute = normalizeMinute(minutesNow)
  const { startMinute, resetMinute } = resolveWindowBoundaries(targetSleepMinute, options)

  if (startMinute === resetMinute) {
    return true
  }

  if (startMinute < resetMinute) {
    return currentMinute >= startMinute && currentMinute < resetMinute
  }

  return currentMinute >= startMinute || currentMinute < resetMinute
}
