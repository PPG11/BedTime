import { COLLECTIONS } from '../config/cloud'
import { formatDateKey, ONE_DAY_MS, parseDateKey } from '../utils/checkin'
import {
  ensureCloud,
  getCurrentOpenId,
  type CloudDatabase,
  type DbCollection
} from './cloud'

export type CheckinStatus = 'hit' | 'late' | 'miss' | 'pending'

export type CheckinDocument = {
  _id: string
  uid: string
  date: string
  status: CheckinStatus
  ts: Date
  tzOffset: number
  goodnightMessageId?: string
  message?: string
}

type CheckinRecord = {
  _id: string
  uid: string
  userUid?: string
  date: string
  status: CheckinStatus
  ts: Date | string | number | { [key: string]: unknown }
  tzOffset: number
  goodnightMessageId?: string
  message?: string
}

function getCheckinsCollection(db: CloudDatabase): DbCollection<CheckinRecord> {
  return db.collection<CheckinRecord>(COLLECTIONS.checkins)
}

function getCheckinDocId(uid: string, date: string): string {
  return `${uid}_${date}`
}

function normalizeTimestamp(input: CheckinRecord['ts']): Date {
  if (input instanceof Date) {
    return input
  }

  if (typeof input === 'number' || typeof input === 'string') {
    const parsed = new Date(input)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  if (input && typeof input === 'object') {
    const candidate =
      (input as { value?: unknown }).value ??
      (input as { time?: unknown }).time ??
      (input as { $date?: unknown }).$date
    if (typeof candidate === 'number' || typeof candidate === 'string') {
      const parsed = new Date(candidate)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed
      }
    }
  }

  return new Date()
}

function mapCheckinDocument(raw: CheckinRecord): CheckinDocument {
  const userUid = resolveUserUid(raw)
  const messageId =
    typeof raw.goodnightMessageId === 'string' && raw.goodnightMessageId.length
      ? raw.goodnightMessageId
      : typeof raw.message === 'string' && raw.message.length
      ? raw.message
      : undefined
  return {
    _id: raw._id,
    uid: userUid,
    date: raw.date,
    status: raw.status,
    tzOffset: raw.tzOffset,
    ts: normalizeTimestamp(raw.ts),
    goodnightMessageId: messageId,
    message: messageId
  }
}

function resolveUserUid(raw: CheckinRecord): string {
  if (typeof raw.userUid === 'string' && raw.userUid.length) {
    return raw.userUid
  }

  if (typeof raw.uid === 'string' && raw.uid.length) {
    const [candidate] = raw.uid.split('_')
    if (candidate && candidate.length) {
      return candidate
    }
    return raw.uid
  }

  return ''
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error) {
    return false
  }

  if (typeof error === 'object') {
    const maybeError = error as { errCode?: unknown; errMsg?: unknown; message?: unknown }
    const errMsg = maybeError.errMsg ?? maybeError.message
    if (typeof errMsg === 'string' && errMsg.toLowerCase().includes('duplicate key')) {
      return true
    }
  }

  const text = String(error)
  return text.toLowerCase().includes('duplicate key')
}

function isDocumentMissingError(error: unknown): boolean {
  if (!error) {
    return false
  }

  if (typeof error === 'object') {
    const maybeError = error as { errMsg?: unknown; message?: unknown }
    const errMsg = maybeError.errMsg ?? maybeError.message
    if (typeof errMsg === 'string') {
      const lower = errMsg.toLowerCase()
      if (lower.includes('cannot find document') || lower.includes('not found')) {
        return true
      }
    }
  }

  const text = String(error).toLowerCase()
  return text.includes('cannot find document') || text.includes('not found')
}

function extractDateFromCheckin(raw: CheckinRecord): string | null {
  if (typeof raw.date === 'string' && raw.date) {
    return raw.date
  }

  const segments = raw._id.split('_')
  const candidate = segments[segments.length - 1]
  if (/^\d{8}$/.test(candidate)) {
    return candidate
  }

  return null
}

function shiftDateKey(key: string, delta: number): string {
  const date = parseDateKey(key)
  date.setTime(date.getTime() + delta * ONE_DAY_MS)
  return formatDateKey(date)
}

async function tryUpdateExistingCheckin(
  collection: DbCollection<CheckinRecord>,
  docId: string,
  uid: string,
  data: Omit<CheckinRecord, '_id'>,
  openid: string
): Promise<CheckinDocument | null> {
  try {
    await collection.doc(docId).update({
      data
    })
    return mapCheckinDocument({
      _id: docId,
      ...data
    })
  } catch (error) {
    if (!isDocumentMissingError(error)) {
      throw error
    }
  }

  const resolved = await resolveCheckinRecordByDate(collection, uid, data.date, openid)
  if (!resolved) {
    return null
  }

  await collection.doc(resolved.id).update({
    data
  })

  return mapCheckinDocument({
    _id: resolved.id,
    ...data
  })
}

async function resolveCheckinRecordByDate(
  collection: DbCollection<CheckinRecord>,
  uid: string,
  date: string,
  openid: string
): Promise<{ id: string; record: CheckinRecord } | null> {
  const docId = getCheckinDocId(uid, date)
  try {
    const snapshot = await collection.doc(docId).get()
    if (snapshot.data) {
      return {
        id: docId,
        record: {
          _id: docId,
          ...snapshot.data
        }
      }
    }
  } catch (error) {
    if (!isDocumentMissingError(error)) {
      throw error
    }
  }

  const sameDateResult = await collection
    .where({
      _openid: openid,
      date
    })
    .limit(1)
    .get()

  const existing = sameDateResult.data?.[0]
  if (!existing) {
    return null
  }
  return {
    id: existing._id,
    record: existing
  }
}

async function migrateLegacyCheckins(
  collection: DbCollection<CheckinRecord>,
  params: {
    userUid: string
    targetDate: string
    docId: string
    data: Omit<CheckinRecord, '_id'>
  }
): Promise<CheckinDocument | null> {
  const legacyResult = await collection
    .where({
      uid: params.userUid
    })
    .limit(1000)
    .get()

  const legacyDocs = legacyResult.data ?? []
  if (!legacyDocs.length) {
    return null
  }

  const normalizedLegacy: Array<{ id: string; legacyDate: string }> = []
  for (const legacy of legacyDocs) {
    const legacyDate = extractDateFromCheckin(legacy) ?? params.targetDate
    const migratedUid = getCheckinDocId(params.userUid, legacyDate)
    await collection.doc(legacy._id).update({
      data: {
        date: legacyDate,
        uid: migratedUid,
        userUid: params.userUid
      }
    })
    normalizedLegacy.push({
      id: legacy._id,
      legacyDate
    })
  }

  const targetLegacy = normalizedLegacy.find((item) => item.legacyDate === params.targetDate)
  if (targetLegacy) {
    await collection.doc(targetLegacy.id).update({
      data: params.data
    })

    return mapCheckinDocument({
      _id: targetLegacy.id,
      ...params.data
    })
  }

  const hasTargetId = legacyDocs.some((item) => item._id === params.docId)
  if (hasTargetId) {
    await collection.doc(params.docId).update({
      data: params.data
    })

    return mapCheckinDocument({
      _id: params.docId,
      ...params.data
    })
  }

  return null
}

export async function upsertCheckin(
  params: Omit<CheckinDocument, '_id' | 'ts'> & { ts?: Date }
): Promise<CheckinDocument> {
  const db = await ensureCloud()
  const docId = getCheckinDocId(params.uid, params.date)
  const now = db.serverDate ? db.serverDate() : new Date()
  const data: Omit<CheckinRecord, '_id'> = {
    uid: docId,
    userUid: params.uid,
    date: params.date,
    status: params.status,
    tzOffset: params.tzOffset,
    ts: params.ts ?? now,
    goodnightMessageId: params.goodnightMessageId ?? params.message,
    message: params.message ?? params.goodnightMessageId
  }

  if (process.env.NODE_ENV !== 'production') {
    console.debug('upsertCheckin', { docId, payload: data })
  }

  const collection = getCheckinsCollection(db)
  try {
    await collection.doc(docId).set({
      data
    })
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error
    }

    const openid = await getCurrentOpenId()
    const resolved = await tryUpdateExistingCheckin(collection, docId, params.uid, data, openid)
    if (resolved) {
      return resolved
    }

    const migrated = await migrateLegacyCheckins(collection, {
      userUid: params.uid,
      targetDate: params.date,
      docId,
      data
    })
    if (migrated) {
      return migrated
    }

    try {
      await collection.doc(docId).set({
        data
      })
    } catch (finalError) {
      if (isDuplicateKeyError(finalError)) {
        const fallback = await tryUpdateExistingCheckin(collection, docId, params.uid, data, openid)
        if (fallback) {
          return fallback
        }
      }
      throw finalError
    }
  }

  return mapCheckinDocument({
    _id: docId,
    ...data
  })
}

export async function updateCheckinGoodnightMessage(params: {
  uid: string
  date: string
  goodnightMessageId: string
}): Promise<CheckinDocument | null> {
  const db = await ensureCloud()
  const collection = getCheckinsCollection(db)
  const openid = await getCurrentOpenId()

  const resolved = await resolveCheckinRecordByDate(collection, params.uid, params.date, openid)
  if (!resolved) {
    return null
  }

  const { id, record } = resolved
  const messageValue = params.goodnightMessageId
  const nextRecord: CheckinRecord = {
    ...record,
    goodnightMessageId: messageValue,
    message: messageValue
  }

  try {
    await collection.doc(id).update({
      data: {
        goodnightMessageId: messageValue,
        message: messageValue
      }
    })
  } catch (error) {
    if (!isDocumentMissingError(error)) {
      throw error
    }
    const { _id: _ignored, ...rest } = nextRecord
    await collection.doc(id).set({
      data: rest
    })
  }

  return mapCheckinDocument({
    ...nextRecord,
    _id: id
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
    .filter((raw) => resolveUserUid(raw) === uid)
    .map(mapCheckinDocument)
}

export async function fetchCheckinInfoForDate(
  uid: string,
  date: string
): Promise<CheckinDocument | null> {
  const db = await ensureCloud()
  const collection = getCheckinsCollection(db)
  const openid = await getCurrentOpenId()
  const resolved = await resolveCheckinRecordByDate(collection, uid, date, openid)
  if (!resolved) {
    return null
  }
  return mapCheckinDocument(resolved.record)
}

export async function fetchCheckinsInRange(
  uid: string,
  startDate: string,
  endDate: string
): Promise<CheckinDocument[]> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate]
  const rangeCondition = db.command.gte(from).and(db.command.lte(to))

  const result = await getCheckinsCollection(db)
    .where({
      _openid: openid,
      date: rangeCondition
    })
    .orderBy('date', 'asc')
    .limit(1000)
    .get()

  return (result.data ?? [])
    .filter((raw) => resolveUserUid(raw) === uid)
    .map(mapCheckinDocument)
    .filter((item) => item.date >= from && item.date <= to)
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
    if (!current || (current.status !== 'hit' && current.status !== 'late')) {
      break
    }
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}
