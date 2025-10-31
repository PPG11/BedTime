const { normalizeError } = require('./errors')

function success(payload = {}) {
  return Object.assign({ code: 'OK' }, payload)
}

function failure(error) {
  const normalized = normalizeError(error)
  return Object.assign({ code: normalized.code, message: normalized.message }, normalized.payload || {})
}

module.exports = {
  success,
  failure
}
