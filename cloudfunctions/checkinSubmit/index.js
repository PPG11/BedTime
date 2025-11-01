const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser, computeCheckinSummary } = require('common/users')
const { getTodayFromOffset } = require('common/time')
const { buildDocId, getCheckin, createCheckin } = require('common/checkins')
const { pickRandomMessage } = require('common/goodnight')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')

initCloud()

const VALID_STATUS = new Set(['hit', 'late'])

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const status = typeof event?.status === 'string' ? event.status.trim() : ''
    if (!VALID_STATUS.has(status)) {
      throw createError('INVALID_ARG', '非法的打卡状态')
    }

    const requestedGnMsgId =
      typeof event?.gnMsgId === 'string' && event.gnMsgId.trim().length
        ? event.gnMsgId.trim()
        : null

    const user = await ensureUser(openid)
    const db = getDb()
    const today = getTodayFromOffset(user.tzOffset)
    const docId = buildDocId(user.uid, today)

    const existing = await getCheckin(user.uid, today)
    if (existing) {
      const hasExistingGnMsgId =
        typeof existing.gnMsgId === 'string' && existing.gnMsgId.trim().length > 0
      let record = existing
      if (requestedGnMsgId && !hasExistingGnMsgId) {
        try {
          await db.collection('checkins').doc(docId).update({
            data: {
              gnMsgId: requestedGnMsgId
            }
          })
          record = Object.assign({}, existing, { gnMsgId: requestedGnMsgId })
        } catch (patchError) {
          console.warn('checkinSubmit patch existing gnMsgId failed', patchError)
        }
      }
      return {
        code: 'ALREADY_EXISTS',
        record,
        summary: {
          date: record.date,
          status: record.status,
          gnMsgId: record.gnMsgId || null,
          streak: user.streak,
          totalDays: user.totalDays,
          todayStatus: user.todayStatus,
          slotKey: user.slotKey
        }
      }
    }

    let messageId = requestedGnMsgId
    if (!messageId) {
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
    }

    const record = {
      _id: docId,
      uid: user.uid,
      date: today,
      status,
      gnMsgId: messageId,
      createdAt: db.serverDate()
    }

    try {
      await createCheckin(record)
    } catch (error) {
      const msg = error?.errMsg || ''
      if (/already exist/i.test(msg)) {
        const latest = await getCheckin(user.uid, today)
        let record = latest
        const hasLatestGnMsgId =
          latest && typeof latest.gnMsgId === 'string' && latest.gnMsgId.trim().length > 0
        if (latest && requestedGnMsgId && !hasLatestGnMsgId) {
          try {
            await db.collection('checkins').doc(docId).update({
              data: {
                gnMsgId: requestedGnMsgId
              }
            })
            record = Object.assign({}, latest, { gnMsgId: requestedGnMsgId })
          } catch (patchError) {
            console.warn('checkinSubmit patch latest gnMsgId failed', patchError)
          }
        }
        const summaryRecord =
          record ||
          Object.assign(
            {
              date: today,
              status,
              gnMsgId: requestedGnMsgId || null
            },
            latest || {}
          )
        return {
          code: 'ALREADY_EXISTS',
          record: summaryRecord,
          summary: {
            date: summaryRecord.date,
            status: summaryRecord.status,
            gnMsgId: summaryRecord.gnMsgId || null,
            streak: user.streak,
            totalDays: user.totalDays,
            todayStatus: user.todayStatus,
            slotKey: user.slotKey
          }
        }
      }
      throw error
    }

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
