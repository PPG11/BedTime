import type { NightRules } from '../types/night'
const DAY = 86_400_000
const HOUR = 3_600_000
const OFFSET = 8 * HOUR

function dateKey(at: number): string {
  const date = new Date(at)
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}
export function isNightId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value) || value < '19000101' || value > '99991231') return false
  return dateKey(nightDay(value)) === value
}
function nightDay(nightId: string) {
  return Date.UTC(Number(nightId.slice(0, 4)), Number(nightId.slice(4, 6)) - 1, Number(nightId.slice(6, 8)))
}
export function resolveNight(serverNow: number): NightRules {
  const nightId = dateKey(serverNow + OFFSET - 12 * HOUR)
  const midnight = nightDay(nightId) - OFFSET
  const windowOpenAt = midnight + 20 * HOUR
  const windowCloseAt = midnight + 30 * HOUR
  return { nightId, phase: serverNow < windowOpenAt ? 'before' : serverNow < windowCloseAt ? 'open' : 'closed', windowOpenAt, windowCloseAt, nextOpenAt: serverNow < windowOpenAt ? windowOpenAt : windowOpenAt + DAY }
}
export function nextNightBoundary(serverNow: number): number {
  const rules = resolveNight(serverNow)
  return rules.phase === 'before' ? rules.windowOpenAt : rules.phase === 'open' ? rules.windowCloseAt : nightDay(rules.nightId) - OFFSET + 36 * HOUR
}
export function formatNight(nightId: string): string {
  return `${Number(nightId.slice(4, 6))} 月 ${Number(nightId.slice(6, 8))} 日的夜晚`
}
export function formatConfirmedAt(at: number): string {
  const date = new Date(at + OFFSET)
  return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日 ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} 关灯`
}
