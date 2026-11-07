import { callCloud } from './cloud'

export type UserDocument = {
  uid: string
  nickname: string
  tzOffset: number
  targetHM: string
  totalDays: number
  streak: number
  lastCheckinDate: string
}

export type UserUpsertPayload = {
  nickname?: string
  targetHM?: string
}

export function ensureCurrentUser(): Promise<UserDocument> {
  return callCloud('bedtimeUser', 'bootstrap', { tzOffset: -new Date().getTimezoneOffset() })
}

export function updateCurrentUser(patch: UserUpsertPayload): Promise<UserDocument> {
  return callCloud('bedtimeUser', 'updateProfile', patch)
}
