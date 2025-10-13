import Taro from '@tarojs/taro'
import {
  CLOUD_ENV_CONFIGURED,
  CLOUD_ENV_ID,
  CLOUD_SHOULD_ENABLE,
  COLLECTIONS,
  UID_LENGTH,
  UID_MAX_RETRY
} from '../config/cloud'
import { formatMinutesToTime, parseTimeStringToMinutes } from '../utils/time'
import { formatDateKey, ONE_DAY_MS, parseDateKey } from '../utils/checkin'

export type CheckinStatus = 'hit' | 'miss' | 'pending'

type CloudDatabase = WechatMiniprogram.Cloud.Database
type DbCollection<T> = WechatMiniprogram.Cloud.Database.CollectionReference<T>

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

export type CheckinDocument = {
  _id: string
  uid: string
  date: string
  status: CheckinStatus
  ts: Date
  tzOffset: number
}

export type PublicProfileDocument = {
  _id: string
  uid: string
  nickname: string
  sleeptime: string
  streak: number
  todayStatus: CheckinStatus
  updatedAt: Date
}

export type FriendProfileSnapshot = {
  uid: string
  nickname: string
  streak: number
  todayStatus: CheckinStatus
  sleeptime: string
  updatedAt: Date
}

export type UserUpsertPayload = Partial<Omit<UserDocument, '_id' | 'uid' | 'createdAt' | 'updatedAt'>> & {
  nickname?: string
  targetHM?: string
  buddyConsent?: boolean
  buddyList?: string[]
  tzOffset?: number
}

const DEFAULT_TARGET_HM = '22:30'
const DEFAULT_BUDDY_CONSENT = false

let databaseCache: CloudDatabase | null = null
let openIdCache: string | null = null

export function supportsCloud(): boolean {
  if (!CLOUD_SHOULD_ENABLE) {
    return false
  }
  const env = Taro.getEnv?.()
  if (!env || env !== Taro.ENV_TYPE.WEAPP) {
    return false
  }
  return Boolean((Taro as unknown as { cloud?: unknown }).cloud)
}

export async function ensureCloud(): Promise<CloudDatabase> {
  if (!CLOUD_SHOULD_ENABLE) {
    throw new Error('未配置云开发环境，当前运行在本地模式')
  }
  if (!supportsCloud()) {
    throw new Error('当前运行环境不支持微信云开发，请在小程序端使用。')
  }

  if (databaseCache) {
    return databaseCache
  }

  const cloud = (Taro as unknown as { cloud?: typeof wx.cloud }).cloud
  if (!cloud) {
    throw new Error('Taro.cloud 未初始化')
  }

  const envId = CLOUD_ENV_ID.trim()
  if (envId) {
    try {
      cloud.init({
        traceUser: true,
        env: envId
      })
    } catch (error) {
      console.warn('微信云开发初始化（带 envId）失败，使用默认环境', error)
      cloud.init({
        traceUser: true
      })
    }
  } else if (CLOUD_ENV_CONFIGURED) {
    console.warn('云开发环境 ID 为空字符串，已跳过自定义环境初始化')
  }

  databaseCache = cloud.database()
  return databaseCache
}

function getUsersCollection(db: CloudDatabase): DbCollection<UserDocument> {
  return db.collection<UserDocument>(COLLECTIONS.users)
}

function getCheckinsCollection(db: CloudDatabase): DbCollection<CheckinDocument> {
  return db.collection<CheckinDocument>(COLLECTIONS.checkins)
}

function getPublicProfilesCollection(db: CloudDatabase): DbCollection<PublicProfileDocument> {
  return db.collection<PublicProfileDocument>(COLLECTIONS.publicProfiles)
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

type LoginResult = {
  result?: {
    openid?: string
  }
}

export async function getCurrentOpenId(): Promise<string> {
  if (openIdCache) {
    return openIdCache
  }
  
  try {
    const db = await ensureCloud()
    void db // 避免未使用警告，ensureCloud 会抛错时走不到下方逻辑

    const response = (await Taro.cloud.callFunction({
      name: 'login'
    })) as LoginResult

    const openid = response?.result?.openid
    if (!openid) {
      throw new Error('登录云函数未返回 openid')
    }
    openIdCache = openid
    return openid
  } catch (error) {
    console.error('获取 openid 失败，云函数可能未部署或云开发环境未配置', error)
    throw new Error('无法获取用户身份信息，请检查云函数配置或使用本地模式')
  }
}

function getDefaultTzOffset(): number {
  const offsetMinutes = -new Date().getTimezoneOffset()
  return Math.min(14 * 60, Math.max(-12 * 60, offsetMinutes))
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

export async function fetchCurrentUser(): Promise<UserDocument | null> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()
  try {
    const snapshot = await getUsersCollection(db).doc(openid).get()
    if (!snapshot.data) {
      return null
    }
    return mapUserDocument(snapshot.data)
  } catch (error) {
    if ((error as { errCode?: number }).errCode === 11) {
      return null
    }
    console.error('读取用户信息失败', error)
    throw error
  }
}

export async function ensureCurrentUser(): Promise<UserDocument> {
  try {
    const db = await ensureCloud()
    const openid = await getCurrentOpenId()

    const existing = await fetchCurrentUser()
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
  } catch (error) {
    console.error('云开发初始化失败，将使用本地模式', error)
    throw error
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
    sanitized.buddyList = Array.from(
      new Set(
        patch.buddyList
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length)
      )
    )
  }

  await getUsersCollection(db)
    .doc(openid)
    .update({
      data: {
        ...sanitized,
        updatedAt: now
      }
    })

  const updated = await fetchCurrentUser()
  if (!updated) {
    throw new Error('更新用户信息后未找到记录')
  }
  return updated
}

function getCheckinDocId(uid: string, date: string): string {
  return `${uid}_${date}`
}

function clampSleeptimeBucket(targetHM: string): string {
  const minutes = parseTimeStringToMinutes(targetHM, 22 * 60 + 30)
  const bucket = Math.round(minutes / 30) * 30
  return formatMinutesToTime(bucket)
}

function shiftDateKey(key: string, delta: number): string {
  const date = parseDateKey(key)
  date.setTime(date.getTime() + delta * ONE_DAY_MS)
  return formatDateKey(date)
}

function mapCheckinDocument(raw: CheckinDocument): CheckinDocument {
  return {
    ...raw,
    ts: raw.ts instanceof Date ? raw.ts : new Date(raw.ts)
  }
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
  const capped = Math.max(1, Math.min(1000, limit))

  const result = await getCheckinsCollection(db)
    .where({ uid })
    .orderBy('date', 'desc')
    .limit(capped)
    .get()

  return (result.data ?? []).map(mapCheckinDocument)
}

export async function fetchCheckinsInRange(
  uid: string,
  startDate: string,
  endDate: string
): Promise<CheckinDocument[]> {
  const db = await ensureCloud()
  const command = db.command
  const result = await getCheckinsCollection(db)
    .where({
      uid,
      date: command.gte(startDate).and(command.lte(endDate))
    })
    .orderBy('date', 'asc')
    .get()
  return (result.data ?? []).map(mapCheckinDocument)
}

function computeHitStreak(records: CheckinDocument[], todayKey: string): number {
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

export async function refreshPublicProfile(
  user: UserDocument,
  todayKey: string
): Promise<PublicProfileDocument> {
  const db = await ensureCloud()
  const recent = await fetchCheckins(user.uid, 90)
  const todayRecord = recent.find((item) => item.date === todayKey)
  const streak = computeHitStreak(recent, todayKey)
  const now = db.serverDate ? db.serverDate() : new Date()

  const payload: PublicProfileDocument = {
    _id: user.uid,
    uid: user.uid,
    nickname: user.nickname,
    sleeptime: clampSleeptimeBucket(user.targetHM),
    streak,
    todayStatus: todayRecord?.status ?? 'pending',
    updatedAt: now as unknown as Date
  }

  await getPublicProfilesCollection(db)
    .doc(user.uid)
    .set({
      data: {
        uid: payload.uid,
        nickname: payload.nickname,
        sleeptime: payload.sleeptime,
        streak: payload.streak,
        todayStatus: payload.todayStatus,
        updatedAt: now
      }
    })

  return {
    ...payload,
    updatedAt: new Date()
  }
}

export async function fetchPublicProfiles(uids: string[]): Promise<FriendProfileSnapshot[]> {
  if (!uids.length) {
    return []
  }

  const db = await ensureCloud()
  const command = db.command
  const result = await getPublicProfilesCollection(db)
    .where({
      uid: command.in(uids)
    })
    .get()
  return (result.data ?? []).map((item) => ({
    uid: item.uid,
    nickname: item.nickname,
    sleeptime: item.sleeptime,
    streak: item.streak,
    todayStatus: item.todayStatus,
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt : new Date(item.updatedAt)
  }))
}
