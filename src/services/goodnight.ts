import { COLLECTIONS } from '../config/cloud'
import {
  GOODNIGHT_ERROR_ALREADY_SUBMITTED,
  type GoodnightMessage,
  type GoodnightVoteType
} from '../types/goodnight'
import {
  ensureCloud,
  getCurrentOpenId,
  callCloudFunction,
  type CloudDatabase,
  type CloudDocumentSnapshot,
  type DbCollection
} from './cloud'

export type GoodnightMessageDocument = {
  _id?: string
  uid?: string
  userId?: string
  content?: string
  text?: string
  likes?: number
  dislikes?: number
  date?: string
  createdAt?: Date | string | number | { [key: string]: unknown }
  slotKey?: string
  rand?: number
  score?: number
  status?: string
}

type GoodnightMessageRecord = GoodnightMessageDocument

type CacheEntry<T> = {
  timestamp: number
  value: T
}

type GoodnightReactionFunctionResponse = {
  code?: string
  message?: string
  queued?: boolean
  dedup?: boolean
}

const MESSAGE_CACHE_TTL = 60 * 1000
const RANDOM_CACHE_TTL = 60 * 1000
const goodnightMessageCache = new Map<string, CacheEntry<GoodnightMessage | null>>()
const randomMessageCache = new Map<string, CacheEntry<GoodnightMessage | null>>()

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

function invalidateRandomCache(key?: string): void {
  if (!key) {
    randomMessageCache.clear()
    return
  }
  randomMessageCache.delete(key)
}

function getGoodnightMessagesCollection(
  db: CloudDatabase
): DbCollection<GoodnightMessageDocument> {
  return db.collection<GoodnightMessageDocument>(COLLECTIONS.goodnightMessages)
}

function getGoodnightMessageId(uid: string, date: string): string {
  return `${uid}_${date}`
}

function mapGoodnightMessage(
  fallbackId: string,
  raw: Partial<GoodnightMessageRecord> & { _id?: string },
  fallback?: { uid?: string; content?: string }
): GoodnightMessage {
  const createdSource = raw.createdAt
  const createdAt =
    createdSource instanceof Date
      ? createdSource
      : new Date(
          typeof createdSource === 'number' || typeof createdSource === 'string'
            ? createdSource
            : Date.now()
        )

  const normalizedContent =
    typeof raw.content === 'string' && raw.content.trim().length
      ? raw.content.trim()
      : typeof raw.text === 'string' && raw.text.trim().length
      ? raw.text.trim()
      : typeof fallback?.content === 'string'
      ? fallback.content
      : ''

  const normalizedUid =
    typeof raw.uid === 'string' && raw.uid.trim().length
      ? raw.uid.trim()
      : typeof fallback?.uid === 'string' && fallback.uid.trim().length
      ? fallback.uid.trim()
      : ''

  return {
    _id:
      typeof raw._id === 'string' && raw._id.trim().length
        ? raw._id.trim()
        : fallbackId,
    uid: normalizedUid,
    content: normalizedContent,
    likes: typeof raw.likes === 'number' ? raw.likes : 0,
    dislikes: typeof raw.dislikes === 'number' ? raw.dislikes : 0,
    date: typeof raw.date === 'string' ? raw.date : '',
    createdAt
  }
}

function mapSnapshot(
  docId: string,
  snapshot: CloudDocumentSnapshot<GoodnightMessageRecord>,
  fallback?: { uid?: string; content?: string }
): GoodnightMessage | null {
  if (!snapshot.data) {
    return null
  }
  return mapGoodnightMessage(docId, snapshot.data, fallback)
}

function isDocumentNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const err = error as { errMsg?: unknown; message?: unknown }
  const message = typeof err.message === 'string' ? err.message : null
  const errMsg = typeof err.errMsg === 'string' ? err.errMsg : null
  const combined = `${errMsg ?? ''} ${message ?? ''}`

  if (!/document\.get:fail/i.test(combined)) {
    return false
  }

  return (
    /can\s*not\s*find\s*document/i.test(combined) ||
    /document\s+with\s+_id[\s\S]*does\s+not\s+exist/i.test(combined)
  )
}

async function getSnapshotOrNull(
  doc: ReturnType<DbCollection<GoodnightMessageDocument>['doc']>
): Promise<CloudDocumentSnapshot<GoodnightMessageRecord> | null> {
  try {
    return await doc.get()
  } catch (error) {
    if (isDocumentNotFoundError(error)) {
      return null
    }
    throw error
  }
}

export async function fetchGoodnightMessageForDate(
  uid: string,
  date: string
): Promise<GoodnightMessage | null> {
  const docId = getGoodnightMessageId(uid, date)
  const cached = goodnightMessageCache.get(docId)
  if (isCacheFresh(cached, MESSAGE_CACHE_TTL)) {
    return cached.value
  }

  const db = await ensureCloud()
  const collection = getGoodnightMessagesCollection(db)
  let message: GoodnightMessage | null = null

  try {
    const openid = await getCurrentOpenId()
    const result = await collection
      .where({
        userId: openid,
        date
      })
      .limit(1)
      .get()

    if (Array.isArray(result.data) && result.data.length > 0) {
      const record = result.data[0]
      const resolvedId =
        typeof record._id === 'string' && record._id.trim().length
          ? record._id.trim()
          : docId
      message = mapGoodnightMessage(resolvedId, record, {
        uid,
        content: typeof record.text === 'string' ? record.text : record.content
      })
    }
  } catch (error) {
    console.warn('按 userId 查询晚安心语失败，退回按文档 ID 查询', error)
  }

  if (!message) {
    const doc = collection.doc(docId)
    const snapshot = await getSnapshotOrNull(doc)
    message = snapshot ? mapSnapshot(docId, snapshot, { uid }) : null
  }

  setCacheEntry(goodnightMessageCache, docId, message)
  if (message) {
    setCacheEntry(goodnightMessageCache, message._id, message)
  }
  return message
}

export async function fetchGoodnightMessageById(id: string): Promise<GoodnightMessage | null> {
  if (!id) {
    return null
  }

  const cached = goodnightMessageCache.get(id)
  if (isCacheFresh(cached, MESSAGE_CACHE_TTL)) {
    return cached.value
  }

  const db = await ensureCloud()
  const doc = getGoodnightMessagesCollection(db).doc(id)
  const snapshot = await getSnapshotOrNull(doc)
  const message = snapshot ? mapSnapshot(id, snapshot) : null
  setCacheEntry(goodnightMessageCache, id, message)
  return message
}

type GoodnightSubmitFunctionResponse = {
  code?: string
  message?: string
  messageId?: string | null
}

export async function submitGoodnightMessage(params: {
  uid: string
  content: string
  date: string
}): Promise<GoodnightMessage> {
  const trimmed = params.content.trim()

  const response = await callCloudFunction<GoodnightSubmitFunctionResponse>({
    name: 'gnSubmit',
    data: {
      text: trimmed,
      date: params.date
    }
  })

  if (!response) {
    throw new Error('提交晚安心语失败')
  }

  const code = typeof response.code === 'string' ? response.code : 'OK'
  if (code === 'ALREADY_EXISTS') {
    throw new Error(GOODNIGHT_ERROR_ALREADY_SUBMITTED)
  }
  if (code !== 'OK') {
    const message =
      typeof response.message === 'string' && response.message.length
        ? response.message
        : '提交晚安心语失败'
    throw new Error(message)
  }

  const fallbackId = getGoodnightMessageId(params.uid, params.date)
  const messageId =
    typeof response.messageId === 'string' && response.messageId.trim().length
      ? response.messageId.trim()
      : fallbackId

  let message: GoodnightMessage | null = null
  try {
    message = await fetchGoodnightMessageById(messageId)
  } catch (error) {
    console.warn('提交后加载晚安心语详情失败', error)
  }

  if (!message) {
    message = {
      _id: messageId,
      uid: params.uid,
      content: trimmed,
      likes: 0,
      dislikes: 0,
      date: params.date,
      createdAt: new Date()
    }
  } else {
    if (!message.uid && params.uid) {
      message = {
        ...message,
        uid: params.uid
      }
    }
    if (!message.content && trimmed) {
      message = {
        ...message,
        content: trimmed
      }
    }
    if (!message.date && params.date) {
      message = {
        ...message,
        date: params.date
      }
    }
  }

  const normalizedMessage = message as GoodnightMessage
  const cacheKeys = new Set(
    [normalizedMessage._id, messageId, fallbackId].filter(
      (key): key is string => typeof key === 'string' && key.length > 0
    )
  )
  cacheKeys.forEach((key) => setCacheEntry(goodnightMessageCache, key, normalizedMessage))

  invalidateRandomCache()
  return normalizedMessage
}

type GoodnightRandomFunctionResponse = {
  code?: string
  message?: string
  messageId?: string | null
  text?: string | null
  score?: number | null
}

export async function fetchRandomGoodnightMessage(
  excludeUid?: string
): Promise<GoodnightMessage | null> {
  const cacheKey = excludeUid ?? '__all__'
  const cached = randomMessageCache.get(cacheKey)
  if (isCacheFresh(cached, RANDOM_CACHE_TTL)) {
    return cached.value
  }

  let response: GoodnightRandomFunctionResponse | undefined
  try {
    response = await callCloudFunction<GoodnightRandomFunctionResponse>({
      name: 'gnGetRandom',
      data: {
        // `gnGetRandom` 默认会按照用户偏好推荐并规避本人投稿
        preferSlot: true
      }
    })
  } catch (error) {
    console.warn('调用 gnGetRandom 失败', error)
    setCacheEntry(randomMessageCache, cacheKey, null)
    return null
  }

  if (!response) {
    setCacheEntry(randomMessageCache, cacheKey, null)
    return null
  }

  const code = typeof response.code === 'string' ? response.code : 'OK'
  if (code !== 'OK') {
    const message =
      typeof response.message === 'string' && response.message.length
        ? response.message
        : '抽取晚安心语失败'
    setCacheEntry(randomMessageCache, cacheKey, null)
    throw new Error(message)
  }

  const messageId =
    typeof response.messageId === 'string' && response.messageId.trim().length
      ? response.messageId.trim()
      : null

  if (!messageId) {
    setCacheEntry(randomMessageCache, cacheKey, null)
    return null
  }

  let resolved: GoodnightMessage | null = null
  try {
    resolved = await fetchGoodnightMessageById(messageId)
  } catch (error) {
    console.warn('加载晚安心语详情失败', error)
  }

  if (resolved) {
    setCacheEntry(randomMessageCache, cacheKey, resolved)
    return resolved
  }

  const fallbackText =
    typeof response.text === 'string' && response.text.trim().length
      ? response.text.trim()
      : null

  if (!fallbackText) {
    setCacheEntry(randomMessageCache, cacheKey, null)
    return null
  }

  const fallback: GoodnightMessage = {
    _id: messageId,
    uid: '',
    content: fallbackText,
    likes: 0,
    dislikes: 0,
    date: '',
    createdAt: new Date()
  }

  setCacheEntry(randomMessageCache, cacheKey, fallback)
  setCacheEntry(goodnightMessageCache, messageId, fallback)
  return fallback
}

export async function voteGoodnightMessage(
  id: string,
  vote: GoodnightVoteType
): Promise<GoodnightMessage | null> {
  if (!id) {
    return null
  }

  const cached = goodnightMessageCache.get(id)
  let current: GoodnightMessage | null = null
  if (cached && isCacheFresh(cached, MESSAGE_CACHE_TTL) && cached.value) {
    current = cached.value
  } else {
    current = await fetchGoodnightMessageById(id)
  }

  if (!current) {
    setCacheEntry(goodnightMessageCache, id, null)
    return null
  }

  console.log('id, vote', id, vote)
  const response = await callCloudFunction<GoodnightReactionFunctionResponse>({
    name: 'gnReact',
    data: {
      messageId: id,
      value: vote === 'like' ? 1 : -1
    }
  })
  console.log('response', response)

  if (!response) {
    throw new Error('投票失败，请稍后再试')
  }

  const code = typeof response.code === 'string' ? response.code : 'OK'
  if (code !== 'OK') {
    const message =
      typeof response.message === 'string' && response.message.length
        ? response.message
        : '投票失败，请稍后再试'
    throw new Error(message)
  }

  if (!response.queued) {
    setCacheEntry(goodnightMessageCache, id, current)
    return current
  }

  const nextLikes = vote === 'like' ? current.likes + 1 : current.likes
  const nextDislikes = vote === 'dislike' ? current.dislikes + 1 : current.dislikes

  const updated: GoodnightMessage = {
    ...current,
    likes: nextLikes,
    dislikes: nextDislikes
  }
  setCacheEntry(goodnightMessageCache, id, updated)
  invalidateRandomCache()
  return updated
}
