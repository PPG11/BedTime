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

function formatLegacyDate(value) {
  const normalized = normalizeDate(value)
  if (!normalized) {
    return null
  }
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`
}

function createLegacyDocId(uid, date) {
  const legacyDate = formatLegacyDate(date)
  if (!legacyDate) {
    return null
  }
  return createDocId(uid, legacyDate)
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

function resolveUserUidFromRecord(raw, docId) {
  if (isNonEmptyString(raw.userUid)) {
    return raw.userUid
  }
  if (isNonEmptyString(raw.uid)) {
    const [candidate] = String(raw.uid).split('_')
    if (candidate) {
      return candidate
    }
  }
  if (isNonEmptyString(docId)) {
    const [candidate] = docId.split('_')
    if (candidate) {
      return candidate
    }
  }
  return ''
}

function normalizeRecord(docId, raw) {
  const baseUid = resolveUserUidFromRecord(raw, docId)
  const normalizedTs = normalizeTimestamp(raw.ts) ?? new Date().toISOString()
  const docDate = docId.split('_').pop()
  const normalizedDate =
    normalizeDate(raw.date) ??
    normalizeDate(docDate) ??
    (isNonEmptyString(raw.date) ? raw.date.trim() : docDate || '')
  const normalized = {
    _id: docId,
    uid: isNonEmptyString(raw.uid) ? raw.uid : docId,
    userUid: baseUid,
    date: normalizedDate,
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

async function loadByOpenId(collection, openid, date) {
  if (!isNonEmptyString(openid)) {
    return null
  }
  let record = null
  const result = await collection
    .where({
      _openid: openid,
      date
    })
    .limit(1)
    .get()
  if (result?.data && result.data[0]) {
    record = result.data[0]
  }
  if (!record) {
    const legacyDate = formatLegacyDate(date)
    if (legacyDate) {
      const legacyResult = await collection
        .where({
          _openid: openid,
          date: legacyDate
        })
        .limit(1)
        .get()
      if (legacyResult?.data && legacyResult.data[0]) {
        record = legacyResult.data[0]
      }
    }
  }

  if (!record) {
    return null
  }

  if (isNonEmptyString(record._id)) {
    return normalizeRecord(record._id, record)
  }
  const resolvedUid =
    resolveUserUidFromRecord(record, `${record.userUid || record.uid || ''}_${date}`) ||
    record.userUid ||
    record.uid ||
    ''
  const resolvedDate = normalizeDate(record.date) ?? date
  const docId = createDocId(resolvedUid, resolvedDate)
  return normalizeRecord(docId, record)
}

exports.main = async (event) => {
  try {
    const payload = validatePayload(event)
    const docId = createDocId(payload.uid, payload.date)
    const collection = db.collection('checkins')
    const docRef = collection.doc(docId)

    let record = await loadExistingRecord(docRef, docId)
    if (!record) {
      const legacyDocId = createLegacyDocId(payload.uid, payload.date)
      if (legacyDocId && legacyDocId !== docId) {
        record = await loadExistingRecord(collection.doc(legacyDocId), legacyDocId)
      }
    }
    if (!record) {
      const { OPENID } = cloud.getWXContext()
      record = await loadByOpenId(collection, OPENID, payload.date)
      if (!record) {
        return {
          ok: true,
          code: 'not_found',
          exists: false
        }
      }
    }

    return {
      ok: true,
      code: 'found',
      exists: true,
      data: record
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
