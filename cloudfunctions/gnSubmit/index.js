const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser, quantizeSlotKey } = require('common/users')
const { getTodayFromOffset } = require('common/time')
const { normalizeDateKey } = require('common/checkins')
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
    const normalizedDate = normalizeDateKey(event?.date)
    const defaultDate = getTodayFromOffset(user.tzOffset)
    const targetDate = normalizedDate || defaultDate
    const slotKey = quantizeSlotKey(user.targetHM)
    const collection = db.collection(GN_COLLECTION)
    const docId = `${user.uid}_${targetDate}`
    const docRef = collection.doc(docId)

    let existingId = null

    try {
      const existingDoc = await docRef.get()
      if (existingDoc?.data) {
        existingId = existingDoc.data._id || docId
      }
    } catch (error) {
      const message = typeof error?.errMsg === 'string' ? error.errMsg : ''
      if (message && !/not\s*exist|not\s*found|fail/i.test(message)) {
        throw error
      }
    }

    if (!existingId) {
      const existing = await collection
        .where({ userId: openid, date: targetDate })
        .limit(1)
        .get()
      if (existing.data.length > 0) {
        existingId = existing.data[0]._id
      }
    }

    if (existingId) {
      return {
        code: 'ALREADY_EXISTS',
        messageId: existingId
      }
    }

    const now = db.serverDate()
    await docRef.set({
      data: {
        userId: openid,
        uid: user.uid,
        date: targetDate,
        text,
        content: text,
        slotKey,
        rand: Math.random(),
        likes: 0,
        dislikes: 0,
        score: 0,
        status: 'approved',
        createdAt: now
      }
    })

    return success({ messageId: docId })
  } catch (error) {
    console.error('gnSubmit error', error)
    return failure(error)
  }
}
