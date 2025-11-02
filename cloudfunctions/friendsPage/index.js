const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser } = require('common/users')
const { REQUESTS_COLLECTION, FRIENDSHIPS_COLLECTION } = require('common/friends')
const { success, failure } = require('common/response')

initCloud()

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeRequestRecord(request, map, resolveUidField) {
  const requestId = typeof request?._id === 'string' ? request._id : ''
  const targetUid = resolveUidField(request)
  if (!requestId || !targetUid) {
    return null
  }

  const profile = map.get(targetUid) || null
  const nickname = profile?.nickname || `睡眠伙伴${targetUid.slice(-4)}`
  const targetHM = profile?.targetHM || ''
  const todayStatus = profile?.todayStatus || 'pending'
  const streak = typeof profile?.streak === 'number' ? profile.streak : 0
  const totalDays = typeof profile?.totalDays === 'number' ? profile.totalDays : 0

  return {
    requestId,
    uid: targetUid,
    nickname,
    targetHM,
    todayStatus,
    streak,
    totalDays,
    status: request.status,
    createdAt: request.createdAt || null
  }
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
    const requestsCollection = db.collection(REQUESTS_COLLECTION)
    const _ = db.command

    let whereCondition = _.or([{ aUid: user.uid }, { bUid: user.uid }])
    if (cursorDate) {
      whereCondition = _.and([whereCondition, { createdAt: _.lt(cursorDate) }])
    }

    const [edgesSnapshot, incomingSnapshot, outgoingSnapshot] = await Promise.all([
      friendships
        .where(whereCondition)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get(),
      requestsCollection
        .where({ toUid: user.uid, status: 'pending' })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get(),
      requestsCollection
        .where({ fromUid: user.uid, status: _.in(['pending', 'accepted']) })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
    ])

    const edges = edgesSnapshot.data || []
    const incomingRequests = incomingSnapshot.data || []
    const outgoingRequests = outgoingSnapshot.data || []

    const relatedUids = new Set(
      edges.map((edge) => (edge.aUid === user.uid ? edge.bUid : edge.aUid)).filter(Boolean)
    )
    for (const request of incomingRequests) {
      if (request?.fromUid) {
        relatedUids.add(request.fromUid)
      }
    }
    for (const request of outgoingRequests) {
      if (request?.toUid) {
        relatedUids.add(request.toUid)
      }
    }

    const mapping = new Map()
    const uniqueUids = Array.from(relatedUids)
    if (uniqueUids.length > 0) {
      const CHUNK_LIMIT = 10
      const usersCollection = db.collection('users')
      const queries = []
      for (let i = 0; i < uniqueUids.length; i += CHUNK_LIMIT) {
        const chunk = uniqueUids.slice(i, i + CHUNK_LIMIT)
        queries.push(
          usersCollection
            .where({ uid: _.in(chunk) })
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
        )
      }

      const snapshots = await Promise.all(queries)
      for (const snap of snapshots) {
        for (const item of snap.data || []) {
          mapping.set(item.uid, item)
        }
      }
    }

    const list = edges.map((edge) => {
      const friendUid = edge.aUid === user.uid ? edge.bUid : edge.aUid
      const profile = mapping.get(friendUid) || null
      return {
        uid: friendUid,
        nickname: profile?.nickname || `睡眠伙伴${friendUid.slice(-4)}`,
        targetHM: profile?.targetHM || '',
        slotKey: profile?.slotKey || '',
        todayStatus: profile?.todayStatus || 'pending',
        streak: typeof profile?.streak === 'number' ? profile.streak : 0,
        totalDays: typeof profile?.totalDays === 'number' ? profile.totalDays : 0
      }
    })

    const incoming = incomingRequests
      .map((request) => normalizeRequestRecord(request, mapping, (entry) => entry?.fromUid || ''))
      .filter(Boolean)
    const outgoing = outgoingRequests
      .map((request) => normalizeRequestRecord(request, mapping, (entry) => entry?.toUid || ''))
      .filter(Boolean)

    const lastEdge = edges[edges.length - 1]
    const nextCursor = lastEdge?.createdAt ? new Date(lastEdge.createdAt).toISOString() : null

    return success({
      list,
      nextCursor,
      requests: {
        incoming,
        outgoing
      }
    })
  } catch (error) {
    console.error('friendsPage error', error)
    return failure(error)
  }
}
