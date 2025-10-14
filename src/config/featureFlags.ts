import { env } from './env'

export const ENABLE_ANALYTICS = env.TARO_APP_ENABLE_ANALYTICS === 'true'
export const ANALYTICS_DEBUG = env.TARO_APP_ANALYTICS_DEBUG === 'true'
