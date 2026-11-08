import { EXPERIENCE } from '../../config/night-experience'
import type { GestureClock } from '../../utils/hold-gesture'

export type CeremonyPhase = 'dimming' | 'blackout' | 'revealing' | 'done'
export type CeremonyFrame = { phase: CeremonyPhase; maskOpacity: number; phraseOpacity: number }

export function ceremonyFrame(elapsed: number, blackoutMs: number, reduceMotion: boolean): CeremonyFrame {
  if (reduceMotion) {
    return elapsed < EXPERIENCE.reducedBlackoutMs
      ? { phase: 'blackout', maskOpacity: 1, phraseOpacity: 0 }
      : { phase: 'done', maskOpacity: 1, phraseOpacity: 1 }
  }
  if (elapsed < EXPERIENCE.fadeMs) return { phase: 'dimming', maskOpacity: elapsed / EXPERIENCE.fadeMs, phraseOpacity: 0 }
  const revealAt = EXPERIENCE.fadeMs + blackoutMs
  if (elapsed < revealAt) return { phase: 'blackout', maskOpacity: 1, phraseOpacity: 0 }
  if (elapsed < revealAt + EXPERIENCE.revealMs) {
    return { phase: 'revealing', maskOpacity: 1, phraseOpacity: (elapsed - revealAt) / EXPERIENCE.revealMs }
  }
  return { phase: 'done', maskOpacity: 1, phraseOpacity: 1 }
}

/** Uses the local response-receipt clock, never a business timestamp. */
export class Ceremony {
  private timer: number | null = null
  private generation = 0
  constructor(private clock: GestureClock) {}

  start(blackoutMs: number, reduceMotion: boolean, render: (frame: CeremonyFrame) => void, interrupted: () => void) {
    this.stop()
    const generation = this.generation
    const startedAt = this.clock.now()
    let lastNow = startedAt
    let previous: CeremonyFrame | null = null
    const tick = () => {
      if (generation !== this.generation) return
      const now = this.clock.now()
      if (now < lastNow || now - lastNow > EXPERIENCE.clockJumpMs) {
        this.stop()
        interrupted()
        return
      }
      lastNow = now
      const frame = ceremonyFrame(now - startedAt, blackoutMs, reduceMotion)
      if (!previous || frame.phase !== previous.phase || frame.maskOpacity !== previous.maskOpacity || frame.phraseOpacity !== previous.phraseOpacity) {
        render(frame); previous = frame
      }
      if (generation === this.generation && frame.phase !== 'done') {
        const elapsed = now - startedAt
        const boundaries = reduceMotion ? [EXPERIENCE.reducedBlackoutMs]
          : [EXPERIENCE.fadeMs, EXPERIENCE.fadeMs + blackoutMs, EXPERIENCE.fadeMs + blackoutMs + EXPERIENCE.revealMs]
        const next = boundaries.find(boundary => boundary > elapsed)!
        this.timer = this.clock.schedule(tick, Math.min(32, next - elapsed))
      }
    }
    tick()
  }

  stop() {
    this.generation += 1
    if (this.timer !== null) this.clock.clear(this.timer)
    this.timer = null
  }
}
