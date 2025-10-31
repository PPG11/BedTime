const { getDb } = require('./cloud')
const { createError } = require('./errors')

const COLLECTION = 'goodnight_messages'

function buildBaseQuery(db, filters) {
  const collection = db.collection(COLLECTION)
  const _ = db.command
  let condition = { status: 'approved' }
  if (filters.avoidUserId) {
    condition = Object.assign(condition, { userId: _.neq(filters.avoidUserId) })
  }
  if (filters.slotKey) {
    condition = Object.assign(condition, { slotKey: filters.slotKey })
  }
  if (Number.isFinite(filters.minScore)) {
    condition = Object.assign(condition, { score: _.gte(filters.minScore) })
  }
  return collection.where(condition)
}

async function pickRandomMessage({ avoidUserId, slotKey, minScore = -2, pivot }) {
  const db = getDb()
  const _ = db.command
  const randomPivot = typeof pivot === 'number' ? pivot : Math.random()
  const baseQuery = buildBaseQuery(db, { avoidUserId, slotKey, minScore })

  const first = await baseQuery
    .where({ rand: _.gte(randomPivot) })
    .orderBy('rand', 'asc')
    .limit(1)
    .get()

  if (first.data.length > 0) {
    return first.data[0]
  }

  const second = await baseQuery
    .where({ rand: _.lt(randomPivot) })
    .orderBy('rand', 'asc')
    .limit(1)
    .get()

  return second.data[0] || null
}

async function getMessageById(messageId) {
  if (typeof messageId !== 'string' || !messageId) {
    throw createError('INVALID_ARG', '缺少消息 ID')
  }
  const db = getDb()
  const doc = await db.collection(COLLECTION).doc(messageId).get()
  if (!doc?.data) {
    throw createError('NOT_FOUND', '消息不存在')
  }
  return doc.data
}

module.exports = {
  pickRandomMessage,
  getMessageById,
  COLLECTION
}
