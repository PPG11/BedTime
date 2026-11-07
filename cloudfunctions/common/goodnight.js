const { createHash } = require('node:crypto')
const { cloud } = require('./cloud')
const { requireValue } = require('./errors')
const { getUser } = require('./users')
const { getCheckin } = require('./checkins')
const { isDateKey, resolveCycle } = require('./time')

const MESSAGES = 'goodnight_messages'
const REACTIONS = 'gn_reactions_dedupe'
const MAX_LENGTH = 80
const MIN_SCORE = -2

function isEligible(message, user) {
  return Boolean(message && message.status === 'approved' && message.uid !== user.uid &&
    message.slotKey === user.slotKey && message.score >= MIN_SCORE)
}

async function pickReward(db, user) {
  const _ = db.command
  const pivot = Math.random()
  const query = condition => db.collection(MESSAGES).where({
    status: 'approved', slotKey: user.slotKey, uid: _.neq(user.uid),
    score: _.gte(MIN_SCORE), rand: condition
  }).orderBy('rand', 'asc').limit(1).get()
  const first = await query(_.gte(pivot))
  if (first.data.length) return first.data[0]
  return (await query(_.lt(pivot))).data[0] || null
}

function project(message, voted = false) {
  const { _id, text, likes, dislikes } = message
  return { _id, content: text, likes, dislikes, voted }
}

function messageId(uid, date) {
  return uid + '_' + date
}

async function ownSubmission(db, openid, { date }) {
  requireValue(isDateKey(date), 'INVALID_ARG', '心语日期无效')
  const user = await getUser(db, openid)
  const { data } = await db.collection(MESSAGES).doc(messageId(user.uid, date)).get()
  return data ? project(data) : null
}

async function submit(db, openid, { text, date }) {
  requireValue(typeof text === 'string' && text.trim().length > 0 && text.trim().length <= MAX_LENGTH, 'INVALID_ARG', '晚安心语需为 1 至 80 字')
  requireValue(isDateKey(date), 'INVALID_ARG', '心语日期无效')
  const content = text.trim()
  const user = await getUser(db, openid)
  const id = messageId(user.uid, date)
  const existing = (await db.collection(MESSAGES).doc(id).get()).data
  if (existing) return project(existing)
  const now = Date.now()
  requireValue(resolveCycle(user, now).date === date, 'CYCLE_CHANGED', '心语周期已更新，请刷新后重试')

  const result = await cloud.openapi.security.msgSecCheck({ content, openid, scene: 3, version: 2 })
  requireValue(result?.result?.suggest === 'pass', 'CONTENT_REJECTED', '这条心语未通过内容审核，请修改后重试')

  const saved = await db.runTransaction(async tx => {
    const current = await getUser(tx, openid)
    const ref = tx.collection(MESSAGES).doc(id)
    const previous = (await ref.get()).data
    if (previous) return previous
    requireValue(resolveCycle(current, now).date === date, 'CYCLE_CHANGED', '心语周期已更新，请刷新后重试')
    const message = {
      uid: current.uid, date, text: content, slotKey: current.slotKey, rand: Math.random(),
      likes: 0, dislikes: 0, score: 0, status: 'approved', createdAt: new Date(now)
    }
    await ref.set({ data: message })
    return { _id: id, ...message }
  })
  return project(saved)
}

function reactionId(uid, id) {
  return createHash('sha256').update(uid + '#' + id).digest('hex')
}

async function assignedMessage(db, user, date) {
  const checkin = await getCheckin(db, user.uid, date)
  if (!checkin?.gnMsgId) return null
  const ref = db.collection(MESSAGES).doc(checkin.gnMsgId)
  const message = (await ref.get()).data
  if (!message || message.status !== 'approved' || message.uid === user.uid) return null
  return { ref, message, voteId: reactionId(user.uid, checkin.gnMsgId) }
}

async function reward(db, openid, { date }) {
  requireValue(isDateKey(date), 'INVALID_ARG', '心语日期无效')
  const user = await getUser(db, openid)
  const assignment = await assignedMessage(db, user, date)
  if (!assignment) return null
  const vote = (await db.collection(REACTIONS).doc(assignment.voteId).get()).data
  return project(assignment.message, Boolean(vote))
}

async function vote(db, openid, { date, value }) {
  requireValue(isDateKey(date) && (value === 1 || value === -1), 'INVALID_ARG', '投票参数无效')
  const user = await getUser(db, openid)

  return db.runTransaction(async tx => {
    const assignment = await assignedMessage(tx, user, date)
    requireValue(assignment, 'FORBIDDEN', '只能评价自己收到的心语')
    const { ref, message, voteId } = assignment
    const voteRef = tx.collection(REACTIONS).doc(voteId)
    if ((await voteRef.get()).data) return project(message, true)

    const tally = {
      likes: message.likes + (value === 1 ? 1 : 0),
      dislikes: message.dislikes + (value === -1 ? 1 : 0),
      score: message.score + value
    }
    await voteRef.set({ data: { uid: user.uid, messageId: message._id, value, createdAt: new Date() } })
    await ref.update({ data: tally })
    return project({ ...message, ...tally }, true)
  })
}

module.exports = { MESSAGES, pickReward, isEligible, ownSubmission, submit, reward, vote }
