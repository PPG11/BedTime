const { cloud, getDb } = require('./cloud')
const { AppError } = require('./errors')

function expose(actions) {
  return async event => {
    const openid = cloud.getWXContext().OPENID
    if (!openid) return { code: 'UNAUTHORIZED', message: '请在微信小程序中登录' }

    const action = event?.action
    if (typeof action !== 'string' || !Object.hasOwn(actions, action)) {
      return { code: 'INVALID_ARG', message: '不支持的操作' }
    }

    try {
      return { code: 'OK', data: await actions[action](getDb(), openid, event) }
    } catch (error) {
      if (error instanceof AppError) return { code: error.code, message: error.message }
      console.error('Cloud operation failed', action, error?.code || error?.errCode || error?.name)
      return { code: 'INTERNAL', message: '服务暂不可用，请重试' }
    }
  }
}

module.exports = { expose }
