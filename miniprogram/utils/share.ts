const SHARE_TITLE = '早睡助手｜和好友一起坚持好睡眠'
const SHARE_PATH = '/pages/home/index'

export function showPageShareMenu(): void {
  // Native pages enable these entries through wx, not page.json flags.
  void wx.showShareMenu({
    menus: ['shareAppMessage', 'shareTimeline'],
    fail: error => console.warn('显示页面分享菜单失败', error)
  })
}

function createShareQuery(uid: string | undefined): string {
  if (!uid || !uid.trim()) {
    return ''
  }
  return `ref=${encodeURIComponent(uid.trim())}`
}

export function createSharePath(uid: string | undefined): string {
  const query = createShareQuery(uid)
  return query.length ? `${SHARE_PATH}?${query}` : SHARE_PATH
}

export function getShareAppMessageOptions(uid: string | undefined): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: SHARE_TITLE,
    path: createSharePath(uid)
  }
}

export function getShareTimelineOptions(uid: string | undefined): WechatMiniprogram.Page.ICustomTimelineContent {
  const query = createShareQuery(uid)
  return {
    title: SHARE_TITLE,
    ...(query.length ? { query } : {})
  }
}
