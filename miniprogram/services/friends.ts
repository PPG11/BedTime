import { coerceDate } from '../utils/normalize'
import type { CheckinStatus } from './checkin'
import { callCloud } from './cloud'

export type FriendSummary = {
  uid: string
  relationshipId: string
  nickname: string
  targetHM: string
  todayStatus: CheckinStatus
  streak: number
}

export type FriendRequestSummary = {
  requestId: string
  uid: string
  nickname: string
  createdAt: Date | null
}

export type FriendsOverview = {
  friends: FriendSummary[]
  requests: { incoming: FriendRequestSummary[]; outgoing: FriendRequestSummary[] }
  nextCursor: string | null
}

type CloudRequest = Omit<FriendRequestSummary, 'createdAt'> & { createdAt: unknown }

export async function fetchFriendsOverview(options: { cursor?: string }): Promise<FriendsOverview> {
  const result = await callCloud<{
    list: FriendSummary[]
    requests: { incoming: CloudRequest[]; outgoing: CloudRequest[] }
    nextCursor: string | null
  }>('bedtimeFriends', 'overview', options)
  const toRequest = ({ createdAt, ...request }: CloudRequest) => ({ ...request, createdAt: coerceDate(createdAt) })
  return {
    friends: result.list,
    nextCursor: result.nextCursor,
    requests: { incoming: result.requests.incoming.map(toRequest), outgoing: result.requests.outgoing.map(toRequest) }
  }
}

export function sendFriendRequest(toUid: string): Promise<{ requestId: string }> {
  return callCloud('bedtimeFriends', 'send', { toUid })
}

export async function respondFriendRequest(requestId: string, accept: boolean): Promise<'accepted' | 'rejected'> {
  const { status } = await callCloud<{ status: 'accepted' | 'rejected' }>('bedtimeFriends', 'respond', {
    requestId, decision: accept ? 'accepted' : 'rejected'
  })
  return status
}

export async function removeFriend(targetUid: string, relationshipId: string): Promise<void> {
  await callCloud('bedtimeFriends', 'remove', { targetUid, relationshipId })
}
