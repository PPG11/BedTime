const { cloud, initCloud } = require('../common/cloud')
const { createError } = require('../common/errors')
const { success, failure } = require('../common/response')

initCloud()

exports.main = async (event) => {
  try {
    const code = typeof event?.code === 'string' ? event.code.trim() : ''
    if (!code) {
      throw createError('INVALID_ARG', '缺少登录 code')
    }
    const response = await cloud.openapi.auth.code2Session({
      js_code: code,
      grant_type: 'authorization_code'
    })
    if (!response?.openid) {
      throw createError('INTERNAL', '无法获取 openid')
    }
    return success({ openid: response.openid })
  } catch (error) {
    console.error('authCode2Session error', error)
    if (error?.errCode && !error.code) {
      error.code = 'INTERNAL'
    }
    return failure(error)
  }
}
