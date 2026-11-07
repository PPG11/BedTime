class AppError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function requireValue(condition, code, message) {
  if (!condition) throw new AppError(code, message)
}

module.exports = { AppError, requireValue }
