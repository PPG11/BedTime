const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser } = require('common/users')
const { buildEdgeId, FRIENDSHIPS_COLLECTION } = require('common/friends')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')

initCloud()

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const targetUid = typeof event?.targetUid === 'string' ? event.targetUid.trim() : ''
    if (!targetUid) {
      throw createError('INVALID_ARG', '缺少目标 UID')
    }

    const db = getDb()
    const edgeId = buildEdgeId(user.uid, targetUid)
    const friendshipRef = db.collection(FRIENDSHIPS_COLLECTION).doc(edgeId)

    try {
      await friendshipRef.remove()
    } catch (error) {
      const msg = error?.errMsg || ''
      if (!/not exist|not found|fail/i.test(msg)) {
        throw error
      }
    }

    return success({ removed: true })
  } catch (error) {
    console.error('friendRemove error', error)
    return failure(error)
  }
}
