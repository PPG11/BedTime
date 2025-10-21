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

type PublicProfileRecord = PublicProfileDocument & { _openid?: string }

type RawUserDocument = Omit<UserDocument, 'uid'> & { uid: string | number }

type CloudServerDate = ReturnType<NonNullable<CloudDatabase['serverDate']>>

type FriendInviteStatus = 'pending' | 'accepted' | 'declined'

type FriendInviteDocument = {
  _id: string
  senderUid: string
  senderOpenId: string
  recipientUid: string
  recipientOpenId: string
  status: FriendInviteStatus
  createdAt: Date
  updatedAt: Date
}

const DEFAULT_TARGET_HM = '22:30'
const DEFAULT_BUDDY_CONSENT = false

function getUsersCollection(db: CloudDatabase): DbCollection<UserDocument> {
  return db.collection<UserDocument>(COLLECTIONS.users)
}

function getPublicProfilesCollection(db: CloudDatabase): DbCollection<PublicProfileDocument> {
  return db.collection<PublicProfileDocument>(COLLECTIONS.publicProfiles)
}

function getFriendInvitesCollection(db: CloudDatabase): DbCollection<FriendInviteDocument> {
  return db.collection<FriendInviteDocument>(COLLECTIONS.friendInvites)
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

function mapUserDocument(raw: RawUserDocument): UserDocument {
  const uid =
    typeof raw.uid === 'number'
      ? Number.isSafeInteger(raw.uid)
        ? normalizeUid(raw.uid)
        : String(raw.uid)
      : raw.uid

  return {
    ...raw,
    uid,
    buddyList: Array.isArray(raw.buddyList) ? sanitizeUidList(raw.buddyList) : [],
    incomingRequests: Array.isArray(raw.incomingRequests)
      ? sanitizeUidList(raw.incomingRequests)
      : [],
    outgoingRequests: Array.isArray(raw.outgoingRequests)
      ? sanitizeUidList(raw.outgoingRequests)
      : [],
    nickname: raw.nickname || `睡眠伙伴${uid.slice(-4)}`,
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
    const mapped = mapUserDocument(doc)
    return await hydrateUserInviteLists(db, mapped)
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

function areUidListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }

  return true
}

function buildFriendInviteId(senderUid: string, recipientUid: string): string {
  return `invite_${senderUid}_${recipientUid}`
}

async function hydrateUserInviteLists(
  db: CloudDatabase,
  user: UserDocument
): Promise<UserDocument> {
  try {
    const invites = getFriendInvitesCollection(db)
    const users = getUsersCollection(db)
    const [
      pendingOutgoingSnapshot,
      pendingIncomingSnapshot,
      acceptedOutgoingSnapshot,
      acceptedIncomingSnapshot,
      declinedOutgoingSnapshot
    ] = await Promise.all([
      invites
        .where({
          senderUid: user.uid,
          status: 'pending'
        })
        .get(),
      invites
        .where({
          recipientUid: user.uid,
          status: 'pending'
        })
        .get(),
      invites
        .where({
          senderUid: user.uid,
          status: 'accepted'
        })
        .limit(100)
        .get(),
      invites
        .where({
          recipientUid: user.uid,
          status: 'accepted'
        })
        .limit(100)
        .get(),
      invites
        .where({
          senderUid: user.uid,
          status: 'declined'
        })
        .limit(100)
        .get()
    ])

    const pendingOutgoingInvites = pendingOutgoingSnapshot.data ?? []
    const pendingIncomingInvites = pendingIncomingSnapshot.data ?? []
    const acceptedOutgoingInvites = acceptedOutgoingSnapshot.data ?? []
    const acceptedIncomingInvites = acceptedIncomingSnapshot.data ?? []
    const declinedOutgoingInvites = declinedOutgoingSnapshot.data ?? []
    const pendingOutgoing: string[] = []
    const pendingIncoming: string[] = []
    const buddySet = new Set(user.buddyList ?? [])
    const cleanupInviteIds: string[] = []

    for (const invite of pendingIncomingInvites) {
      pendingIncoming.push(invite.senderUid)
    }

    for (const invite of pendingOutgoingInvites) {
      pendingOutgoing.push(invite.recipientUid)
    }

    for (const invite of acceptedIncomingInvites) {
      buddySet.add(invite.senderUid)
    }

    for (const invite of acceptedOutgoingInvites) {
      buddySet.add(invite.recipientUid)
      cleanupInviteIds.push(invite._id)
    }

    for (const invite of declinedOutgoingInvites) {
      cleanupInviteIds.push(invite._id)
    }

    const sanitizedIncoming = sanitizeUidList(pendingIncoming)
    const sanitizedOutgoing = sanitizeUidList(pendingOutgoing)
    const sanitizedBuddyList = sanitizeUidList(Array.from(buddySet))

    const shouldUpdateIncoming = !areUidListsEqual(
      sanitizedIncoming,
      user.incomingRequests
    )
    const shouldUpdateOutgoing = !areUidListsEqual(
      sanitizedOutgoing,
      user.outgoingRequests
    )
    const shouldUpdateBuddy = !areUidListsEqual(
      sanitizedBuddyList,
      user.buddyList
    )

    const now = db.serverDate ? db.serverDate() : new Date()
    const updatePayload: Partial<UserDocument> & {
      updatedAt?: Date | CloudServerDate
    } = {}

    if (shouldUpdateIncoming) {
      updatePayload.incomingRequests = sanitizedIncoming
    }
    if (shouldUpdateOutgoing) {
      updatePayload.outgoingRequests = sanitizedOutgoing
    }
    if (shouldUpdateBuddy) {
      updatePayload.buddyList = sanitizedBuddyList
    }

    let nextUser = {
      ...user,
      buddyList: sanitizedBuddyList,
      incomingRequests: sanitizedIncoming,
      outgoingRequests: sanitizedOutgoing
    }

    if (
      shouldUpdateIncoming ||
      shouldUpdateOutgoing ||
      shouldUpdateBuddy
    ) {
      updatePayload.updatedAt = now

      try {
        await users.doc(user._id).update({
          data: updatePayload
        })
        nextUser = {
          ...nextUser,
          updatedAt: now as unknown as Date
        }
      } catch (error) {
        console.warn('同步好友邀请缓存失败', error)
      }
    }

    if (cleanupInviteIds.length) {
      await Promise.all(
        cleanupInviteIds.map((inviteId) =>
          invites
            .doc(inviteId)
            .remove()
            .catch((error) => console.warn('清理好友邀请失败', error))
        )
      )
    }

    return nextUser
  } catch (error) {
    console.warn('同步好友邀请列表失败', error)
    return {
      ...user,
      incomingRequests: sanitizeUidList(user.incomingRequests ?? []),
      outgoingRequests: sanitizeUidList(user.outgoingRequests ?? [])
    }
  }
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
  | { status: 'self-target'; user: UserDocument }
  | { status: 'already-friends'; user: UserDocument }
  | { status: 'incoming-exists'; user: UserDocument }
  | { status: 'already-sent'; user: UserDocument }
  | { status: 'sent'; user: UserDocument }

function removeUid(source: string[], target: string): string[] {
  return source.filter((item) => item !== target)
}

type UidCandidate = string | number

function buildUidCandidates(uid: string): UidCandidate[] {
  const candidates: UidCandidate[] = []
  const seen = new Set<string>()

  const pushCandidate = (value: UidCandidate) => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed.length) {
        return
      }
      const key = `string:${trimmed}`
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      candidates.push(trimmed)
      return
    }

    const key = `number:${value}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    candidates.push(value)
  }

  const normalized = uid.trim()
  pushCandidate(normalized)

  if (normalized.length && normalized !== uid) {
    pushCandidate(uid)
  }

  if (/^\d+$/.test(normalized)) {
    if (normalized.length < UID_LENGTH) {
      pushCandidate(normalized.padStart(UID_LENGTH, '0'))
    }

    const withoutLeadingZeros = normalized.replace(/^0+/, '')
    if (withoutLeadingZeros.length) {
      pushCandidate(withoutLeadingZeros)
    }

    const numericUid = Number(normalized)
    if (Number.isSafeInteger(numericUid)) {
      pushCandidate(numericUid)
      pushCandidate(String(numericUid))
      pushCandidate(normalizeUid(numericUid))
    }
  }

  return candidates
}

async function queryUserByCandidates(
  users: DbCollection<UserDocument>,
  candidates: UidCandidate[]
): Promise<UserDocument | null> {
  for (const candidate of candidates) {
    const result = await users
      .where({
        uid: candidate
      })
      .limit(1)
      .get()

    const doc = result.data?.[0]
    if (doc) {
      return mapUserDocument(doc)
    }
  }

  return null
}

async function fetchPublicProfileRecords(
  publicProfiles: DbCollection<PublicProfileDocument>,
  candidate: string
): Promise<PublicProfileRecord[]> {
  const records: PublicProfileRecord[] = []

  try {
    const snapshot = await publicProfiles.doc(candidate).get()
    if (snapshot.data) {
      records.push({
        ...snapshot.data,
        uid: snapshot.data.uid ?? candidate
      } as PublicProfileRecord)
    }
  } catch (error) {
    console.warn('按 UID 读取公开资料失败', error)
  }

  try {
    const queried = await publicProfiles
      .where({
        uid: candidate
      })
      .limit(1)
      .get()
    const doc = queried.data?.[0]
    if (doc) {
      records.push(doc as PublicProfileRecord)
    }
  } catch (error) {
    console.warn('查询公开资料失败', error)
  }

  return records
}

async function bootstrapUserFromPublicProfile(
  db: CloudDatabase,
  users: DbCollection<UserDocument>,
  record: PublicProfileRecord,
  openid: string
): Promise<UserDocument | null> {
  const now = db.serverDate ? db.serverDate() : new Date()
  const bootstrap = ensureUserDocument(
    {
      nickname: typeof record.nickname === 'string' ? record.nickname : undefined,
      targetHM: typeof record.sleeptime === 'string' ? record.sleeptime : undefined,
      createdAt: now as unknown as Date,
      updatedAt: now as unknown as Date
    },
    openid,
    record.uid
  )

  try {
    await users.doc(openid).set({
      data: {
        uid: bootstrap.uid,
        nickname: bootstrap.nickname,
        tzOffset: bootstrap.tzOffset,
        targetHM: bootstrap.targetHM,
        buddyConsent: bootstrap.buddyConsent,
        buddyList: bootstrap.buddyList,
        incomingRequests: bootstrap.incomingRequests,
        outgoingRequests: bootstrap.outgoingRequests,
        createdAt: now,
        updatedAt: now
      }
    })
  } catch (error) {
    console.error('根据公开资料补充用户信息失败', error)
    return null
  }

  return {
    ...bootstrap,
    createdAt: new Date(),
    updatedAt: new Date()
  }
}

async function resolveUserFromPublicProfiles(
  db: CloudDatabase,
  users: DbCollection<UserDocument>,
  candidates: UidCandidate[]
): Promise<UserDocument | null> {
  const publicProfiles = getPublicProfilesCollection(db)
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue
    }

    const trimmed = candidate.trim()
    if (!trimmed.length || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)

    const records = await fetchPublicProfileRecords(publicProfiles, trimmed)
    for (const record of records) {
      if (!record || typeof record.uid !== 'string' || !record.uid.length) {
        continue
      }

      const openid = (record as { _openid?: unknown })._openid
      if (typeof openid !== 'string' || !openid.length) {
        continue
      }

      try {
        const existing = await fetchUserByOpenId(db, openid)
        if (existing) {
          return existing
        }
      } catch (error) {
        console.warn('通过公开资料关联用户信息失败', error)
      }

      const bootstrapped = await bootstrapUserFromPublicProfile(db, users, record, openid)
      if (bootstrapped) {
        return bootstrapped
      }
    }
  }

  return null
}

async function fetchUserByUid(db: CloudDatabase, uid: string): Promise<UserDocument | null> {
  const users = getUsersCollection(db)

  try {
    const candidates = buildUidCandidates(uid)

    const directMatch = await queryUserByCandidates(users, candidates)
    if (directMatch) {
      return directMatch
    }

    return await resolveUserFromPublicProfiles(db, users, candidates)
  } catch (error) {
    console.error('通过 UID 查询用户失败', error)
    throw error
  }
}

export async function sendFriendInvite(targetUid: string): Promise<SendFriendInviteResult> {
  const db = await ensureCloud()
  const sender = await ensureCurrentUser()
  const users = getUsersCollection(db)
  const invites = getFriendInvitesCollection(db)
  const normalizedTargetUid = targetUid.trim()

  if (!normalizedTargetUid.length) {
    return { status: 'not-found' }
  }
  if (normalizedTargetUid === sender.uid) {
    return { status: 'self-target', user: sender }
  }
  if (sender.buddyList.includes(normalizedTargetUid)) {
    return { status: 'already-friends', user: sender }
  }
  if (sender.incomingRequests.includes(normalizedTargetUid)) {
    return { status: 'incoming-exists', user: sender }
  }
  if (sender.outgoingRequests.includes(normalizedTargetUid)) {
    return { status: 'already-sent', user: sender }
  }

  const recipient = await fetchUserByUid(db, normalizedTargetUid)
  if (!recipient) {
    return { status: 'not-found' }
  }
  if (recipient.uid === sender.uid) {
    return { status: 'self-target', user: sender }
  }
  if (recipient.buddyList.includes(sender.uid)) {
    return { status: 'already-friends', user: sender }
  }

  const now = db.serverDate ? db.serverDate() : new Date()
  const inviteId = buildFriendInviteId(sender.uid, recipient.uid)
  const inviteDoc = invites.doc(inviteId)
  let existingInvite: FriendInviteDocument | undefined

  try {
    const snapshot = await inviteDoc.get()
    if (snapshot.data) {
      existingInvite = snapshot.data
    }
  } catch (error) {
    console.warn('读取好友邀请记录失败', error)
  }

  if (existingInvite) {
    if (existingInvite.status === 'pending') {
      return { status: 'already-sent', user: sender }
    }
    if (existingInvite.status === 'accepted') {
      return { status: 'already-friends', user: sender }
    }
  }

  const inviteCreatedAt =
    existingInvite?.createdAt instanceof Date
      ? (existingInvite.createdAt as Date)
      : existingInvite?.createdAt
      ? new Date(existingInvite.createdAt)
      : now

  const invitePayload = {
    senderUid: sender.uid,
    senderOpenId: sender._id,
    recipientUid: recipient.uid,
    recipientOpenId: recipient._id,
    status: 'pending' as FriendInviteStatus,
    createdAt: inviteCreatedAt as unknown as Date,
    updatedAt: now as unknown as Date
  }

  if (existingInvite) {
    await inviteDoc.update({
      data: invitePayload
    })
  } else {
    await inviteDoc.set({
      data: invitePayload
    })
  }

  const nextSenderOutgoing = sanitizeUidList([...sender.outgoingRequests, normalizedTargetUid])

  await users.doc(sender._id).update({
    data: {
      outgoingRequests: nextSenderOutgoing,
      updatedAt: now
    }
  })

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
  const invites = getFriendInvitesCollection(db)
  const current = await ensureCurrentUser()
  const normalizedTargetUid = targetUid.trim()

  if (!normalizedTargetUid.length) {
    return { status: 'not-found', user: current }
  }

  if (!current.incomingRequests.includes(normalizedTargetUid)) {
    return { status: 'not-found', user: current }
  }

  const inviteId = buildFriendInviteId(normalizedTargetUid, current.uid)
  const inviteDoc = invites.doc(inviteId)
  let invite: FriendInviteDocument | undefined

  try {
    const snapshot = await inviteDoc.get()
    if (snapshot.data) {
      invite = snapshot.data
    }
  } catch (error) {
    console.warn('读取好友邀请失败', error)
  }

  if (!invite || invite.status !== 'pending') {
    return { status: 'not-found', user: current }
  }

  const requester = await fetchUserByUid(db, normalizedTargetUid)
  const now = db.serverDate ? db.serverDate() : new Date()
  const nextInviteStatus: FriendInviteStatus =
    accept && requester ? 'accepted' : 'declined'

  const nextCurrentIncoming = removeUid(current.incomingRequests, normalizedTargetUid)
  const nextCurrentOutgoing = removeUid(current.outgoingRequests, normalizedTargetUid)
  const currentBuddyList = accept && requester
    ? sanitizeUidList([...current.buddyList, normalizedTargetUid])
    : sanitizeUidList(current.buddyList)

  await users.doc(current._id).update({
    data: {
      incomingRequests: nextCurrentIncoming,
      outgoingRequests: nextCurrentOutgoing,
      buddyList: currentBuddyList,
      updatedAt: now
    }
  })

  await inviteDoc.update({
    data: {
      status: nextInviteStatus,
      updatedAt: now
    }
  })

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
