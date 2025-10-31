const { getDb } = require('./cloud')
const { quantizeSlotKey, normalizeHm, getYesterday } = require('./time')
const { createError } = require('./errors')

const COLLECTION = 'users'
const UID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function randomUid(length) {
  let result = ''
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * UID_ALPHABET.length)
    result += UID_ALPHABET.charAt(index)
  }
  return result
}

async function generateUniqueUid(db) {
  const collection = db.collection(COLLECTION)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const length = 8 + Math.floor(Math.random() * 3)
    const candidate = randomUid(length)
    const existing = await collection.where({ uid: candidate }).limit(1).get()
    if (existing.data.length === 0) {
      return candidate
    }
  }
  throw createError('INTERNAL', '无法生成唯一 UID')
}

function normalizeTzOffset(value, fallback = 480) {
  if (Number.isFinite(value)) {
    return Math.max(Math.min(Math.trunc(value), 14 * 60), -12 * 60)
  }
  return fallback
}

function toUserResponse(user) {
  return {
    uid: user.uid,
    nickname: user.nickname,
    tzOffset: user.tzOffset,
    targetHM: user.targetHM,
    slotKey: user.slotKey,
    todayStatus: user.todayStatus,
    streak: user.streak,
    totalDays: user.totalDays,
    lastCheckinDate: user.lastCheckinDate || '',
    createdAt: user.createdAt
  }
}

async function ensureUser(openid, overrides = {}) {
  if (typeof openid !== 'string' || !openid) {
    throw createError('UNAUTHORIZED', '缺少 OPENID')
  }
  const db = getDb()
  const users = db.collection(COLLECTION)
  const docRef = users.doc(openid)

  try {
    const existing = await docRef.get()
    if (existing?.data) {
      return existing.data
    }
  } catch (error) {
    const msg = error?.errMsg || ''
    if (!/not exist|not found|fail/i.test(msg)) {
      throw error
    }
  }

  const tzOffset = normalizeTzOffset(overrides.tzOffset)
  const targetHM = normalizeHm(overrides.targetHM, '22:30')
  const slotKey = quantizeSlotKey(targetHM)
  const uid = await generateUniqueUid(db)
  const nickname = overrides.nickname || `睡眠伙伴${uid}`
  const newUser = {
    _id: openid,
    uid,
    nickname,
    tzOffset,
    targetHM,
    slotKey,
    todayStatus: 'none',
    streak: 0,
    totalDays: 0,
    lastCheckinDate: '',
    createdAt: db.serverDate()
  }

  await docRef.set({ data: newUser })
  return newUser
}

async function getUserByOpenid(openid) {
  if (typeof openid !== 'string' || !openid) {
    throw createError('UNAUTHORIZED', '缺少 OPENID')
  }
  const db = getDb()
  const doc = await db.collection(COLLECTION).doc(openid).get()
  if (!doc?.data) {
    throw createError('NOT_FOUND', '用户不存在')
  }
  return doc.data
}

async function getUserByUid(uid) {
  if (typeof uid !== 'string' || !uid.trim()) {
    throw createError('INVALID_ARG', '缺少用户 UID')
  }
  const db = getDb()
  const result = await db.collection(COLLECTION).where({ uid: uid.trim() }).limit(1).get()
  if (result.data.length === 0) {
    throw createError('NOT_FOUND', '用户不存在')
  }
  return result.data[0]
}

function computeCheckinSummary(user, status, today) {
  const currentTotal = Number.isFinite(user.totalDays) ? user.totalDays : 0
  const currentStreak = Number.isFinite(user.streak) ? user.streak : 0
  const lastDate = typeof user.lastCheckinDate === 'string' ? user.lastCheckinDate : ''

  const totalDays = currentTotal + 1
  let streak = 0

  if (status === 'hit') {
    const yesterday = getYesterday(today)
    if (lastDate === yesterday) {
      streak = currentStreak + 1
    } else if (lastDate === today) {
      streak = currentStreak
    } else {
      streak = 1
    }
  } else {
    streak = 0
  }

  return {
    todayStatus: status,
    totalDays,
    streak,
    lastCheckinDate: today,
    slotKey: user.slotKey
  }
}

module.exports = {
  ensureUser,
  toUserResponse,
  getUserByOpenid,
  getUserByUid,
  computeCheckinSummary,
  normalizeTzOffset,
  normalizeHm,
  quantizeSlotKey
}
