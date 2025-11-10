import { callCloudFunction } from './cloud'
import type { CheckinStatus } from './checkin'

export type FriendSummary = {
  uid: string
  nickname: string
  targetHM: string
  slotKey: string
  todayStatus: CheckinStatus
  streak: number
  totalDays: number
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected'

export type FriendRequestSummary = {
  requestId: string
  uid: string
  nickname: string
  targetHM: string
  todayStatus: CheckinStatus
  streak: number
  totalDays: number
  status: FriendRequestStatus
  createdAt: Date | null
}

export type FriendsOverview = {
  friends: FriendSummary[]
  requests: {
    incoming: FriendRequestSummary[]
    outgoing: FriendRequestSummary[]
  }
  nextCursor: string | null
}

type FriendsPageFunctionResponse = {
  code?: string
  message?: string
  list?: Array<{
    uid?: string
    nickname?: string
    targetHM?: string
    slotKey?: string
    todayStatus?: string
    streak?: number
    totalDays?: number
  }>
  nextCursor?: string | null
  requests?: {
    incoming?: Array<{
      requestId?: string
      uid?: string
      nickname?: string
      targetHM?: string
      todayStatus?: string
      streak?: number
      totalDays?: number
      status?: string
      createdAt?: Date | string | number | Record<string, unknown>
    }>
    outgoing?: Array<{
      requestId?: string
      uid?: string
      nickname?: string
      targetHM?: string
      todayStatus?: string
      streak?: number
      totalDays?: number
      status?: string
      createdAt?: Date | string | number | Record<string, unknown>
    }>
  }
}

type FriendRequestSendResponse = {
  code?: string
  message?: string
  requestId?: string
}

type FriendRequestUpdateResponse = {
  code?: string
  message?: string
  status?: string
}

type FriendFinishResponse = {
  code?: string
  message?: string
  added?: boolean
}

type FriendRemoveResponse = {
  code?: string
  message?: string
  removed?: boolean
}

const VALID_STATUS_SET = new Set<CheckinStatus>(['hit', 'late', 'miss', 'pending'])
const VALID_REQUEST_STATUS_SET = new Set<FriendRequestStatus>(['pending', 'accepted', 'rejected'])

function normalizeStatus(value: unknown): CheckinStatus {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (VALID_STATUS_SET.has(normalized as CheckinStatus)) {
      return normalized as CheckinStatus
    }
  }
  return 'pending'
}

function normalizeRequestStatus(value: unknown): FriendRequestStatus {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (VALID_REQUEST_STATUS_SET.has(normalized as FriendRequestStatus)) {
      return normalized as FriendRequestStatus
    }
  }
  return 'pending'
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value
  }
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const converted = (value as { toDate: () => Date }).toDate()
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return converted
      }
    } catch {
      // ignore
    }
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return null
}

function normalizeString(value: unknown, fallback: string | undefined): string {
  const resolvedFallback = typeof fallback === 'string' ? fallback : ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length) {
      return trimmed
    }
  }
  return resolvedFallback
}

function normalizeNumber(value: unknown, fallback: number | undefined): number {
  const resolvedFallback = typeof fallback === 'number' ? fallback : 0
  if (Number.isFinite(value)) {
    return Math.trunc(value as number)
  }
  return resolvedFallback
}

function mapFriendList(list: FriendsPageFunctionResponse['list']): FriendSummary[] {
  if (!Array.isArray(list) || !list.length) {
    return []
  }

  return list
    .map((entry) => {
      const uid = normalizeString(entry?.uid, undefined)
      if (!uid) {
        return null
      }

      return {
        uid,
        nickname: normalizeString(entry?.nickname, `睡眠伙伴${uid.slice(-4)}`),
        targetHM: normalizeString(entry?.targetHM, undefined),
        slotKey: normalizeString(
          entry?.slotKey,
          normalizeString(entry?.targetHM, undefined)
        ),
        todayStatus: normalizeStatus(entry?.todayStatus),
        streak: Math.max(0, normalizeNumber(entry?.streak, undefined)),
        totalDays: Math.max(0, normalizeNumber(entry?.totalDays, undefined))
      } satisfies FriendSummary
    })
    .filter((item): item is FriendSummary => Boolean(item))
}

function mapRequests(list: FriendsPageFunctionResponse['requests']): {
  incoming: FriendRequestSummary[]
  outgoing: FriendRequestSummary[]
} {
  type RequestEntry = NonNullable<FriendsPageFunctionResponse['requests']>['incoming'][number]

  const mapList = (entries: Array<RequestEntry> | undefined) => {
    if (!Array.isArray(entries) || !entries.length) {
      return []
    }

    return entries
      .map((entry) => {
        const requestId = normalizeString(entry?.requestId, undefined)
        const uid = normalizeString(entry?.uid, undefined)
        if (!requestId || !uid) {
          return null
        }

        return {
          requestId,
          uid,
          nickname: normalizeString(entry?.nickname, `睡眠伙伴${uid.slice(-4)}`),
          targetHM: normalizeString(entry?.targetHM, undefined),
          todayStatus: normalizeStatus(entry?.todayStatus),
          streak: Math.max(0, normalizeNumber(entry?.streak, undefined)),
          totalDays: Math.max(0, normalizeNumber(entry?.totalDays, undefined)),
          status: normalizeRequestStatus(entry?.status),
          createdAt: toDate(entry?.createdAt)
        } satisfies FriendRequestSummary
      })
      .filter((item): item is FriendRequestSummary => Boolean(item))
  }

  return {
    incoming: mapList(list?.incoming),
    outgoing: mapList(list?.outgoing)
  }
}

export async function fetchFriendsOverview(
  options: { limit?: number; cursor?: string | null } | undefined
): Promise<FriendsOverview> {
  const resolvedOptions = options ?? {}
  const response = await callCloudFunction<FriendsPageFunctionResponse>({
    name: 'friendsPage',
    data: {
      limit: Number.isFinite(resolvedOptions.limit)
        ? Math.trunc(resolvedOptions.limit as number)
        : undefined,
      cursor:
        typeof resolvedOptions.cursor === 'string' && resolvedOptions.cursor.trim().length
          ? resolvedOptions.cursor
          : undefined
    }
  })

  const code = typeof response?.code === 'string' ? response.code : 'OK'
  if (code !== 'OK') {
    const message =
      typeof response?.message === 'string' && response.message.length
        ? response.message
        : '读取好友信息失败'
    throw new Error(message)
  }

  const friends = mapFriendList(response?.list)
  const requests = mapRequests(response?.requests)
  const nextCursor =
    typeof response?.nextCursor === 'string' && response.nextCursor.length ? response.nextCursor : null

  return {
    friends,
    requests,
    nextCursor
  }
}

export async function sendFriendRequest(toUid: string): Promise<{ requestId: string }> {
  const normalized = normalizeString(toUid, undefined)
  if (!/^[0-9A-Za-z]{6,12}$/.test(normalized)) {
    throw new Error('缺少有效的好友 UID')
  }

  const response = await callCloudFunction<FriendRequestSendResponse>({
    name: 'friendRequestSend',
    data: { toUid: normalized }
  })

  const code = typeof response?.code === 'string' ? response.code : 'OK'
  if (code !== 'OK') {
    const message =
      typeof response?.message === 'string' && response.message.length
        ? response.message
        : '发送好友申请失败'
    throw new Error(message)
  }

  const requestId = normalizeString(response?.requestId, undefined)
  if (!requestId) {
    throw new Error('发送好友申请失败：缺少申请标识')
  }

  return { requestId }
}

export async function respondFriendRequest(
  requestId: string,
  accept: boolean
): Promise<FriendRequestStatus> {
  const normalizedId = normalizeString(requestId, undefined)
  if (!normalizedId) {
    throw new Error('缺少好友申请标识')
  }

  const decision: FriendRequestStatus = accept ? 'accepted' : 'rejected'

  const response = await callCloudFunction<FriendRequestUpdateResponse>({
    name: 'friendRequestUpdate',
    data: { requestId: normalizedId, decision }
  })

  const code = typeof response?.code === 'string' ? response.code : 'OK'
  if (code !== 'OK') {
    const message =
      typeof response?.message === 'string' && response.message.length
        ? response.message
        : '处理好友申请失败'
    throw new Error(message)
  }

  return normalizeRequestStatus(response?.status)
}

export async function confirmFriendRequest(requestId: string): Promise<boolean> {
  const normalizedId = normalizeString(requestId, undefined)
  if (!normalizedId) {
    throw new Error('缺少好友申请标识')
  }

  const response = await callCloudFunction<FriendFinishResponse>({
    name: 'friendFinish',
    data: { requestId: normalizedId }
  })

  const code = typeof response?.code === 'string' ? response.code : 'OK'
  if (code !== 'OK') {
    const message =
      typeof response?.message === 'string' && response.message.length
        ? response.message
        : '确认好友关系失败'
    throw new Error(message)
  }

  return Boolean(response?.added)
}

export async function removeFriend(targetUid: string): Promise<void> {
  const normalized = normalizeString(targetUid, undefined)
  if (!normalized) {
    throw new Error('缺少好友 UID')
  }

  const response = await callCloudFunction<FriendRemoveResponse>({
    name: 'friendRemove',
    data: { targetUid: normalized }
  })

  const code = typeof response?.code === 'string' ? response.code : 'OK'
  if (code !== 'OK') {
    const message =
      typeof response?.message === 'string' && response.message.length
        ? response.message
        : '解除好友失败'
    throw new Error(message)
  }

  if (!response?.removed) {
    throw new Error('解除好友失败，请稍后重试')
  }
}
