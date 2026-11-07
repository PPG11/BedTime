const { createHash } = require('node:crypto')
const { requireValue } = require('./errors')
const { TARGET_TIME, previousDay, quantizeSlotKey, resolveCycle } = require('./time')

const USERS = 'users'
const UID_PATTERN = /^[A-Za-z0-9]{6,12}$/

async function getUser(db, openid) {
  const { data } = await db.collection(USERS).doc(openid).get()
  requireValue(data, 'NOT_FOUND', '请先初始化个人资料')
  return data
}

function getCurrentStreak(user, cycleDate = resolveCycle(user).date) {
  if (user.todayStatus !== 'hit') return 0
  // The previous night's streak stays alive until the current window closes.
  // resolveCycle advances at that boundary, so a skipped full cycle expires it.
  return user.lastCheckinDate === cycleDate || user.lastCheckinDate === previousDay(cycleDate)
    ? user.streak : 0
}

function toUserResponse(user) {
  const { uid, nickname, tzOffset, targetHM, slotKey, totalDays, lastCheckinDate, createdAt } = user
  const cycleDate = resolveCycle(user).date
  const todayStatus = lastCheckinDate === cycleDate ? user.todayStatus : 'pending'
  const streak = getCurrentStreak(user, cycleDate)
  return { uid, nickname, tzOffset, targetHM, slotKey, streak, totalDays, lastCheckinDate, createdAt, todayStatus }
}

async function bootstrap(db, openid, { tzOffset }) {
  requireValue(Number.isInteger(tzOffset) && tzOffset >= -720 && tzOffset <= 840, 'INVALID_ARG', '时区无效')
  const ref = db.collection(USERS).doc(openid)
  const existing = (await ref.get()).data
  if (existing) return toUserResponse(existing)

  // Stable across concurrent first requests and independent of the short code supplied by a client.
  const uid = createHash('sha256').update(openid).digest('hex').slice(0, 12)
  const user = {
    uid, nickname: '睡眠伙伴' + uid.slice(-4), tzOffset, targetHM: '22:30', slotKey: '22:30',
    todayStatus: 'pending', streak: 0, totalDays: 0, lastCheckinDate: '', createdAt: new Date()
  }
  const saved = await db.runTransaction(async tx => {
    const doc = tx.collection(USERS).doc(openid)
    const current = (await doc.get()).data
    if (current) return current
    await doc.set({ data: user })
    return user
  })
  return toUserResponse(saved)
}

async function updateProfile(db, openid, { nickname, targetHM }) {
  const data = {}
  if (nickname !== undefined) {
    requireValue(typeof nickname === 'string' && nickname.trim().length > 0 && nickname.trim().length <= 20, 'INVALID_ARG', '昵称需为 1 至 20 字')
    data.nickname = nickname.trim()
  }
  if (targetHM !== undefined) {
    requireValue(typeof targetHM === 'string' && TARGET_TIME.test(targetHM), 'INVALID_ARG', '目标时间无效')
    data.targetHM = targetHM
    data.slotKey = quantizeSlotKey(targetHM)
  }
  requireValue(Object.keys(data).length > 0, 'INVALID_ARG', '缺少可更新的资料')
  await getUser(db, openid)
  await db.collection(USERS).doc(openid).update({ data })
  return toUserResponse(await getUser(db, openid))
}

module.exports = { USERS, UID_PATTERN, getUser, getCurrentStreak, toUserResponse, bootstrap, updateProfile }
