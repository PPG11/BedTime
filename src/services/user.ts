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
  incomingRequests: string[]
  outgoingRequests: string[]
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
  incomingRequests?: string[]
  outgoingRequests?: string[]
}

type PublicProfileDocument = {
  _id: string
  uid: string
  nickname: string
  sleeptime: string
  streak: number
  todayStatus: 'hit' | 'miss' | 'pending'
  updatedAt: Date
}

type CloudServerDate = ReturnType<NonNullable<CloudDatabase['serverDate']>>

const DEFAULT_TARGET_HM = '22:30'
const DEFAULT_BUDDY_CONSENT = false

function getUsersCollection(db: CloudDatabase): DbCollection<UserDocument> {
  return db.collection<UserDocument>(COLLECTIONS.users)
}

function getPublicProfilesCollection(db: CloudDatabase): DbCollection<PublicProfileDocument> {
  return db.collection<PublicProfileDocument>(COLLECTIONS.publicProfiles)
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
    buddyList: Array.isArray(data.buddyList) ? sanitizeUidList(data.buddyList) : [],
    incomingRequests: Array.isArray(data.incomingRequests)
      ? sanitizeUidList(data.incomingRequests)
      : [],
    outgoingRequests: Array.isArray(data.outgoingRequests)
      ? sanitizeUidList(data.outgoingRequests)
      : [],
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now
  }
}

function mapUserDocument(raw: UserDocument): UserDocument {
  return {
    ...raw,
    buddyList: Array.isArray(raw.buddyList) ? sanitizeUidList(raw.buddyList) : [],
    incomingRequests: Array.isArray(raw.incomingRequests)
      ? sanitizeUidList(raw.incomingRequests)
      : [],
    outgoingRequests: Array.isArray(raw.outgoingRequests)
      ? sanitizeUidList(raw.outgoingRequests)
      : [],
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

function sanitizeUidList(list: string[]): string[] {
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
    sanitized.buddyList = sanitizeUidList(patch.buddyList)
  }
  if (Array.isArray(patch.incomingRequests)) {
    sanitized.incomingRequests = sanitizeUidList(patch.incomingRequests)
  }
  if (Array.isArray(patch.outgoingRequests)) {
    sanitized.outgoingRequests = sanitizeUidList(patch.outgoingRequests)
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
  if (typeof sanitized.nickname === 'string' || typeof sanitized.targetHM === 'string') {
    await syncPublicProfileBasics(db, updated, now)
  }
  return updated
}

type SendFriendInviteResult =
  | { status: 'not-found' }
  | { status: 'already-friends'; user: UserDocument }
  | { status: 'incoming-exists'; user: UserDocument }
  | { status: 'already-sent'; user: UserDocument }
  | { status: 'sent'; user: UserDocument }

function removeUid(source: string[], target: string): string[] {
  return source.filter((item) => item !== target)
}

async function fetchUserByUid(db: CloudDatabase, uid: string): Promise<UserDocument | null> {
  const users = getUsersCollection(db)

  const queryByUid = async (candidate: string | number): Promise<UserDocument | null> => {
    const result = await users
      .where({
        uid: candidate
      })
      .limit(1)
      .get()

    const doc = result.data?.[0]
    if (!doc) {
      return null
    }
    return mapUserDocument(doc)
  }

  try {
    const doc = await queryByUid(uid)
    if (doc) {
      return doc
    }

    if (/^\d+$/.test(uid)) {
      const numericUid = Number(uid)
      if (Number.isSafeInteger(numericUid)) {
        return await queryByUid(numericUid)
      }
    }

    return null
  } catch (error) {
    console.error('通过 UID 查询用户失败', error)
    throw error
  }
}

export async function sendFriendInvite(targetUid: string): Promise<SendFriendInviteResult> {
  const db = await ensureCloud()
  const sender = await ensureCurrentUser()
  const users = getUsersCollection(db)

  if (sender.buddyList.includes(targetUid)) {
    return { status: 'already-friends', user: sender }
  }
  if (sender.incomingRequests.includes(targetUid)) {
    return { status: 'incoming-exists', user: sender }
  }
  if (sender.outgoingRequests.includes(targetUid)) {
    return { status: 'already-sent', user: sender }
  }

  const recipient = await fetchUserByUid(db, targetUid)
  if (!recipient) {
    return { status: 'not-found' }
  }
  if (recipient.buddyList.includes(sender.uid)) {
    return { status: 'already-friends', user: sender }
  }

  const now = db.serverDate ? db.serverDate() : new Date()

  const nextSenderOutgoing = sanitizeUidList([...sender.outgoingRequests, targetUid])
  const nextRecipientIncoming = sanitizeUidList([...recipient.incomingRequests, sender.uid])

  await Promise.all([
    users.doc(sender._id).update({
      data: {
        outgoingRequests: nextSenderOutgoing,
        updatedAt: now
      }
    }),
    users.doc(recipient._id).update({
      data: {
        incomingRequests: nextRecipientIncoming,
        updatedAt: now
      }
    })
  ])

  const updatedSender = await fetchUserByOpenId(db, sender._id)
  if (!updatedSender) {
    throw new Error('更新邀请信息后未找到当前用户记录')
  }

  return { status: 'sent', user: updatedSender }
}

type RespondFriendInviteResult =
  | { status: 'accepted'; user: UserDocument }
  | { status: 'declined'; user: UserDocument }
  | { status: 'not-found'; user: UserDocument }

export async function respondFriendInvite(
  targetUid: string,
  accept: boolean
): Promise<RespondFriendInviteResult> {
  const db = await ensureCloud()
  const users = getUsersCollection(db)
  const current = await ensureCurrentUser()

  if (!current.incomingRequests.includes(targetUid)) {
    return { status: 'not-found', user: current }
  }

  const requester = await fetchUserByUid(db, targetUid)
  const now = db.serverDate ? db.serverDate() : new Date()

  const nextCurrentIncoming = removeUid(current.incomingRequests, targetUid)
  const nextCurrentOutgoing = removeUid(current.outgoingRequests, targetUid)
  const currentBuddyList = accept
    ? sanitizeUidList([...current.buddyList, targetUid])
    : current.buddyList

  await users.doc(current._id).update({
    data: {
      incomingRequests: nextCurrentIncoming,
      outgoingRequests: nextCurrentOutgoing,
      buddyList: currentBuddyList,
      updatedAt: now
    }
  })

  if (requester) {
    const nextRequesterOutgoing = removeUid(requester.outgoingRequests, current.uid)
    const nextRequesterIncoming = removeUid(requester.incomingRequests, current.uid)
    const requesterBuddyList = accept
      ? sanitizeUidList([...requester.buddyList, current.uid])
      : requester.buddyList

    await users.doc(requester._id).update({
      data: {
        outgoingRequests: nextRequesterOutgoing,
        incomingRequests: nextRequesterIncoming,
        buddyList: requesterBuddyList,
        updatedAt: now
      }
    })
  }

  const updatedCurrent = await fetchUserByOpenId(db, current._id)
  if (!updatedCurrent) {
    throw new Error('处理好友邀请后未找到当前用户记录')
  }

  if (!requester) {
    return { status: 'not-found', user: updatedCurrent }
  }

  return { status: accept ? 'accepted' : 'declined', user: updatedCurrent }
}

type RemoveFriendResult =
  | { status: 'ok'; user: UserDocument }
  | { status: 'not-found'; user: UserDocument }

export async function removeFriend(targetUid: string): Promise<RemoveFriendResult> {
  const db = await ensureCloud()
  const users = getUsersCollection(db)
  const current = await ensureCurrentUser()

  if (!current.buddyList.includes(targetUid)) {
    return { status: 'not-found', user: current }
  }

  const target = await fetchUserByUid(db, targetUid)
  const now = db.serverDate ? db.serverDate() : new Date()

  const nextCurrentBuddyList = removeUid(current.buddyList, targetUid)
  const nextCurrentIncoming = removeUid(current.incomingRequests, targetUid)
  const nextCurrentOutgoing = removeUid(current.outgoingRequests, targetUid)

  await users.doc(current._id).update({
    data: {
      buddyList: nextCurrentBuddyList,
      incomingRequests: nextCurrentIncoming,
      outgoingRequests: nextCurrentOutgoing,
      updatedAt: now
    }
  })

  if (target) {
    const nextTargetBuddyList = removeUid(target.buddyList, current.uid)
    const nextTargetIncoming = removeUid(target.incomingRequests, current.uid)
    const nextTargetOutgoing = removeUid(target.outgoingRequests, current.uid)

    await users.doc(target._id).update({
      data: {
        buddyList: nextTargetBuddyList,
        incomingRequests: nextTargetIncoming,
        outgoingRequests: nextTargetOutgoing,
        updatedAt: now
      }
    })
  }

  const updatedCurrent = await fetchUserByOpenId(db, current._id)
  if (!updatedCurrent) {
    throw new Error('解除好友关系后未找到当前用户记录')
  }

  return { status: 'ok', user: updatedCurrent }
}

function clampSleeptimeBucket(targetHM: string): string {
  const minutes = parseTimeStringToMinutes(targetHM, 22 * 60 + 30)
  const bucket = Math.round(minutes / 30) * 30
  return formatMinutesToTime(bucket)
}

async function syncPublicProfileBasics(
  db: CloudDatabase,
  user: UserDocument,
  timestamp: Date | CloudServerDate
): Promise<void> {
  const publicProfiles = getPublicProfilesCollection(db)
  const doc = publicProfiles.doc(user.uid)
  const updatePayload = {
    nickname: user.nickname,
    sleeptime: clampSleeptimeBucket(user.targetHM),
    updatedAt: timestamp as unknown as Date
  }

  try {
    await doc.update({
      data: updatePayload
    })
    return
  } catch (error) {
    console.warn('更新公开资料失败，尝试创建新的记录', error)
  }

  await doc.set({
    data: {
      uid: user.uid,
      nickname: updatePayload.nickname,
      sleeptime: updatePayload.sleeptime,
      streak: 0,
      todayStatus: 'pending',
      updatedAt: timestamp as unknown as Date
    }
  })
}
