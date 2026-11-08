import { DEMO_PHRASE, EXPERIENCE } from '../../config/night-experience'
import { CloudError } from '../../services/cloud'
import { NightStore } from '../../state/create-night-store'
import type { NightStoreState } from '../../state/create-night-store'
import type { NightMethod, NightPrefs, NightEventData } from '../../types/night'
import type { GestureClock } from '../../utils/hold-gesture'
import { nextNightBoundary, resolveNight } from '../../utils/night-time'
import { Ceremony } from './ceremony'
import type { CeremonyPhase } from './ceremony'

export type NightInteraction = {
  interaction: 'idle' | 'pressing' | 'submitting' | 'unknown' | CeremonyPhase
  demo: boolean; progress: number; immersive: boolean; maskOpacity: number; phraseOpacity: number
  phrase: string; notice: string; requestNightId: string | null; checking: boolean; canRetry: boolean
}
export const initialNightInteraction = (): NightInteraction => ({ interaction: 'idle', demo: false, progress: 0,
  immersive: false, maskOpacity: 0, phraseOpacity: 0, phrase: '', notice: '', requestNightId: null, checking: false, canRetry: false })
type Effects = {
  render(view: NightInteraction, state: NightStoreState): void
  enter(): void; restore(): void; feedback(prefs: NightPrefs, demo: boolean): void; stop(): void
  exit(failed: () => void): void
  track?(event: NightEventData): void
}

export class NightController {
  private view = initialNightInteraction()
  private visible = false
  private generation = 0
  private unknownTimer: number | null = null
  private boundaryTimer: number | null = null
  private ceremony: Ceremony
  private unsubscribe: () => void
  private userId: string | null = null
  private nightId: string | null = null
  private method: NightMethod = 'tap'
  private seen = new Set<string>()

  constructor(private store: NightStore, private clock: GestureClock, private effects: Effects) {
    this.ceremony = new Ceremony(clock)
    this.unsubscribe = store.subscribe(state => {
      const userId = state.snapshot?.userId || null, nightId = state.snapshot?.nightId || null
      if (userId !== this.userId || nightId !== this.nightId) {
        this.reset(); this.userId = userId; this.nightId = nightId
      }
      if (this.visible) { this.render(); this.armBoundary() }
    })
  }
  async show() {
    this.reset(); this.seen.clear(); this.visible = true; this.render()
    const context = this.store.getContext() + 1
    const ready = await this.store.activate()
    if (!this.visible || context !== this.store.getContext()) return
    const pending = this.store.get().pendingNightId
    if (ready && pending && !this.view.demo) await this.checkResult(pending)
  }
  hide() { if (this.visible) { this.visible = false; this.store.hide() }; this.reset(); this.clearBoundary() }
  destroy() { this.hide(); this.unsubscribe() }
  private render() {
    if (!this.visible) return
    const state = this.store.get(), snapshot = state.snapshot
    this.effects.render({ ...this.view }, state)
    if (!snapshot || state.status !== 'ready' || state.stale || this.view.demo || this.view.immersive || this.view.interaction !== 'idle') return
    const key = `${snapshot.nightId}:${snapshot.phase}:${!!snapshot.record}`
    if (!this.seen.has(key)) { this.seen.add(key); this.effects.track?.({ name: 'night_view', props: { phase: snapshot.phase, hasRecord: !!snapshot.record } }) }
    const receipt = snapshot.record || (snapshot.phase !== 'open' ? snapshot.lastRecord : null)
    if (receipt && !this.seen.has(receipt.nightId)) { this.seen.add(receipt.nightId); this.effects.track?.({ name: 'receipt_view', props: { source: 'home' } }) }
  }
  private publish(patch: Partial<NightInteraction>) { this.view = { ...this.view, ...patch }; this.render() }
  private clearUnknown() { if (this.unknownTimer !== null) this.clock.clear(this.unknownTimer); this.unknownTimer = null }
  private clearBoundary() { if (this.boundaryTimer !== null) this.clock.clear(this.boundaryTimer); this.boundaryTimer = null }
  private reset() {
    this.generation += 1; this.clearUnknown(); this.ceremony.stop(); this.effects.stop(); this.effects.restore()
    this.view = initialNightInteraction()
  }
  private armBoundary() {
    this.clearBoundary()
    const state = this.store.get()
    if (!this.visible || state.status !== 'ready') return
    const now = this.store.estimatedNow()
    this.boundaryTimer = this.clock.schedule(() => {
      this.boundaryTimer = null
      if (this.visible) void this.store.refresh()
    }, Math.max(50, nextNightBoundary(now) - now + 50))
  }
  pressing(progress: number) { if (this.visible && ['idle', 'pressing'].includes(this.view.interaction)) this.publish({ interaction: 'pressing', progress, notice: '' }) }
  cancelPress() { if (this.view.interaction === 'pressing') this.publish({ interaction: 'idle', progress: 0 }) }
  startDemo() { if (!this.visible || this.view.interaction === 'submitting') return; this.reset(); this.publish({ demo: true }) }
  returnHome(notice = '') { this.reset(); this.publish({ notice }) }
  refresh() { this.returnHome(); void this.store.refresh() }

  submit(method: NightMethod) {
    if (!this.visible || !['idle', 'pressing'].includes(this.view.interaction)) return
    if (this.view.demo) { this.play(DEMO_PHRASE, true); return }
    const state = this.store.get(), snapshot = state.snapshot
    if (!snapshot || state.status !== 'ready' || state.stale) return
    const generation = ++this.generation, context = this.store.getContext(), userId = snapshot.userId, nightId = snapshot.nightId
    const active = () => this.visible && generation === this.generation && context === this.store.getContext() && this.store.get().snapshot?.userId === userId
    this.method = method
    this.publish({ interaction: 'submitting', progress: 1, notice: '', requestNightId: nightId, canRetry: false })
    this.unknownTimer = this.clock.schedule(() => {
      this.unknownTimer = null
      if (active() && this.view.interaction === 'submitting') this.publish({ interaction: 'unknown', notice: '暂时没确认，可以查看结果。' })
    }, EXPERIENCE.unknownMs)
    void this.store.submit(method, nightId).then(reply => {
      if (!active()) return
      this.clearUnknown()
      if (this.view.interaction === 'unknown') { this.publish({ notice: '回复已到达，可以查看结果。' }); return }
      if (reply.created && resolveNight(this.store.estimatedNow()).nightId === nightId) this.play(reply.record.phraseText, false)
      else this.returnHome()
    }).catch(error => {
      if (!active()) return
      this.clearUnknown()
      const code = error instanceof CloudError ? error.code : 'INTERNAL'
      if (['WINDOW_NOT_OPEN', 'NIGHT_CHANGED', 'UNAUTHORIZED', 'INVALID_ARG', 'STALE'].includes(code)) {
        this.returnHome(code === 'NIGHT_CHANGED' ? '已经是新的一晚，请重新确认。' : '请重新确认今晚的状态。')
        void this.store.refresh()
      } else this.publish({ interaction: 'unknown', notice: '暂时没确认，可以查看结果。' })
    })
  }
  private play(phrase: string, demo: boolean) {
    const prefs = this.store.get().snapshot?.prefs || { sound: false, haptics: true, reduceMotion: false }
    this.clearUnknown(); this.effects.enter(); this.effects.feedback(prefs, demo)
    this.view = { ...this.view, demo, phrase, progress: 1, immersive: true, notice: '' }
    let reported = false
    this.ceremony.start(EXPERIENCE.blackoutMs, prefs.reduceMotion,
      frame => {
        this.publish({ interaction: frame.phase, maskOpacity: frame.maskOpacity, phraseOpacity: frame.phraseOpacity })
        if (frame.phase === 'done' && !demo && !reported) { reported = true; this.effects.track?.({ name: 'ceremony_done_view', props: {} }) }
      },
      () => this.returnHome('设备时间发生变化，已返回今晚。'))
  }
  async checkResult(requestedNightId?: string) {
    const nightId = requestedNightId || this.view.requestNightId || this.store.get().pendingNightId
    if (!nightId || !this.visible || this.view.checking) return
    this.generation += 1; const generation = this.generation, context = this.store.getContext(), userId = this.store.get().snapshot?.userId
    const active = () => this.visible && generation === this.generation && context === this.store.getContext() && userId === this.store.get().snapshot?.userId
    this.clearUnknown()
    this.publish({ interaction: 'unknown', requestNightId: nightId, checking: true, canRetry: false, notice: '正在查看原夜的结果。' })
    try {
      const record = await this.store.lookup(nightId)
      if (!active()) return
      if (record) { this.returnHome('关灯结果已确认。'); return }
      if (!await this.store.refresh()) throw new Error('State unavailable')
      if (!active()) return
      const state = this.store.get(), snapshot = state.snapshot
      if (snapshot?.nightId !== nightId) { this.returnHome('已结束上次等待；新的一晚可以正常使用。'); return }
      if (snapshot.record) { this.returnHome('关灯结果已确认。'); return }
      if (snapshot.phase === 'closed') { this.returnHome('这一晚已结束，稍后确认的记录仍会保留在我的夜签。'); return }
      this.publish({ checking: false, canRetry: state.status === 'ready' && snapshot.phase === 'open', notice: '暂未查到记录，不能确定先前请求是否完成。' })
    } catch {
      if (active()) this.publish({ checking: false, canRetry: false, notice: '暂时查不到结果，请稍后再试。' })
    }
  }
  retry() {
    if (!this.view.canRetry || this.view.checking) return
    const nightId = this.view.requestNightId
    if (nightId !== this.store.get().snapshot?.nightId) { this.refresh(); return }
    this.publish({ interaction: 'idle', canRetry: false }); this.submit(this.method)
  }
  exit() {
    if (this.view.demo) { this.returnHome(); return }
    this.effects.track?.({ name: 'exit_tap', props: {} })
    const generation = this.generation
    this.effects.exit(() => { if (this.visible && generation === this.generation) this.publish({ notice: '可以用微信右上角离开。' }) })
  }
}
