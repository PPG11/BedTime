function createError(code, message, extra = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, extra)
  return error
}

function normalizeError(error) {
  if (!error) {
    return { code: 'INTERNAL', message: 'Internal error' }
  }
  const code = typeof error.code === 'string' ? error.code : 'INTERNAL'
  const message = typeof error.message === 'string' ? error.message : 'Internal error'
  return { code, message }
}

module.exports = {
  createError,
  normalizeError
}
