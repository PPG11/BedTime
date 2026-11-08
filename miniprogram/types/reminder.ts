export type ReminderStatus = 'pending' | 'sending' | 'sent' | 'cancelled' | 'skipped' | 'expired' | 'failed' | 'unknown'
export type Reminder = { requestId: string; revision: number; nightId: string; time: string; dueAt: number; status: ReminderStatus }
export type ReminderReply = { serverNow: number; userId: string; enabled: boolean; templateId: string | null; reminder: Reminder | null; lastAttemptNightId: string | null; testUntil: number | null }
export type ReminderSchedule = { requestId: string; revision: number; nightId: string; time: string; templateId: string }
