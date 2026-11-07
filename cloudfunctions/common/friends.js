const { randomUUID } = require('node:crypto')
const { requireValue } = require('./errors')
const { USERS, UID_PATTERN, getUser, getCurrentStreak } = require('./users')
const { resolveCycle } = require('./time')

const LINKS = 'friendships'
const EDGE_PATTERN = /^[A-Za-z0-9]{6,12}#[A-Za-z0-9]{6,12}$/
const edgeId = (left, right) => [left, right].sort().join('#')

function includesUid(id, uid) {
  return EDGE_PATTERN.test(id) && id.split('#').includes(uid)
}

async function send(db, openid, { toUid }) {
  const user = await getUser(db, openid)
  requireValue(typeof toUid === 'string' && UID_PATTERN.test(toUid) && toUid !== user.uid, 'INVALID_ARG', '好友 UID 无效')
  const target = await db.collection(USERS).where({ uid: toUid }).limit(2).get()
  requireValue(target.data.length === 1, 'NOT_FOUND', '找不到该用户')

  const id = edgeId(user.uid, toUid)
  return db.runTransaction(async tx => {
    const ref = tx.collection(LINKS).doc(id)
    const link = (await ref.get()).data
    requireValue(link?.status !== 'accepted', 'ALREADY_EXISTS', '已经是好友')
    if (link?.status === 'pending') {
      requireValue(link.fromUid === user.uid, 'INCOMING_REQUEST', '对方已发来好友申请')
      return { requestId: link.requestId }
    }

    const requestId = id + ':' + randomUUID()
    const [aUid, bUid] = id.split('#')
    await ref.set({
      data: { requestId, aUid, bUid, fromUid: user.uid, toUid, status: 'pending', createdAt: new Date() }
    })
    return { requestId }
  })
}

async function respond(db, openid, { requestId, decision }) {
  const user = await getUser(db, openid)
  requireValue(typeof requestId === 'string' && (decision === 'accepted' || decision === 'rejected'), 'INVALID_ARG', '申请处理参数无效')
  const id = requestId.split(':')[0]
  requireValue(includesUid(id, user.uid), 'FORBIDDEN', '无权处理该申请')

  return db.runTransaction(async tx => {
    const ref = tx.collection(LINKS).doc(id)
    const link = (await ref.get()).data
    requireValue(link?.requestId === requestId, 'NOT_FOUND', '申请已失效')
    requireValue(link.toUid === user.uid, 'FORBIDDEN', '仅接收方可以处理申请')
    if (link.status !== 'pending') return { status: link.status }
    await ref.update({ data: { status: decision } })
    return { status: decision }
  })
}

async function remove(db, openid, { targetUid, relationshipId }) {
  const user = await getUser(db, openid)
  requireValue(typeof targetUid === 'string' && UID_PATTERN.test(targetUid) && targetUid !== user.uid, 'INVALID_ARG', '好友 UID 无效')
  requireValue(typeof relationshipId === 'string' && relationshipId.length > 0, 'INVALID_ARG', '缺少好友关系标识')
  return db.runTransaction(async tx => {
    const ref = tx.collection(LINKS).doc(edgeId(user.uid, targetUid))
    const link = (await ref.get()).data
    if (link?.status === 'accepted' && link.requestId === relationshipId) await ref.remove()
    return { removed: true }
  })
}

async function overview(db, openid, { cursor, limit = 20 }) {
  const user = await getUser(db, openid)
  requireValue(cursor === undefined || (typeof cursor === 'string' && includesUid(cursor, user.uid)), 'INVALID_ARG', '分页游标无效')
  requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'INVALID_ARG', '分页大小无效')
  const links = db.collection(LINKS)
  const _ = db.command
  const member = _.or([{ aUid: user.uid }, { bUid: user.uid }])
  const filters = [member, { status: 'accepted' }]
  if (cursor) filters.push({ _id: _.gt(cursor) })

  const [friends, incoming, outgoing] = await Promise.all([
    links.where(_.and(filters)).orderBy('_id', 'asc').limit(limit + 1).get(),
    links.where({ toUid: user.uid, status: 'pending' }).orderBy('createdAt', 'desc').limit(50).get(),
    links.where({ fromUid: user.uid, status: 'pending' }).orderBy('createdAt', 'desc').limit(50).get()
  ])

  const page = friends.data.slice(0, limit)
  const other = link => link.aUid === user.uid ? link.bUid : link.aUid
  const uids = [...new Set([...page, ...incoming.data, ...outgoing.data].map(other))]
  const batches = []
  for (let i = 0; i < uids.length; i += 10) {
    batches.push(db.collection(USERS).where({ uid: _.in(uids.slice(i, i + 10)) }).get())
  }
  const profiles = new Map((await Promise.all(batches)).flatMap(result => result.data).map(profile => [profile.uid, profile]))
  const summary = uid => {
    const profile = profiles.get(uid)
    const cycle = profile && resolveCycle(profile).date
    const todayStatus = profile?.lastCheckinDate === cycle ? profile?.todayStatus : 'pending'
    return {
      uid, nickname: profile?.nickname ?? '睡眠伙伴' + uid.slice(-4),
      targetHM: profile?.targetHM ?? '', slotKey: profile?.slotKey ?? '',
      todayStatus, streak: profile ? getCurrentStreak(profile, cycle) : 0, totalDays: profile?.totalDays ?? 0
    }
  }
  // A pending request exposes the short code and nickname only.
  const request = link => {
    const uid = other(link)
    return { requestId: link.requestId, uid, nickname: summary(uid).nickname, status: 'pending', createdAt: link.createdAt }
  }
  return {
    list: page.map(link => ({ ...summary(other(link)), relationshipId: link.requestId })),
    nextCursor: friends.data.length > limit ? page.at(-1)._id : null,
    requests: { incoming: incoming.data.map(request), outgoing: outgoing.data.map(request) }
  }
}

module.exports = { send, respond, remove, overview }
