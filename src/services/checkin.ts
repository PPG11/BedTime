import { COLLECTIONS } from '../config/cloud'
import { formatDateKey, normalizeDateKey, ONE_DAY_MS, parseDateKey } from '../utils/checkin'
import {
  ensureCloud,
  getCurrentOpenId,
  callCloudFunction,
  type CloudDatabase,
  type DbCollection,
  type DbDocumentHandle
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

type CheckinEntry = {
  date?: string
  status?: CheckinStatus
  message?: string
  goodnightMessageId?: string
  tzOffset?: number
  ts?: Date | string | number | { [key: string]: unknown }
}

type CheckinsAggregateRecord = {
  _id: string
  uid?: string
  ownerOpenid?: string
  info?: CheckinEntry[]
  createdAt?: Date | string | number | { [key: string]: unknown }
  updatedAt?: Date | string | number | { [key: string]: unknown }
}

type SubmitCheckinFunctionResponse = {
  ok?: boolean
  code?: string
  data?: CheckinEntry & { uid?: string }
  message?: string
}

type CheckTodayFunctionResponse = {
  ok?: boolean
  code?: string
  exists?: boolean
  data?: CheckinEntry & { uid?: string }
  message?: string
}

export type SubmitCheckinResult = {
  document: CheckinDocument
  status: 'created' | 'already_exists'
}

const VALID_STATUS_SET = new Set<CheckinStatus>(['hit', 'late', 'miss', 'pending'])

function getCheckinsCollection(db: CloudDatabase): DbCollection<CheckinsAggregateRecord> {
  return db.collection<CheckinsAggregateRecord>(COLLECTIONS.checkins)
}

function normalizeStatus(value: unknown): CheckinStatus {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (VALID_STATUS_SET.has(normalized as CheckinStatus)) {
      return normalized as CheckinStatus
    }
  }
  return 'hit'
}

function normalizeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function normalizeTimestamp(input: CheckinEntry['ts']): Date {
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
      (input as { $date?: unknown }).$date ??
      (input as { $numberLong?: unknown }).$numberLong ??
      (input as { $numberDecimal?: unknown }).$numberDecimal
    if (typeof candidate === 'number' || typeof candidate === 'string') {
      const parsed = new Date(candidate)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed
      }
    }
  }

  return new Date()
}

function normalizeInfoList(record: CheckinsAggregateRecord | undefined): CheckinEntry[] {
  if (!record || !Array.isArray(record.info)) {
    return []
  }
  return record.info
}

function mapEntryToDocument(uid: string, entry: CheckinEntry, fallbackDate?: string): CheckinDocument {
  const baseDate = entry?.date ?? fallbackDate ?? formatDateKey(new Date())
  const normalizedDate = normalizeDateKey(baseDate) ?? formatDateKey(new Date())
  const tzOffset = typeof entry?.tzOffset === 'number' ? entry.tzOffset : 0
  const fallbackTimestamp =
    entry?.ts ??
    (() => {
      const parsed = parseDateKey(normalizedDate)
      parsed.setHours(22, 0, 0, 0)
      return parsed
    })()
  const ts = normalizeTimestamp(fallbackTimestamp)
  const message = normalizeMessage(entry?.message ?? entry?.goodnightMessageId)
  const status = normalizeStatus(entry?.status)

  const document: CheckinDocument = {
    _id: `${uid}_${normalizedDate}`,
    uid,
    date: normalizedDate,
    status,
    tzOffset,
    ts
  }

  if (message) {
    document.goodnightMessageId = message
    document.message = message
  }

  return document
}

function isDocumentMissingError(error: unknown): boolean {
  if (!error) {
    return false
  }
  if (typeof error === 'object') {
    const maybeError = error as { errMsg?: unknown; message?: unknown; code?: unknown; errCode?: unknown }
    const errMsg = maybeError.errMsg ?? maybeError.message
    if (typeof errMsg === 'string') {
      const lower = errMsg.toLowerCase()
      if (
        lower.includes('cannot find document') ||
        lower.includes('not found') ||
        lower.includes('does not exist')
      ) {
        return true
      }
    }
    const code = maybeError.code ?? maybeError.errCode
    if (code === 'DOCUMENT_NOT_FOUND') {
      return true
    }
  }
  const text = String(error).toLowerCase()
  return (
    text.includes('cannot find document') ||
    text.includes('not found') ||
    text.includes('does not exist')
  )
}

function isCloudFunctionMissingError(error: unknown): boolean {
  if (!error) {
    return false
  }

  if (typeof error === 'object') {
    const maybeError = error as { code?: unknown; errCode?: unknown; errMsg?: unknown; message?: unknown }
    const code = maybeError.code ?? maybeError.errCode
    if (typeof code === 'string') {
      const normalized = code.toUpperCase()
      if (
        normalized.includes('FUNCTION_NOT_FOUND') ||
        normalized.includes('FUNCTION_NOT_EXIST') ||
        normalized.includes('INVALID_FUNCTION_NAME')
      ) {
        return true
      }
    }
    const errMsg = maybeError.errMsg ?? maybeError.message
    if (typeof errMsg === 'string') {
      const lower = errMsg.toLowerCase()
      if (
        lower.includes('function not found') ||
        lower.includes('function not exist') ||
        lower.includes('function does not exist') ||
        lower.includes('functionname not found') ||
        lower.includes('functionname not exist')
      ) {
        return true
      }
    }
  }

  const text = String(error).toLowerCase()
  return (
    text.includes('function not found') ||
    text.includes('function not exist') ||
    text.includes('invalid function name')
  )
}

async function ensureCheckinsDocument(
  db: CloudDatabase,
  uid: string,
  openid?: string
): Promise<{
  docRef: DbDocumentHandle<CheckinsAggregateRecord>
  record: CheckinsAggregateRecord
}> {
  const collection = getCheckinsCollection(db)
  let documentId = uid
  let docRef = collection.doc(documentId)

  try {
    const snapshot = await docRef.get()
    if (snapshot && snapshot.data) {
      return {
        docRef,
        record: {
          _id: documentId,
          ...snapshot.data
        }
      }
    }
  } catch (error) {
    if (!isDocumentMissingError(error)) {
      throw error
    }
  }

  try {
    const legacyQuery = await collection
      .where({
        uid
      })
      .limit(1)
      .get()
    const legacyDoc = legacyQuery?.data && legacyQuery.data[0]
    if (legacyDoc) {
      documentId = legacyDoc._id
      docRef = collection.doc(documentId)
      return {
        docRef,
        record: {
          _id: documentId,
          ...legacyDoc
        }
      }
    }
  } catch (error) {
    if (!isDocumentMissingError(error)) {
      throw error
    }
  }

  try {
    const ensureResult = await callCloudFunction<{
      ok?: boolean
      data?: {
        documentId?: string
        uid?: string
        ownerOpenid?: string
        info?: CheckinEntry[]
        createdAt?: unknown
        updatedAt?: unknown
      }
    }>({
      name: 'ensureCheckinsDoc',
      data: {
        uid
      }
    })

    if (ensureResult && ensureResult.ok && ensureResult.data) {
      const resolvedId =
        typeof ensureResult.data.documentId === 'string' && ensureResult.data.documentId.length
          ? ensureResult.data.documentId
          : uid
      documentId = resolvedId
      docRef = collection.doc(documentId)
      return {
        docRef,
        record: {
          _id: documentId,
          uid: ensureResult.data.uid ?? documentId,
          ownerOpenid: ensureResult.data.ownerOpenid ?? openid,
          info: Array.isArray(ensureResult.data.info) ? ensureResult.data.info : [],
          createdAt: ensureResult.data.createdAt,
          updatedAt: ensureResult.data.updatedAt
        }
      }
    }
  } catch (error) {
    if (!isCloudFunctionMissingError(error)) {
      throw error
    }
  }

  const snapshot = await collection.doc(documentId).get()
  if (snapshot && snapshot.data) {
    return {
      docRef: collection.doc(documentId),
      record: {
        _id: documentId,
        ...snapshot.data
      }
    }
  }

  throw new Error('无法初始化用户打卡记录')
}

function mapFunctionRecord(uid: string, payload?: CheckinEntry & { uid?: string }): CheckinDocument | null {
  if (!payload) {
    return null
  }
  const entry: CheckinEntry = {
    date: payload.date,
    status: payload.status,
    message: payload.message ?? payload.goodnightMessageId,
    goodnightMessageId: payload.goodnightMessageId ?? payload.message,
    tzOffset: payload.tzOffset,
    ts: payload.ts
  }
  return mapEntryToDocument(uid, entry)
}

async function submitCheckinViaCloudFunction(params: {
  uid: string
  date: string
  status: CheckinStatus
  tzOffset: number
  goodnightMessageId?: string
}): Promise<SubmitCheckinResult | null> {
  try {
    const payload: Record<string, unknown> = {
      uid: params.uid,
      date: params.date,
      status: params.status,
      tzOffset: params.tzOffset
    }
    if (params.goodnightMessageId) {
      payload.goodnightMessageId = params.goodnightMessageId
    }

    const response = await callCloudFunction<SubmitCheckinFunctionResponse>({
      name: 'submitCheckin',
      data: payload
    })

    if (!response) {
      return null
    }

    if (response.ok === false) {
      const message =
        typeof response.message === 'string' && response.message.length
          ? response.message
          : '提交打卡失败'
      throw new Error(message)
    }

    if (!response.data) {
      return {
        document: mapEntryToDocument(params.uid, {
          date: params.date,
          status: params.status,
          message: params.goodnightMessageId,
          tzOffset: params.tzOffset,
          ts: new Date()
        }),
        status: response.code === 'already_exists' ? 'already_exists' : 'created'
      }
    }

    const document = mapFunctionRecord(params.uid, response.data)
    if (!document) {
      return null
    }

    return {
      document,
      status: response.code === 'already_exists' ? 'already_exists' : 'created'
    }
  } catch (error) {
    if (isCloudFunctionMissingError(error)) {
      return null
    }
    throw error
  }
}

async function fetchCheckinViaCloudFunction(
  uid: string,
  date: string
): Promise<CheckinDocument | null> {
  try {
    const response = await callCloudFunction<CheckTodayFunctionResponse>({
      name: 'checkTodayCheckin',
      data: {
        uid,
        date
      }
    })

    if (!response) {
      return null
    }

    if (response.ok === false) {
      const message =
        typeof response.message === 'string' && response.message.length
          ? response.message
          : '查询打卡状态失败'
      throw new Error(message)
    }

    if (response.exists === false || !response.data) {
      return null
    }

    return mapFunctionRecord(uid, response.data)
  } catch (error) {
    if (isCloudFunctionMissingError(error)) {
      return null
    }
    throw error
  }
}

async function appendCheckinEntry(params: {
  uid: string
  date: string
  status: CheckinStatus
  tzOffset: number
  goodnightMessageId?: string
}): Promise<SubmitCheckinResult> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()

  const { docRef, record } = await ensureCheckinsDocument(db, params.uid, openid)
  const infoList = normalizeInfoList(record)
  const normalizedDate = normalizeDateKey(params.date) ?? params.date
  const existing = infoList.find((entry) => normalizeDateKey(entry.date ?? '') === normalizedDate)
  if (existing) {
    return {
      document: mapEntryToDocument(params.uid, existing, normalizedDate),
      status: 'already_exists'
    }
  }

  const serverDate = db.serverDate ? db.serverDate() : new Date()
  const message = params.goodnightMessageId
  const entry: CheckinEntry = {
    date: normalizedDate,
    status: params.status,
    message,
    goodnightMessageId: message,
    tzOffset: params.tzOffset,
    ts: serverDate
  }

  const command = db.command

  await docRef.update({
    data: {
      ownerOpenid: openid,
      updatedAt: serverDate,
      info: command.push([entry])
    }
  })

  return {
    document: mapEntryToDocument(params.uid, {
      ...entry,
      ts: new Date()
    }),
    status: 'created'
  }
}

export async function submitCheckinRecord(
  params: Omit<CheckinDocument, '_id' | 'ts'> & { ts?: Date }
): Promise<SubmitCheckinResult> {
  const messageId =
    typeof params.goodnightMessageId === 'string' && params.goodnightMessageId.length
      ? params.goodnightMessageId
      : typeof params.message === 'string' && params.message.length
      ? params.message
      : undefined

  const functionResult = await submitCheckinViaCloudFunction({
    uid: params.uid,
    date: params.date,
    status: params.status,
    tzOffset: params.tzOffset,
    goodnightMessageId: messageId
  })
  if (functionResult) {
    return functionResult
  }

  return appendCheckinEntry({
    uid: params.uid,
    date: params.date,
    status: params.status,
    tzOffset: params.tzOffset,
    goodnightMessageId: messageId
  })
}

export async function upsertCheckin(
  params: Omit<CheckinDocument, '_id' | 'ts'> & { ts?: Date }
): Promise<CheckinDocument> {
  const result = await submitCheckinRecord(params)
  return result.document
}

export async function updateCheckinGoodnightMessage(params: {
  uid: string
  date: string
  goodnightMessageId: string
}): Promise<CheckinDocument | null> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const { docRef, record } = await ensureCheckinsDocument(db, params.uid, openid)
  const infoList = normalizeInfoList(record)
  const normalizedDate = normalizeDateKey(params.date) ?? params.date
  const index = infoList.findIndex(
    (entry) => normalizeDateKey(entry.date ?? '') === normalizedDate
  )
  if (index === -1) {
    return null
  }

  const updatedEntry: CheckinEntry = {
    ...infoList[index],
    date: normalizedDate,
    message: params.goodnightMessageId,
    goodnightMessageId: params.goodnightMessageId
  }

  const updatedInfo = [...infoList]
  updatedInfo[index] = updatedEntry
  const serverDate = db.serverDate ? db.serverDate() : new Date()

  await docRef.update({
    data: {
      updatedAt: serverDate,
      info: updatedInfo
    }
  })

  return mapEntryToDocument(params.uid, {
    ...updatedEntry,
    ts: updatedEntry.ts ?? new Date()
  })
}

export async function fetchCheckins(uid: string, limit = 120): Promise<CheckinDocument[]> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  console.log('fetchCheckins start', uid, limit, openid)
  const { record } = await ensureCheckinsDocument(db, uid, openid)
  console.log('fetchCheckins record', record)
  const infoList = normalizeInfoList(record)
  console.log('fetchCheckins infoList', infoList)
  const sorted = infoList
    .slice()
    .sort((a, b) => {
      const dateA = normalizeDateKey(a.date ?? '') ?? ''
      const dateB = normalizeDateKey(b.date ?? '') ?? ''
      return dateB.localeCompare(dateA)
    })
    .slice(0, Math.max(1, Math.min(1000, limit)))

  return sorted.map((entry) => mapEntryToDocument(uid, entry))
}

export async function fetchCheckinInfoForDate(
  uid: string,
  date: string
): Promise<CheckinDocument | null> {
  const functionResult = await fetchCheckinViaCloudFunction(uid, date)
  if (functionResult) {
    return functionResult
  }

  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const { record } = await ensureCheckinsDocument(db, uid, openid)
  const normalizedDate = normalizeDateKey(date) ?? date
  const infoList = normalizeInfoList(record)
  const entry = infoList.find((item) => normalizeDateKey(item.date ?? '') === normalizedDate)
  if (!entry) {
    return null
  }
  return mapEntryToDocument(uid, entry, normalizedDate)
}

export async function fetchCheckinsInRange(
  uid: string,
  startDate: string,
  endDate: string
): Promise<CheckinDocument[]> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const { record } = await ensureCheckinsDocument(db, uid, openid)
  const infoList = normalizeInfoList(record)
  const normalizedStart = normalizeDateKey(startDate) ?? startDate
  const normalizedEnd = normalizeDateKey(endDate) ?? endDate
  const [from, to] =
    normalizedStart <= normalizedEnd ? [normalizedStart, normalizedEnd] : [normalizedEnd, normalizedStart]

  return infoList
    .filter((entry) => {
      const date = normalizeDateKey(entry.date ?? '')
      if (!date) {
        return false
      }
      return date >= from && date <= to
    })
    .map((entry) => mapEntryToDocument(uid, entry))
    .sort((a, b) => a.date.localeCompare(b.date))
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

function shiftDateKey(key: string, delta: number): string {
  const date = parseDateKey(key)
  date.setTime(date.getTime() + delta * ONE_DAY_MS)
  return formatDateKey(date)
}
