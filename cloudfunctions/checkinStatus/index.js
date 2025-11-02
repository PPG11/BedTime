const { initCloud, getOpenId } = require('common/cloud')
const { ensureUser } = require('common/users')
const { getTodayFromOffset } = require('common/time')
const { getCheckin, normalizeDateKey } = require('common/checkins')
const { success, failure } = require('common/response')

initCloud()

function normalizeStatus(value) {
  if (typeof value !== 'string') {
    return 'hit'
  }
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'hit' || trimmed === 'late' || trimmed === 'miss' || trimmed === 'pending') {
    return trimmed
  }
  return 'hit'
}

function normalizeMessageId(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTimestamp(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return value
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  if (typeof value === 'object') {
    const candidates = [
      value.time,
      value.value,
      value.$date,
      value.$numberLong,
      value.$numberDecimal
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'number' || typeof candidate === 'string') {
        const parsed = new Date(candidate)
        if (!Number.isNaN(parsed.getTime())) {
          return parsed
        }
      }
    }
  }

  return null
}

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const today = getTodayFromOffset(user.tzOffset)
    const requestedDate = normalizeDateKey(event?.date)
    const targetDate = requestedDate || today
    console.log('[checkinStatus] 查询打卡状态:', {
      requestedDate: event?.date,
      normalizedRequestedDate: requestedDate,
      computedToday: today,
      targetDate: targetDate,
      tzOffset: user.tzOffset
    })
    const record = await getCheckin(user.uid, targetDate)

    if (!record) {
      return success({
        checkedIn: false,
        date: targetDate,
        status: null,
        gnMsgId: null,
        timestamp: null
      })
    }

    const status = normalizeStatus(record.status)
    const gnMsgId = normalizeMessageId(record.gnMsgId)
    const timestamp =
      normalizeTimestamp(record.updatedAt) ||
      normalizeTimestamp(record.createdAt) ||
      normalizeTimestamp(record.ts) ||
      null

    console.log('[checkinStatus] 找到打卡记录:', {
      recordDate: record.date,
      targetDate: targetDate,
      status: status,
      willReturnDate: targetDate
    })

    return success({
      checkedIn: true,
      date: targetDate,
      status,
      gnMsgId,
      timestamp
    })
  } catch (error) {
    console.error('checkinStatus error', error)
    return failure(error)
  }
}
