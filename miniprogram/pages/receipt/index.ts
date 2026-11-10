import { nightStore, nightEvents } from '../../state/night-store'
import { formatConfirmedAt, formatNight, isNightId } from '../../utils/night-time'
import { renderNightCard } from '../../utils/night-card'
import { restoreTabBar } from '../../utils/night-platform'
import type { NightRecord } from '../../types/night'
import { BRAND } from '../../config/brand'

Page({
  visible: false, generation: 0, nightId: '', record: null as NightRecord | null,
  preview: null as { userId: string; nightId: string; path: string } | null,
  data: { loading: true, error: '', phrase: '', date: '', confirmed: '', imagePath: '', rendering: false, saving: false, saveDenied: false, notice: '', privacyNeeded: false, brand: BRAND },
  onLoad(options: Record<string, string | undefined> = {}) { this.nightId = isNightId(options.nightId) ? options.nightId : '' },
  onShow() { this.visible = true; restoreTabBar(); void this.reload() },
  onHide() { this.deactivate() },
  onUnload() { this.deactivate() },
  deactivate() { if (this.visible) { this.visible = false; this.generation++; nightStore.hide() } },
  async reload() {
    const generation = ++this.generation
    this.record = null
    this.setData({ loading: true, error: '', phrase: '', imagePath: '', rendering: false, saving: false, saveDenied: false, notice: '', privacyNeeded: false })
    if (!this.nightId) { this.setData({ loading: false, error: '没有找到这个夜晚。' }); return }
    try {
      if (!await nightStore.activate()) throw new Error('unavailable')
      if (!this.visible || generation !== this.generation) return
      const record = await nightStore.lookup(this.nightId)
      if (!this.visible || generation !== this.generation) return
      this.record = record
      const userId = nightStore.get().snapshot?.userId
      if (this.preview?.userId !== userId || this.preview?.nightId !== record?.nightId) this.preview = null
      this.setData({ loading: false, phrase: record?.phraseText || '', date: `${this.nightId.slice(0, 4)} 年 ${formatNight(this.nightId)}`, confirmed: record ? formatConfirmedAt(record.confirmedAt) : '', error: record ? '' : '这个夜晚还没有查到记录。', imagePath: this.preview?.path || '' })
      if (record) nightEvents.record({ name: 'receipt_view', props: { source: 'archive' } })
    } catch { if (this.visible && generation === this.generation) this.setData({ loading: false, error: '暂时无法读取这个夜晚，请重试。' }) }
  },
  onRetry() { void this.reload() },
  onPublicCard() {
    if (this.visible && this.record) wx.navigateTo({ url: `/pages/public-card/index?nightId=${this.record.nightId}` })
  },
  async onRender() {
    if (!this.visible || !this.record || this.data.rendering) return
    const generation = this.generation, userId = nightStore.get().snapshot?.userId, record = this.record
    const active = () => this.visible && generation === this.generation && nightStore.get().snapshot?.userId === userId
    this.setData({ rendering: true, notice: '', imagePath: '', saveDenied: false })
    try {
      const canvas = await new Promise<WechatMiniprogram.Canvas>((resolve, reject) => {
        wx.createSelectorQuery().in(this).select('#night-card').fields({ node: true }).exec(result => result[0]?.node ? resolve(result[0].node) : reject(new Error('canvas unavailable')))
      })
      const imagePath = await renderNightCard(canvas, record)
      if (!active()) return
      this.preview = { userId: userId!, nightId: record.nightId, path: imagePath }
      this.setData({ imagePath, rendering: false })
      nightEvents.record({ name: 'card_export_result', props: { stage: 'render', ok: true, code: 'OK' } })
    } catch {
      if (!active()) return
      this.setData({ rendering: false, notice: '夜签暂时没有生成，请再试一次。' })
      nightEvents.record({ name: 'card_export_result', props: { stage: 'render', ok: false, code: 'RENDER_FAILED' } })
    }
  },
  async onSave() {
    if (!this.visible || !this.data.imagePath || this.data.saving || this.data.saveDenied) return
    const generation = this.generation, userId = nightStore.get().snapshot?.userId
    const active = () => this.visible && generation === this.generation && userId === nightStore.get().snapshot?.userId
    this.setData({ saving: true, notice: '' })
    try {
      const privacy = await new Promise<WechatMiniprogram.GetPrivacySettingSuccessCallbackResult>((resolve, reject) => wx.getPrivacySetting({ success: resolve, fail: reject }))
      if (!active()) return
      if (privacy.needAuthorization) { this.setData({ saving: false, privacyNeeded: true }); return }
      await new Promise<void>((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: this.data.imagePath, success: () => resolve(), fail: reject }))
      if (!active()) return
      this.setData({ saving: false, notice: '夜签已保存到相册。' })
      nightEvents.record({ name: 'card_export_result', props: { stage: 'save', ok: true, code: 'OK' } })
    } catch (error) {
      if (!active()) return
      const message = String((error as { errMsg?: string })?.errMsg || '')
      if (/cancel/i.test(message) && !/deny|denied/i.test(message)) {
        this.setData({ saving: false, saveDenied: false, notice: '已取消保存，你可以继续查看夜签。' })
        return
      }
      const denied = /auth(?:orize)?(?:\s*:\s*fail)?\s+(?:deny|denied)\b|permission\s+(?:deny|denied)\b|access\s+denied\b/i.test(message)
      this.setData({ saving: false, saveDenied: denied, notice: denied ? '没有获得相册权限，夜签预览仍在这里。需要保存时，可以主动打开权限设置。' : '暂时无法保存，预览仍在这里，可以稍后重试。' })
      nightEvents.record({ name: 'card_export_result', props: { stage: 'save', ok: false, code: denied ? 'SAVE_DENIED' : 'SAVE_FAILED' } })
    }
  },
  onPrivacyGuide() { wx.openPrivacyContract({ fail: () => this.setData({ notice: '暂时无法打开隐私指引，请稍后重试。' }) }) },
  onPrivacyAgree() { this.setData({ privacyNeeded: false }); void this.onSave() },
  onPrivacyCancel() {
    this.setData({ privacyNeeded: false, notice: '已取消保存，你可以继续查看夜签。' })
  },
  onSettings() {
    const userId = nightStore.get().snapshot?.userId
    wx.openSetting({ success: result => { if (userId === nightStore.get().snapshot?.userId) this.setData({ saveDenied: !result.authSetting['scope.writePhotosAlbum'] }) }, fail: () => { if (this.visible) this.setData({ notice: '可以在微信的小程序设置中调整相册权限。' }) } })
  }
})
