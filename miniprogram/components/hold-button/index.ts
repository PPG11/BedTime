import { HoldGesture } from '../../utils/hold-gesture'
import { localClock } from '../../utils/night-platform'
import type { Point, Bounds } from '../../utils/hold-gesture'

const properties = {
  enabled: { type: Boolean, value: true, observer: 'onEnabledChange' },
  surface: { type: String, value: 'main' },
  label: { type: String, value: '按住关灯' },
  variant: { type: String, value: 'button' }
}
type Methods = {
  onEnabledChange(value: boolean): void
  onTouchStart(event: WechatMiniprogram.TouchEvent): void
  onTouchMove(event: WechatMiniprogram.TouchEvent): void
  onTouchEnd(): void
  cancelGesture(): void
}
type Fields = { _token: number; _pointer: Point | null; _gesture: HoldGesture | null }

Component<{ held: boolean }, typeof properties, Methods, Fields>({
  options: { styleIsolation: 'isolated', multipleSlots: true },
  properties,
  data: { held: false },
  lifetimes: {
    attached() {
      this._token = 0
      this._pointer = null as Point | null
      this._gesture = new HoldGesture(localClock, {
        progress: (progress: number) => this.triggerEvent('holdprogress', { progress, surface: this.data.surface }),
        commit: () => { this.setData({ held: false }); this.triggerEvent('holdcommit', { surface: this.data.surface }) },
        cancel: () => { this.setData({ held: false }); this.triggerEvent('holdcancel', { surface: this.data.surface }) }
      })
    },
    detached() { this.cancelGesture() }
  },
  pageLifetimes: { hide() { this.cancelGesture() } },
  methods: {
    onEnabledChange(value) { if (!value) this.cancelGesture() },
    onTouchStart(event: WechatMiniprogram.TouchEvent) {
      if (event.touches.length !== 1) { this.cancelGesture(); return }
      if (!this.data.enabled || this.data.held) return
      const touch = event.touches[0]
      const point = { x: touch.clientX, y: touch.clientY }
      this._pointer = point
      const startedAt = Date.now()
      const token = ++this._token
      this.setData({ held: true })
      this.createSelectorQuery().select('.hold-target').boundingClientRect(rect => {
        if (token !== this._token || !this.data.enabled || !rect || !this._pointer) return
        const bounds = rect as Bounds
        this._gesture?.start(point, bounds, startedAt)
        this._gesture?.move(this._pointer)
      }).exec()
    },
    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      if (event.touches.length !== 1) { this.cancelGesture(); return }
      const touch = event.touches[0]
      this._pointer = { x: touch.clientX, y: touch.clientY }
      this._gesture?.move(this._pointer)
    },
    onTouchEnd() {
      this._token += 1
      this._pointer = null
      this._gesture?.release()
      this.setData({ held: false })
    },
    cancelGesture() {
      this._token = (this._token || 0) + 1
      this._pointer = null
      this._gesture?.cancel()
      this.setData({ held: false })
    }
  }
})
