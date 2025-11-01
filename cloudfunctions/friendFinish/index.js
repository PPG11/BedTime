const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser } = require('common/users')
const { buildEdgeId, REQUESTS_COLLECTION, FRIENDSHIPS_COLLECTION } = require('common/friends')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')

initCloud()

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const requestId = typeof event?.requestId === 'string' ? event.requestId.trim() : ''
    if (!requestId) {
      throw createError('INVALID_ARG', '缺少申请 ID')
    }

    const db = getDb()
    const requestRef = db.collection(REQUESTS_COLLECTION).doc(requestId)
    const requestSnap = await requestRef.get()
    if (!requestSnap?.data) {
      throw createError('NOT_FOUND', '申请不存在')
    }
    const request = requestSnap.data
    if (request.fromUid !== user.uid) {
      throw createError('UNAUTHORIZED', '无权访问该申请')
    }

    if (request.status === 'accepted') {
      const edgeId = buildEdgeId(request.fromUid, request.toUid)
      const friendshipRef = db.collection(FRIENDSHIPS_COLLECTION).doc(edgeId)
      try {
        const existing = await friendshipRef.get()
        if (!existing?.data) {
          await friendshipRef.set({
            data: {
              _id: edgeId,
              aUid: edgeId.split('#')[0],
              bUid: edgeId.split('#')[1],
              createdAt: db.serverDate()
            }
          })
        }
      } catch (error) {
        const msg = error?.errMsg || ''
        if (!/not exist|not found|fail/i.test(msg)) {
          throw error
        }
        await friendshipRef.set({
          data: {
            _id: edgeId,
            aUid: edgeId.split('#')[0],
            bUid: edgeId.split('#')[1],
            createdAt: db.serverDate()
          }
        })
      }
      return success({ added: true })
    }

    return success({ added: false })
  } catch (error) {
    console.error('friendFinish error', error)
    return failure(error)
  }
}
