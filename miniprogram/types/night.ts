export type NightPhase = 'before' | 'open' | 'closed'
export type NightMethod = 'hold' | 'tap'
export type NightPrefs = { sound: boolean; haptics: boolean; reduceMotion: boolean }
export const DEFAULT_NIGHT_PREFS: NightPrefs = { sound: false, haptics: true, reduceMotion: false }
export type NightRecord = {
  nightId: string; confirmedAt: number; method: NightMethod
  phraseId: string; phraseText: string; phraseVersion: number
}
export type NightRules = {
  nightId: string; phase: NightPhase; windowOpenAt: number; windowCloseAt: number; nextOpenAt: number
}
export type NightStateReply = NightRules & {
  serverNow: number; userId: string; record: NightRecord | null; lastRecord: NightRecord | null
  prefs: NightPrefs; firstNightId: string | null; lastNightId: string | null
  reminderAvailable?: boolean
}
export type NightCloseReply = { serverNow: number; record: NightRecord; created: boolean; isFirstEver: boolean }
export type NightLookupReply = { serverNow: number; record: NightRecord | null }
export type NightPrefsReply = { serverNow: number; prefs: NightPrefs }
export type NightArchiveReply = { serverNow: number; items: NightRecord[]; nextCursor: string | null }
export type NightEventData =
  | { name: 'night_view'; props: { phase: NightPhase; hasRecord: boolean } }
  | { name: 'ceremony_start'; props: { method: NightMethod } }
  | { name: 'ceremony_done_view' | 'exit_tap'; props: Record<string, never> }
  | { name: 'receipt_view'; props: { source: 'home' | 'archive' } }
  | { name: 'card_export_result'; props: { stage: 'render' | 'save'; ok: boolean; code: 'OK' | 'RENDER_FAILED' | 'SAVE_DENIED' | 'SAVE_FAILED' } }
export type NightEvent = NightEventData & { eventId: string }
export type NightTrackReply = { serverNow: number; acceptedIds: string[]; duplicateIds: string[] }
export interface NightApi {
  getState(): Promise<NightStateReply>
  closeLight(clientNightId: string, method: NightMethod): Promise<NightCloseReply>
  getNight(nightId: string): Promise<NightLookupReply>
  setPrefs(prefs: Partial<NightPrefs>): Promise<NightPrefsReply>
  getArchive(cursor?: string, limit?: number): Promise<NightArchiveReply>
  track(events: NightEvent[]): Promise<NightTrackReply>
}
