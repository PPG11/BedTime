const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

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
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
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

function validatePayload(event) {
  if (!event || typeof event !== 'object') {
    throw Object.assign(new Error('缺少打卡参数'), { code: 'bad_payload' })
  }
  const { uid, date, status, tzOffset, goodnightMessageId, message } = event
  if (!isNonEmptyString(uid)) {
    throw Object.assign(new Error('缺少用户 UID'), { code: 'missing_uid' })
  }
  const normalizedDate = normalizeDate(date)
  if (!normalizedDate) {
    throw Object.assign(new Error('缺少或非法的日期'), { code: 'bad_date' })
  }
  if (!isNonEmptyString(status) || !VALID_STATUS.has(status)) {
    throw Object.assign(new Error('非法的打卡状态'), { code: 'bad_status' })
  }
  const normalizedMessage = isNonEmptyString(goodnightMessageId)
    ? goodnightMessageId.trim()
    : isNonEmptyString(message)
    ? message.trim()
    : undefined
  return {
    uid: uid.trim(),
    date: normalizedDate,
    status,
    tzOffset: isNumber(tzOffset) ? tzOffset : 0,
    goodnightMessageId: normalizedMessage
  }
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

    const { docRef, data: existingDoc } = await ensureUserCheckinsDocument(
      collection,
      payload.uid,
      OPENID
    )

    const infoList = normalizeInfoList(existingDoc?.info)
    const existingEntry = infoList.find((entry) => normalizeDate(entry.date) === payload.date)
    if (existingEntry) {
      return {
        ok: true,
        code: 'already_exists',
        data: mapEntryToRecord(payload.uid, existingEntry)
      }
    }

    const nowIso = new Date().toISOString()
    const newEntryForDb = {
      date: payload.date,
      status: payload.status,
      message: payload.goodnightMessageId,
      tzOffset: payload.tzOffset,
      ts: db.serverDate()
    }

    await docRef.update({
      data: {
        ownerOpenid: OPENID,
        updatedAt: db.serverDate(),
        info: _.push([newEntryForDb])
      }
    })

    const responseEntry = {
      ...newEntryForDb,
      ts: nowIso
    }

    return {
      ok: true,
      code: 'created',
      data: mapEntryToRecord(payload.uid, responseEntry)
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
