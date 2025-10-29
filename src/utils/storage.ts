import Taro from '@tarojs/taro'
import { normalizeDateKey } from './checkin'

export type CheckInMap = Record<string, number>

export type UserSettings = {
  name: string
  targetSleepMinute: number
}

const STORAGE_KEYS = {
  checkIns: 'bedtime-checkins',
  settings: 'bedtime-user-settings',
  uid: 'bedtime-user-uid',
  friends: 'bedtime-friends'
} as const

export const DEFAULT_SLEEP_MINUTE = 22 * 60 + 30 // 22:30
export const DEFAULT_USER_NAME = '七月博士'

function isRecordMap(value: unknown): value is CheckInMap {
  return Boolean(value) && typeof value === 'object'
}

function normalizeCheckInMapKeys(source: CheckInMap): CheckInMap {
  const entries = Object.entries(source)
  if (!entries.length) {
    return {}
  }
  return entries.reduce<CheckInMap>((acc, [key, value]) => {
    const normalizedKey = normalizeDateKey(key)
    if (normalizedKey) {
      acc[normalizedKey] = value
    } else if (typeof key === 'string' && key.length) {
      acc[key] = value
    }
    return acc
  }, {})
}

export function readCheckIns(): CheckInMap {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEYS.checkIns) as CheckInMap | undefined
    if (isRecordMap(stored)) {
      return normalizeCheckInMapKeys(stored)
    }
  } catch (error) {
    console.warn('读取早睡打卡数据失败', error)
  }
  return {}
}

export function saveCheckIns(next: CheckInMap): void {
  try {
    const normalized = normalizeCheckInMapKeys(next)
    Taro.setStorageSync(STORAGE_KEYS.checkIns, normalized)
  } catch (error) {
    console.warn('保存早睡打卡数据失败', error)
  }
}

export function readSettings(): UserSettings {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEYS.settings) as Partial<UserSettings> | undefined
    if (stored && typeof stored === 'object') {
      return {
        name:
          typeof stored.name === 'string' && stored.name.length
            ? stored.name
            : DEFAULT_USER_NAME,
        targetSleepMinute:
          typeof stored.targetSleepMinute === 'number'
            ? stored.targetSleepMinute
            : DEFAULT_SLEEP_MINUTE
      }
    }
  } catch (error) {
    console.warn('读取用户设置信息失败', error)
  }

  return {
    name: DEFAULT_USER_NAME,
    targetSleepMinute: DEFAULT_SLEEP_MINUTE
  }
}

export function saveSettings(next: UserSettings): void {
  try {
    Taro.setStorageSync(STORAGE_KEYS.settings, next)
  } catch (error) {
    console.warn('保存用户设置信息失败', error)
  }
}

export type FriendProfile = {
  uid: string
  remark?: string
}

function isFriendProfile(value: unknown): value is FriendProfile {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Partial<FriendProfile>
  return typeof record.uid === 'string'
}

export function readFriends(): FriendProfile[] {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEYS.friends) as FriendProfile[] | undefined
    if (Array.isArray(stored)) {
      return stored.filter(isFriendProfile)
    }
  } catch (error) {
    console.warn('读取好友列表失败', error)
  }
  return []
}

export function saveFriends(list: FriendProfile[]): void {
  try {
    Taro.setStorageSync(STORAGE_KEYS.friends, list)
  } catch (error) {
    console.warn('保存好友列表失败', error)
  }
}

function generateUid(): string {
  return `${Math.floor(Math.random() * 100_000_000)}`.padStart(8, '0')
}

export function ensureUserUid(): string {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEYS.uid) as string | undefined
    if (typeof stored === 'string' && /^\d{8}$/.test(stored)) {
      return stored
    }
  } catch (error) {
    console.warn('读取用户 UID 失败', error)
  }

  const next = generateUid()
  try {
    Taro.setStorageSync(STORAGE_KEYS.uid, next)
  } catch (error) {
    console.warn('保存用户 UID 失败', error)
  }
  return next
}

export function readUserUid(): string {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEYS.uid) as string | undefined
    if (typeof stored === 'string' && /^\d{8}$/.test(stored)) {
      return stored
    }
  } catch (error) {
    console.warn('读取用户 UID 失败', error)
  }
  return ensureUserUid()
}
