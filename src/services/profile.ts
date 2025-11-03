import { COLLECTIONS } from '../config/cloud'
import { clampSleeptimeBucket } from '../utils/sleep'
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
        updatedAt: now as unknown as Date
      }
    })

  return {
    ...payload,
    updatedAt: new Date()
  }
}

export async function fetchPublicProfiles(uids: string[]): Promise<FriendProfileSnapshot[]> {
  const uniqueUids = Array.from(new Set(uids.filter((uid) => typeof uid === 'string' && uid)))
  if (!uniqueUids.length) {
    return []
  }

  const db = await ensureCloud()
  const collection = getPublicProfilesCollection(db)

  const snapshots = await Promise.allSettled(
    uniqueUids.map(async (uid) => {
      try {
        const result = await collection.doc(uid).get()
        const data = result.data
        if (!data) {
          console.warn('未找到好友公开资料', uid)
          return null
        }

        const normalizedUid = typeof data.uid === 'string' && data.uid.length ? data.uid : uid
        const updatedAt =
          data.updatedAt instanceof Date ? data.updatedAt : new Date(data.updatedAt ?? Date.now())

        return {
          uid: normalizedUid,
          nickname: typeof data.nickname === 'string' ? data.nickname : '',
          sleeptime: typeof data.sleeptime === 'string' ? data.sleeptime : '',
          streak: typeof data.streak === 'number' ? data.streak : 0,
          todayStatus: (data.todayStatus as CheckinStatus) ?? 'pending',
          updatedAt
        } satisfies FriendProfileSnapshot
      } catch (error) {
        console.warn('获取好友公开资料失败', uid, error)
        return null
      }
    })
  )

  const records: FriendProfileSnapshot[] = []
  for (const snapshot of snapshots) {
    if (snapshot.status === 'fulfilled' && snapshot.value) {
      records.push(snapshot.value)
    }
  }

  return records
}
