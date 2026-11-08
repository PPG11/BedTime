const { expose } = require('common/response')
const { createNightActions, validateNightRequest } = require('common/nights')

exports.main = expose(createNightActions(), { validate: validateNightRequest })
