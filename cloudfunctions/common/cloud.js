const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function getDb() {
  return cloud.database({ throwOnNotFound: false })
}

module.exports = { cloud, getDb }
