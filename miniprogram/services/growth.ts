import { callCloud, CloudError } from './cloud'
import { isNightId, resolveNight } from '../utils/night-time'
import type { NightRecord } from '../types/night'
import type { CardReply, DashboardReply, GrowthChannel, LightsReply, PublicCard, Retention } from '../types/growth'

function check(value: unknown): asserts value { if (!value) throw new CloudError('INTERNAL', '返回的信息暂时无法确认，请重试。') }
function object(value: unknown): Record<string, unknown> { check(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown> }
function time(value: unknown): number { check(typeof value === 'number' && Number.isFinite(value) && value > 0); return value }
function count(value: unknown): number { check(Number.isSafeInteger(value) && Number(value) >= 0); return Number(value) }
export function isCardId(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) }
export function isChannelCode(value: unknown): value is string { return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{1,31}$/.test(value) }
async function request(action: string, data: Record<string, unknown> = {}) {
  let timer: number | undefined
  try { return object(await Promise.race([callCloud('bedtimeGrowth', action, data), new Promise<never>((_yes, no) => { timer = setTimeout(() => no(new CloudError('TIMEOUT', '暂时没有确认结果，请重新查看。')), 8000) })])) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}
function personal(value: unknown): NightRecord | null {
  if (value === null) return null
  const r = object(value)
  check(isNightId(r.nightId) && ['tap', 'hold'].includes(String(r.method)) && typeof r.phraseId === 'string' && typeof r.phraseText === 'string' && r.phraseText.length > 0 && r.phraseText.length <= 40 && Number.isInteger(r.phraseVersion) && Number(r.phraseVersion) > 0)
  return { nightId: r.nightId, method: r.method as 'hold' | 'tap', confirmedAt: time(r.confirmedAt), phraseId: r.phraseId, phraseText: r.phraseText, phraseVersion: Number(r.phraseVersion) }
}
function card(value: unknown): PublicCard | null {
  if (value === null) return null
  const r = object(value)
  check(isCardId(r.cardId) && isNightId(r.nightId) && typeof r.phraseText === 'string' && r.phraseText.length > 0 && r.phraseText.length <= 40)
  return { cardId: r.cardId, nightId: r.nightId, phraseText: r.phraseText, expiresAt: time(r.expiresAt) }
}
function cardReply(value: Record<string, unknown>, nightId?: string, cardId?: string): CardReply {
  const serverNow = time(value.serverNow), result = card(value.card)
  check(['none', 'active', 'expired', 'revoked', 'unavailable'].includes(String(value.status)))
  check(value.status === 'active' ? result && result.expiresAt > serverNow : result === null)
  check(!result || ((!nightId || result.nightId === nightId) && (!cardId || result.cardId === cardId)))
  check(value.created === undefined || typeof value.created === 'boolean')
  return { serverNow, status: value.status as CardReply['status'], card: result, ...(typeof value.created === 'boolean' ? { created: value.created } : {}) }
}
function channel(value: unknown): GrowthChannel {
  const r = object(value)
  check(isChannelCode(r.code) && typeof r.label === 'string' && r.label.length > 0 && Array.from(r.label).length <= 24 && typeof r.enabled === 'boolean')
  check(typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) && r.createdAt >= 0 && typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) && r.updatedAt >= r.createdAt)
  return { code: r.code, label: r.label, enabled: r.enabled, createdAt: r.createdAt, updatedAt: r.updatedAt }
}
function ratio(value: unknown, numerator: number, denominator: number): number | null {
  check(denominator === 0 ? value === null : typeof value === 'number' && Number.isFinite(value) && Math.abs(value - numerator / denominator) < 0.000001)
  return value as number | null
}
function retention(value: unknown): Retention {
  const r = object(value), activated = count(r.activated), mature = count(r.mature), immature = count(r.immature), reachedThree = count(r.reachedThree)
  check(activated === mature + immature && reachedThree <= mature)
  return { activated, mature, immature, reachedThree, ratio: ratio(r.ratio, reachedThree, mature) }
}
type ChannelWrite = { userId: string; code: string; label: string; enabled: boolean; pending: boolean; unknown: boolean; promise: Promise<{ serverNow: number; channel: GrowthChannel }> | null }
const channelWrites = new Map<string, ChannelWrite>()
export function getChannelWrite(userId: string) {
  const w = channelWrites.get(userId)
  return w ? { code: w.code, label: w.label, enabled: w.enabled, pending: w.pending, unknown: w.unknown } : null
}
export function waitChannelWrite(userId: string): Promise<void> | null {
  const promise = channelWrites.get(userId)?.promise
  return promise ? promise.then(() => {}, () => {}) : null
}
export function confirmChannelWrite(userId: string, channels: GrowthChannel[]): boolean {
  const w = channelWrites.get(userId)
  if (!w || w.pending || !w.unknown) return false
  if (!channels.some(c => c.code === w.code && c.label === w.label && c.enabled === w.enabled)) return false
  channelWrites.delete(userId)
  return true
}
export const growthApi = {
  async getGrowthAccess() { const r = await request('getGrowthAccess'); check(typeof r.isAdmin === 'boolean'); return { serverNow: time(r.serverNow), isAdmin: r.isAdmin } },
  async captureEntry(ref?: string) { const r = await request('captureEntry', ref ? { ref } : {}); check(typeof r.captured === 'boolean' && (r.source === 'unknown' || isChannelCode(r.source))); return { serverNow: time(r.serverNow), captured: r.captured, source: r.source as string } },
  async getLights(nightId?: string): Promise<LightsReply> {
    const r = await request('getLights', nightId ? { nightId } : {}), serverNow = time(r.serverNow)
    check(isNightId(r.nightId) && (!nightId || nightId === r.nightId) && isNightId(r.currentNightId) && r.currentNightId === resolveNight(serverNow).nightId)
    check(Array.isArray(r.availableNightIds) && r.availableNightIds.length === 7 && r.availableNightIds.every(isNightId) && new Set(r.availableNightIds).size === 7 && r.availableNightIds.includes(r.nightId))
    check(typeof r.suppressed === 'boolean' && Array.isArray(r.buckets))
    const buckets = r.buckets.map(value => { const b = object(value); check(Number.isInteger(b.startHour) && Number.isInteger(b.endHour) && Number(b.startHour) >= 20 && Number(b.endHour) <= 30 && Number(b.startHour) < Number(b.endHour)); const total = count(b.count); check(total >= 3); return { startHour: Number(b.startHour), endHour: Number(b.endHour), count: total } })
    const total = r.total === null ? null : count(r.total)
    check(r.suppressed ? total === null && buckets.length === 0 : total !== null && total >= 3 && buckets.reduce((sum, b) => sum + b.count, 0) === total)
    check(buckets.every((b, i) => i === 0 || b.startHour >= buckets[i - 1].endHour))
    const ownRecord = personal(r.ownRecord); check(!ownRecord || ownRecord.nightId === r.currentNightId)
    return { serverNow, nightId: r.nightId, availableNightIds: r.availableNightIds as string[], settledAt: time(r.settledAt), suppressed: r.suppressed, total, buckets, currentNightId: r.currentNightId, ownRecord }
  },
  async createPublicCard(nightId: string) { return cardReply(await request('createPublicCard', { nightId }), nightId) },
  async getOwnedCard(nightId: string) { return cardReply(await request('getOwnedCard', { nightId }), nightId) },
  async revokePublicCard(nightId: string, cardId: string) { return cardReply(await request('revokePublicCard', { nightId, cardId }), nightId) },
  async getPublicCard(cardId: string) { const r = cardReply(await request('getPublicCard', { cardId }), undefined, cardId); check(['active', 'unavailable'].includes(r.status)); return r },
  async getDashboard(from: string, to: string): Promise<DashboardReply> {
    const r = await request('getDashboard', { from, to })
    check(r.from === from && r.to === to && isNightId(r.from) && isNightId(r.to) && r.consistency === 'checked' && r.attributionHours === 24)
    const t = object(r.totals), totals = { users: count(t.users), records: count(t.records), activations: count(t.activations), hold: count(t.hold), tap: count(t.tap) }
    check(totals.records === totals.hold + totals.tap)
    check(Array.isArray(r.daily) && Array.isArray(r.channels))
    const daily = r.daily.map(value => { const d = object(value); check(isNightId(d.nightId) && d.nightId >= from && d.nightId <= to); const row = { nightId: d.nightId, users: count(d.users), activations: count(d.activations), hold: count(d.hold), tap: count(d.tap) }; check(row.users === row.hold + row.tap && row.activations <= row.users); return row })
    check(new Set(daily.map(d => d.nightId)).size === daily.length)
    const ret = object(r.retention); check(Array.isArray(ret.cohorts))
    const cohorts = ret.cohorts.map(value => { const c = object(value); check(isNightId(c.activationWeek)); return { ...retention(c), activationWeek: c.activationWeek } })
    const channels = r.channels.map(value => { const c = object(value); check((c.code === 'unknown' || isChannelCode(c.code)) && typeof c.label === 'string' && Array.from(c.label).length <= 24 && typeof c.enabled === 'boolean'); const arrivals = count(c.arrivals), matureArrivals = count(c.matureArrivals), immatureArrivals = count(c.immatureArrivals), activations = count(c.activations), convertedMature = count(c.convertedMature); check(arrivals === matureArrivals + immatureArrivals && convertedMature <= matureArrivals && activations <= arrivals); return { code: c.code as string, label: c.label, enabled: c.enabled, arrivals, matureArrivals, immatureArrivals, activations, convertedMature, conversionRate: ratio(c.conversionRate, convertedMature, matureArrivals) } })
    return { serverNow: time(r.serverNow), from, to, totals, daily, retention: { ...retention(ret), cohorts }, channels, excludedAccounts: count(r.excludedAccounts), attributionHours: 24, consistency: 'checked' }
  },
  async getChannels() { const r = await request('getChannels'); check(Array.isArray(r.channels)); const channels = r.channels.map(channel); check(new Set(channels.map(c => c.code)).size === channels.length); return { serverNow: time(r.serverNow), channels } },
  saveChannel(code: string, label: string, enabled: boolean, userId: string) {
    check(typeof userId === 'string' && userId.length > 0)
    const previous = channelWrites.get(userId)
    if (previous?.pending) return Promise.reject(new CloudError('PENDING', '上次保存仍在确认中。'))
    if (previous?.unknown && (previous.code !== code || previous.label !== label || previous.enabled !== enabled)) return Promise.reject(new CloudError('PENDING', '请先确认上次保存结果。'))
    const write: ChannelWrite = { userId, code, label, enabled, pending: true, unknown: false, promise: null }
    channelWrites.set(userId, write)
    // Eight seconds only changes the page message. Keep the underlying write
    // alive so re-entering this page cannot start a competing write.
    write.promise = callCloud('bedtimeGrowth', 'saveChannel', { code, label, enabled }).then(value => {
      const r = object(value), saved = channel(r.channel)
      check(saved.code === code && saved.label === label && saved.enabled === enabled)
      const result = { serverNow: time(r.serverNow), channel: saved }
      if (channelWrites.get(userId) === write) channelWrites.delete(userId)
      return result
    }).catch(error => {
      if (channelWrites.get(userId) === write) {
        if (error instanceof CloudError && ['INVALID_ARG', 'FORBIDDEN', 'UNAUTHORIZED'].includes(error.code)) channelWrites.delete(userId)
        else { write.pending = false; write.unknown = true; write.promise = null }
      }
      throw error
    })
    return write.promise
  }
}
