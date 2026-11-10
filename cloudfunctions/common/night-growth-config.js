// Administrators and analysis exclusions are deployment settings, never client fields.
// Invalid JSON or malformed entries fail closed rather than broadening access.
function hashes(name, fallback) {
  try {
    const value = Object.hasOwn(process.env, name) ? JSON.parse(process.env[name]) : fallback === undefined ? [] : fallback
    return Array.isArray(value) && value.every(item => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item)) ? [...new Set(value)] : null
  } catch { return null }
}

function resolveConfig(privateConfig = {}) {
  if (!privateConfig || typeof privateConfig !== 'object' || Array.isArray(privateConfig) || Object.keys(privateConfig).some(key => !['adminHashes', 'excludeHashes'].includes(key))) return { adminHashes: null, excludeHashes: null }
  return {
    adminHashes: hashes('NIGHT_ADMIN_OPENID_HASHES', privateConfig.adminHashes),
    excludeHashes: hashes('NIGHT_ANALYTICS_EXCLUDE_HASHES', privateConfig.excludeHashes)
  }
}

module.exports = { ...resolveConfig(), resolveConfig }
