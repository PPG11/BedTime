import { EXPERIENCE } from '../config/night-experience'

export type Point = { x: number; y: number }
export type Bounds = { left: number; right: number; top: number; bottom: number }
export type GestureClock = {
  now(): number
  schedule(callback: () => void, delay: number): number
  clear(handle: number): void
}
type Hooks = { progress(value: number): void; commit(): void; cancel(): void }

/** One touch sequence can commit or cancel once, never re-enter after leaving. */
export class HoldGesture {
  private active = false
  private startedAt = 0
  private lastNow = 0
  private timer: number | null = null
  private bounds: Bounds | null = null

  constructor(private clock: GestureClock, private hooks: Hooks) {}

  start(point: Point, bounds: Bounds, startedAt = this.clock.now()): boolean {
    if (this.active || !this.inside(point, bounds)) return false
    this.bounds = bounds
    this.startedAt = startedAt
    this.lastNow = startedAt
    this.active = true
    this.tick()
    return true
  }

  move(point: Point) {
    if (this.active && this.bounds && !this.inside(point, this.bounds)) this.cancel()
  }

  release() {
    // Decide by the elapsed clock even if the scheduled threshold callback is
    // delayed. A release at 799 ms must not become a submit at the next tick.
    if (this.active) this.tick(false)
    this.cancel()
  }

  cancel() {
    if (!this.active) return
    this.active = false
    this.clearTimer()
    this.hooks.cancel()
  }

  private inside(point: Point, bounds: Bounds) {
    const margin = EXPERIENCE.moveTolerancePx
    return point.x >= bounds.left - margin && point.x <= bounds.right + margin &&
      point.y >= bounds.top - margin && point.y <= bounds.bottom + margin
  }

  private clearTimer() {
    if (this.timer !== null) this.clock.clear(this.timer)
    this.timer = null
  }

  private tick(reschedule = true) {
    if (!this.active) return
    this.clearTimer()
    const now = this.clock.now()
    if (now < this.lastNow || now - this.lastNow > EXPERIENCE.clockJumpMs) {
      this.cancel()
      return
    }
    this.lastNow = now
    const elapsed = now - this.startedAt
    this.hooks.progress(Math.min(1, elapsed / EXPERIENCE.holdMs))
    if (elapsed >= EXPERIENCE.holdMs) {
      this.active = false
      this.hooks.commit()
    } else if (reschedule) {
      this.timer = this.clock.schedule(() => this.tick(), Math.min(32, EXPERIENCE.holdMs - elapsed))
    }
  }
}
