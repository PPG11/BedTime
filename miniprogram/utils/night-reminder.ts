import { resolveNight } from './night-time'
import type { ReminderStatus } from '../types/reminder'

export function validReminderTime(time: string): boolean { return /^(?:2[0-3]|0[0-5]):[0-5]\d$/.test(time) }
export function quickReminderTime(now: number): string {
  return new Date(Math.ceil((now + 2 * 60000) / 60000) * 60000 + 8 * 3600000).toISOString().slice(11, 16)
}
export function reminderDueAt(nightId: string, time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return Date.UTC(Number(nightId.slice(0, 4)), Number(nightId.slice(4, 6)) - 1, Number(nightId.slice(6, 8)), (hour < 6 ? hour + 24 : hour) - 8, minute)
}
export function nextReminderChoice(now: number, time: string, completedNightId: string | null, lastAttemptNightId: string | null) {
  if (!validReminderTime(time)) return null
  const nightId = resolveNight(now).nightId
  for (let offset = 0; offset <= 1; offset++) {
    const date = new Date(Date.UTC(Number(nightId.slice(0, 4)), Number(nightId.slice(4, 6)) - 1, Number(nightId.slice(6, 8)) + offset))
    const candidate = date.toISOString().slice(0, 10).replace(/-/g, '')
    const dueAt = reminderDueAt(candidate, time)
    if (dueAt >= now + 60000 && candidate !== completedNightId && (!lastAttemptNightId || candidate > lastAttemptNightId)) return { nightId: candidate, dueAt }
  }
  return null
}
export function formatReminderAt(at: number): string {
  const date = new Date(at + 8 * 3600000)
  return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日 ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}
export const REMINDER_STATUS_TEXT: Record<ReminderStatus, string> = {
  pending: '已安排一次提醒。', sending: '正在发送，已无法撤回。', sent: '这次提醒已交给微信发送。',
  cancelled: '这次提醒已取消。', skipped: '这一晚已结束提醒安排。', expired: '这次提醒已过时，不再补发。',
  failed: '这次提醒未能发出，不会自动重试。', unknown: '发送结果尚未确认，为避免重复打扰，本次不会重发。'
}
