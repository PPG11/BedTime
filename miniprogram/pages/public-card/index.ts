import { growthApi, isCardId } from '../../services/growth'
import type { CardReply, PublicCard } from '../../types/growth'
import { nightStore } from '../../state/night-store'
import { restoreTabBar } from '../../utils/night-platform'
import { formatNight, isNightId } from '../../utils/night-time'
import { BRAND } from '../../config/brand'
const unavailable = '这张公开夜签已失效，或已由分享者撤销。'
Page({
  visible: false, generation: 0, nightId: '', cardId: '', userId: '',
  data: { loading: true, busy: false, error: '', notice: '', owner: false, valid: true, status: 'none', card: null as PublicCard | null, phrase: '', night: '', expiry: '', confirmed: false, revokeUnknown: false, brand: BRAND },
  onLoad(options: Record<string, string | undefined>) {
    this.nightId = isNightId(options.nightId) ? options.nightId : ''
    this.cardId = isCardId(options.cardId) ? options.cardId : ''
    this.setData({ owner: !!this.nightId && !this.cardId, valid: !!this.nightId !== !!this.cardId })
  },
  onShow() { this.visible = true; restoreTabBar(); void this.reload() },
  onHide() { this.deactivate() }, onUnload() { this.deactivate() },
  deactivate() { if (this.visible) { this.visible = false; this.generation++; nightStore.hide() } },
  active(generation: number) { return this.visible && generation === this.generation && (!this.data.owner || this.userId === nightStore.get().snapshot?.userId) },
  present(reply: CardReply) {
    const card = reply.card
    try { if (reply.status === 'active') wx.showShareMenu({ menus: ['shareAppMessage'], fail() {} }); else wx.hideShareMenu({ menus: ['shareAppMessage'], fail() {} }) } catch { /* The explicit share button remains gated by an active card. */ }
    this.setData({ status: reply.status, card, revokeUnknown: false, phrase: card?.phraseText || this.data.phrase, night: card ? formatNight(card.nightId) : this.data.night, expiry: card ? `${formatNight(new Date(card.expiresAt + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '')).replace('的夜晚', '')}到期` : '', notice: reply.status === 'unavailable' ? unavailable : reply.status === 'revoked' ? '原链接已撤销，不能再打开。这个夜晚不再生成新的公开链接。' : reply.status === 'expired' ? '这张夜签已到期。这个夜晚不再生成新的公开链接。' : '' })
  },
  async reload() {
    const generation = ++this.generation
    try { wx.hideShareMenu({ menus: ['shareAppMessage'], fail() {} }) } catch { /* Older hosts may not expose menu control. */ }
    this.setData({ loading: true, busy: false, error: '', notice: '', card: null, phrase: '', night: '', confirmed: false })
    if (!this.data.valid) { this.setData({ loading: false, error: '这个夜签地址无效。' }); return }
    try {
      if (this.data.owner) {
        if (!await nightStore.activate()) throw new Error('identity')
        if (!this.visible || generation !== this.generation) return
        this.userId = nightStore.get().snapshot?.userId || ''
        const record = await nightStore.lookup(this.nightId)
        if (!this.active(generation)) return
        if (!record) { this.setData({ loading: false, error: '没有找到你在这一晚的关灯记录。' }); return }
        this.setData({ phrase: record.phraseText, night: formatNight(record.nightId) })
      }
      const reply = this.data.owner ? await growthApi.getOwnedCard(this.nightId) : await growthApi.getPublicCard(this.cardId)
      if (!this.active(generation)) return
      this.present(reply); this.setData({ loading: false })
    } catch { if (this.visible && generation === this.generation) this.setData({ loading: false, error: '暂时没有读到夜签，请重试。' }) }
  },
  onConfirm(event: WechatMiniprogram.CheckboxGroupChange) { this.setData({ confirmed: event.detail.value.includes('agree') }) },
  async onCreate() {
    if (!this.data.owner || this.data.status !== 'none' || !this.data.confirmed || this.data.busy || !this.active(this.generation)) return
    const generation = this.generation
    this.setData({ busy: true, notice: '' })
    try { const reply = await growthApi.createPublicCard(this.nightId); if (this.active(generation)) this.present(reply) }
    catch { if (this.active(generation)) this.setData({ notice: '暂时未确认是否已生成。请点「查看结果」，不会重复生成链接。' }) }
    finally { if (this.active(generation)) this.setData({ busy: false }) }
  },
  async onRevoke() {
    if (!this.data.card || this.data.busy || this.data.revokeUnknown || !this.data.owner) return
    const generation = this.generation, cardId = this.data.card.cardId
    wx.showModal({ title: '撤销公开夜签', content: '撤销后原链接立即失效；这个夜晚不能再生成新的公开链接。你自己的记录和图片会保留。', confirmText: '撤销链接', success: result => { if (result.confirm && this.active(generation)) void this.revoke(generation, cardId) } })
  },
  async revoke(generation: number, cardId: string) {
    this.setData({ busy: true, revokeUnknown: true, notice: '' })
    try { wx.hideShareMenu({ menus: ['shareAppMessage'], fail() {} }) } catch { /* Share button remains disabled. */ }
    try { const reply = await growthApi.revokePublicCard(this.nightId, cardId); if (this.active(generation)) this.present(reply) }
    catch { if (this.active(generation)) this.setData({ notice: '暂时未确认撤销结果，已暂停分享。请点「查看结果」确认链接状态。' }) }
    finally { if (this.active(generation)) this.setData({ busy: false }) }
  },
  onRetry() { void this.reload() },
  onTonight() { wx.switchTab({ url: '/pages/night/index' }) },
  onShareAppMessage() { const card = this.data.card; return card && this.data.status === 'active' && !this.data.revokeUnknown ? { title: card.phraseText, path: `/pages/public-card/index?cardId=${card.cardId}&ref=share` } : { title: BRAND.name, path: '/pages/night/index?ref=share' } }
})
