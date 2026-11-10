import { growthApi } from '../../services/growth'
import { CloudError } from '../../services/cloud'
import { nightStore } from '../../state/night-store'
import { restoreTabBar } from '../../utils/night-platform'
import { resolveNight } from '../../utils/night-time'
import type { DashboardReply } from '../../types/growth'
const percent = (value: number | null) => value === null ? '暂无成熟样本' : `${(value * 100).toFixed(1)}%`
function previousNight(id: string, days: number) { return new Date(Date.UTC(Number(id.slice(0, 4)), Number(id.slice(4, 6)) - 1, Number(id.slice(6, 8)) - days)).toISOString().slice(0, 10).replace(/-/g, '') }
Page({
  visible: false, generation: 0,
  data: { loading: true, denied: false, error: '', days: 7, from: '', to: '', report: null as DashboardReply | null, retentionText: '', daily: [] as { label: string; users: number; activations: number; width: number }[], channels: [] as { code: string; label: string; arrivals: number; matureArrivals: number; activations: number; rate: string }[], cohorts: [] as { label: string; mature: number; immature: number; reachedThree: number; rate: string }[] },
  onShow() { this.visible = true; restoreTabBar(); void this.reload() },
  onHide() { this.deactivate() }, onUnload() { this.deactivate() },
  deactivate() { if (this.visible) { this.visible = false; this.generation++; nightStore.hide() } },
  async reload() {
    const generation = ++this.generation
    this.setData({ loading: true, denied: false, error: '', report: null, daily: [], channels: [], cohorts: [] })
    try {
      if (!await nightStore.activate()) throw new Error('identity')
      const userId = nightStore.get().snapshot?.userId
      const active = () => this.visible && generation === this.generation && userId === nightStore.get().snapshot?.userId
      if (!active()) return
      const access = await growthApi.getGrowthAccess()
      if (!active()) return
      if (!access.isAdmin) { this.setData({ loading: false, denied: true }); return }
      const to = resolveNight(access.serverNow).nightId, from = previousNight(to, this.data.days - 1)
      const report = await growthApi.getDashboard(from, to)
      if (!active()) return
      const maximum = Math.max(1, ...report.daily.map(d => d.users))
      this.setData({ loading: false, report, from, to, retentionText: percent(report.retention.ratio), daily: report.daily.map(d => ({ label: `${Number(d.nightId.slice(4, 6))}/${Number(d.nightId.slice(6, 8))}`, users: d.users, activations: d.activations, width: d.users / maximum * 100 })), channels: report.channels.map(c => ({ ...c, rate: percent(c.conversionRate) })), cohorts: report.retention.cohorts.map(c => ({ label: `${c.activationWeek.slice(4, 6)}/${c.activationWeek.slice(6, 8)} 当周`, mature: c.mature, immature: c.immature, reachedThree: c.reachedThree, rate: percent(c.ratio) })) })
    } catch (error) { if (this.visible && generation === this.generation) this.setData({ loading: false, denied: error instanceof CloudError && error.code === 'FORBIDDEN', error: '暂时没有读到统计，请重试。' }) }
  },
  onRange(event: WechatMiniprogram.TouchEvent) { const days = Number(event.currentTarget.dataset.days); if ([7, 30].includes(days) && days !== this.data.days) { this.setData({ days }); void this.reload() } },
  onRetry() { void this.reload() }, onChannels() { wx.navigateTo({ url: '/pages/channels/index' }) }, onMine() { wx.switchTab({ url: '/pages/me/index' }) }
})
