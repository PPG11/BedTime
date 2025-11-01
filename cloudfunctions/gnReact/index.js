const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser } = require('common/users')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')

initCloud()

const DEDUPE_COLLECTION = 'gn_reactions_dedupe'
const EVENTS_COLLECTION = 'gn_reaction_events'

function normalizeValue(value) {
  const num = Number(value)
  if (num === 1 || num === -1) {
    return num
  }
  return null
}

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    await ensureUser(openid)

    const messageId = typeof event?.messageId === 'string' ? event.messageId.trim() : ''
    const value = normalizeValue(event?.value)

    if (!messageId) {
      throw createError('INVALID_ARG', '缺少消息 ID')
    }
    if (value === null) {
      throw createError('INVALID_ARG', '非法的投票值')
    }

    const db = getDb()
    const result = await db.runTransaction(async (transaction) => {
      const dedupeId = `${openid}#${messageId}`
      const dedupeRef = transaction.collection(DEDUPE_COLLECTION).doc(dedupeId)
      const dedupeSnap = await dedupeRef.get()
      const now = db.serverDate()

      if (!dedupeSnap?.data) {
        let deltaLikes = 0
        let deltaDislikes = 0
        let deltaScore = value
        if (value === 1) {
          deltaLikes = 1
        } else {
          deltaDislikes = 1
        }
        await dedupeRef.set({
          data: {
            _id: dedupeId,
            userId: openid,
            messageId,
            value,
            createdAt: now
          }
        })
        await transaction.collection(EVENTS_COLLECTION).add({
          data: {
            messageId,
            deltaLikes,
            deltaDislikes,
            deltaScore,
            createdAt: now,
            status: 'queued'
          }
        })
        return { queued: true }
      }

      const previous = dedupeSnap.data.value
      if (previous === value) {
        return { queued: false, dedup: true }
      }

      let deltaLikes = 0
      let deltaDislikes = 0
      const deltaScore = value - previous

      if (value === 1) {
        deltaLikes = 1
        if (previous === -1) {
          deltaDislikes = -1
        }
      } else {
        deltaDislikes = 1
        if (previous === 1) {
          deltaLikes = -1
        }
      }

      await dedupeRef.update({ data: { value, updatedAt: now } })
      await transaction.collection(EVENTS_COLLECTION).add({
        data: {
          messageId,
          deltaLikes,
          deltaDislikes,
          deltaScore,
          createdAt: now,
          status: 'queued'
        }
      })

      return { queued: true }
    })

    return success(result)
  } catch (error) {
    console.error('gnReact error', error)
    return failure(error)
  }
}
