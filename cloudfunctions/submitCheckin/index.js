const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const VALID_STATUS = new Set(['hit', 'late', 'miss', 'pending'])

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function createDocId(uid, date) {
  return `${uid}_${date}`
}

function normalizeTimestamp(value) {
  if (!value) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }
  if (typeof value === 'object') {
    const candidate =
      value.value ?? value.time ?? value.$date ?? value.$numberLong ?? value.$numberDecimal
    if (candidate !== undefined) {
      return normalizeTimestamp(candidate)
    }
  }
  return null
}

function normalizeRecord(docId, raw) {
  const baseUid = isNonEmptyString(raw.userUid)
    ? raw.userUid
    : isNonEmptyString(raw.uid)
    ? String(raw.uid).split('_')[0]
    : docId.split('_')[0]
  const normalizedTs = normalizeTimestamp(raw.ts) ?? new Date().toISOString()
  const normalized = {
    _id: docId,
    uid: isNonEmptyString(raw.uid) ? raw.uid : docId,
    userUid: baseUid,
    date: isNonEmptyString(raw.date) ? raw.date : docId.split('_').pop(),
    status: VALID_STATUS.has(raw.status) ? raw.status : 'hit',
    tzOffset: isNumber(raw.tzOffset) ? raw.tzOffset : 0,
    ts: normalizedTs
  }
  if (isNonEmptyString(raw.goodnightMessageId)) {
    normalized.goodnightMessageId = raw.goodnightMessageId
  }
  if (isNonEmptyString(raw.message)) {
    normalized.message = raw.message
  }
  return normalized
}

function isDuplicateKeyError(error) {
  if (!error || typeof error !== 'object') {
    return false
  }
  const maybeCode = error.code ?? error.errCode
  if (maybeCode === 11000 || maybeCode === 'DATABASE_REALTIME_LISTENER_DUP_FAIL') {
    return true
  }
  const message = error.errMsg ?? error.message
  if (typeof message === 'string') {
    const lower = message.toLowerCase()
    return lower.includes('duplicate key') || lower.includes('already exists')
  }
  return false
}

function isDocumentNotFoundError(error) {
  if (!error || typeof error !== 'object') {
    return false
  }
  const message = error.errMsg ?? error.message
  if (typeof message === 'string') {
    const lower = message.toLowerCase()
    return (
      lower.includes('document.get:fail') ||
      lower.includes('cannot find document') ||
      lower.includes('not found') ||
      lower.includes('does not exist')
    )
  }
  const code = error.code ?? error.errCode
  return code === 'DATABASE_REALTIME_LISTENER_INVALIDDOCID' || code === 'DOCUMENT_NOT_FOUND'
}

function validatePayload(event) {
  if (!event || typeof event !== 'object') {
    throw Object.assign(new Error('缺少打卡参数'), { code: 'bad_payload' })
  }
  const { uid, date, status, tzOffset, goodnightMessageId } = event
  if (!isNonEmptyString(uid)) {
    throw Object.assign(new Error('缺少用户 UID'), { code: 'missing_uid' })
  }
  if (!isNonEmptyString(date) || !/^\d{8}$/.test(date)) {
    throw Object.assign(new Error('缺少或非法的日期'), { code: 'bad_date' })
  }
  if (!isNonEmptyString(status) || !VALID_STATUS.has(status)) {
    throw Object.assign(new Error('非法的打卡状态'), { code: 'bad_status' })
  }
  if (!isNumber(tzOffset)) {
    throw Object.assign(new Error('缺少时区偏移量'), { code: 'bad_tz_offset' })
  }
  if (goodnightMessageId !== undefined && goodnightMessageId !== null && !isNonEmptyString(goodnightMessageId)) {
    throw Object.assign(new Error('非法的晚安心语 ID'), { code: 'bad_message_id' })
  }
  return {
    uid: uid.trim(),
    date: date.trim(),
    status,
    tzOffset,
    goodnightMessageId: isNonEmptyString(goodnightMessageId) ? goodnightMessageId.trim() : undefined
  }
}

async function loadExistingRecord(docRef, docId) {
  try {
    const snapshot = await docRef.get()
    if (snapshot && snapshot.data) {
      return normalizeRecord(docId, snapshot.data)
    }
  } catch (error) {
    if (!isDocumentNotFoundError(error)) {
      throw error
    }
  }
  return null
}

exports.main = async (event) => {
  try {
    const payload = validatePayload(event)
    const docId = createDocId(payload.uid, payload.date)
    const collection = db.collection('checkins')
    const docRef = collection.doc(docId)

    const existing = await loadExistingRecord(docRef, docId)
    if (existing) {
      return {
        ok: true,
        code: 'already_exists',
        data: existing
      }
    }

    const record = {
      uid: docId,
      userUid: payload.uid,
      date: payload.date,
      status: payload.status,
      tzOffset: payload.tzOffset,
      ts: db.serverDate()
    }
    if (payload.goodnightMessageId) {
      record.goodnightMessageId = payload.goodnightMessageId
      record.message = payload.goodnightMessageId
    }

    try {
      await docRef.set({
        data: record
      })
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error
      }
      const fallback = await loadExistingRecord(docRef, docId)
      if (fallback) {
        return {
          ok: true,
          code: 'already_exists',
          data: fallback
        }
      }
      throw error
    }

    const created = await loadExistingRecord(docRef, docId)
    return {
      ok: true,
      code: 'created',
      data: created || normalizeRecord(docId, record)
    }
  } catch (error) {
    console.error('[submitCheckin] failed', error)
    return {
      ok: false,
      code: error.code || error.errCode || 'internal_error',
      message: error.message || error.errMsg || '提交打卡失败'
    }
  }
}
