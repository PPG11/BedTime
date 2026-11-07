import { coerceDate } from '../utils/normalize'
import { callCloud } from './cloud'

export type CheckinStatus = 'hit' | 'late' | 'miss' | 'pending'

export type CheckinDocument = {
  _id: string
  uid: string
  date: string
  status: 'hit' | 'late'
  ts: Date
  goodnightMessageId: string | null
}

type CloudRecord = Omit<CheckinDocument, 'ts'> & { createdAt: unknown }

export type TodayCheckinStatus = {
  checkedIn: boolean
  date: string
  status: CheckinStatus | null
  goodnightMessageId: string | null
  timestamp: Date | null
}

function toDocument({ createdAt, ...record }: CloudRecord): CheckinDocument {
  const ts = coerceDate(createdAt)
  if (!ts) throw new Error('云端打卡时间无效')
  return { ...record, ts }
}

export async function fetchTodayCheckinStatus(): Promise<TodayCheckinStatus> {
  const { date, record } = await callCloud<{ date: string; record: CloudRecord | null }>('bedtimeCheckin', 'status')
  const document = record ? toDocument(record) : null
  return {
    date, checkedIn: Boolean(document), status: document?.status ?? null,
    goodnightMessageId: document?.goodnightMessageId ?? null, timestamp: document?.ts ?? null
  }
}

export async function fetchCheckins(limit: number): Promise<CheckinDocument[]> {
  const records: CheckinDocument[] = []
  let cursor: string | null = null
  while (records.length < limit) {
    const page: { list: CloudRecord[]; nextCursor: string | null } = await callCloud('bedtimeCheckin', 'history', {
      limit: Math.min(limit - records.length, 50),
      ...(cursor ? { cursor } : {})
    })
    records.push(...page.list.map(toDocument))
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return records
}

export async function submitCheckinRecord(date: string) {
  const { record, created } = await callCloud<{ record: CloudRecord; created: boolean }>('bedtimeCheckin', 'submit', { date })
  return { document: toDocument(record), created }
}
