const { expose } = require('common/response')
const { send, respond, remove, overview } = require('common/friends')

exports.main = expose({ send, respond, remove, overview })
