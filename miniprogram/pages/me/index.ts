import { nightStore } from '../../state/night-store'
import { DEFAULT_NIGHT_PREFS } from '../../types/night'
import { restoreTabBar } from '../../utils/night-platform'
import { showAddToMine } from '../../utils/night-entry'

Page({
  visible: false,
  unsubscribe: null as (() => void) | null,
  data: { ...DEFAULT_NIGHT_PREFS, canEdit: false, saving: false, delayed: false, loading: true, notice: '', reminderAvailable: false },
  onShow() {
    this.visible = true; restoreTabBar()
    this.unsubscribe?.()
    this.unsubscribe = nightStore.subscribe(state => {
      if (!this.visible) return
      this.setData({ ...(state.snapshot?.prefs || DEFAULT_NIGHT_PREFS), canEdit: state.status === 'ready' && !state.stale,
        saving: state.prefsSaving, delayed: state.prefsDelayed, loading: state.status === 'loading', notice: state.prefsError || state.error,
        reminderAvailable: state.status === 'ready' && !state.stale && Boolean(state.snapshot?.reminderAvailable) })
    })
    void nightStore.activate()
  },
  onHide() { this.deactivate() },
  onUnload() { this.deactivate() },
  deactivate() {
    if (this.visible) { this.visible = false; nightStore.hide() }
    this.unsubscribe?.(); this.unsubscribe = null
  },
  onSoundChange(event: WechatMiniprogram.SwitchChange) { void nightStore.setPrefs({ sound: event.detail.value }) },
  onHapticsChange(event: WechatMiniprogram.SwitchChange) { void nightStore.setPrefs({ haptics: event.detail.value }) },
  onMotionChange(event: WechatMiniprogram.SwitchChange) { void nightStore.setPrefs({ reduceMotion: event.detail.value }) },
  onRetry() { void nightStore.refresh() },
  onOpenNight() { wx.switchTab({ url: '/pages/night/index' }) },
  onOpenAbout() { wx.navigateTo({ url: '/pages/about/index' }) },
  onArchive() { wx.navigateTo({ url: '/pages/archive/index' }) },
  onReminder() { if (this.data.reminderAvailable) wx.navigateTo({ url: '/pages/reminder/index' }) },
  onAddToMine() { showAddToMine() }
})
