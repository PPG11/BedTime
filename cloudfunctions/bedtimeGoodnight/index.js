const { expose } = require('common/response')
const { ownSubmission, submit, reward, vote } = require('common/goodnight')

exports.main = expose({ ownSubmission, submit, reward, vote })
