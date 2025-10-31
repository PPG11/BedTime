const { initCloud, getOpenId, getDb } = require('../common/cloud')
const { ensureUser, computeCheckinSummary } = require('../common/users')
const { getTodayFromOffset } = require('../common/time')
const { buildDocId, getCheckin, createCheckin } = require('../common/checkins')
const { pickRandomMessage } = require('../common/goodnight')
const { createError } = require('../common/errors')
const { success, failure } = require('../common/response')

initCloud()

const VALID_STATUS = new Set(['hit', 'pending'])

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const status = typeof event?.status === 'string' ? event.status.trim() : ''
    if (!VALID_STATUS.has(status)) {
      throw createError('INVALID_ARG', '非法的打卡状态')
    }

    const user = await ensureUser(openid)
    const today = getTodayFromOffset(user.tzOffset)
    const docId = buildDocId(user.uid, today)

    const existing = await getCheckin(user.uid, today)
    if (existing) {
      return {
        code: 'ALREADY_EXISTS',
        record: existing,
        summary: {
          date: existing.date,
          status: existing.status,
          gnMsgId: existing.gnMsgId || null,
          streak: user.streak,
          totalDays: user.totalDays,
          todayStatus: user.todayStatus,
          slotKey: user.slotKey
        }
      }
    }

    let messageId = null
    try {
      const message = await pickRandomMessage({
        avoidUserId: openid,
        slotKey: user.slotKey,
        minScore: typeof event?.minScore === 'number' ? event.minScore : -2
      })
      messageId = message?._id || null
    } catch (messageError) {
      console.warn('checkinSubmit pick message failed', messageError)
      messageId = null
    }

    const record = {
      _id: docId,
      uid: user.uid,
      date: today,
      status,
      gnMsgId: messageId,
      createdAt: getDb().serverDate()
    }

    try {
      await createCheckin(record)
    } catch (error) {
      const msg = error?.errMsg || ''
      if (/already exist/i.test(msg)) {
        const latest = await getCheckin(user.uid, today)
        return {
          code: 'ALREADY_EXISTS',
          record: latest,
          summary: {
            date: latest.date,
            status: latest.status,
            gnMsgId: latest.gnMsgId || null,
            streak: user.streak,
            totalDays: user.totalDays,
            todayStatus: user.todayStatus,
            slotKey: user.slotKey
          }
        }
      }
      throw error
    }

    const db = getDb()
    const summary = computeCheckinSummary(user, status, today)
    await db.collection('users').doc(openid).update({
      data: summary
    })

    const response = {
      date: today,
      status,
      gnMsgId: messageId,
      streak: summary.streak,
      totalDays: summary.totalDays,
      todayStatus: summary.todayStatus,
      slotKey: summary.slotKey
    }
    return success(response)
  } catch (error) {
    console.error('checkinSubmit error', error)
    return failure(error)
  }
}
