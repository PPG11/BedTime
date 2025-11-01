const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser, getUserByUid } = require('common/users')
const { ensureNotFriends, REQUESTS_COLLECTION } = require('common/friends')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')

initCloud()

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const fromUser = await ensureUser(openid)
    const toUid = typeof event?.toUid === 'string' ? event.toUid.trim() : ''
    if (!toUid) {
      throw createError('INVALID_ARG', '缺少目标 UID')
    }
    if (toUid === fromUser.uid) {
      throw createError('INVALID_ARG', '不能向自己发起申请')
    }

    const targetUser = await getUserByUid(toUid)
    await ensureNotFriends(fromUser.uid, targetUser.uid)

    const db = getDb()
    const requests = db.collection(REQUESTS_COLLECTION)
    const existing = await requests
      .where({ fromUid: fromUser.uid, toUid: targetUser.uid, status: 'pending' })
      .limit(1)
      .get()
    if (existing.data.length > 0) {
      throw createError('ALREADY_EXISTS', '已有待处理申请')
    }

    const result = await requests.add({
      data: {
        fromUid: fromUser.uid,
        toUid: targetUser.uid,
        status: 'pending',
        createdAt: db.serverDate()
      }
    })

    return success({ requestId: result._id })
  } catch (error) {
    console.error('friendRequestSend error', error)
    return failure(error)
  }
}
