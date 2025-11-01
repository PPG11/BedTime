import { COLLECTIONS } from '../config/cloud'
import {
  GOODNIGHT_ERROR_ALREADY_SUBMITTED,
  type GoodnightMessage,
  type GoodnightVoteType
} from '../types/goodnight'
import {
  ensureCloud,
  type CloudDatabase,
  type CloudDocumentSnapshot,
  type DbCollection
} from './cloud'

export type GoodnightMessageDocument = GoodnightMessage

type GoodnightMessageRecord = Omit<GoodnightMessage, '_id'>

type CacheEntry<T> = {
  timestamp: number
  value: T
}

const MESSAGE_CACHE_TTL = 60 * 1000
const RANDOM_CACHE_TTL = 60 * 1000
const goodnightMessageCache = new Map<string, CacheEntry<GoodnightMessage | null>>()
const randomMessageCache = new Map<string, CacheEntry<GoodnightMessage[]>>()

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
  raw: Partial<GoodnightMessageRecord> & { _id?: string }
): GoodnightMessage {
  const createdAt = raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt ?? Date.now())

  return {
    _id: raw._id ?? fallbackId,
    uid: typeof raw.uid === 'string' ? raw.uid : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    likes: typeof raw.likes === 'number' ? raw.likes : 0,
    dislikes: typeof raw.dislikes === 'number' ? raw.dislikes : 0,
    date: typeof raw.date === 'string' ? raw.date : '',
    createdAt
  }
}

function mapSnapshot(
  docId: string,
  snapshot: CloudDocumentSnapshot<GoodnightMessageRecord>
): GoodnightMessage | null {
  if (!snapshot.data) {
    return null
  }
  return mapGoodnightMessage(docId, snapshot.data)
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
  const doc = getGoodnightMessagesCollection(db).doc(docId)
  const snapshot = await getSnapshotOrNull(doc)
  const message = snapshot ? mapSnapshot(docId, snapshot) : null
  setCacheEntry(goodnightMessageCache, docId, message)
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

export async function submitGoodnightMessage(params: {
  uid: string
  content: string
  date: string
}): Promise<GoodnightMessage> {
  const db = await ensureCloud()
  const docId = getGoodnightMessageId(params.uid, params.date)
  const collection = getGoodnightMessagesCollection(db)
  const existingSnapshot = await getSnapshotOrNull(collection.doc(docId))

  if (existingSnapshot && existingSnapshot.data) {
    throw new Error(GOODNIGHT_ERROR_ALREADY_SUBMITTED)
  }

  const trimmed = params.content.trim()
  const now = db.serverDate ? db.serverDate() : new Date()
  const data: GoodnightMessageRecord = {
    uid: params.uid,
    content: trimmed,
    likes: 0,
    dislikes: 0,
    date: params.date,
    createdAt: now as unknown as Date
  }

  await collection.doc(docId).set({
    data: {
      uid: data.uid,
      content: data.content,
      likes: data.likes,
      dislikes: data.dislikes,
      date: data.date,
      createdAt: now as unknown as Date
    }
  })

  const message = mapGoodnightMessage(docId, data)
  setCacheEntry(goodnightMessageCache, docId, message)
  invalidateRandomCache()
  return message
}

export async function fetchRandomGoodnightMessage(
  excludeUid?: string
): Promise<GoodnightMessage | null> {
  const cacheKey = excludeUid ?? '__all__'
  const cached = randomMessageCache.get(cacheKey)
  if (isCacheFresh(cached, RANDOM_CACHE_TTL)) {
    const pool = cached.value
    if (!pool.length) {
      return null
    }
    const randomIndex = Math.floor(Math.random() * pool.length)
    return pool[randomIndex]
  }

  const db = await ensureCloud()
  const collection = getGoodnightMessagesCollection(db)
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

  const result = await collection
    .where({
      createdAt: db.command.gte(cutoff)
    })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

  const candidates = (result.data ?? [])
    .map((item) => mapGoodnightMessage(getGoodnightMessageId(item.uid, item.date), item))
    .filter((item) => !excludeUid || item.uid !== excludeUid)

  if (!candidates.length) {
    setCacheEntry(randomMessageCache, cacheKey, [])
    return null
  }

  setCacheEntry(randomMessageCache, cacheKey, candidates)
  candidates.forEach((item) => setCacheEntry(goodnightMessageCache, item._id, item))
  const randomIndex = Math.floor(Math.random() * candidates.length)
  return candidates[randomIndex]
}

export async function voteGoodnightMessage(
  id: string,
  vote: GoodnightVoteType
): Promise<GoodnightMessage | null> {
  const db = await ensureCloud()
  const collection = getGoodnightMessagesCollection(db)
  const doc = collection.doc(id)
  const snapshot = await doc.get()
  const current = mapSnapshot(id, snapshot)

  if (!current) {
    setCacheEntry(goodnightMessageCache, id, null)
    return null
  }

  const nextLikes = vote === 'like' ? current.likes + 1 : current.likes
  const nextDislikes = vote === 'dislike' ? current.dislikes + 1 : current.dislikes

  await doc.update({
    data: {
      likes: nextLikes,
      dislikes: nextDislikes
    }
  })

  const updated: GoodnightMessage = {
    ...current,
    likes: nextLikes,
    dislikes: nextDislikes
  }
  setCacheEntry(goodnightMessageCache, id, updated)
  invalidateRandomCache()
  return updated
}
