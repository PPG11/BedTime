import { CloudError } from './cloud'
import { requestNight } from './night'
import { isNightId } from '../utils/night-time'
import { reminderDueAt, validReminderTime } from '../utils/night-reminder'
import type { ReminderReply, ReminderSchedule, ReminderStatus } from '../types/reminder'

function check(value: unknown): asserts value { if (!value) throw new CloudError('INTERNAL', '提醒服务返回无效数据') }
function parse(value: unknown): ReminderReply {
  check(value && typeof value === 'object')
  const result = value as ReminderReply
  check(Number.isFinite(result.serverNow) && result.serverNow > 0 && typeof result.userId === 'string' && result.userId.length > 0 && result.userId.length <= 128 && typeof result.enabled === 'boolean')
  check(result.enabled ? typeof result.templateId === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(result.templateId) : result.templateId === null)
  check(result.lastAttemptNightId === null || isNightId(result.lastAttemptNightId))
  check(result.testUntil == null || (Number.isSafeInteger(result.testUntil) && result.testUntil > result.serverNow && result.testUntil <= result.serverNow + 30 * 60000))
  const r = result.reminder
  if (r !== null) {
    const statuses: ReminderStatus[] = ['pending', 'sending', 'sent', 'cancelled', 'skipped', 'expired', 'failed', 'unknown']
    check(r && typeof r.requestId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(r.requestId) && Number.isSafeInteger(r.revision) && r.revision >= 1 &&
      isNightId(r.nightId) && typeof r.time === 'string' && validReminderTime(r.time) && r.dueAt === reminderDueAt(r.nightId, r.time) && statuses.includes(r.status))
  }
  return { serverNow: result.serverNow, userId: result.userId, enabled: result.enabled, templateId: result.templateId, lastAttemptNightId: result.lastAttemptNightId,
    testUntil: result.testUntil ?? null,
    reminder: r ? { requestId: r.requestId, revision: r.revision, nightId: r.nightId, time: r.time, dueAt: r.dueAt, status: r.status } : null }
}
export const reminderApi = {
  async get() { return parse(await requestNight('getReminder')) },
  async schedule(input: ReminderSchedule) { return parse(await requestNight('scheduleReminder', input)) },
  async cancel(requestId: string, revision: number) { return parse(await requestNight('cancelReminder', { requestId, revision })) }
}
