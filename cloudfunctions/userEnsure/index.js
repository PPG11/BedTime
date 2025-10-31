const { initCloud, getOpenId } = require('../common/cloud')
const { ensureUser, toUserResponse } = require('../common/users')
const { success, failure } = require('../common/response')

initCloud()

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    const overrides = typeof event === 'object' && event ? event : {}
    const user = await ensureUser(openid, overrides)
    return success(toUserResponse(user))
  } catch (error) {
    console.error('userEnsure error', error)
    return failure(error)
  }
}
