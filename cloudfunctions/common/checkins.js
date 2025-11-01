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

module.exports = {
  buildDocId,
  getCheckin,
  createCheckin,
  COLLECTION
}
