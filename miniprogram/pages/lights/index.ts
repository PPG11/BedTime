import { growthApi } from '../../services/growth'
import { nightStore } from '../../state/night-store'
import { restoreTabBar } from '../../utils/night-platform'
import { formatNight, isNightId } from '../../utils/night-time'
function hour(value: number) { return `${value >= 24 ? '次日 ' : ''}${String(value % 24).padStart(2, '0')}:00` }
Page({
  visible: false, generation: 0,
  data: { loading: true, error: '', dates: [] as { id: string; label: string; displayLabel: string }[], hasDates: false, selected: 0, choosing: false, night: '', suppressed: true, total: null as number | null, bars: [] as { label: string; count: number; width: number }[], ownText: '' },
  onShow() { this.visible = true; restoreTabBar(); void this.reload() },
  onHide() { this.deactivate() }, onUnload() { this.deactivate() },
  deactivate() { if (this.visible) { this.visible = false; this.generation++; nightStore.hide() } },
  async reload(nightId?: string) {
    const generation = ++this.generation
    this.setData({ loading: true, error: '', bars: [], ownText: '', total: null })
    try {
      if (!await nightStore.activate()) throw new Error('identity')
      const userId = nightStore.get().snapshot?.userId
      if (!this.visible || generation !== this.generation) return
      const r = await growthApi.getLights(nightId)
      if (!this.visible || generation !== this.generation || userId !== nightStore.get().snapshot?.userId) return
      const maximum = Math.max(1, ...r.buckets.map(b => b.count))
      this.setData({ loading: false, dates: r.availableNightIds.map(id => ({ id, label: formatNight(id), displayLabel: `${formatNight(id)}${id === r.nightId ? ' · 当前选择' : ''}` })), hasDates: r.availableNightIds.length > 0, selected: r.availableNightIds.indexOf(r.nightId), night: formatNight(r.nightId), suppressed: r.suppressed, total: r.total, bars: r.buckets.map(b => ({ label: `${hour(b.startHour)}—${hour(b.endHour)}`, count: b.count, width: Math.max(4, b.count / maximum * 100) })), ownText: r.ownRecord ? '你已为当前这一晚留下关灯记录。' : '当前这一晚，你还没有留下关灯记录。' })
    } catch { if (this.visible && generation === this.generation) this.setData({ loading: false, error: '灯迹暂时没有读到，可以稍后重试。' }) }
  },
  onChooseNight() { if (!this.data.loading && this.data.dates.length) this.setData({ choosing: !this.data.choosing }) },
  onNightSelected(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.night
    if (!this.data.loading && isNightId(id) && this.data.dates.some(item => item.id === id)) { this.setData({ choosing: false }); void this.reload(id) }
  },
  onRetry() { void this.reload(this.data.dates[this.data.selected]?.id) },
  onTonight() { wx.switchTab({ url: '/pages/night/index' }) }
})
