import { restoreTabBar } from '../../utils/night-platform'
Page({
  data: { contact: 'luolie0577@gmail.com', copied: false },
  onShow() { restoreTabBar() },
  onCopyContact() { wx.setClipboardData({ data: this.data.contact, success: () => this.setData({ copied: true }) }) }
})
