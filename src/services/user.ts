import {
  UID_LENGTH,
  UID_MAX_RETRY,
  COLLECTIONS
} from '../config/cloud'
import { formatMinutesToTime, parseTimeStringToMinutes } from '../utils/time'
import { ensureCloud, getCurrentOpenId, type CloudDatabase, type DbCollection } from './cloud'

export type UserDocument = {
  _id: string
  uid: string
  nickname: string
  tzOffset: number
  targetHM: string
  buddyConsent: boolean
  buddyList: string[]
  createdAt: Date
  updatedAt: Date
}

export type UserUpsertPayload = Partial<
  Omit<UserDocument, '_id' | 'uid' | 'createdAt' | 'updatedAt'>
> & {
  nickname?: string
  targetHM?: string
  buddyConsent?: boolean
  buddyList?: string[]
  tzOffset?: number
}

const DEFAULT_TARGET_HM = '22:30'
const DEFAULT_BUDDY_CONSENT = false

function getUsersCollection(db: CloudDatabase): DbCollection<UserDocument> {
  return db.collection<UserDocument>(COLLECTIONS.users)
}

function getDefaultTzOffset(): number {
  const offsetMinutes = -new Date().getTimezoneOffset()
  return Math.min(14 * 60, Math.max(-12 * 60, offsetMinutes))
}

function normalizeUid(candidate: number): string {
  return `${candidate}`.padStart(UID_LENGTH, '0')
}

async function generateUniqueUid(db: CloudDatabase): Promise<string> {
  const users = getUsersCollection(db)

  for (let attempt = 0; attempt < UID_MAX_RETRY; attempt += 1) {
    const randomCandidate = normalizeUid(Math.floor(Math.random() * 10 ** UID_LENGTH))
    const result = await users
      .where({
        uid: randomCandidate
      })
      .count()
    if (result.total === 0) {
      return randomCandidate
    }
  }

  throw new Error('UID 分配失败，请稍后重试')
}

function ensureUserDocument(data: Partial<UserDocument>, openid: string, uid: string): UserDocument {
  const now = new Date()
  return {
    _id: openid,
    uid,
    nickname: data.nickname ?? `睡眠伙伴${uid.slice(-4)}`,
    tzOffset: data.tzOffset ?? getDefaultTzOffset(),
    targetHM: data.targetHM ?? DEFAULT_TARGET_HM,
    buddyConsent: data.buddyConsent ?? DEFAULT_BUDDY_CONSENT,
    buddyList: Array.isArray(data.buddyList) ? data.buddyList : [],
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now
  }
}

function mapUserDocument(raw: UserDocument): UserDocument {
  return {
    ...raw,
    buddyList: Array.isArray(raw.buddyList) ? raw.buddyList : [],
    nickname: raw.nickname || `睡眠伙伴${raw.uid.slice(-4)}`,
    targetHM: raw.targetHM || DEFAULT_TARGET_HM,
    tzOffset: typeof raw.tzOffset === 'number' ? raw.tzOffset : getDefaultTzOffset(),
    buddyConsent: Boolean(raw.buddyConsent),
    createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt),
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : new Date(raw.updatedAt)
  }
}

async function fetchUserByOpenId(
  db: CloudDatabase,
  openid: string
): Promise<UserDocument | null> {
  try {
    const result = await getUsersCollection(db)
      .where({
        _openid: openid
      })
      .limit(1)
      .get()

    const doc = result.data?.[0]
    if (!doc) {
      return null
    }
    return mapUserDocument(doc)
  } catch (error) {
    console.error('读取用户信息失败', error)
    throw error
  }
}

export async function fetchCurrentUser(): Promise<UserDocument | null> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  return fetchUserByOpenId(db, openid)
}

export async function ensureCurrentUser(): Promise<UserDocument> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()

  const existing = await fetchUserByOpenId(db, openid)
  if (existing) {
    return existing
  }

  const uid = await generateUniqueUid(db)
  const now = db.serverDate ? db.serverDate() : new Date()
  const doc = ensureUserDocument(
    {
      createdAt: now as unknown as Date,
      updatedAt: now as unknown as Date
    },
    openid,
    uid
  )

  await getUsersCollection(db)
    .doc(openid)
    .set({
      data: {
        uid: doc.uid,
        nickname: doc.nickname,
        tzOffset: doc.tzOffset,
        targetHM: doc.targetHM,
        buddyConsent: doc.buddyConsent,
        buddyList: doc.buddyList,
        createdAt: now,
        updatedAt: now
      }
    })

  return {
    ...doc,
    createdAt: new Date(),
    updatedAt: new Date()
  }
}

function sanitizeBuddyList(list: string[]): string[] {
  return Array.from(
    new Set(
      list
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length)
    )
  )
}

export async function updateCurrentUser(patch: UserUpsertPayload): Promise<UserDocument> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  const now = db.serverDate ? db.serverDate() : new Date()

  const sanitized: UserUpsertPayload = {}
  if (typeof patch.nickname === 'string') {
    sanitized.nickname = patch.nickname.trim()
  }
  if (typeof patch.targetHM === 'string') {
    const minutes = parseTimeStringToMinutes(patch.targetHM, 22 * 60 + 30)
    sanitized.targetHM = formatMinutesToTime(minutes)
  }
  if (typeof patch.tzOffset === 'number') {
    sanitized.tzOffset = Math.round(patch.tzOffset)
  }
  if (typeof patch.buddyConsent === 'boolean') {
    sanitized.buddyConsent = patch.buddyConsent
  }
  if (Array.isArray(patch.buddyList)) {
    sanitized.buddyList = sanitizeBuddyList(patch.buddyList)
  }

  await getUsersCollection(db)
    .doc(openid)
    .update({
      data: {
        ...sanitized,
        updatedAt: now
      }
    })

  const updated = await fetchUserByOpenId(db, openid)
  if (!updated) {
    throw new Error('更新用户信息后未找到记录')
  }
  return updated
}
