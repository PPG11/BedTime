import { restoreTabBar } from '../../utils/night-platform'
import { BRAND } from '../../config/brand'
Page({
  data: { contact: 'luolie0577@gmail.com', copied: false, brand: BRAND },
  onShow() { restoreTabBar() },
  onCopyContact() { wx.setClipboardData({ data: this.data.contact, success: () => this.setData({ copied: true }) }) }
})
