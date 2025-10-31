const { initCloud, getOpenId, getDb } = require('../common/cloud')
const { ensureUser } = require('../common/users')
const { createError } = require('../common/errors')
const { success, failure } = require('../common/response')

initCloud()

function normalizeDate(value, fallback) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{8}$/.test(trimmed)) {
      return trimmed
    }
  }
  return fallback
}

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const params = typeof event === 'object' && event ? event : {}

    const from = normalizeDate(params.from, '00000000')
    const to = normalizeDate(params.to, '99999999')
    if (from > to) {
      throw createError('INVALID_ARG', '日期范围非法')
    }

    let limit = Number.isFinite(params.limit) ? Math.trunc(params.limit) : 20
    if (limit <= 0) limit = 20
    if (limit > 50) limit = 50

    const cursor = typeof params.cursor === 'string' && params.cursor.startsWith(`${user.uid}#`) ? params.cursor : null

    const db = getDb()
    const collection = db.collection('checkins')
    const _ = db.command

    let condition = _.and([
      _.gte(`${user.uid}#${from}`),
      _.lte(`${user.uid}#${to}`)
    ])

    if (cursor) {
      condition = _.and([condition, _.lt(cursor)])
    }

    const query = collection.where({ _id: condition }).orderBy('_id', 'desc').limit(limit)
    const snapshot = await query.get()
    const list = snapshot.data || []
    const nextCursor = list.length === limit ? list[list.length - 1]._id : null

    return success({ list, nextCursor })
  } catch (error) {
    console.error('checkinRange error', error)
    return failure(error)
  }
}
