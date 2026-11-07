import {
  computeBestStreak, computeCompletionRate,
  computeRecommendedBedTime, formatCountdown, formatWindowHint,
  getMinutesSinceMidnight, getRecentDays, isCheckInWindowOpen,
  normalizeDateKey, resolveCheckInCycle, weekdayLabels
} from '../../utils/checkin'
import { DEFAULT_USER_NAME, type CheckInMap, type UserSettings } from '../../utils/storage'
import { formatMinutesToTime, formatTime } from '../../utils/time'
import type { TodayCheckinStatus } from '../../services/index'
import { previousCheckinDate } from '../../utils/checkinsMap'

type HomeSnapshot = {
  ready: boolean
  loading: boolean
  settings: UserSettings
  records: CheckInMap
  onTimeRecords: CheckInMap
  totalDays: number
  streak: number
  lastCheckinDate: string
  todayStatus: TodayCheckinStatus | null
  error: string | null
  user: { uid: string; tzOffset: number } | null
}

/** All derived fields are JSON values; Date objects remain outside Page.data. */
export function createHomeView(state: HomeSnapshot, now: Date) {
  const offset = state.user?.tzOffset ?? -now.getTimezoneOffset()
  const local = (date: Date) => new Date(date.getTime() + (offset + date.getTimezoneOffset()) * 60_000)
  now = local(now)
  const target = state.settings.targetSleepMinute
  const options = { targetSleepMinute: target }
  const cycle = resolveCheckInCycle(now, target, options)
  const todayStatus = normalizeDateKey(state.todayStatus?.date) === cycle.dateKey
    ? state.todayStatus : null
  const record = state.records[cycle.dateKey] || todayStatus?.timestamp?.getTime() || null
  const checkedIn = Boolean(record || todayStatus?.checkedIn)
  const recommended = computeRecommendedBedTime(now, target, options)
  const windowOpen = isCheckInWindowOpen(getMinutesSinceMidnight(now), target, options)
  const lateNow = now.getTime() > recommended.getTime()
  const localRecord = record ? local(new Date(record)) : null
  const lateCheckin = todayStatus?.status === 'late' || (todayStatus?.status !== 'hit' && Boolean(
    localRecord && localRecord > computeRecommendedBedTime(localRecord, target, options)
  ))
  const awaiting = !state.ready
  const statusText = awaiting ? '☁️ 正在等待云端返回数据，请稍候'
    : checkedIn ? (lateCheckin ? '⌛ 今日稍晚完成打卡，今晚早点休息' : '✨ 今日按时完成打卡，继续保持')
    : formatWindowHint(now, recommended, windowOpen, target, options)
  const targetTime = formatMinutesToTime(target)
  // Keep the server's full-history streak through an unfinished cycle, then expire it by cycle date.
  const currentStreak = state.lastCheckinDate === cycle.dateKey ||
    (!checkedIn && state.lastCheckinDate === previousCheckinDate(cycle.dateKey)) ? state.streak : 0
  const stats = [
    { label: '连续早睡天数', value: String(currentStreak), icon: '🌙', tone: 'dawn' },
    { label: '累计打卡次数', value: String(state.totalDays), icon: '✨', tone: 'twinkle' },
    { label: '近期最佳连续', value: String(computeBestStreak(state.onTimeRecords, options)), icon: '🌟', tone: 'glow' },
    { label: '坚持完成率', value: `${computeCompletionRate(state.records, now, options)}%`, icon: '💖', tone: 'blush' }
  ]
  return {
    ready: state.ready,
    loading: state.loading,
    error: state.error || '',
    uid: state.user?.uid || '',
    todayKey: cycle.dateKey,
    dateLabel: `${cycle.dateKey.slice(0, 4)}-${cycle.dateKey.slice(4, 6)}-${cycle.dateKey.slice(6, 8)}`,
    weekdayLabel: weekdayLabels[cycle.date.getDay()],
    displayName: state.settings.name || DEFAULT_USER_NAME,
    countdownLabel: lateNow ? '已经超过推荐时间' : '距离推荐入睡',
    countdownText: lateNow ? '请尽快准备休息' : formatCountdown(recommended.getTime() - now.getTime()),
    recommendedSleepTime: formatTime(recommended),
    targetTime,
    checkedIn,
    windowOpen,
    lateNow,
    showHitEffects: checkedIn && !lateCheckin,
    showLateEffects: (checkedIn && lateCheckin) || (!checkedIn && lateNow),
    statusTone: checkedIn ? (lateCheckin ? 'late' : 'hit') : lateNow ? 'late' : '',
    statusText,
    timestampText: localRecord
      ? `已在 ${formatTime(localRecord)} 完成打卡（${lateCheckin ? '晚于' : '吻合'}目标时间）`
      : `目标入睡时间 ${targetTime} 之前完成打卡`,
    pillIcon: awaiting ? '☁️' : checkedIn ? '✅' : windowOpen ? '🚀' : '🌙',
    pillText: awaiting ? '同步云端数据中' : checkedIn ? '今日打卡完成' : windowOpen ? '打卡窗口开放' : '耐心等待适合入睡',
    progressWidth: awaiting ? '24%' : checkedIn ? '100%' : windowOpen ? '72%' : '38%',
    checkinDisabled: awaiting || !state.user || !windowOpen || checkedIn,
    checkinButtonText: awaiting ? '等待云端返回数据' : checkedIn ? '今日已完成' : windowOpen ? '立即打卡' : '等待打卡',
    goodnightId: todayStatus?.goodnightMessageId || '',
    stats,
    recentDays: getRecentDays(state.records, now, 7, options)
  }
}
