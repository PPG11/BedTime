const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser, computeCheckinSummary } = require('common/users')
const { buildDocId, getCheckin, createCheckin, normalizeDateKey } = require('common/checkins')
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
    const requestedDate = normalizeDateKey(event?.date)
    if (!requestedDate) {
      throw createError('INVALID_ARG', '缺少日期参数')
    }
    const checkinDate = requestedDate
    console.log('[checkinSubmit] 打卡提交:', {
      requestedDate: event?.date,
      normalizedDate: requestedDate,
      checkinDate: checkinDate,
      status: status,
      tzOffset: user.tzOffset
    })

    const docId = buildDocId(user.uid, checkinDate)

    const existing = await getCheckin(user.uid, checkinDate)
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
          date: checkinDate,
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
          avoidUid: user.uid,
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
      date: checkinDate,
      status,
      gnMsgId: messageId,
      createdAt: db.serverDate()
    }

    try {
      await createCheckin(record)
    } catch (error) {
      const msg = error?.errMsg || ''
      if (/already exist/i.test(msg)) {
        const latest = await getCheckin(user.uid, checkinDate)
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
              date: checkinDate,
              status,
              gnMsgId: requestedGnMsgId || null
            },
            latest || {}
          )
        return {
          code: 'ALREADY_EXISTS',
          record: summaryRecord,
          summary: {
            date: checkinDate,
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

    const summary = computeCheckinSummary(user, status, checkinDate)
    await db.collection('users').doc(openid).update({
      data: summary
    })

    const response = {
      date: checkinDate,
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
