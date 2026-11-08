import { nightStore } from '../../state/night-store'
import { formatNight } from '../../utils/night-time'
import { restoreTabBar } from '../../utils/night-platform'
import type { NightRecord } from '../../types/night'

type Row = NightRecord & { label: string }
Page({
  visible: false, generation: 0, cursor: null as string | null,
  data: { rows: [] as Row[], loading: true, error: '', hasMore: false },
  onShow() { this.visible = true; restoreTabBar(); void this.reload() },
  onHide() { this.deactivate() },
  onUnload() { this.deactivate() },
  deactivate() { if (this.visible) { this.visible = false; this.generation++; nightStore.hide() } },
  async reload() {
    const generation = ++this.generation
    this.cursor = null
    this.setData({ rows: [], loading: true, error: '', hasMore: false })
    const ready = await nightStore.activate()
    if (!this.visible || generation !== this.generation) return
    if (!ready) { this.setData({ loading: false, error: '暂时无法读取夜签，请重试。' }); return }
    await this.loadPage(generation)
  },
  async loadPage(generation: number) {
    this.setData({ loading: true, error: '' })
    try {
      const result = await nightStore.archive(this.cursor || undefined)
      if (!this.visible || generation !== this.generation) return
      const known = new Set(this.data.rows.map(row => row.nightId))
      const rows = result.items.filter(row => !known.has(row.nightId)).map(row => ({ ...row, label: `${row.nightId.slice(0, 4)} 年 ${formatNight(row.nightId)}` }))
      this.cursor = result.nextCursor
      this.setData({ rows: [...this.data.rows, ...rows], hasMore: !!this.cursor, loading: false })
    } catch { if (this.visible && generation === this.generation) this.setData({ loading: false, error: '暂时无法读取夜签，请重试。' }) }
  },
  onReachBottom() { if (!this.data.loading && this.data.hasMore && !this.data.error) void this.loadPage(this.generation) },
  onMore() { if (!this.data.loading && this.data.hasMore) void this.loadPage(this.generation) },
  onRetry() { if (this.data.rows.length) void this.loadPage(this.generation); else void this.reload() },
  onOpen(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/receipt/index?nightId=${event.currentTarget.dataset.night}` }) },
  onTonight() { wx.switchTab({ url: '/pages/night/index' }) }
})
