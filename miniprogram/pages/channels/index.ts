import { growthApi, isChannelCode, getChannelWrite, waitChannelWrite, confirmChannelWrite } from '../../services/growth'
import { CloudError } from '../../services/cloud'
import type { GrowthChannel } from '../../types/growth'
import { nightStore } from '../../state/night-store'
import { restoreTabBar } from '../../utils/night-platform'
import { BRAND } from '../../config/brand'
Page({
  visible: false, generation: 0, userId: '', waitTimer: null as number | null,
  data: { loading: true, denied: false, error: '', notice: '', busy: false, writeUnknown: false, delayed: false, code: '', label: '', channels: [] as GrowthChannel[] },
  onShow() { this.visible = true; restoreTabBar(); void this.reload() },
  onHide() { this.deactivate() }, onUnload() { this.deactivate() },
  clearWait() { if (this.waitTimer !== null) clearTimeout(this.waitTimer); this.waitTimer = null },
  deactivate() { this.clearWait(); if (this.visible) { this.visible = false; this.generation++; nightStore.hide() } },
  active(generation: number) { return this.visible && generation === this.generation && this.userId === nightStore.get().snapshot?.userId },
  watchPending(generation: number) {
    const pending = waitChannelWrite(this.userId)
    if (!pending) return
    this.clearWait()
    this.waitTimer = setTimeout(() => { if (this.active(generation)) this.setData({ delayed: true, notice: '保存尚未确认，可以先离开。收到结果前暂不能修改其他渠道。' }) }, 8000)
    void pending.then(() => { if (this.active(generation)) void this.reload() })
  },
  async reload() {
    this.clearWait()
    const generation = ++this.generation
    this.setData({ loading: true, denied: false, error: '', notice: '', busy: false, writeUnknown: false, delayed: false, channels: [] })
    try {
      if (!await nightStore.activate()) throw new Error('identity')
      if (!this.visible || generation !== this.generation) return
      this.userId = nightStore.get().snapshot?.userId || ''
      const access = await growthApi.getGrowthAccess()
      if (!this.active(generation)) return
      if (!access.isAdmin) { this.setData({ loading: false, denied: true }); return }
      const result = await growthApi.getChannels()
      if (!this.active(generation)) return
      const confirmed = confirmChannelWrite(this.userId, result.channels), write = getChannelWrite(this.userId)
      this.setData({ loading: false, channels: result.channels, busy: !!write?.pending, writeUnknown: !!write?.unknown,
        notice: confirmed ? '上次保存结果已确认。' : write?.pending ? '上次保存仍在确认中，可以先离开。' : write?.unknown ? '上次保存结果尚未确认，暂不能修改其他内容。可以再次查看，或重试同一次保存。' : '' })
      if (write?.pending) this.watchPending(generation)
    } catch (error) { if (this.visible && generation === this.generation) this.setData({ loading: false, denied: error instanceof CloudError && error.code === 'FORBIDDEN', error: '渠道暂时没有读到，请重试。' }) }
  },
  onCode(event: WechatMiniprogram.Input) { if (!this.data.busy && !this.data.writeUnknown) this.setData({ code: event.detail.value.trim().toLowerCase() }) },
  onLabel(event: WechatMiniprogram.Input) { if (!this.data.busy && !this.data.writeUnknown) this.setData({ label: event.detail.value }) },
  async onCreate() {
    if (this.data.busy || this.data.writeUnknown || this.data.denied || this.data.loading) return
    const code = this.data.code, label = this.data.label.trim()
    if (!isChannelCode(code) || !label || Array.from(label).length > 24 || ['unknown', 'share'].includes(code)) { this.setData({ notice: '请填写 2—32 位小写字母、数字、短横线或下划线标识，以及 1—24 字名称。unknown、share 为保留标识。' }); return }
    if (this.data.channels.some(c => c.code === code)) { this.setData({ notice: '这个标识已存在，请使用新的标识。' }); return }
    await this.save(code, label, true)
  },
  async save(code: string, label: string, enabled: boolean) {
    const generation = this.generation
    if (!this.active(generation) || this.data.busy) return
    this.setData({ busy: true, writeUnknown: false, delayed: false, notice: '' }); this.clearWait()
    this.waitTimer = setTimeout(() => { if (this.active(generation)) this.setData({ delayed: true, notice: '保存尚未确认，可以先离开。收到结果前暂不能修改其他渠道。' }) }, 8000)
    try {
      const result = await growthApi.saveChannel(code, label, enabled, this.userId)
      if (!this.active(generation)) return
      const channels = [...this.data.channels.filter(c => c.code !== code), result.channel].sort((a, b) => a.code.localeCompare(b.code))
      this.setData({ channels, code: '', label: '', notice: enabled ? '渠道已启用，可以复制入口或分享。' : '渠道已停用，历史来源保持不变。' })
    } catch {
      if (this.active(generation)) {
        const unknown = !!getChannelWrite(this.userId)?.unknown
        this.setData({ writeUnknown: unknown, notice: unknown ? '暂时未确认保存结果。请先重新读取；结果确认前不能修改其他内容。' : '这次修改没有保存，请重新读取后再试。' })
      }
    } finally { if (this.active(generation)) { this.clearWait(); this.setData({ busy: false, delayed: false }) } }
  },
  onRetrySave() { const write = getChannelWrite(this.userId); if (write?.unknown && !write.pending && !this.data.loading && !this.data.busy) void this.save(write.code, write.label, write.enabled) },
  onToggle(event: WechatMiniprogram.TouchEvent) { const c = this.data.channels.find(row => row.code === event.currentTarget.dataset.code); if (c && !this.data.busy && !this.data.writeUnknown) void this.save(c.code, c.label, !c.enabled) },
  onCopy(event: WechatMiniprogram.TouchEvent) { const c = this.data.channels.find(row => row.code === event.currentTarget.dataset.code); if (c?.enabled && !this.data.busy && !this.data.writeUnknown) wx.setClipboardData({ data: `pages/night/index?ref=${c.code}`, success: () => { if (this.visible) this.setData({ notice: '页面路径已复制，可用于已授权的小程序入口配置。' }) } }) },
  onRetry() { void this.reload() }, onMine() { wx.switchTab({ url: '/pages/me/index' }) },
  onShareAppMessage(event: WechatMiniprogram.Page.IShareAppMessageOption) { const code = event.target?.dataset.code; const c = this.data.channels.find(row => row.code === code && row.enabled); return { title: BRAND.name, path: `/pages/night/index?ref=${!this.data.busy && !this.data.writeUnknown && c ? c.code : 'share'}` } }
})
