class AppError extends Error {
  constructor(code, message, data) {
    super(message)
    this.code = code
    this.data = data
  }
}

function requireValue(condition, code, message) {
  if (!condition) throw new AppError(code, message)
}

module.exports = { AppError, requireValue }
