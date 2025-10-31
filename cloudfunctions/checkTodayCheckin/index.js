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

function normalizeDate(value) {
  if (!isNonEmptyString(value)) {
    return null
  }
  const trimmed = value.trim()
  const digits = /^\d{8}$/.test(trimmed) ? trimmed : trimmed.replace(/[^\d]/g, '')
  if (digits.length !== 8) {
    return null
  }
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null
  }
  const normalizedYear = String(year).padStart(4, '0')
  const normalizedMonth = String(month).padStart(2, '0')
  const normalizedDay = String(day).padStart(2, '0')
  return `${normalizedYear}${normalizedMonth}${normalizedDay}`
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

function normalizeInfoList(value) {
  return Array.isArray(value) ? value : []
}

function mapEntryToRecord(uid, entry, fallbackTs) {
  const normalizedDate = normalizeDate(entry?.date) ?? ''
  const safeDate = normalizedDate || ''
  const status = VALID_STATUS.has(entry?.status) ? entry.status : 'hit'
  const tzOffset = isNumber(entry?.tzOffset) ? entry.tzOffset : 0
  const normalizedTs = normalizeTimestamp(entry?.ts) ?? fallbackTs ?? new Date().toISOString()
  const message = isNonEmptyString(entry?.message) ? entry.message.trim() : undefined

  const record = {
    _id: safeDate ? `${uid}_${safeDate}` : `${uid}_${normalizedTs}`,
    uid,
    userUid: uid,
    date: safeDate,
    status,
    tzOffset,
    ts: normalizedTs
  }

  if (message) {
    record.goodnightMessageId = message
    record.message = message
  }

  return record
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
  return code === 'DOCUMENT_NOT_FOUND'
}

function validatePayload(event) {
  if (!event || typeof event !== 'object') {
    throw Object.assign(new Error('缺少查询参数'), { code: 'bad_payload' })
  }
  const { uid, date } = event
  if (!isNonEmptyString(uid)) {
    throw Object.assign(new Error('缺少用户 UID'), { code: 'missing_uid' })
  }
  const normalizedDate = normalizeDate(date)
  if (!normalizedDate) {
    throw Object.assign(new Error('缺少或非法的日期'), { code: 'bad_date' })
  }
  return {
    uid: uid.trim(),
    date: normalizedDate
  }
}

async function ensureUserCheckinsDocument(collection, uid, openid) {
  const docRef = collection.doc(uid)
  try {
    const snapshot = await docRef.get()
    if (snapshot && snapshot.data) {
      return {
        docRef,
        data: snapshot.data
      }
    }
  } catch (error) {
    if (!isDocumentNotFoundError(error)) {
      throw error
    }
  }

  const now = db.serverDate()
  await docRef.set({
    data: {
      uid,
      ownerOpenid: openid,
      info: [],
      createdAt: now,
      updatedAt: now
    }
  })

  return {
    docRef,
    data: {
      uid,
      ownerOpenid: openid,
      info: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }
}

exports.main = async (event) => {
  try {
    const payload = validatePayload(event)
    const { OPENID } = cloud.getWXContext()
    const collection = db.collection('checkins')

    const { data: doc } = await ensureUserCheckinsDocument(collection, payload.uid, OPENID)
    const infoList = normalizeInfoList(doc?.info)
    const entry = infoList.find((item) => normalizeDate(item.date) === payload.date)

    if (!entry) {
      return {
        ok: true,
        code: 'not_found',
        exists: false
      }
    }

    return {
      ok: true,
      code: 'found',
      exists: true,
      data: mapEntryToRecord(payload.uid, entry)
    }
  } catch (error) {
    console.error('[checkTodayCheckin] failed', error)
    return {
      ok: false,
      code: error.code || error.errCode || 'internal_error',
      message: error.message || error.errMsg || '查询打卡状态失败'
    }
  }
}
