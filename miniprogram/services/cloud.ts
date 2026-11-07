import { CLOUD_ENV_ID, CLOUD_SHOULD_ENABLE } from '../config/cloud'

type CloudDomain = 'bedtimeUser' | 'bedtimeCheckin' | 'bedtimeGoodnight' | 'bedtimeFriends'
type CloudResponse<T> = { code: string; message?: string; data?: T }
let initialized = false

export function supportsCloud(): boolean {
  return CLOUD_SHOULD_ENABLE && typeof wx !== 'undefined' && Boolean(wx.cloud)
}

export class CloudError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

export async function callCloud<T>(name: CloudDomain, action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!supportsCloud()) throw new Error('当前环境未连接微信云开发')
  if (!initialized) {
    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
    initialized = true
  }

  const response = await wx.cloud.callFunction({ name, data: { ...data, action } })
  const result = response.result as CloudResponse<T> | undefined
  if (!result || result.code !== 'OK') {
    throw new CloudError(result?.code ?? 'INTERNAL', result?.message ?? '云服务未返回有效结果')
  }
  if (result.data === undefined) throw new CloudError('INTERNAL', '云服务未返回有效数据')
  return result.data
}
