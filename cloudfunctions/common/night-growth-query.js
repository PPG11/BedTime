const { requireValue } = require('./errors')

// A fixed _id ceiling and strict cursor make each scan finite. Counts are checked
// before and after: a partial or changing dataset must never become a percentage.
// This is a consistency check, not a database snapshot across concurrent updates.
async function scanRows(db, name, where = {}, { maxRows = 10000, pageSize = 100, fields } = {}) {
  requireValue(Number.isInteger(maxRows) && maxRows > 0 && Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 100, 'INTERNAL', '读取配置无效')
  const count = async condition => {
    const result = await db.collection(name).where(condition).count()
    requireValue(Number.isSafeInteger(result.total) && result.total >= 0, 'INTERNAL', '数据数量暂不能确认')
    return result.total
  }
  const expected = await count(where)
  requireValue(expected <= maxRows, 'INTERNAL', '数据超出本次完整汇总上限，请缩小运营规模或升级汇总方式')
  if (!expected) {
    requireValue(await count(where) === 0, 'INTERNAL', '数据正在变化，请稍后重新读取')
    return []
  }
  const newest = (await db.collection(name).where(where).orderBy('_id', 'desc').limit(1).field({ _id: true }).get()).data
  const upper = newest?.[0]?._id
  requireValue(typeof upper === 'string' && upper.length > 0, 'INTERNAL', '数据边界暂不能确认')
  const bounded = db.command.and([where, { _id: db.command.lte(upper) }])
  const rows = []
  let cursor = null
  while (rows.length < expected) {
    const condition = cursor ? db.command.and([bounded, { _id: db.command.gt(cursor) }]) : bounded
    let query = db.collection(name).where(condition).orderBy('_id', 'asc').limit(Math.min(pageSize, expected - rows.length))
    if (fields) query = query.field({ ...fields, _id: true })
    const page = (await query.get()).data
    requireValue(Array.isArray(page) && page.length > 0 && page.length <= Math.min(pageSize, expected - rows.length), 'INTERNAL', '数据不完整，请重新读取')
    for (const row of page) {
      requireValue(typeof row?._id === 'string' && (!cursor || row._id > cursor) && row._id <= upper, 'INTERNAL', '数据游标异常，请重新读取')
      cursor = row._id
      rows.push(row)
    }
  }
  requireValue(await count(bounded) === expected && await count(where) === expected, 'INTERNAL', '数据正在变化，请稍后重新读取')
  return rows
}

module.exports = { scanRows }
