import type { GestureClock } from './hold-gesture'

export const localClock: GestureClock = {
  now: () => Date.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  clear: handle => clearTimeout(handle)
}

export type TabBarApi = {
  hide(options: { success(): void; fail(): void }): void
  show(): void
}

export class NightNavigation {
  private immersive = false
  constructor(private api: TabBarApi) {}
  enter() {
    this.immersive = true
    try {
      this.api.hide({
        success: () => { if (!this.immersive) this.restore() },
        fail: () => { if (!this.immersive) this.restore() }
      })
    } catch { /* A visible dark TabBar is an allowed capability fallback. */ }
  }
  restore() {
    this.immersive = false
    try { this.api.show() } catch { /* The page still has an explicit exit. */ }
  }
}

export function restoreTabBar() {
  try { wx.showTabBar({ animation: false, fail() {} }) } catch { /* Unsupported host. */ }
}

export class NightSound {
  private audio: WechatMiniprogram.InnerAudioContext | null = null
  private generation = 0

  play(enabled: boolean) {
    this.stop()
    if (!enabled) return
    const generation = this.generation
    try {
      wx.setInnerAudioOption({
        obeyMuteSwitch: true, mixWithOther: true,
        success: () => {
          if (generation !== this.generation) return
          try {
            this.audio = wx.createInnerAudioContext()
            this.audio.src = '/assets/night/light-off.wav'
            this.audio.obeyMuteSwitch = true
            this.audio.volume = 0.22
            this.audio.onError(() => { if (generation === this.generation) this.stop() })
            this.audio.play()
          } catch { this.stop() }
        },
        fail() {}
      })
    } catch { /* Sound must never be required for completing the ceremony. */ }
  }

  stop() {
    this.generation += 1
    try { this.audio?.stop(); this.audio?.destroy() } catch { /* Already interrupted. */ }
    this.audio = null
  }
}

export function contentTop(): number {
  try {
    const capsule = wx.getMenuButtonBoundingClientRect()
    return capsule.bottom + 16
  } catch { return 76 }
}
