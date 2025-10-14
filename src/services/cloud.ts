import Taro from '@tarojs/taro'
import {
  CLOUD_ENV_CONFIGURED,
  CLOUD_ENV_ID,
  CLOUD_SHOULD_ENABLE
} from '../config/cloud'

type CloudComparisonCommand = {
  and(condition: unknown): unknown
}

type CloudCommand = {
  gte(value: unknown): CloudComparisonCommand
  lte(value: unknown): unknown
  in(values: unknown[]): unknown
}

export type CloudDocumentSnapshot<T> = {
  data?: T
}

export type DbDocumentHandle<T> = {
  get(): Promise<CloudDocumentSnapshot<T>>
  set(options: { data: Partial<T> }): Promise<unknown>
  update(options: { data: Partial<T> }): Promise<unknown>
}

export type DbCollection<T> = {
  doc(id: string): DbDocumentHandle<T>
  where(query: Record<string, unknown>): DbCollection<T>
  count(): Promise<{ total: number }>
  orderBy(field: keyof T, order: 'asc' | 'desc'): DbCollection<T>
  limit(count: number): DbCollection<T>
  get(): Promise<{ data?: T[] }>
}

export type CloudDatabase = {
  collection<T>(name: string): DbCollection<T>
  serverDate?: () => Date
  command: CloudCommand
}

type TaroCloud = {
  init(options: { traceUser?: boolean; env?: string }): void
  database(): CloudDatabase
  callFunction(options: { name: string; data?: Record<string, unknown> }): Promise<unknown>
}

let databaseCache: CloudDatabase | null = null
let openIdCache: string | null = null

export function supportsCloud(): boolean {
  if (!CLOUD_SHOULD_ENABLE) {
    return false
  }

  const env = Taro.getEnv?.()
  if (!env || env !== Taro.ENV_TYPE.WEAPP) {
    return false
  }

  return Boolean((Taro as unknown as { cloud?: unknown }).cloud)
}

export async function ensureCloud(): Promise<CloudDatabase> {
  if (!CLOUD_SHOULD_ENABLE) {
    throw new Error('未配置云开发环境，当前运行在本地模式')
  }

  if (!supportsCloud()) {
    throw new Error('当前运行环境不支持微信云开发，请在小程序端使用。')
  }

  if (databaseCache) {
    return databaseCache
  }

  const cloud = (Taro as unknown as { cloud?: TaroCloud }).cloud
  if (!cloud) {
    throw new Error('Taro.cloud 未初始化')
  }

  const envId = CLOUD_ENV_ID.trim()
  if (envId) {
    try {
      cloud.init({
        traceUser: true,
        env: envId
      })
    } catch (error) {
      console.warn('微信云开发初始化（带 envId）失败，使用默认环境', error)
      cloud.init({
        traceUser: true
      })
    }
  } else if (CLOUD_ENV_CONFIGURED) {
    console.warn('云开发环境 ID 为空字符串，已跳过自定义环境初始化')
  }

  databaseCache = cloud.database()
  return databaseCache
}

type LoginResult = {
  result?: {
    openid?: string
  }
}

export async function getCurrentOpenId(): Promise<string> {
  if (openIdCache) {
    return openIdCache
  }

  try {
    await ensureCloud()

    const response = (await Taro.cloud.callFunction({
      name: 'login'
    })) as LoginResult

    const openid = response?.result?.openid
    if (!openid) {
      throw new Error('登录云函数未返回 openid')
    }

    openIdCache = openid
    return openid
  } catch (error) {
    console.error('获取 openid 失败，云函数可能未部署或云开发环境未配置', error)
    throw new Error('无法获取用户身份信息，请检查云函数配置或使用本地模式')
  }
}
