import { callCloud, CloudError } from './cloud'
import { isNightId, resolveNight } from '../utils/night-time'
import { EXPERIENCE } from '../config/night-experience'
import type { NightApi, NightCloseReply, NightLookupReply, NightPrefs, NightPrefsReply, NightRecord, NightStateReply } from '../types/night'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudError('INTERNAL', '服务返回格式无效')
  return value as Record<string, unknown>
}
function check(condition: unknown): asserts condition {
  if (!condition) throw new CloudError('INTERNAL', '服务返回数据无效')
}
function time(value: unknown): number { check(typeof value === 'number' && Number.isFinite(value) && value > 0); return value }
async function request(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
  // Expiring a submission does not cancel its server transaction. Its original
  // night marker remains until a read confirms the outcome.
  let timer: number | undefined
  try {
    return await Promise.race([
      callCloud('bedtimeNight', action, data),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new CloudError('TIMEOUT', '暂时没确认。')), EXPERIENCE.unknownMs) })
    ])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
function prefs(value: unknown): NightPrefs {
  const p = object(value)
  check(typeof p.sound === 'boolean' && typeof p.haptics === 'boolean' && typeof p.reduceMotion === 'boolean')
  return { sound: p.sound, haptics: p.haptics, reduceMotion: p.reduceMotion }
}
function record(value: unknown): NightRecord | null {
  if (value === null) return null
  const r = object(value)
  check(isNightId(r.nightId) && (r.method === 'hold' || r.method === 'tap') && typeof r.phraseId === 'string' && r.phraseId.length > 0 &&
    typeof r.phraseText === 'string' && r.phraseText.length > 0 && r.phraseText.length <= 40 && Number.isInteger(r.phraseVersion) && Number(r.phraseVersion) > 0)
  return { nightId: r.nightId, method: r.method, confirmedAt: time(r.confirmedAt), phraseId: r.phraseId, phraseText: r.phraseText, phraseVersion: Number(r.phraseVersion) }
}

export const nightApi: NightApi = {
  async getState(): Promise<NightStateReply> {
    const data = object(await request('getState'))
    const serverNow = time(data.serverNow)
    const rules = resolveNight(serverNow)
    check(typeof data.userId === 'string' && data.userId.length > 0 && data.userId.length <= 128)
    check(Object.keys(rules).every(key => data[key] === rules[key as keyof typeof rules]))
    check((data.firstNightId === null || isNightId(data.firstNightId)) && (data.lastNightId === null || isNightId(data.lastNightId)))
    const current = record(data.record)
    const last = record(data.lastRecord)
    check(!current || current.nightId === rules.nightId)
    check((last?.nightId || null) === data.lastNightId)
    check(data.reminderAvailable === undefined || typeof data.reminderAvailable === 'boolean')
    return { ...rules, serverNow, userId: data.userId, prefs: prefs(data.prefs), record: current, lastRecord: last, firstNightId: data.firstNightId as string | null, lastNightId: data.lastNightId as string | null, reminderAvailable: data.reminderAvailable === true }
  },
  async closeLight(clientNightId, method): Promise<NightCloseReply> {
    const data = object(await request('closeLight', { clientNightId, method }))
    const confirmed = record(data.record)
    check(confirmed && confirmed.nightId === clientNightId && typeof data.created === 'boolean' && typeof data.isFirstEver === 'boolean')
    return { serverNow: time(data.serverNow), record: confirmed, created: data.created, isFirstEver: data.isFirstEver }
  },
  async getNight(nightId): Promise<NightLookupReply> {
    const data = object(await request('getNight', { nightId }))
    const found = record(data.record)
    check(!found || found.nightId === nightId)
    return { serverNow: time(data.serverNow), record: found }
  },
  async setPrefs(patch): Promise<NightPrefsReply> {
    const data = object(await callCloud('bedtimeNight', 'setPrefs', { prefs: patch }))
    return { serverNow: time(data.serverNow), prefs: prefs(data.prefs) }
  },
  async getArchive(cursor, limit = 30) {
    const data = object(await request('getArchive', { ...(cursor ? { cursor } : {}), limit }))
    check(Array.isArray(data.items) && data.items.length <= limit && (data.nextCursor === null || isNightId(data.nextCursor)))
    const items = data.items.map(value => { const item = record(value); check(item); return item })
    check(items.every((item, index) => (!cursor || item.nightId < cursor) && (!index || item.nightId < items[index - 1].nightId)))
    check(data.nextCursor === null || (items.length === limit && data.nextCursor === items[items.length - 1].nightId))
    return { serverNow: time(data.serverNow), items, nextCursor: data.nextCursor as string | null }
  },
  async track(events) {
    const data = object(await request('track', { events }))
    const requested = new Set(events.map(event => event.eventId))
    check(Array.isArray(data.acceptedIds) && Array.isArray(data.duplicateIds))
    const ids = [...data.acceptedIds, ...data.duplicateIds]
    check(ids.every(id => typeof id === 'string' && requested.has(id)) && new Set(ids).size === ids.length && ids.length === requested.size)
    return { serverNow: time(data.serverNow), acceptedIds: data.acceptedIds as string[], duplicateIds: data.duplicateIds as string[] }
  }
}
export { request as requestNight }
