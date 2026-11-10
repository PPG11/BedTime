import { nightStore, nightEvents } from '../../state/night-store'
import { showAddToMine } from '../../utils/night-entry'
import { contentTop, localClock, NightNavigation, NightSound } from '../../utils/night-platform'
import { createNightView } from './night-view-model'
import { initialNightInteraction, NightController } from './night-controller'
import { BRAND } from '../../config/brand'

const initialData = {
  ...createNightView(nightStore.get(), initialNightInteraction()), top: 76, activeSurface: '', brand: BRAND
}
type Methods = {
  controller: NightController | null
  navigation: NightNavigation | null
  sound: NightSound | null
  visible: boolean
  onHoldProgress(event: WechatMiniprogram.CustomEvent<{ progress: number; surface: string }>): void
  onHoldCancel(): void
  onHoldCommit(): void
  onTapClose(): void
  onStartDemo(): void
  onRefresh(): void
  onRetry(): void
  onExit(): void
  onCheckResult(): void
  onEndDemo(): void
  onReturnNight(): void
  onOpenReceipt(): void
  onAddToMine(): void
}

Page<typeof initialData, Methods>({
  data: initialData,
  controller: null, navigation: null, sound: null, visible: false,
  onLoad() {
    this.sound = new NightSound()
    this.navigation = new NightNavigation({
      hide: callbacks => wx.hideTabBar({ animation: false, ...callbacks }),
      show: () => wx.showTabBar({ animation: false, fail() {} })
    })
    this.controller = new NightController(nightStore, localClock, {
      render: (view, state) => {
        if (!this.visible) return
        this.setData({ ...createNightView(state, view), ...(view.interaction !== 'pressing' ? { activeSurface: '' } : {}) })
      },
      enter: () => this.navigation?.enter(),
      restore: () => this.navigation?.restore(),
      feedback: (prefs, demo) => {
        this.sound?.play(prefs.sound)
        if (!demo && prefs.haptics && this.visible) { try { wx.vibrateShort({ type: 'light', fail() {} }) } catch { /* Visual feedback is sufficient. */ } }
      },
      stop: () => this.sound?.stop(),
      exit: failed => { try { wx.exitMiniProgram({ fail: failed }) } catch { failed() } },
      track: event => nightEvents.record(event)
    })
  },
  onShow() {
    this.visible = true
    this.setData({ top: contentTop(), activeSurface: '' })
    void this.controller?.show()
  },
  onResize() { if (this.visible) this.setData({ top: contentTop() }) },
  onHide() { this.visible = false; this.controller?.hide() },
  onUnload() { this.visible = false; this.controller?.destroy(); this.controller = null; this.sound = null; this.navigation = null },
  onHoldProgress(event) {
    if (!this.visible) return
    if (this.data.activeSurface && this.data.activeSurface !== event.detail.surface) return
    if (this.data.activeSurface !== event.detail.surface) this.setData({ activeSurface: event.detail.surface })
    this.controller?.pressing(event.detail.progress)
  },
  onHoldCancel() { if (this.visible) { this.controller?.cancelPress(); this.setData({ activeSurface: '' }) } },
  onHoldCommit() { this.controller?.submit('hold') },
  onTapClose() { this.controller?.submit('tap') },
  onStartDemo() { this.controller?.startDemo() },
  onRefresh() { this.controller?.refresh() },
  onRetry() { this.controller?.retry() },
  onCheckResult() { void this.controller?.checkResult() },
  onEndDemo() { this.controller?.returnHome() },
  onReturnNight() { this.controller?.returnHome() },
  onExit() { this.controller?.exit() },
  onOpenReceipt() { if (this.data.receiptNightId) wx.navigateTo({ url: `/pages/receipt/index?nightId=${this.data.receiptNightId}` }) },
  onAddToMine() { showAddToMine() }
})
