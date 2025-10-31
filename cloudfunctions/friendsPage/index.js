const { initCloud, getOpenId, getDb } = require('../common/cloud')
const { ensureUser } = require('../common/users')
const { FRIENDSHIPS_COLLECTION } = require('../common/friends')
const { success, failure } = require('../common/response')

initCloud()

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const params = typeof event === 'object' && event ? event : {}

    let limit = Number.isFinite(params.limit) ? Math.trunc(params.limit) : 20
    if (limit <= 0) limit = 20
    if (limit > 50) limit = 50

    const cursorDate = toDate(params.cursor)

    const db = getDb()
    const friendships = db.collection(FRIENDSHIPS_COLLECTION)
    const _ = db.command

    let whereCondition = _.or([{ aUid: user.uid }, { bUid: user.uid }])
    if (cursorDate) {
      whereCondition = _.and([whereCondition, { createdAt: _.lt(cursorDate) }])
    }

    const snapshot = await friendships
      .where(whereCondition)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()

    const edges = snapshot.data || []
    if (edges.length === 0) {
      return success({ list: [], nextCursor: null })
    }

    const friendUids = edges.map((edge) => (edge.aUid === user.uid ? edge.bUid : edge.aUid))
    const usersCollection = db.collection('users')
    const usersSnapshot = await usersCollection
      .where({ uid: _.in(friendUids) })
      .field({
        uid: true,
        nickname: true,
        targetHM: true,
        slotKey: true,
        todayStatus: true,
        streak: true,
        totalDays: true
      })
      .get()

    const mapping = new Map()
    for (const item of usersSnapshot.data || []) {
      mapping.set(item.uid, item)
    }

    const list = edges
      .map((edge) => {
        const friendUid = edge.aUid === user.uid ? edge.bUid : edge.aUid
        const profile = mapping.get(friendUid)
        if (!profile) {
          return null
        }
        return {
          uid: profile.uid,
          nickname: profile.nickname,
          targetHM: profile.targetHM,
          slotKey: profile.slotKey,
          todayStatus: profile.todayStatus,
          streak: profile.streak,
          totalDays: profile.totalDays
        }
      })
      .filter(Boolean)

    const lastEdge = edges[edges.length - 1]
    const nextCursor = lastEdge?.createdAt ? new Date(lastEdge.createdAt).toISOString() : null

    return success({ list, nextCursor })
  } catch (error) {
    console.error('friendsPage error', error)
    return failure(error)
  }
}
