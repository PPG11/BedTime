// 将下面的空字符串替换为你的云开发环境 ID
// 例如：'cloud1-xxx' 或 'env-xxxxx'
// 如果留空，应用会自动使用本地模式
import { env } from './env'

export const CLOUD_ENV_ID = 'cloud1-0gw1plhs593190e1'

const trimmedEnvId = CLOUD_ENV_ID.trim()

export const CLOUD_ENV_CONFIGURED = trimmedEnvId.length > 0

export const CLOUD_SHOULD_ENABLE =
  CLOUD_ENV_CONFIGURED && env.TARO_APP_ENABLE_CLOUD !== 'false'

export const COLLECTIONS = {
  users: 'users',
  checkins: 'checkins',
  publicProfiles: 'public_profiles',
  goodnightMessages: 'goodnight_messages'
} as const

export const UID_LENGTH = 8
export const UID_MAX_RETRY = 8
