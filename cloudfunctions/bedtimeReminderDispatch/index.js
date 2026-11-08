const { cloud, getDb } = require('common/cloud')
const { dispatchReminders } = require('common/night-reminders')

exports.main = async () => {
  // Trigger source is supplied by the platform, never trusted from event data.
  const hasWechatUser = Boolean(cloud.getWXContext().OPENID)
  // WeChat IDE timers use the authenticated wx_trigger source plus a platform
  // timer ticket in this environment; their TRIGGER_SRC is not "timer".
  const wechatTimer = process.env.TCB_SOURCE === 'wx_trigger' && Boolean(process.env.WX_TRIGGER_API_TOKEN_V0)
  if ((!wechatTimer && process.env.TRIGGER_SRC !== 'timer') || hasWechatUser) {
    // Fixed categories only: no caller IDs, event bodies or platform credentials.
    console.warn('Reminder invocation rejected', JSON.stringify({
      triggerSource: process.env.TRIGGER_SRC === 'timer' ? 'timer' : process.env.TRIGGER_SRC ? 'other' : 'missing',
      wechatTimer, hasWechatUser
    }))
    return { code: 'UNAUTHORIZED' }
  }
  try {
    const data = await dispatchReminders(getDb(), { send: message => cloud.openapi.subscribeMessage.send(message) })
    console.info('Reminder tick', JSON.stringify(data))
    return { code: 'OK', data }
  } catch (error) {
    console.error('Reminder dispatch failed', error?.code || error?.errCode || error?.name)
    return { code: 'INTERNAL' }
  }
}
