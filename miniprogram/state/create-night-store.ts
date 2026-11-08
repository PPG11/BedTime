import { CloudError } from '../services/cloud'
import { EXPERIENCE } from '../config/night-experience'
import { resolveNight } from '../utils/night-time'
import type { NightApi, NightCloseReply, NightMethod, NightPrefs, NightRecord, NightStateReply } from '../types/night'

export type NightStoreState = {
  status: 'loading' | 'ready' | 'error'; snapshot: NightStateReply | null
  error: string; stale: boolean; pendingNightId: string | null
  prefsSaving: boolean; prefsDelayed: boolean; prefsError: string
}
export type NightPersistence = {
  getPending(userId: string): string | null
  setPending(userId: string, nightId: string | null): void
}
const definite = new Set(['INVALID_ARG', 'UNAUTHORIZED', 'NIGHT_CHANGED', 'WINDOW_NOT_OPEN'])

/** Authenticated business state. It does not play UI effects or invent records. */
export class NightStore {
  private state: NightStoreState = { status: 'loading', snapshot: null, error: '', stale: true, pendingNightId: null, prefsSaving: false, prefsDelayed: false, prefsError: '' }
  private listeners = new Set<(state: NightStoreState) => void>()
  private records = new Map<string, NightRecord>()
  private visible = false
  private context = 0
  private identity = 0
  private revision = 0
  private receivedAt = 0
  private readId = 0
  private readFlight: { context: number; id: number; promise: Promise<boolean> } | null = null
  private submission: { context: number; promise: Promise<NightCloseReply> } | null = null
  private prefsFlight: Promise<void> | null = null
  private queuedPrefs: Partial<NightPrefs> = {}

  constructor(private api: NightApi, private persistence: NightPersistence, private now: () => number,
    private onSubmission: (method: NightMethod) => void = () => {}) {}
  get(): NightStoreState { return JSON.parse(JSON.stringify(this.state)) as NightStoreState }
  getContext() { return this.context }
  isActive() { return this.visible }
  subscribe(listener: (state: NightStoreState) => void): () => void {
    this.listeners.add(listener); listener(this.get())
    return () => { this.listeners.delete(listener) }
  }
  private emit() { const state = this.get(); this.listeners.forEach(listener => listener(state)) }
  private current(context: number, userId?: string) { return this.visible && context === this.context && (!userId || this.state.snapshot?.userId === userId) }
  activate(): Promise<boolean> { this.visible = true; this.context += 1; this.readFlight = null; return this.refresh() }
  hide() { this.visible = false; this.context += 1; this.readFlight = null; this.emit() }
  estimatedNow(): number { return this.state.snapshot ? this.state.snapshot.serverNow + Math.max(0, this.now() - this.receivedAt) : this.now() }

  refresh(preservePrefsError = false): Promise<boolean> {
    if (!this.visible) return Promise.resolve(false)
    if (this.readFlight?.context === this.context) return this.readFlight.promise
    const context = this.context, revision = this.revision, id = ++this.readId
    this.state = { ...this.state, status: 'loading', stale: true, error: '' }; this.emit()
    const promise = this.api.getState().then(async snapshot => {
      if (!this.current(context)) return false
      // A read started before a mutation must not clear its confirmation or
      // replace a newer preference. Obtain a fresh authoritative snapshot.
      if (this.state.snapshot?.userId === snapshot.userId && revision !== this.revision) {
        if (this.readFlight?.id === id) this.readFlight = null
        return this.refresh(preservePrefsError)
      }
      if (this.state.snapshot?.userId !== snapshot.userId) {
        this.identity += 1; this.records.clear(); this.queuedPrefs = {}; this.prefsFlight = null; this.submission = null
        this.state = { ...this.state, snapshot: null, pendingNightId: null, prefsSaving: false, prefsDelayed: false, prefsError: '' }
      }
      if (snapshot.record) this.records.set(snapshot.record.nightId, snapshot.record)
      if (snapshot.lastRecord) this.records.set(snapshot.lastRecord.nightId, snapshot.lastRecord)
      const pendingNightId = this.state.pendingNightId || this.persistence.getPending(snapshot.userId)
      const activePrefs = this.state.prefsSaving && this.state.snapshot ? this.state.snapshot.prefs : snapshot.prefs
      this.state = { ...this.state, snapshot: { ...snapshot, prefs: { ...activePrefs } }, status: 'ready', stale: false, error: '', pendingNightId,
        prefsError: preservePrefsError ? this.state.prefsError : '' }
      this.receivedAt = this.now()
      if (pendingNightId && this.records.has(pendingNightId)) this.clearPending(pendingNightId)
      this.emit(); return true
    }).catch(error => {
      if (this.current(context)) {
        if (error instanceof CloudError && error.code === 'UNAUTHORIZED') this.clearIdentity()
        this.state = { ...this.state, status: 'error', stale: true, error: '暂时无法确认今晚的状态，请重试。' }; this.emit()
      }
      return false
    }).finally(() => { if (this.readFlight?.id === id) this.readFlight = null })
    this.readFlight = { context, id, promise }
    return promise
  }

  private clearIdentity() {
    this.identity += 1; this.records.clear(); this.queuedPrefs = {}; this.prefsFlight = null; this.submission = null
    this.state = { ...this.state, snapshot: null, pendingNightId: null, prefsSaving: false, prefsDelayed: false, prefsError: '' }
  }
  private clearPending(nightId: string) {
    const userId = this.state.snapshot?.userId
    if (!userId || this.state.pendingNightId !== nightId) return
    this.state.pendingNightId = null
    this.persistence.setPending(userId, null)
  }
  private mergeRecord(record: NightRecord, serverNow: number) {
    const snapshot = this.state.snapshot
    if (!snapshot) return
    this.revision += 1; this.records.set(record.nightId, record)
    // A late lookup/commit may have been evaluated before a newer getState.
    // Keep that newer clock and night while caching the original receipt.
    const advancesClock = serverNow >= snapshot.serverNow
    const rules = advancesClock ? resolveNight(serverNow) : {
      nightId: snapshot.nightId, phase: snapshot.phase, windowOpenAt: snapshot.windowOpenAt,
      windowCloseAt: snapshot.windowCloseAt, nextOpenAt: snapshot.nextOpenAt
    }
    const lastRecord = !snapshot.lastRecord || record.nightId >= snapshot.lastRecord.nightId ? record : snapshot.lastRecord
    this.state.snapshot = { ...snapshot, ...rules, serverNow: advancesClock ? serverNow : snapshot.serverNow, record: this.records.get(rules.nightId) || null, lastRecord,
      firstNightId: snapshot.firstNightId || record.nightId, lastNightId: lastRecord.nightId }
    if (advancesClock) this.receivedAt = this.now()
    this.clearPending(record.nightId); this.emit()
  }

  async submit(method: NightMethod, requestedNightId: string): Promise<NightCloseReply> {
    const context = this.context
    const userId = this.state.snapshot?.userId
    if (!userId || !this.current(context, userId)) throw new CloudError('STALE', '请重新确认今晚状态')
    if (this.submission?.context === context) return this.submission.promise
    const promise = (async () => {
      const elapsed = this.now() - this.receivedAt
      const estimate = resolveNight(this.estimatedNow())
      const state = this.state.snapshot!
      if (this.state.stale || elapsed < 0 || elapsed >= 300_000 || estimate.nightId !== state.nightId || estimate.phase !== state.phase) {
        if (!await this.refresh()) throw new CloudError('NETWORK', '请先重新确认今晚状态')
      }
      if (!this.current(context, userId)) throw new CloudError('STALE', '页面已变化')
      const snapshot = this.state.snapshot!
      if (snapshot.nightId !== requestedNightId) throw new CloudError('NIGHT_CHANGED', '已经是新的一晚，请重新确认。')
      if (snapshot.phase !== 'open' && !snapshot.record) throw new CloudError('WINDOW_NOT_OPEN', '本夜不能新增关灯记录。')
      this.state.pendingNightId = requestedNightId
      this.persistence.setPending(userId, requestedNightId); this.emit()
      try {
        try { this.onSubmission(method) } catch { /* Observation cannot block a close. */ }
        const reply = await this.api.closeLight(requestedNightId, method)
        if (this.current(context, userId)) this.mergeRecord(reply.record, reply.serverNow)
        return reply
      } catch (error) {
        if (this.current(context, userId) && error instanceof CloudError && definite.has(error.code)) {
          this.clearPending(requestedNightId)
          if (error.code === 'UNAUTHORIZED') this.clearIdentity()
          this.emit()
        }
        throw error
      }
    })().finally(() => { if (this.submission?.promise === promise) this.submission = null })
    this.submission = { context, promise }
    return promise
  }

  async lookup(nightId: string): Promise<NightRecord | null> {
    const context = this.context, userId = this.state.snapshot?.userId
    if (!userId || !this.current(context, userId)) throw new CloudError('STALE', '请先确认身份')
    if (this.state.stale && !await this.refresh()) throw new CloudError('NETWORK', '请先重新确认身份')
    if (!this.current(context, userId)) throw new CloudError('STALE', '身份已变化')
    const reply = await this.api.getNight(nightId)
    if (!this.current(context, userId)) throw new CloudError('STALE', '页面已变化')
    if (reply.record) this.mergeRecord(reply.record, reply.serverNow)
    else {
      const rules = resolveNight(reply.serverNow)
      // A successful empty lookup after the original window closes ends the
      // recovery prompt, not the possibility of a late committed record.
      // Later records remain recoverable through getState and the archive.
      if (nightId < rules.nightId || (nightId === rules.nightId && rules.phase === 'closed')) {
        this.clearPending(nightId); this.emit()
      }
    }
    return reply.record
  }

  async archive(cursor?: string) {
    const context = this.context, userId = this.state.snapshot?.userId
    if (!userId || !this.current(context, userId) || this.state.stale) throw new CloudError('STALE', '请先确认身份')
    const reply = await this.api.getArchive(cursor)
    if (!this.current(context, userId)) throw new CloudError('STALE', '页面已变化')
    return reply
  }

  setPrefs(patch: Partial<NightPrefs>): Promise<void> {
    const snapshot = this.state.snapshot
    if (!snapshot || this.state.stale || !this.visible) return Promise.resolve()
    this.revision += 1
    this.queuedPrefs = { ...this.queuedPrefs, ...patch }
    this.state.snapshot = { ...snapshot, prefs: { ...snapshot.prefs, ...patch } }
    this.state.prefsSaving = true; this.state.prefsError = ''; this.emit()
    if (this.prefsFlight) return this.prefsFlight
    const identity = this.identity, userId = snapshot.userId
    const active = () => identity === this.identity && this.state.snapshot?.userId === userId
    const promise = (async () => {
      while (active() && Object.keys(this.queuedPrefs).length) {
        const next = this.queuedPrefs; this.queuedPrefs = {}
        this.state.prefsDelayed = false
        // Bound the visible wait without releasing the write queue: a client
        // timeout cannot cancel a server write or allow the next write to race it.
        const timer = setTimeout(() => {
          if (active()) { this.state.prefsDelayed = true; this.emit() }
        }, EXPERIENCE.unknownMs)
        try {
          const reply = await this.api.setPrefs(next)
          if (!active()) return
          this.revision += 1
          this.state.snapshot = { ...this.state.snapshot!, prefs: { ...reply.prefs, ...this.queuedPrefs } }
          this.state.prefsDelayed = false
          this.emit()
        } catch {
          clearTimeout(timer)
          if (!active()) return
          this.queuedPrefs = {}; this.state.prefsSaving = false; this.state.prefsDelayed = false
          this.state.prefsError = '设置未保存，请重试。'; this.emit()
          await this.refresh(true)
          return
        } finally { clearTimeout(timer) }
      }
    })().finally(() => {
      if (this.prefsFlight !== promise) return
      this.prefsFlight = null
      if (active()) { this.state.prefsSaving = false; this.state.prefsDelayed = false; this.emit() }
    })
    this.prefsFlight = promise
    return promise
  }
}
