const crypto = require('crypto')
const { initCloud, getOpenId, getDb } = require('common/cloud')
const { ensureUser } = require('common/users')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')

initCloud()

const DEDUPE_COLLECTION = 'gn_reactions_dedupe'

function normalizeValue(value) {
  const num = Number(value)
  if (num === 1 || num === -1) return num
  return null
}

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const voteUid = user.uid || openid

    const messageId = typeof event?.messageId === 'string' ? event.messageId.trim() : ''
    const value = normalizeValue(event?.value)

    if (!messageId) throw createError('INVALID_ARG', '缺少消息 ID')
    if (value === null) throw createError('INVALID_ARG', '非法的投票值')

    const db = getDb()
    const _ = db.command
    const now = db.serverDate()
    const dedupeKey = `${voteUid}#${messageId}`
    const dedupeId = crypto.createHash('md5').update(dedupeKey).digest('hex')
    const dedupeRef = db.collection(DEDUPE_COLLECTION).doc(dedupeId)

    // ---- Step 1: 先检查文档是否存在 ----
    let existing = null
    try {
      const snap = await dedupeRef.get()
      if (snap && snap.data) {
        existing = snap.data
      }
    } catch (e) {
      const msg = String(e || '')
      // 如果文档不存在，忽略错误继续创建
      if (!/not exist|not found|fail/i.test(msg)) {
        throw e
      }
    }

    // ---- Step 2: 如果不存在，创建新文档 ----
    if (!existing) {
      await dedupeRef.set({
        data: {
          messageId,
          dedupeKey,
          deltaLikes: value === 1 ? 1 : 0,
          deltaDislikes: value === -1 ? 1 : 0,
          deltaScore: value,
          createdAt: now,
          updatedAt: now,
          lastVoteAt: now,
          voteUid,
          value,
        }
      })

      return success({ queued: true, firstVote: true })
    }

    // ---- Step 3: 文档已存在，检查是否重复投票 ----
    const previousNormalized = normalizeValue(existing.value)
    if (previousNormalized === value) {
      return success({ queued: false, dedup: true })
    }

    // ---- Step 4: 计算增量并更新 ----
    const previousValue = typeof previousNormalized === 'number' ? previousNormalized : 0
    const deltaScore = value - previousValue

    let deltaLikes = 0
    if (value === 1) deltaLikes += 1
    if (previousNormalized === 1) deltaLikes -= 1

    let deltaDislikes = 0
    if (value === -1) deltaDislikes += 1
    if (previousNormalized === -1) deltaDislikes -= 1

    try {
      await dedupeRef.update({
        data: {
          messageId,
          dedupeKey,
          deltaLikes: _.inc(deltaLikes),
          deltaDislikes: _.inc(deltaDislikes),
          deltaScore: _.inc(deltaScore),
          updatedAt: now,
          voteUid,
          value,
          lastVoteAt: now,
        }
      })
    } catch (updateError) {
      const message = updateError && updateError.errMsg ? String(updateError.errMsg) : String(updateError || '')
      if (/does\s+not\s+exist|not\s+found|not\s+exist/i.test(message)) {
        await dedupeRef.set({
          data: {
            messageId,
            dedupeKey,
            deltaLikes,
            deltaDislikes,
            deltaScore,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            voteUid,
            value,
            lastVoteAt: now,
          }
        })
      } else {
        throw updateError
      }
    }

    return success({ queued: true, updated: true })
  } catch (error) {
    console.error('gnReact error', error)
    return failure(error)
  }
}
