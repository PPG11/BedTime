const { initCloud, getOpenId } = require('common/cloud')
const { ensureUser } = require('common/users')
const { pickRandomMessage } = require('common/goodnight')
const { success, failure } = require('common/response')

initCloud()

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const user = await ensureUser(openid)
    const params = typeof event === 'object' && event ? event : {}
    const preferSlot = params.preferSlot !== false
    const avoidSelf = params.avoidSelf !== false
    const minScore = Number.isFinite(params.minScore) ? params.minScore : -2

    const message = await pickRandomMessage({
      avoidUserId: avoidSelf ? openid : undefined,
      avoidUid: avoidSelf ? user.uid : undefined,
      slotKey: preferSlot ? user.slotKey : undefined,
      minScore
    })

    if (!message) {
      return success({ messageId: null, text: null, score: null })
    }

    return success({
      messageId: message._id,
      text: message.text,
      score: message.score
    })
  } catch (error) {
    console.error('gnGetRandom error', error)
    return failure(error)
  }
}
