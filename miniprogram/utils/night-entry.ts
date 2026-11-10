import { BRAND } from '../config/brand'

export function showAddToMine() {
  wx.showModal({ title: '下次更容易找到', content: `点击微信右上角「···」，选择「添加到我的小程序」。以后可从微信聊天列表下拉，在「我的小程序」找到「${BRAND.name}」。`, showCancel: false, confirmText: '知道了' })
}
