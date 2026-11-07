const { expose } = require('common/response')
const { status, history, submit } = require('common/checkins')

exports.main = expose({ status, history, submit })
