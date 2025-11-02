const { initCloud, getDb } = require('common/cloud')
const { success, failure } = require('common/response')
const { COLLECTION: GN_COLLECTION } = require('common/goodnight')

initCloud()

const DEDUPE_COLLECTION = 'gn_reactions_dedupe'

// https://docs.cloudbase.net/cloud-function/timer-trigger

exports.main = async () => {
  try {
    const db = getDb()
    const dedupeCollection = db.collection(DEDUPE_COLLECTION)
    const messagesCollection = db.collection(GN_COLLECTION)
    const _ = db.command

    // 从去重集合中读取所有记录
    const snapshot = await dedupeCollection
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get()

    const records = snapshot.data || []
    if (records.length === 0) {
      return success({ consumed: 0, grouped: 0 })
    }

    // 按 messageId 分组，累加 deltaLikes, deltaDislikes, deltaScore
    const grouped = new Map()

    for (const record of records) {
      if (!record.messageId) {
        continue
      }

      const existing = grouped.get(record.messageId) || {
        deltaLikes: 0,
        deltaDislikes: 0,
        deltaScore: 0,
        recordIds: []
      }

      existing.deltaLikes += Number(record.deltaLikes) || 0
      existing.deltaDislikes += Number(record.deltaDislikes) || 0
      existing.deltaScore += Number(record.deltaScore) || 0
      existing.recordIds.push(record._id)

      grouped.set(record.messageId, existing)
    }

    const results = { consumed: records.length, grouped: grouped.size }

    // 更新对应的晚安心语文档
    for (const [messageId, info] of grouped.entries()) {
      if (!messageId) {
        continue
      }

      const incData = {}
      if (info.deltaLikes !== 0) {
        incData.likes = _.inc(info.deltaLikes)
      }
      if (info.deltaDislikes !== 0) {
        incData.dislikes = _.inc(info.deltaDislikes)
      }
      if (info.deltaScore !== 0) {
        incData.score = _.inc(info.deltaScore)
      }

      if (Object.keys(incData).length === 0) {
        // 如果没有需要更新的字段，直接删除记录
        for (const recordId of info.recordIds) {
          try {
            await dedupeCollection.doc(recordId).remove()
          } catch (error) {
            console.error('gnReactionsConsume remove failed', recordId, error)
          }
        }
        continue
      }

      try {
        // 更新晚安心语文档
        await messagesCollection.doc(messageId).update({ data: incData })
        
        // 更新成功后，删除已处理的记录
        for (const recordId of info.recordIds) {
          try {
            await dedupeCollection.doc(recordId).remove()
          } catch (error) {
            console.error('gnReactionsConsume remove failed', recordId, error)
          }
        }
      } catch (error) {
        console.error('gnReactionsConsume update failed', messageId, error)
        // 更新失败时，不删除记录，等待下次重试
      }
    }

    return success(results)
  } catch (error) {
    console.error('gnReactionsConsume error', error)
    return failure(error)
  }
}
