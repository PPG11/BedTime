const { getDb } = require('./cloud')
const { createError } = require('./errors')

const REQUESTS_COLLECTION = 'friend_requests'
const FRIENDSHIPS_COLLECTION = 'friendships'

function buildEdgeId(uidA, uidB) {
  const a = String(uidA)
  const b = String(uidB)
  return a < b ? `${a}#${b}` : `${b}#${a}`
}

async function ensureNotFriends(uidA, uidB) {
  const db = getDb()
  const edgeId = buildEdgeId(uidA, uidB)
  try {
    const snapshot = await db.collection(FRIENDSHIPS_COLLECTION).doc(edgeId).get()
    if (snapshot?.data) {
      throw createError('ALREADY_EXISTS', '已是好友')
    }
  } catch (error) {
    const msg = error?.errMsg || ''
    if (!/not exist|not found|fail/i.test(msg)) {
      throw error
    }
  }
}

module.exports = {
  REQUESTS_COLLECTION,
  FRIENDSHIPS_COLLECTION,
  buildEdgeId,
  ensureNotFriends
}
