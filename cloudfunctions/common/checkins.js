const { getUser, USERS } = require('./users')
const { requireValue } = require('./errors')
const { isDateKey, previousDay, resolveCycle } = require('./time')

const CHECKINS = 'checkins'
const docId = (uid, date) => uid + '#' + date

function project(record) {
  const { _id, uid, date, status, createdAt, gnMsgId } = record
  return { _id, uid, date, status, createdAt, goodnightMessageId: gnMsgId || null }
}

async function getCheckin(db, uid, date) {
  return (await db.collection(CHECKINS).doc(docId(uid, date)).get()).data
}

async function status(db, openid) {
  const user = await getUser(db, openid)
  const { date } = resolveCycle(user)
  const record = await getCheckin(db, user.uid, date)
  return { date, record: record ? project(record) : null }
}

async function history(db, openid, { cursor, limit = 50 }) {
  const user = await getUser(db, openid)
  requireValue(cursor === undefined || isDateKey(cursor), 'INVALID_ARG', '分页游标无效')
  requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'INVALID_ARG', '分页大小无效')
  const _ = db.command
  const from = docId(user.uid, '00000000')
  const to = docId(user.uid, cursor ?? '99999999')
  const { data } = await db.collection(CHECKINS)
    .where({ _id: _.and([_.gt(from), _.lt(to)]) }).orderBy('_id', 'desc').limit(limit + 1).get()
  const list = data.slice(0, limit)
  return { list: list.map(project), nextCursor: data.length > limit ? list.at(-1).date : null }
}

async function submit(db, openid, { date }) {
  requireValue(isDateKey(date), 'INVALID_ARG', '打卡周期无效')
  const user = await getUser(db, openid)
  const existing = await getCheckin(db, user.uid, date)
  if (existing) return { record: project(existing), created: false }

  const now = Date.now()
  const cycle = resolveCycle(user, now)
  requireValue(cycle.date === date, 'CYCLE_CHANGED', '打卡周期已更新，请刷新后重试')
  requireValue(cycle.open, 'WINDOW_CLOSED', '不在打卡时间段内')
  const { pickReward, MESSAGES, isEligible } = require('./goodnight')
  const candidate = await pickReward(db, user)
  const id = docId(user.uid, date)

  return db.runTransaction(async tx => {
    const current = await getUser(tx, openid)
    const ref = tx.collection(CHECKINS).doc(id)
    const previous = (await ref.get()).data
    if (previous) return { record: project(previous), created: false }

    const currentCycle = resolveCycle(current, now)
    requireValue(currentCycle.date === date && current.slotKey === user.slotKey, 'CYCLE_CHANGED', '作息已更新，请刷新后重试')
    requireValue(currentCycle.open, 'WINDOW_CLOSED', '不在打卡时间段内')
    requireValue(!current.lastCheckinDate || current.lastCheckinDate < date, 'CYCLE_CHANGED', '已完成更新周期的打卡')
    const reward = candidate && (await tx.collection(MESSAGES).doc(candidate._id).get()).data
    const record = {
      uid: current.uid, date, status: currentCycle.status, createdAt: new Date(now),
      slotKey: current.slotKey, gnMsgId: isEligible(reward, current) ? candidate._id : null
    }
    const streak = record.status === 'hit'
      ? (current.lastCheckinDate === previousDay(date) ? current.streak : 0) + 1
      : 0
    await ref.set({ data: record })
    await tx.collection(USERS).doc(openid).update({
      data: { streak, totalDays: current.totalDays + 1, lastCheckinDate: date, todayStatus: record.status }
    })
    return { record: project({ _id: id, ...record }), created: true }
  })
}

module.exports = { getCheckin, status, history, submit }
