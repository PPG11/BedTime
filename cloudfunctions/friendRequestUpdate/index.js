const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser } = require('common/users')
const { buildEdgeId, REQUESTS_COLLECTION, FRIENDSHIPS_COLLECTION } = require('common/friends')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')

initCloud()

const DECISIONS = new Set(['accepted', 'rejected'])

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const requestId = typeof event?.requestId === 'string' ? event.requestId.trim() : ''
    const decision = typeof event?.decision === 'string' ? event.decision.trim() : ''

    if (!requestId) {
      throw createError('INVALID_ARG', '缺少申请 ID')
    }
    if (!DECISIONS.has(decision)) {
      throw createError('INVALID_ARG', '非法的处理决定')
    }

    const db = getDb()

    const result = await db.runTransaction(async (transaction) => {
      const requestRef = transaction.collection(REQUESTS_COLLECTION).doc(requestId)
      const requestSnap = await requestRef.get()
      if (!requestSnap?.data) {
        throw createError('NOT_FOUND', '申请不存在')
      }
      const request = requestSnap.data
      if (request.toUid !== user.uid) {
        throw createError('UNAUTHORIZED', '无权处理该申请')
      }
      if (request.status !== 'pending') {
        return { status: request.status }
      }

      if (decision === 'accepted') {
        const edgeId = buildEdgeId(request.fromUid, request.toUid)
        const friendshipRef = transaction.collection(FRIENDSHIPS_COLLECTION).doc(edgeId)
        const friendshipSnap = await friendshipRef.get()
        if (!friendshipSnap?.data) {
          await friendshipRef.set({
            data: {
              _id: edgeId,
              aUid: edgeId.split('#')[0],
              bUid: edgeId.split('#')[1],
              createdAt: db.serverDate()
            }
          })
        }
        await requestRef.update({ data: { status: 'accepted' } })
        return { status: 'accepted' }
      }

      await requestRef.update({ data: { status: 'rejected' } })
      return { status: 'rejected' }
    })

    return success(result)
  } catch (error) {
    console.error('friendRequestUpdate error', error)
    return failure(error)
  }
}
