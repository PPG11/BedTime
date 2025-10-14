import { COLLECTIONS } from '../config/cloud'
import { formatDateKey, ONE_DAY_MS, parseDateKey } from '../utils/checkin'
import {
  ensureCloud,
  getCurrentOpenId,
  type CloudDatabase,
  type DbCollection
} from './cloud'

export type CheckinStatus = 'hit' | 'miss' | 'pending'

export type CheckinDocument = {
  _id: string
  uid: string
  date: string
  status: CheckinStatus
  ts: Date
  tzOffset: number
}

function getCheckinsCollection(db: CloudDatabase): DbCollection<CheckinDocument> {
  return db.collection<CheckinDocument>(COLLECTIONS.checkins)
}

function getCheckinDocId(uid: string, date: string): string {
  return `${uid}_${date}`
}

function mapCheckinDocument(raw: CheckinDocument): CheckinDocument {
  return {
    ...raw,
    ts: raw.ts instanceof Date ? raw.ts : new Date(raw.ts)
  }
}

function shiftDateKey(key: string, delta: number): string {
  const date = parseDateKey(key)
  date.setTime(date.getTime() + delta * ONE_DAY_MS)
  return formatDateKey(date)
}

export async function upsertCheckin(
  params: Omit<CheckinDocument, '_id' | 'ts'> & { ts?: Date }
): Promise<CheckinDocument> {
  const db = await ensureCloud()
  const docId = getCheckinDocId(params.uid, params.date)
  const now = db.serverDate ? db.serverDate() : new Date()
  const data = {
    uid: params.uid,
    date: params.date,
    status: params.status,
    tzOffset: params.tzOffset,
    ts: params.ts ?? now
  }

  await getCheckinsCollection(db)
    .doc(docId)
    .set({
      data
    })

  return mapCheckinDocument({
    _id: docId,
    ...data,
    ts: data.ts as unknown as Date
  })
}

export async function fetchCheckins(uid: string, limit = 120): Promise<CheckinDocument[]> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const capped = Math.max(1, Math.min(1000, limit))

  const result = await getCheckinsCollection(db)
    .where({ _openid: openid })
    .orderBy('date', 'desc')
    .limit(capped)
    .get()

  return (result.data ?? [])
    .map(mapCheckinDocument)
    .filter((item) => item.uid === uid)
}

export async function fetchCheckinsInRange(
  uid: string,
  startDate: string,
  endDate: string
): Promise<CheckinDocument[]> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()

  const result = await getCheckinsCollection(db)
    .where({
      _openid: openid
    })
    .orderBy('date', 'asc')
    .limit(1000)
    .get()

  return (result.data ?? [])
    .map(mapCheckinDocument)
    .filter((item) => item.uid === uid && item.date >= startDate && item.date <= endDate)
}

export function computeHitStreak(records: CheckinDocument[], todayKey: string): number {
  let streak = 0
  const recordMap = new Map<string, CheckinDocument>()
  records.forEach((item) => {
    recordMap.set(item.date, item)
  })

  let cursor = todayKey
  while (true) {
    const current = recordMap.get(cursor)
    if (!current || current.status !== 'hit') {
      break
    }
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}
