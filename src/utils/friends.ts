import { FriendProfile } from './storage'
import { formatMinutesToTime } from './time'

export function createFriendProfile(uid: string, alias?: string): FriendProfile {
  const trimmedAlias = alias?.trim() ?? ''
  const nickname = trimmedAlias.length ? trimmedAlias : `早睡伙伴 ${uid.slice(-4)}`
  const digits = uid.split('').map(Number)
  const base = digits.reduce((sum, value, index) => sum + value * (index + 3), 0)
  const streak = (base % 12) + 1
  const total = streak + (base % 40) + 8
  const completion = Math.min(100, 60 + (base % 38))
  const checkInMinutes = 21 * 60 + (base % 120)
  const statusTexts = [
    `昨晚 ${formatMinutesToTime(checkInMinutes)} 完成打卡`,
    `最近连续 ${streak} 天按时休息`,
    `近一周完成率约 ${completion}%`
  ]
  const lastCheckInLabel = statusTexts[base % statusTexts.length]

  return {
    uid,
    nickname,
    streak,
    total,
    completion,
    lastCheckInLabel,
    remark: trimmedAlias || undefined
  }
}
