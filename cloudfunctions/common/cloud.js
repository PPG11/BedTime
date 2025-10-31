const cloud = require('wx-server-sdk')

let initialized = false

function initCloud() {
  if (!initialized) {
    cloud.init({
      env: cloud.DYNAMIC_CURRENT_ENV
    })
    initialized = true
  }
  return cloud
}

function getDb() {
  return initCloud().database()
}

function getOpenId(context) {
  if (context && typeof context.OPENID === 'string') {
    return context.OPENID
  }
  const runtime = cloud.getWXContext?.()
  return runtime?.OPENID || null
}

module.exports = {
  cloud,
  initCloud,
  getDb,
  getOpenId
}
