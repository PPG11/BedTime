import { runtime } from './runtime'

export const CLOUD_ENV_ID = runtime.cloudEnvId.trim()
export const CLOUD_SHOULD_ENABLE = Boolean(CLOUD_ENV_ID) && runtime.cloudEnabled
