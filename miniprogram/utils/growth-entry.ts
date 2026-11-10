import { growthApi } from '../services/growth'

export type GrowthEntryOptions = { query?: Record<string, unknown>; scene?: unknown }
export function parseEntryRef(options: GrowthEntryOptions): string | null {
  const query = options.query || {}
  if (typeof query.ref === 'string' && /^[a-z0-9][a-z0-9_-]{1,31}$/.test(query.ref)) return query.ref
  if (typeof query.scene !== 'string' || query.scene === '0') return null
  try {
    const scene = decodeURIComponent(query.scene)
    const match = /(?:^|&)ref=([a-z0-9][a-z0-9_-]{1,31})(?:&|$)/.exec(scene)
    return match ? match[1] : null
  } catch { return null }
}
let pending: Promise<void> | null = null
export function captureGrowthEntry(options: GrowthEntryOptions = {}): Promise<void> {
  if (pending) return pending
  const ref = parseEntryRef(options)
  pending = growthApi.captureEntry(ref || undefined).then(() => {}, () => {}).finally(() => { pending = null })
  return pending
}
