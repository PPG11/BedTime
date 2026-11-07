import type { CheckinDocument, TodayCheckinStatus } from '../services/checkin'
import type { UserDocument, UserUpsertPayload } from '../services/user'
import { DEFAULT_SLEEP_MINUTE, DEFAULT_USER_NAME, type CheckInMap, type UserSettings } from '../utils/storage'
import { parseTimeStringToMinutes } from '../utils/time'
import { mapCheckinsToRecord, previousCheckinDate } from '../utils/checkinsMap'
import { normalizeDateKey } from '../utils/checkin'

export type AppDataState = {
  ready: boolean
  loading: boolean
  user: UserDocument | null
  settings: UserSettings
  todayStatus: TodayCheckinStatus | null
  records: CheckInMap
  onTimeRecords: CheckInMap
  totalDays: number
  streak: number
  lastCheckinDate: string
  error: string | null
}

type Dependencies = {
  supportsCloud(): boolean
  ensureCurrentUser(): Promise<UserDocument>
  updateCurrentUser(patch: UserUpsertPayload): Promise<UserDocument>
  fetchTodayCheckinStatus(): Promise<TodayCheckinStatus | null>
  fetchCheckins(limit: number): Promise<CheckinDocument[]>
}

function settingsFor(user: UserDocument | null): UserSettings {
  return {
    name: user?.nickname || DEFAULT_USER_NAME,
    targetSleepMinute: parseTimeStringToMinutes(user?.targetHM ?? '', DEFAULT_SLEEP_MINUTE)
  }
}

/** Shared domain state stays outside Page.data; pages project JSON view models. */
export function createAppDataStore(deps: Dependencies) {
  let state: AppDataState = {
    ready: false, loading: false, user: null, settings: settingsFor(null),
    todayStatus: null, records: {}, onTimeRecords: {}, totalDays: 0, streak: 0, lastCheckinDate: '', error: null
  }
  const listeners = new Set<(snapshot: AppDataState) => void>()
  let inflight: Promise<void> | null = null
  let revision = 0
  let profileWriting = false
  let profileQueue: Promise<unknown> = Promise.resolve()

  function publish(patch: Partial<AppDataState>) {
    state = { ...state, ...patch }
    listeners.forEach(listener => {
      try { listener(state) } catch (error) { console.error('更新页面状态失败', error) }
    })
  }

  async function hydrate() {
    const startedAt = revision
    publish({ loading: true, error: null })
    try {
      if (!deps.supportsCloud()) throw new Error('当前环境不支持微信云开发，请在微信中打开')
      const user = await deps.ensureCurrentUser()
      const settings = settingsFor(user)
      const [todayStatus, checkins] = await Promise.all([
        deps.fetchTodayCheckinStatus(), deps.fetchCheckins(365)
      ])
      if (startedAt !== revision) return
      const records = mapCheckinsToRecord(checkins)
      const onTimeRecords = mapCheckinsToRecord(checkins, ['hit'])
      if (todayStatus?.checkedIn && todayStatus.timestamp) {
        records[todayStatus.date] = todayStatus.timestamp.getTime()
        if (todayStatus.status === 'hit') onTimeRecords[todayStatus.date] = todayStatus.timestamp.getTime()
        else delete onTimeRecords[todayStatus.date]
      }
      const dates = Object.keys(records).sort()
      const savedTotal = Number.isSafeInteger(user.totalDays) && user.totalDays >= 0 ? user.totalDays : 0
      const savedLastDate = normalizeDateKey(user.lastCheckinDate) || ''
      // History/status may include a write completed after bootstrap read the user summary.
      const totalDays = savedLastDate
        ? savedTotal + dates.filter(date => date > savedLastDate).length
        : Math.max(savedTotal, dates.length)
      let streak = Number.isSafeInteger(user.streak) && user.streak >= 0 ? user.streak : 0
      let lastCheckinDate = savedLastDate
      for (const date of dates) {
        if (date <= lastCheckinDate) continue
        streak = onTimeRecords[date] ? (lastCheckinDate === previousCheckinDate(date) ? streak : 0) + 1 : 0
        lastCheckinDate = date
      }
      publish({ ready: true, user, settings, records, onTimeRecords, totalDays, streak, lastCheckinDate, todayStatus, error: null })
    } catch (error) {
      if (startedAt === revision) {
        publish({ ready: true, error: error instanceof Error ? error.message : '加载失败，请重试' })
      }
    } finally {
      publish({ loading: false })
    }
  }

  function refresh(): Promise<void> {
    if (inflight) return inflight
    inflight = hydrate().finally(() => { inflight = null })
    return inflight
  }

  function updateProfile(patch: UserUpsertPayload): Promise<UserDocument> {
    const task = profileQueue.then(async () => {
      profileWriting = true
      try {
        if (inflight) await inflight
        const user = await deps.updateCurrentUser(patch)
        revision += 1
        const settings = settingsFor(user)
        const targetChanged = user.targetHM !== state.user?.targetHM
        publish({ user, settings, error: null, ...(targetChanged ? { todayStatus: null } : {}) })
        // External refreshes wait on this write; read the new nightly cycle here.
        await refresh()
        return state.user ?? user
      } finally {
        profileWriting = false
      }
    })
    profileQueue = task.catch(() => undefined)
    return task
  }

  function patchCheckins(document: CheckinDocument) {
    revision += 1
    const checkedIn = document.status === 'hit' || document.status === 'late'
    const onTimeRecords = { ...state.onTimeRecords }
    if (document.status === 'hit') onTimeRecords[document.date] = document.ts.getTime()
    else delete onTimeRecords[document.date]
    // The server accepts new check-ins in increasing cycle order. Replayed old records never add a day.
    const isNewDate = checkedIn && document.date > state.lastCheckinDate
    const totalDays = state.totalDays + (isNewDate ? 1 : 0)
    let streak = state.streak
    if (isNewDate) {
      const previousStreak = state.lastCheckinDate === previousCheckinDate(document.date) ? state.streak : 0
      streak = document.status === 'hit' ? previousStreak + 1 : 0
    }
    publish({
      records: checkedIn ? { ...state.records, [document.date]: document.ts.getTime() } : state.records,
      onTimeRecords,
      totalDays,
      streak,
      lastCheckinDate: isNewDate ? document.date : state.lastCheckinDate,
      todayStatus: {
        checkedIn, date: document.date, status: document.status,
        timestamp: document.ts, goodnightMessageId: document.goodnightMessageId ?? null
      }
    })
  }

  return {
    getAppData: () => state,
    subscribeAppData(listener: (snapshot: AppDataState) => void) {
      listeners.add(listener)
      listener(state)
      return () => { listeners.delete(listener) }
    },
    refreshAppData: () => profileWriting ? profileQueue.then(() => undefined) : refresh(),
    updateProfile,
    patchCheckins
  }
}
