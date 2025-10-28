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
  if (!isNonEmptyString(date) || !/^\d{8}$/.test(date)) {
    throw Object.assign(new Error('缺少或非法的日期'), { code: 'bad_date' })
  }
  return {
    uid: uid.trim(),
    date: date.trim()
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
  const result = await collection
    .where({
      _openid: openid,
      date
    })
    .limit(1)
    .get()

  const record = result?.data && result.data[0]
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
  const resolvedDate = isNonEmptyString(record.date) ? record.date : date
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
