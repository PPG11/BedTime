import { COLLECTIONS } from '../config/cloud'
import { formatDateKey, normalizeDateKey, ONE_DAY_MS, parseDateKey } from '../utils/checkin'
import {
  callCloudFunction,
  ensureCloud,
  getCurrentOpenId,
  type CloudCommand,
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

type CloudCheckinRecord = {
  _id?: string
  uid?: string
  date?: string
  status?: string
  gnMsgId?: string | null
  tzOffset?: number
  createdAt?: unknown
  updatedAt?: unknown
}

type CheckinSubmitFunctionResponse = {
  code?: string
  message?: string
  date?: string
  status?: string
  gnMsgId?: string | null
  record?: CloudCheckinRecord
}

type CheckinRangeFunctionResponse = {
  code?: string
  list?: CloudCheckinRecord[]
  nextCursor?: string | null
  message?: string
}

type CheckinStatusFunctionResponse = {
  code?: string
  message?: string
  checkedIn?: boolean
  date?: string
  status?: string | null
  gnMsgId?: string | null
  timestamp?: CheckinEntry['ts']
  createdAt?: CheckinEntry['ts']
  updatedAt?: CheckinEntry['ts']
}

export type SubmitCheckinResult = {
  document: CheckinDocument
  status: 'created' | 'already_exists'
}

export type TodayCheckinStatus = {
  checkedIn: boolean
  date: string
  status: CheckinStatus | null
  goodnightMessageId: string | null
  timestamp: Date | null
}

const VALID_STATUS_SET = new Set<CheckinStatus>(['hit', 'late', 'miss', 'pending'])

type CacheEntry<T> = {
  timestamp: number
  value: T
}

const CHECKIN_LIST_CACHE_TTL = 30 * 1000
const CHECKIN_INFO_CACHE_TTL = 30 * 1000
const TODAY_STATUS_CACHE_TTL = 15 * 1000

const checkinListCache = new Map<string, CacheEntry<CheckinDocument[]>>()
const checkinListInflight = new Map<string, Promise<CheckinDocument[]>>()
const checkinInfoCache = new Map<string, CacheEntry<CheckinDocument | null>>()
const checkinInfoInflight = new Map<string, Promise<CheckinDocument | null>>()
let todayStatusCache: CacheEntry<TodayCheckinStatus | null> | null = null
let todayStatusInflight: Promise<TodayCheckinStatus | null> | null = null

function isCacheFresh<T>(entry: CacheEntry<T> | null | undefined, ttl: number): entry is CacheEntry<T> {
  if (!entry) {
    return false
  }
  return Date.now() - entry.timestamp < ttl
}

function setCacheEntry<T>(store: Map<string, CacheEntry<T>>, key: string, value: T): void {
  store.set(key, {
    timestamp: Date.now(),
    value
  })
}

function makeListCacheKey(uid: string, limit: number): string {
  return `${uid}:${limit}`
}

function makeInfoCacheKey(uid: string, normalizedDate: string): string {
  return `${uid}:${normalizedDate}`
}

function invalidateCheckinInfos(uid: string, normalizedDate?: string): void {
  for (const key of checkinInfoCache.keys()) {
    if (key.startsWith(`${uid}:`) && (!normalizedDate || key === `${uid}:${normalizedDate}`)) {
      checkinInfoCache.delete(key)
    }
  }
  for (const key of checkinInfoInflight.keys()) {
    if (key.startsWith(`${uid}:`) && (!normalizedDate || key === `${uid}:${normalizedDate}`)) {
      checkinInfoInflight.delete(key)
    }
  }
}

function invalidateCheckinLists(uid: string): void {
  for (const key of checkinListCache.keys()) {
    if (key.startsWith(`${uid}:`)) {
      checkinListCache.delete(key)
    }
  }
  for (const key of checkinListInflight.keys()) {
    if (key.startsWith(`${uid}:`)) {
      checkinListInflight.delete(key)
    }
  }
}

function invalidateTodayStatusCache(): void {
  todayStatusCache = null
  todayStatusInflight = null
}

function invalidateCheckinCaches(uid: string, normalizedDate?: string): void {
  invalidateCheckinLists(uid)
  invalidateCheckinInfos(uid, normalizedDate)
  invalidateTodayStatusCache()
}

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
    _id: `${uid}#${normalizedDate}`,
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

function mapCloudCheckinRecord(
  uid: string,
  record: CloudCheckinRecord | null | undefined,
  defaults: { date?: string; status?: CheckinStatus; tzOffset?: number } = {}
): CheckinDocument | null {
  if (!record) {
    return null
  }

  const resolvedUid =
    typeof record.uid === 'string' && record.uid.trim().length ? record.uid.trim() : uid
  const resolvedDate =
    normalizeDateKey(
      typeof record.date === 'string' && record.date.trim().length
        ? record.date.trim()
        : defaults.date ?? ''
    ) ?? defaults.date

  if (!resolvedDate) {
    return null
  }

  const resolvedStatus = normalizeStatus(record.status ?? defaults.status ?? 'hit')
  const resolvedId =
    typeof record._id === 'string' && record._id.trim().length
      ? record._id.trim()
      : `${resolvedUid}#${resolvedDate}`

  const timestampSource =
    (record.createdAt as CheckinEntry['ts']) ??
    (record.updatedAt as CheckinEntry['ts']) ??
    ((record as unknown as { ts?: CheckinEntry['ts'] }).ts ?? new Date())
  const ts = normalizeTimestamp(timestampSource)

  const messageId =
    typeof record.gnMsgId === 'string' && record.gnMsgId.trim().length
      ? record.gnMsgId.trim()
      : undefined
  const tzOffset =
    typeof record.tzOffset === 'number'
      ? record.tzOffset
      : typeof defaults.tzOffset === 'number'
      ? defaults.tzOffset
      : 0

  return {
    _id: resolvedId,
    uid: resolvedUid,
    date: resolvedDate,
    status: resolvedStatus,
    ts,
    tzOffset,
    goodnightMessageId: messageId,
    message: messageId
  }
}

function mapCloudCheckinList(
  uid: string,
  list: CloudCheckinRecord[] | undefined,
  defaults: { tzOffset?: number } = {}
): CheckinDocument[] {
  if (!Array.isArray(list) || !list.length) {
    return []
  }

  const mapped = list
    .map((item) => mapCloudCheckinRecord(uid, item, { tzOffset: defaults.tzOffset }))
    .filter((item): item is CheckinDocument => Boolean(item))

  return mapped
}

async function fetchCheckinPageViaCloud(
  uid: string,
  options: { limit: number; from?: string; to?: string; cursor?: string }
): Promise<{ documents: CheckinDocument[]; nextCursor: string | null } | null> {
  try {
    const response = await callCloudFunction<CheckinRangeFunctionResponse>({
      name: 'checkinRange',
      data: {
        uid,
        from: options.from,
        to: options.to,
        limit: options.limit,
        cursor: options.cursor
      }
    })

    if (!response) {
      return { documents: [], nextCursor: null }
    }

    const code = typeof response.code === 'string' ? response.code : 'OK'
    if (code !== 'OK') {
      if (code === 'NOT_FOUND') {
        return { documents: [], nextCursor: null }
      }

      const message =
        typeof response.message === 'string' && response.message.length
          ? response.message
          : '查询打卡记录失败'
      throw new Error(message)
    }

    const documents = mapCloudCheckinList(uid, response.list)
    const nextCursor =
      typeof response.nextCursor === 'string' && response.nextCursor.length
        ? response.nextCursor
        : null

    return { documents, nextCursor }
  } catch (error) {
    if (isCloudFunctionMissingError(error)) {
      return null
    }
    throw error
  }
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
  const normalizedOwnerOpenid =
    typeof openid === 'string' && openid.trim().length ? openid.trim() : undefined

  try {
    const snapshot = await docRef.get()
    if (snapshot && snapshot.data) {
      const snapshotData = snapshot.data as CheckinsAggregateRecord
      return {
        docRef,
        record: {
          ...snapshotData,
          _id: documentId
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
    const legacyDoc = Array.isArray(legacyQuery?.data) ? legacyQuery.data[0] : null
    if (legacyDoc && Array.isArray((legacyDoc as CheckinsAggregateRecord).info)) {
      const legacyRecord = legacyDoc as CheckinsAggregateRecord
      const legacyInfo = legacyRecord.info ?? []
      const legacyOwner =
        typeof legacyRecord.ownerOpenid === 'string' && legacyRecord.ownerOpenid.length
          ? legacyRecord.ownerOpenid
          : normalizedOwnerOpenid

      if (typeof legacyDoc._id === 'string' && legacyDoc._id === documentId) {
        return {
          docRef,
          record: {
            ...(legacyDoc as CheckinsAggregateRecord),
            _id: documentId
          }
        }
      }

      const legacyDocumentId =
        typeof legacyDoc._id === 'string' && legacyDoc._id.length ? legacyDoc._id : documentId
      if (legacyDocumentId !== documentId) {
        documentId = legacyDocumentId
        docRef = collection.doc(documentId)
      }

      const serverDateForLegacy = db.serverDate ? db.serverDate() : new Date()
      const resolvedOwner =
        typeof legacyRecord.ownerOpenid === 'string' && legacyRecord.ownerOpenid.length
          ? legacyRecord.ownerOpenid
          : legacyOwner
      const normalizedCreatedAt =
        legacyRecord.createdAt instanceof Date ? legacyRecord.createdAt : serverDateForLegacy
      const normalizedUpdatedAt =
        legacyRecord.updatedAt instanceof Date ? legacyRecord.updatedAt : serverDateForLegacy

      const shouldUpdateOwner =
        typeof resolvedOwner === 'string' && resolvedOwner.length
          ? resolvedOwner !== legacyRecord.ownerOpenid
          : false
      const shouldUpdateCreatedAt = !(legacyRecord.createdAt instanceof Date)
      const shouldUpdateUpdatedAt = !(legacyRecord.updatedAt instanceof Date)

      if (shouldUpdateOwner || shouldUpdateCreatedAt || shouldUpdateUpdatedAt) {
        const updatePayload: Partial<CheckinsAggregateRecord> = {}
        if (shouldUpdateOwner && resolvedOwner) {
          updatePayload.ownerOpenid = resolvedOwner
        }
        if (shouldUpdateCreatedAt) {
          updatePayload.createdAt = normalizedCreatedAt
        }
        if (shouldUpdateUpdatedAt) {
          updatePayload.updatedAt = normalizedUpdatedAt
        }

        await docRef.update({
          data: updatePayload
        })
      }

      return {
        docRef,
        record: {
          _id: documentId,
          uid,
          ownerOpenid: resolvedOwner,
          info: legacyInfo,
          createdAt: normalizedCreatedAt,
          updatedAt: normalizedUpdatedAt
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
          createdAt: ensureResult.data.createdAt as CheckinEntry['ts'],
          updatedAt: ensureResult.data.updatedAt as CheckinEntry['ts']
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
    const snapshotData = snapshot.data as CheckinsAggregateRecord
    return {
      docRef: collection.doc(documentId),
      record: {
        ...snapshotData,
        _id: documentId
      }
    }
  }

  const serverDate = db.serverDate ? db.serverDate() : new Date()
  const payload: Partial<CheckinsAggregateRecord> = {
    uid,
    info: [],
    createdAt: serverDate,
    updatedAt: serverDate
  }
  if (normalizedOwnerOpenid) {
    payload.ownerOpenid = normalizedOwnerOpenid
  }

  await docRef.set({
    data: payload
  })

  return {
    docRef,
    record: {
      _id: documentId,
      uid,
      ownerOpenid: normalizedOwnerOpenid,
      info: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }
}

async function submitCheckinViaCloudFunction(params: {
  uid: string
  date: string
  status: CheckinStatus
  tzOffset: number
  goodnightMessageId?: string
}): Promise<SubmitCheckinResult | null> {
  try {
    const requestGnMsgId =
      typeof params.goodnightMessageId === 'string' && params.goodnightMessageId.trim().length
        ? params.goodnightMessageId.trim()
        : undefined
    const payload: Record<string, unknown> = {
      status: params.status
    }
    if (requestGnMsgId) {
      payload.gnMsgId = requestGnMsgId
    }
    const response = await callCloudFunction<CheckinSubmitFunctionResponse>({
      name: 'checkinSubmit',
      data: payload
    })

    if (!response) {
      return null
    }

    const code = typeof response.code === 'string' ? response.code : 'OK'

    if (code === 'OK') {
      const responseDate =
        typeof response.date === 'string' && response.date.trim().length
          ? response.date.trim()
          : undefined
      const resolvedDate = normalizeDateKey(responseDate ?? params.date) ?? params.date
      const responseStatus =
        typeof response.status === 'string' && response.status.trim().length
          ? response.status.trim()
          : undefined
      const resolvedStatus = normalizeStatus(responseStatus ?? params.status)

      const record: CloudCheckinRecord = {
        _id: `${params.uid}#${resolvedDate}`,
        uid: params.uid,
        date: resolvedDate,
        status: resolvedStatus,
        gnMsgId:
          typeof response.gnMsgId === 'string' && response.gnMsgId.length
            ? response.gnMsgId
            : requestGnMsgId ?? null,
        tzOffset: params.tzOffset,
        createdAt: new Date()
      }

      const document =
        mapCloudCheckinRecord(params.uid, record, {
          date: resolvedDate,
          status: resolvedStatus,
          tzOffset: params.tzOffset
        }) ??
        mapEntryToDocument(params.uid, {
          date: resolvedDate,
          status: resolvedStatus,
          message: requestGnMsgId,
          tzOffset: params.tzOffset,
          ts: new Date()
        })

      return {
        document,
        status: 'created'
      }
    }

    if (code === 'ALREADY_EXISTS') {
      const existing = mapCloudCheckinRecord(params.uid, response.record, {
        date: params.date,
        status: params.status,
        tzOffset: params.tzOffset
      })

      if (existing) {
        return {
          document: existing,
          status: 'already_exists'
        }
      }

      const fallback = await fetchCheckinViaCloudFunction(params.uid, params.date)
      if (fallback) {
        return {
          document: fallback,
          status: 'already_exists'
        }
      }

      return {
        document: mapEntryToDocument(params.uid, {
          date: params.date,
          status: params.status,
          message: requestGnMsgId,
          tzOffset: params.tzOffset,
          ts: new Date()
        }),
        status: 'already_exists'
      }
    }

    const message =
      typeof (response as { message?: unknown }).message === 'string' &&
      (response as { message?: string }).message
        ? (response as { message: string }).message
        : '提交打卡失败'
    throw new Error(message)
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
  const normalizedDate = normalizeDateKey(date) ?? date
  const cacheKey = makeInfoCacheKey(uid, normalizedDate)
  const cached = checkinInfoCache.get(cacheKey)
  if (isCacheFresh(cached, CHECKIN_INFO_CACHE_TTL)) {
    return cached.value
  }

  const inflight = checkinInfoInflight.get(cacheKey)
  if (inflight) {
    return inflight
  }

  const request = (async () => {
    try {
      const response = await callCloudFunction<CheckinRangeFunctionResponse>({
        name: 'checkinRange',
        data: {
          uid,
          from: normalizedDate,
          to: normalizedDate,
          limit: 1
        }
      })

      if (!response) {
        setCacheEntry(checkinInfoCache, cacheKey, null)
        return null
      }

      const code = typeof response.code === 'string' ? response.code : 'OK'
      if (code !== 'OK') {
        if (code === 'NOT_FOUND') {
          setCacheEntry(checkinInfoCache, cacheKey, null)
          return null
        }

        const message =
          typeof response.message === 'string' && response.message.length
            ? response.message
            : '查询打卡状态失败'
        throw new Error(message)
      }

      const document = mapCloudCheckinRecord(uid, response.list?.[0], {
        date: normalizedDate
      })
      setCacheEntry(checkinInfoCache, cacheKey, document ?? null)
      return document ?? null
    } catch (error) {
      if (isCloudFunctionMissingError(error)) {
        setCacheEntry(checkinInfoCache, cacheKey, null)
        return null
      }
      checkinInfoCache.delete(cacheKey)
      throw error
    } finally {
      checkinInfoInflight.delete(cacheKey)
    }
  })()

  checkinInfoInflight.set(cacheKey, request)
  return request
}

export async function fetchTodayCheckinStatus(): Promise<TodayCheckinStatus | null> {
  if (isCacheFresh(todayStatusCache, TODAY_STATUS_CACHE_TTL)) {
    return todayStatusCache.value
  }

  if (todayStatusInflight) {
    return todayStatusInflight
  }

  todayStatusInflight = (async () => {
    try {
      const response = await callCloudFunction<CheckinStatusFunctionResponse>({
        name: 'checkinStatus'
      })

      if (!response) {
        todayStatusCache = {
          timestamp: Date.now(),
          value: null
        }
        return null
      }

      const code = typeof response.code === 'string' ? response.code : 'OK'
      if (code !== 'OK') {
        if (code === 'NOT_FOUND') {
          const value: TodayCheckinStatus = {
            checkedIn: false,
            date: '',
            status: null,
            goodnightMessageId: null,
            timestamp: null
          }
          todayStatusCache = {
            timestamp: Date.now(),
            value
          }
          return value
        }

        const message =
          typeof response.message === 'string' && response.message.length
            ? response.message
            : '查询今日打卡状态失败'
        throw new Error(message)
      }

      const checkedIn = Boolean(response.checkedIn)
      const rawDate =
        typeof response.date === 'string' && response.date.trim().length
          ? response.date.trim()
          : ''
      const date = (normalizeDateKey(rawDate) ?? rawDate) || ''
      const status = checkedIn ? normalizeStatus(response.status) : null
      const goodnightMessageId =
        typeof response.gnMsgId === 'string' && response.gnMsgId.trim().length
          ? response.gnMsgId.trim()
          : null
      let timestamp: Date | null = null
      if (checkedIn) {
        const timestampSource =
          response.timestamp ?? response.createdAt ?? response.updatedAt ?? null
        if (timestampSource) {
          timestamp = normalizeTimestamp(timestampSource)
        }
      }

      const value: TodayCheckinStatus = {
        checkedIn,
        date,
        status,
        goodnightMessageId,
        timestamp
      }
      todayStatusCache = {
        timestamp: Date.now(),
        value
      }
      return value
    } catch (error) {
      if (isCloudFunctionMissingError(error)) {
        todayStatusCache = {
          timestamp: Date.now(),
          value: null
        }
        return null
      }
      todayStatusCache = null
      throw error
    } finally {
      todayStatusInflight = null
    }
  })()

  return todayStatusInflight
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

  const command = db.command as CloudCommand & { push?: (values: unknown[]) => unknown }
  const updateData: Record<string, unknown> = {
    ownerOpenid: openid,
    updatedAt: serverDate
  }

  if (typeof command.push === 'function') {
    updateData.info = command.push([entry])
  } else {
    updateData.info = [...infoList, entry]
  }

  await docRef.update({
    data: updateData
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
    invalidateCheckinCaches(params.uid, normalizeDateKey(params.date) ?? params.date)
    return functionResult
  }

  const appended = await appendCheckinEntry({
    uid: params.uid,
    date: params.date,
    status: params.status,
    tzOffset: params.tzOffset,
    goodnightMessageId: messageId
  })
  invalidateCheckinCaches(params.uid, normalizeDateKey(params.date) ?? params.date)
  return appended
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
  const normalizedDate = normalizeDateKey(params.date) ?? params.date

  try {
    const page = await fetchCheckinPageViaCloud(params.uid, {
      from: normalizedDate,
      to: normalizedDate,
      limit: 1
    })

    if (page !== null) {
      return page.documents[0] ?? null
    }
  } catch (error) {
    if (!isCloudFunctionMissingError(error)) {
      throw error
    }
  }

  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const { docRef, record } = await ensureCheckinsDocument(db, params.uid, openid)
  const infoList = normalizeInfoList(record)
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

  const document = mapEntryToDocument(params.uid, {
    ...updatedEntry,
    ts: updatedEntry.ts ?? new Date()
  })
  invalidateCheckinCaches(params.uid, normalizedDate)
  return document
}

export async function fetchCheckins(uid: string, limit = 120): Promise<CheckinDocument[]> {
  const normalizedLimit = Math.max(1, Math.min(1000, limit))
  const cacheKey = makeListCacheKey(uid, normalizedLimit)
  const cached = checkinListCache.get(cacheKey)
  if (isCacheFresh(cached, CHECKIN_LIST_CACHE_TTL)) {
    return cached.value
  }

  const inflight = checkinListInflight.get(cacheKey)
  if (inflight) {
    return inflight
  }

  const request = (async () => {
    try {
      const documents: CheckinDocument[] = []
      let usedCloud = false

      try {
        let remaining = normalizedLimit
        let cursor: string | null = null

        while (remaining > 0) {
          const batchLimit = Math.min(50, remaining)
          const page = await fetchCheckinPageViaCloud(uid, {
            limit: batchLimit,
            cursor: cursor ?? undefined
          })

          if (page === null) {
            break
          }

          usedCloud = true
          documents.push(...page.documents)

          if (!page.nextCursor || page.documents.length < batchLimit) {
            break
          }

          cursor = page.nextCursor
          remaining -= page.documents.length
        }

        if (usedCloud) {
          setCacheEntry(checkinListCache, cacheKey, documents)
          return documents
        }
      } catch (error) {
        if (!isCloudFunctionMissingError(error)) {
          throw error
        }
      }

      const db = await ensureCloud()
      const openid = await getCurrentOpenId()
      const { record } = await ensureCheckinsDocument(db, uid, openid)
      const infoList = normalizeInfoList(record)
      const sorted = infoList
        .slice()
        .sort((a, b) => {
          const dateA = normalizeDateKey(a.date ?? '') ?? ''
          const dateB = normalizeDateKey(b.date ?? '') ?? ''
          return dateB.localeCompare(dateA)
        })
        .slice(0, normalizedLimit)

      const mapped = sorted.map((entry) => mapEntryToDocument(uid, entry))
      setCacheEntry(checkinListCache, cacheKey, mapped)
      return mapped
    } catch (error) {
      checkinListCache.delete(cacheKey)
      throw error
    } finally {
      checkinListInflight.delete(cacheKey)
    }
  })()

  checkinListInflight.set(cacheKey, request)
  return request
}

export async function fetchCheckinInfoForDate(
  uid: string,
  date: string
): Promise<CheckinDocument | null> {
  const normalizedDate = normalizeDateKey(date) ?? date
  const cacheKey = makeInfoCacheKey(uid, normalizedDate)
  const cached = checkinInfoCache.get(cacheKey)
  if (isCacheFresh(cached, CHECKIN_INFO_CACHE_TTL)) {
    return cached.value
  }

  const functionResult = await fetchCheckinViaCloudFunction(uid, normalizedDate)
  if (functionResult) {
    return functionResult
  }

  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const { record } = await ensureCheckinsDocument(db, uid, openid)
  const infoList = normalizeInfoList(record)
  const entry = infoList.find((item) => normalizeDateKey(item.date ?? '') === normalizedDate)
  if (!entry) {
    setCacheEntry(checkinInfoCache, cacheKey, null)
    return null
  }
  const document = mapEntryToDocument(uid, entry, normalizedDate)
  setCacheEntry(checkinInfoCache, cacheKey, document)
  return document
}

export async function fetchCheckinsInRange(
  uid: string,
  startDate: string,
  endDate: string
): Promise<CheckinDocument[]> {
  const normalizedStart = normalizeDateKey(startDate) ?? startDate
  const normalizedEnd = normalizeDateKey(endDate) ?? endDate
  const [from, to] =
    normalizedStart <= normalizedEnd ? [normalizedStart, normalizedEnd] : [normalizedEnd, normalizedStart]

  try {
    const documents: CheckinDocument[] = []
    let cursor: string | null = null
    let usedCloud = false

    while (true) {
      const page = await fetchCheckinPageViaCloud(uid, {
        from,
        to,
        limit: 50,
        cursor: cursor ?? undefined
      })

      if (page === null) {
        break
      }

      usedCloud = true
      documents.push(...page.documents)

      if (!page.nextCursor || page.documents.length === 0) {
        break
      }

      cursor = page.nextCursor
    }

    if (usedCloud) {
      return documents.sort((a, b) => a.date.localeCompare(b.date))
    }
  } catch (error) {
    if (!isCloudFunctionMissingError(error)) {
      throw error
    }
  }

  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const { record } = await ensureCheckinsDocument(db, uid, openid)
  const infoList = normalizeInfoList(record)

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
