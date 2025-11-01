const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser, quantizeSlotKey } = require('common/users')
const { getTodayFromOffset } = require('common/time')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')
const { COLLECTION: GN_COLLECTION } = require('common/goodnight')

initCloud()

function normalizeText(text) {
  if (typeof text !== 'string') {
    return ''
  }
  const trimmed = text.trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.slice(0, 240)
}

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const text = normalizeText(event?.text)
    if (!text) {
      throw createError('INVALID_ARG', '内容不能为空')
    }

    const db = getDb()
    const today = getTodayFromOffset(user.tzOffset)
    const slotKey = quantizeSlotKey(user.targetHM)

    const existing = await db
      .collection(GN_COLLECTION)
      .where({ userId: openid, date: today })
      .limit(1)
      .get()

    if (existing.data.length > 0) {
      return {
        code: 'ALREADY_EXISTS',
        messageId: existing.data[0]._id
      }
    }

    const result = await db.collection(GN_COLLECTION).add({
      data: {
        userId: openid,
        date: today,
        text,
        slotKey,
        rand: Math.random(),
        likes: 0,
        dislikes: 0,
        score: 0,
        status: 'approved',
        createdAt: db.serverDate()
      }
    })

    return success({ messageId: result._id })
  } catch (error) {
    console.error('gnSubmit error', error)
    return failure(error)
  }
}
