import { COLLECTIONS } from '../config/cloud'
import { formatMinutesToTime, parseTimeStringToMinutes } from '../utils/time'
import { ensureCloud, type CloudDatabase, type DbCollection } from './cloud'
import { fetchCheckins, type CheckinStatus, computeHitStreak } from './checkin'
import type { UserDocument } from './user'

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

function getPublicProfilesCollection(db: CloudDatabase): DbCollection<PublicProfileDocument> {
  return db.collection<PublicProfileDocument>(COLLECTIONS.publicProfiles)
}

function clampSleeptimeBucket(targetHM: string): string {
  const minutes = parseTimeStringToMinutes(targetHM, 22 * 60 + 30)
  const bucket = Math.round(minutes / 30) * 30
  return formatMinutesToTime(bucket)
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
