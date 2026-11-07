import type { CheckinStatus, FriendsOverview } from '../../services/index'
import type { FriendProfile } from '../../utils/storage'

export type FriendItem = {
  uid: string
  relationshipId: string
  nickname: string
  displayName: string
  remark: string
  streak: number
  todayStatus: CheckinStatus
  todayStatusLabel: string
  sleeptime: string
  updatedAtLabel: string
}

export type RequestItem = {
  requestId: string
  uid: string
  nickname: string
  updatedAtLabel: string
  statusLabel: string
}

const statusLabels: Record<CheckinStatus, string> = {
  hit: '✅ 今日按时完成打卡',
  late: '⌛ 今日稍晚完成打卡',
  miss: '今日尚未达标',
  pending: '等待打卡'
}

function formatUpdatedAt(date: Date): string {
  return `${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`
}

export function buildFriendItems(
  summaries: FriendsOverview['friends'],
  aliases: FriendProfile[],
  updatedAt = new Date()
): FriendItem[] {
  const aliasMap = new Map(aliases.map((item) => [item.uid, item.remark?.trim() ?? '']))
  return summaries.map((summary) => {
    const nickname = summary.nickname || `早睡伙伴 ${summary.uid.slice(-4)}`
    const remark = aliasMap.get(summary.uid) ?? ''
    return {
      uid: summary.uid,
      relationshipId: summary.relationshipId,
      nickname,
      displayName: remark || nickname,
      remark,
      streak: summary.streak,
      todayStatus: summary.todayStatus,
      todayStatusLabel: statusLabels[summary.todayStatus] ?? statusLabels.pending,
      sleeptime: summary.targetHM || '22:30',
      updatedAtLabel: formatUpdatedAt(updatedAt)
    }
  })
}

export function buildRequestItems(requests: FriendsOverview['requests']['incoming']): RequestItem[] {
  return requests.map((request) => ({
    requestId: request.requestId,
    uid: request.uid,
    nickname: request.nickname || `早睡伙伴 ${request.uid.slice(-4)}`,
    updatedAtLabel: request.createdAt ? formatUpdatedAt(request.createdAt) : '未知',
    statusLabel: '等待对方同意'
  }))
}

export function mergeFriendItems(current: FriendItem[], incoming: FriendItem[]): FriendItem[] {
  const byUid = new Map(current.map((item) => [item.uid, item]))
  incoming.forEach((item) => byUid.set(item.uid, item))
  return Array.from(byUid.values())
}
