const { initCloud, getOpenId } = require('common/cloud')
const { createError } = require('common/errors')
const { success, failure } = require('common/response')

initCloud()

exports.main = async (event, context) => {
  try {
    const openid = getOpenId(context)
    if (!openid) {
      throw createError('INTERNAL', '无法获取 openid')
    }

    return success({ openid })
  } catch (error) {
    console.error('login error', error)
    return failure(error)
  }
}
