const { getDb } = require('./cloud')
const { createError } = require('./errors')

const COLLECTION = 'checkins'

function buildDocId(uid, date) {
  if (typeof uid !== 'string' || !uid) {
    throw createError('INVALID_ARG', '缺少 UID')
  }
  if (typeof date !== 'string' || !/^\d{8}$/.test(date)) {
    throw createError('INVALID_ARG', '缺少日期')
  }
  return `${uid}#${date}`
}

async function getCheckin(uid, date) {
  const db = getDb()
  const docId = buildDocId(uid, date)
  try {
    const doc = await db.collection(COLLECTION).doc(docId).get()
    if (doc?.data) {
      return doc.data
    }
  } catch (error) {
    const msg = error?.errMsg || ''
    if (!/not exist|not found|fail/i.test(msg)) {
      throw error
    }
  }
  return null
}

async function createCheckin(record) {
  const db = getDb()
  const docRef = db.collection(COLLECTION).doc(record._id)
  const data = { ...record }
  delete data._id
  await docRef.set({ data })
  return record
}

function normalizeDateKey(input) {
  if (typeof input !== 'string') {
    return null
  }
  const trimmed = input.trim()
  if (!trimmed.length) {
    return null
  }
  const digits = /^\d{8}$/.test(trimmed) ? trimmed : trimmed.replace(/\D/g, '')
  if (digits.length !== 8) {
    return null
  }
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  const normalizedYear = String(year).padStart(4, '0')
  const normalizedMonth = String(month).padStart(2, '0')
  const normalizedDay = String(day).padStart(2, '0')
  return `${normalizedYear}${normalizedMonth}${normalizedDay}`
}

module.exports = {
  buildDocId,
  getCheckin,
  createCheckin,
  COLLECTION,
  normalizeDateKey
}
