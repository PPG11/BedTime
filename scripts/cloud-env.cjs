const fs = require('node:fs')
const path = require('node:path')
const { parseEnv } = require('node:util')

const LOCAL_ENV_FILE = '.env.local'

/** Build and deployment must resolve the same target, without mutating process.env. */
function resolveCloudEnvironment(root, { env = process.env, requireCloud = false } = {}) {
  const file = path.join(root, LOCAL_ENV_FILE)
  const local = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {}
  const value = key => (env[key] !== undefined ? env[key] : local[key])?.trim()
  const cloudEnvId = value('CLOUD_ENV_ID') || ''
  const enableCloud = value('ENABLE_CLOUD')
  if (enableCloud !== undefined && !['true', 'false'].includes(enableCloud)) {
    throw new Error('ENABLE_CLOUD 必须为 true 或 false。')
  }
  const cloudEnabled = enableCloud !== 'false'
  if (requireCloud && !cloudEnabled) {
    throw new Error('发布或部署必须启用云开发；请移除 ENABLE_CLOUD=false。')
  }
  if (cloudEnabled && !cloudEnvId) {
    throw new Error('缺少 CLOUD_ENV_ID。请在 .env.local 中配置云环境；仅离线预览时显式设置 ENABLE_CLOUD=false。')
  }
  if (cloudEnvId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(cloudEnvId)) {
    throw new Error('CLOUD_ENV_ID 格式无效，请填写云环境 ID。')
  }
  return { cloudEnvId, cloudEnabled }
}

module.exports = { LOCAL_ENV_FILE, resolveCloudEnvironment }
