import { env } from './env'

const DEFAULT_CLOUD_ENV_ID = 'cloud1-0gw1plhs593190e1'

export const CLOUD_ENV_ID = process.env.TARO_APP_CLOUD_ENV_ID?.trim() || DEFAULT_CLOUD_ENV_ID

export const CLOUD_SHOULD_ENABLE = Boolean(CLOUD_ENV_ID) && env.TARO_APP_ENABLE_CLOUD !== 'false'

export const COLLECTIONS = {
  users: 'users',
  checkins: 'checkins',
  publicProfiles: 'public_profiles',
  goodnightMessages: 'goodnight_messages'
} as const

export const UID_LENGTH = 8
export const UID_MAX_RETRY = 8
