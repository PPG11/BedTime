import { CloudError } from '../services/cloud'
import type { NightEvent, NightEventData, NightTrackReply } from '../types/night'
import type { GestureClock } from '../utils/hold-gesture'

type Queued = { event: NightEvent; retries: number }
/** Session-only, bounded best-effort queue. Never delays the business request. */
export class NightEvents {
  private userId: string | null = null
  private ready = false
  private queue: Queued[] = []
  private flight: object | null = null
  private generation = 0
  private timer: number | null = null
  constructor(private send: (events: NightEvent[]) => Promise<NightTrackReply>, private clock: GestureClock,
    private random: () => number = Math.random) {}
  update(userId: string | null, ready: boolean, hidden = false) {
    if (userId !== this.userId) { this.generation++; this.queue = []; this.flight = null; this.userId = userId }
    const wasReady = this.ready
    this.ready = ready && !!userId
    this.clearTimer()
    if (this.ready) this.arm()
    else if (wasReady && hidden) void this.flush(true)
  }
  record(data: NightEventData) {
    if (!this.ready || !this.userId || this.queue.length >= 20) return
    const eventId = Array.from({ length: 32 }, () => Math.floor(this.random() * 16).toString(16)).join('')
    this.queue.push({ event: { ...data, eventId } as NightEvent, retries: 0 })
    if (this.queue.length >= 5) void this.flush()
    else this.arm()
  }
  private clearTimer() { if (this.timer !== null) this.clock.clear(this.timer); this.timer = null }
  private arm() {
    if (!this.ready || !this.queue.length || this.timer !== null || this.flight) return
    this.timer = this.clock.schedule(() => { this.timer = null; void this.flush() }, 3000)
  }
  async flush(hidden = false) {
    if ((!this.ready && !hidden) || !this.userId || this.flight || !this.queue.length) return
    this.clearTimer()
    const generation = this.generation, token = {}, batch = this.queue.slice(0, 10)
    const ids = new Set(batch.map(row => row.event.eventId))
    this.flight = token
    try {
      const reply = await this.send(batch.map(row => row.event))
      if (generation !== this.generation || this.flight !== token) return
      const accepted = new Set([...reply.acceptedIds, ...reply.duplicateIds])
      this.queue = this.queue.filter(row => !ids.has(row.event.eventId) || !accepted.has(row.event.eventId))
    } catch (error) {
      if (generation !== this.generation || this.flight !== token) return
      this.queue = this.queue.filter(row => !ids.has(row.event.eventId) || (this.ready && !hidden && row.retries++ < 1 && !(error instanceof CloudError && error.code === 'RATE_LIMITED')))
    } finally {
      if (this.flight === token) { this.flight = null; this.arm() }
    }
  }
}
