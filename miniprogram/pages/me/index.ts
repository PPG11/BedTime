import { nightStore } from '../../state/night-store'
import { DEFAULT_NIGHT_PREFS } from '../../types/night'
import { restoreTabBar } from '../../utils/night-platform'
import { showAddToMine } from '../../utils/night-entry'
import { BRAND } from '../../config/brand'
import { growthApi } from '../../services/growth'

Page({
  visible: false,
  generation: 0,
  unsubscribe: null as (() => void) | null,
  data: { ...DEFAULT_NIGHT_PREFS, canEdit: false, saving: false, delayed: false, loading: true, notice: '', reminderAvailable: false, isAdmin: false, brand: BRAND },
  onShow() {
    this.visible = true; restoreTabBar()
    const generation = ++this.generation
    this.setData({ isAdmin: false })
    this.unsubscribe?.()
    this.unsubscribe = nightStore.subscribe(state => {
      if (!this.visible) return
      this.setData({ ...(state.snapshot?.prefs || DEFAULT_NIGHT_PREFS), canEdit: state.status === 'ready' && !state.stale,
        saving: state.prefsSaving, delayed: state.prefsDelayed, loading: state.status === 'loading', notice: state.prefsError || state.error,
        reminderAvailable: state.status === 'ready' && !state.stale && Boolean(state.snapshot?.reminderAvailable) })
    })
    void nightStore.activate().then(async ready => {
      if (!ready || !this.visible || generation !== this.generation) return
      const userId = nightStore.get().snapshot?.userId
      try {
        const access = await growthApi.getGrowthAccess()
        if (this.visible && generation === this.generation && userId === nightStore.get().snapshot?.userId) this.setData({ isAdmin: access.isAdmin })
      } catch { /* Optional management never blocks personal settings. */ }
    })
  },
  onHide() { this.deactivate() },
  onUnload() { this.deactivate() },
  deactivate() {
    if (this.visible) { this.visible = false; this.generation++; nightStore.hide() }
    this.unsubscribe?.(); this.unsubscribe = null
  },
  onSoundChange(event: WechatMiniprogram.SwitchChange) { void nightStore.setPrefs({ sound: event.detail.value }) },
  onHapticsChange(event: WechatMiniprogram.SwitchChange) { void nightStore.setPrefs({ haptics: event.detail.value }) },
  onMotionChange(event: WechatMiniprogram.SwitchChange) { void nightStore.setPrefs({ reduceMotion: event.detail.value }) },
  onRetry() { void nightStore.refresh() },
  onOpenNight() { wx.switchTab({ url: '/pages/night/index' }) },
  onOpenAbout() { wx.navigateTo({ url: '/pages/about/index' }) },
  onArchive() { wx.navigateTo({ url: '/pages/archive/index' }) },
  onLights() { wx.navigateTo({ url: '/pages/lights/index' }) },
  onDashboard() { if (this.data.isAdmin) wx.navigateTo({ url: '/pages/dashboard/index' }) },
  onReminder() { if (this.data.reminderAvailable) wx.navigateTo({ url: '/pages/reminder/index' }) },
  onAddToMine() { showAddToMine() }
})
