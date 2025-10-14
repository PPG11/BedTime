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

export async function fetchGoodnightMessageForDate(
  uid: string,
  date: string
): Promise<GoodnightMessage | null> {
  const db = await ensureCloud()
  const docId = getGoodnightMessageId(uid, date)
  const snapshot = await getGoodnightMessagesCollection(db).doc(docId).get()
  return mapSnapshot(docId, snapshot)
}

export async function submitGoodnightMessage(params: {
  uid: string
  content: string
  date: string
}): Promise<GoodnightMessage> {
  const db = await ensureCloud()
  const docId = getGoodnightMessageId(params.uid, params.date)
  const collection = getGoodnightMessagesCollection(db)
  const existing = await collection.doc(docId).get()

  if (existing.data) {
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
      createdAt: now
    }
  })

  return mapGoodnightMessage(docId, data)
}

export async function fetchRandomGoodnightMessage(
  excludeUid?: string
): Promise<GoodnightMessage | null> {
  const db = await ensureCloud()
  const result = await getGoodnightMessagesCollection(db)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

  const candidates = (result.data ?? [])
    .map((item) => mapGoodnightMessage(getGoodnightMessageId(item.uid, item.date), item))
    .filter((item) => !excludeUid || item.uid !== excludeUid)

  if (!candidates.length) {
    return null
  }

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

  return {
    ...current,
    likes: nextLikes,
    dislikes: nextDislikes
  }
}
