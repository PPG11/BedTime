import { COLLECTIONS } from '../config/cloud'
import { clampSleeptimeBucket } from '../utils/sleep'
import { coerceDate, normalizeNumber, normalizeString } from '../utils/normalize'
import { formatMinutesToTime, parseTimeStringToMinutes } from '../utils/time'
import {
  callCloudFunction,
  ensureCloud,
  getCurrentOpenId,
  type CloudDatabase,
  type DbCollection
} from './cloud'

export type UserTodayStatus = 'hit' | 'late' | 'miss' | 'pending' | 'none'

export type UserDocument = {
  _id: string
  uid: string
  nickname: string
  tzOffset: number
  targetHM: string
  slotKey: string
  todayStatus: UserTodayStatus
  streak: number
  totalDays: number
  lastCheckinDate: string
  createdAt: Date
}

export type UserUpsertPayload = {
  nickname?: string
  targetHM?: string
  tzOffset?: number
}

type CloudServerDate = ReturnType<NonNullable<CloudDatabase['serverDate']>>

type CloudUserEnsureResponse = {
  code?: string
  message?: string
  uid?: string
  nickname?: string
  tzOffset?: number
  targetHM?: string
  slotKey?: string
  todayStatus?: string
  streak?: number
  totalDays?: number
  lastCheckinDate?: string
  createdAt?: Date | string | number | Record<string, unknown>
}

type UserRecord = {
  uid?: string
  nickname?: string
  tzOffset?: number
  targetHM?: string
  slotKey?: string
  todayStatus?: string
  streak?: number
  totalDays?: number
  lastCheckinDate?: string
  createdAt?: Date | string | number | Record<string, unknown>
  updatedAt?: Date | string | number | Record<string, unknown>
}

type PublicProfileRecord = {
  uid: string
  nickname: string
  sleeptime: string
  streak: number
  todayStatus: string
  updatedAt: Date | string | number | Record<string, unknown>
}

const DEFAULT_TARGET_HM = '22:30'
const VALID_STATUS_SET = new Set<UserTodayStatus>(['hit', 'late', 'miss', 'pending', 'none'])

function normalizeTodayStatus(value: unknown): UserTodayStatus {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (VALID_STATUS_SET.has(normalized as UserTodayStatus)) {
      return normalized as UserTodayStatus
    }
  }
  return 'none'
}

function mapUserResponse(openid: string, payload: CloudUserEnsureResponse | null | undefined): UserDocument {
  if (!payload) {
    throw new Error('未获取到用户资料')
  }

  const uid = normalizeString(payload.uid)
  if (!uid) {
    throw new Error('用户 UID 缺失')
  }

  const nickname = normalizeString(payload.nickname, `睡眠伙伴${uid.slice(-4)}`)
  const tzOffset = typeof payload.tzOffset === 'number' ? payload.tzOffset : 8 * 60
  const targetHM = normalizeString(payload.targetHM, DEFAULT_TARGET_HM)
  const slotKey = normalizeString(payload.slotKey, targetHM)
  const todayStatus = normalizeTodayStatus(payload.todayStatus)
  const streak = normalizeNumber(payload.streak) ?? 0
  const totalDays = normalizeNumber(payload.totalDays) ?? 0
  const lastCheckinDate = normalizeString(payload.lastCheckinDate)
  const createdAt = coerceDate(payload.createdAt) ?? new Date()

  return {
    _id: openid,
    uid,
    nickname,
    tzOffset,
    targetHM,
    slotKey,
    todayStatus,
    streak,
    totalDays,
    lastCheckinDate,
    createdAt
  }
}

function getUsersCollection(db: CloudDatabase): DbCollection<UserRecord> {
  return db.collection<UserRecord>(COLLECTIONS.users)
}

function getPublicProfilesCollection(db: CloudDatabase): DbCollection<PublicProfileRecord> {
  return db.collection<PublicProfileRecord>(COLLECTIONS.publicProfiles)
}

async function syncPublicProfileBasics(
  db: CloudDatabase,
  user: UserDocument,
  timestamp: Date | CloudServerDate
): Promise<void> {
  const collection = getPublicProfilesCollection(db)
  const doc = collection.doc(user.uid)

  const updatePayload = {
    uid: user.uid,
    nickname: user.nickname,
    sleeptime: clampSleeptimeBucket(user.targetHM),
    streak: user.streak,
    todayStatus: user.todayStatus,
    updatedAt: timestamp as unknown as Date
  }

  try {
    await doc.update({
      data: {
        nickname: updatePayload.nickname,
        sleeptime: updatePayload.sleeptime,
        streak: updatePayload.streak,
        todayStatus: updatePayload.todayStatus,
        updatedAt: updatePayload.updatedAt
      }
    })
  } catch (error) {
    console.warn('更新公开资料失败，尝试创建新记录', error)
    await doc.set({
      data: updatePayload
    })
  }
}

export async function fetchCurrentUser(): Promise<UserDocument | null> {
  try {
    return await ensureCurrentUser()
  } catch (error) {
    console.error('读取用户信息失败', error)
    return null
  }
}

export async function ensureCurrentUser(overrides?: UserUpsertPayload): Promise<UserDocument> {
  const openid = await getCurrentOpenId()
  const response = await callCloudFunction<CloudUserEnsureResponse>({
    name: 'userEnsure',
    data: overrides && Object.keys(overrides).length ? overrides : undefined
  })

  const code = typeof response?.code === 'string' ? response.code : 'OK'
  if (code !== 'OK') {
    const message =
      typeof response?.message === 'string' && response.message.length
        ? response.message
        : '确保用户资料失败'
    throw new Error(message)
  }

  return mapUserResponse(openid, response)
}

export async function updateCurrentUser(patch: UserUpsertPayload): Promise<UserDocument> {
  const db = await ensureCloud()
  const openid = await getCurrentOpenId()

  const sanitized: Record<string, unknown> = {}

  if (typeof patch.nickname === 'string') {
    const trimmed = patch.nickname.trim()
    if (trimmed.length) {
      sanitized.nickname = trimmed
    }
  }

  if (typeof patch.targetHM === 'string') {
    const minutes = parseTimeStringToMinutes(patch.targetHM, 22 * 60 + 30)
    const normalized = formatMinutesToTime(minutes)
    sanitized.targetHM = normalized
    sanitized.slotKey = clampSleeptimeBucket(normalized)
  }

  if (typeof patch.tzOffset === 'number') {
    if (Number.isFinite(patch.tzOffset)) {
      sanitized.tzOffset = Math.trunc(patch.tzOffset)
    }
  }

  if (!Object.keys(sanitized).length) {
    return ensureCurrentUser()
  }

  const now = db.serverDate ? db.serverDate() : new Date()

  await getUsersCollection(db)
    .doc(openid)
    .update({
      data: {
        ...sanitized,
        updatedAt: now as unknown as Date
      }
    })

  const updated = await ensureCurrentUser()

  if ('nickname' in sanitized || 'targetHM' in sanitized) {
    try {
      await syncPublicProfileBasics(db, updated, now)
    } catch (error) {
      console.warn('同步公开资料失败', error)
    }
  }

  return updated
}
