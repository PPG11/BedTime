import { nightApi } from '../services/night'
import { isNightId } from '../utils/night-time'
import { NightStore } from './create-night-store'
import type { NightPersistence } from './create-night-store'
import { NightEvents } from './night-events'
import { localClock } from '../utils/night-platform'

const key = (userId: string, field: string) => `bedtime:v11:${encodeURIComponent(userId)}:${field}`
const persistence: NightPersistence = {
  getPending(userId) {
    try { const value: unknown = wx.getStorageSync(key(userId, 'pending')); return isNightId(value) ? value : null } catch { return null }
  },
  setPending(userId, nightId) {
    try { if (nightId) wx.setStorageSync(key(userId, 'pending'), nightId); else wx.removeStorageSync(key(userId, 'pending')) } catch { /* In-memory state and server reconciliation remain available. */ }
  }
}
export const nightEvents = new NightEvents(events => nightApi.track(events), localClock)
export const nightStore = new NightStore(nightApi, persistence, () => Date.now(), method => nightEvents.record({ name: 'ceremony_start', props: { method } }))
nightStore.subscribe(state => nightEvents.update(state.snapshot?.userId || null, nightStore.isActive() && state.status === 'ready' && !state.stale, !nightStore.isActive()))
