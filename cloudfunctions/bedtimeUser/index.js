const { expose } = require('common/response')
const { bootstrap, updateProfile } = require('common/users')

exports.main = expose({ bootstrap, updateProfile })
