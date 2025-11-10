import type {
  ShareAppMessageReturn,
  ShareTimelineReturnObject
} from '@tarojs/taro'

const SHARE_TITLE = '早睡助手｜和好友一起坚持好睡眠'
const SHARE_PATH = '/pages/home/index'

function createShareQuery(uid?: string): string {
  if (!uid || !uid.trim()) {
    return ''
  }
  return `ref=${encodeURIComponent(uid.trim())}`
}

export function createSharePath(uid?: string): string {
  const query = createShareQuery(uid)
  return query.length ? `${SHARE_PATH}?${query}` : SHARE_PATH
}

export function getShareAppMessageOptions(uid?: string): ShareAppMessageReturn {
  return {
    title: SHARE_TITLE,
    path: createSharePath(uid)
  }
}

export function getShareTimelineOptions(uid?: string): ShareTimelineReturnObject {
  const query = createShareQuery(uid)
  return {
    title: SHARE_TITLE,
    ...(query.length ? { query } : {})
  }
}
