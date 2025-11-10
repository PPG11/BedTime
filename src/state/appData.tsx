import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import Taro from '@tarojs/taro'
import { DEFAULT_SLEEP_MINUTE, DEFAULT_USER_NAME, readCheckIns, readSettings, readUserUid, saveCheckIns, saveSettings, type CheckInMap, type UserSettings } from '../utils/storage'
import { parseTimeStringToMinutes } from '../utils/time'
import { mapCheckinsToRecord } from '../utils/checkinsMap'
import { resolveCheckInCycle } from '../utils/checkin'
import {
  fetchCheckins,
  fetchTodayCheckinStatus,
  refreshPublicProfile,
  ensureCurrentUser,
  supportsCloud,
  type TodayCheckinStatus,
  type UserDocument
} from '../services'

type AppDataState = {
  ready: boolean
  loading: boolean
  canUseCloud: boolean
  user: UserDocument | null
  settings: UserSettings
  todayStatus: TodayCheckinStatus | null
  records: CheckInMap
  localUid: string
  error: string | null
}

type Updater<T> = T | ((prev: T) => T)

type AppDataContextValue = AppDataState & {
  refresh(): Promise<void>
  setUser: (updater: Updater<UserDocument | null>) => void
  setSettings: (updater: Updater<UserSettings>) => void
  setRecords: (updater: Updater<CheckInMap>) => void
  setTodayStatus: (updater: Updater<TodayCheckinStatus | null>) => void
}

const defaultSettings: UserSettings = {
  name: DEFAULT_USER_NAME,
  targetSleepMinute: DEFAULT_SLEEP_MINUTE
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

function resolveUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (value: T) => T)(prev) : updater
}

function deriveSettingsFromUser(user: UserDocument | null): UserSettings {
  if (!user) {
    return defaultSettings
  }
  return {
    name: user.nickname || DEFAULT_USER_NAME,
    targetSleepMinute: parseTimeStringToMinutes(user.targetHM, DEFAULT_SLEEP_MINUTE)
  }
}

function ensureTodayRecord(records: CheckInMap, status: TodayCheckinStatus | null, dateKey: string): CheckInMap {
  if (!status?.checkedIn || !status.timestamp) {
    return records
  }
  if (records[dateKey]) {
    return records
  }
  return {
    ...records,
    [dateKey]: status.timestamp.getTime()
  }
}

export function AppDataProvider({ children }: { children: ReactNode }): JSX.Element {
  const canUseCloud = supportsCloud()
  const [state, setState] = useState<AppDataState>(() => ({
    ready: false,
    loading: false,
    canUseCloud,
    user: null,
    settings: canUseCloud ? defaultSettings : readSettings(),
    todayStatus: null,
    records: canUseCloud ? {} : readCheckIns(),
    localUid: readUserUid(),
    error: null
  }))

  const canUseCloudRef = useRef(canUseCloud)
  canUseCloudRef.current = canUseCloud

  const setUser = useCallback((updater: Updater<UserDocument | null>) => {
    setState((prev) => {
      const nextUser = resolveUpdater(updater, prev.user)
      const nextSettings = canUseCloudRef.current
        ? deriveSettingsFromUser(nextUser)
        : prev.settings
      return {
        ...prev,
        user: nextUser,
        settings: nextSettings
      }
    })
  }, [])

  const setSettings = useCallback((updater: Updater<UserSettings>) => {
    setState((prev) => {
      const next = resolveUpdater(updater, prev.settings)
      if (!canUseCloudRef.current) {
        saveSettings(next)
      }
      return { ...prev, settings: next }
    })
  }, [])

  const setRecords = useCallback((updater: Updater<CheckInMap>) => {
    setState((prev) => {
      const next = resolveUpdater(updater, prev.records)
      if (!canUseCloudRef.current) {
        saveCheckIns(next)
      }
      return { ...prev, records: next }
    })
  }, [])

  const setTodayStatus = useCallback((updater: Updater<TodayCheckinStatus | null>) => {
    setState((prev) => ({
      ...prev,
      todayStatus: resolveUpdater(updater, prev.todayStatus ?? null)
    }))
  }, [])

  const hydrate = useCallback(async () => {
    if (!canUseCloud) {
      setState((prev) => ({
        ...prev,
        ready: true,
        loading: false,
        records: readCheckIns(),
        settings: readSettings(),
        todayStatus: null,
        user: null,
        error: null
      }))
      return
    }

    setState((prev) => ({ ...prev, loading: true, error: null }))

    try {
      const user = await ensureCurrentUser({})
      const settings = deriveSettingsFromUser(user)
      const windowOptions = { targetSleepMinute: settings.targetSleepMinute }
      const cycle = resolveCheckInCycle(new Date(), settings.targetSleepMinute, windowOptions)
      const [todayStatus, checkins] = await Promise.all([
        fetchTodayCheckinStatus(cycle.dateKey),
        fetchCheckins(user.uid, 365)
      ])

      const records = mapCheckinsToRecord(checkins)
      const normalizedRecords = ensureTodayRecord(records, todayStatus, cycle.dateKey)

      try {
        await refreshPublicProfile(user, cycle.dateKey)
      } catch (error) {
        console.warn('刷新公开资料失败，将在后台重试', error)
      }

      setState((prev) => ({
        ...prev,
        ready: true,
        loading: false,
        user,
        settings,
        records: normalizedRecords,
        todayStatus: todayStatus ?? null,
        error: null
      }))
    } catch (error) {
      console.error('初始化应用数据失败', error)
      const message = error instanceof Error ? error.message : '初始化失败'
      Taro.showToast({ title: message, icon: 'none', duration: 2000 })
      setState((prev) => ({
        ...prev,
        ready: true,
        loading: false,
        user: null,
        todayStatus: null,
        records: {},
        error: message
      }))
    }
  }, [canUseCloud])

  const inflightRef = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (inflightRef.current) {
      return inflightRef.current
    }
    const task = hydrate().finally(() => {
      inflightRef.current = null
    })
    inflightRef.current = task
    return task
  }, [hydrate])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AppDataContextValue>(() => ({
    ...state,
    refresh,
    setUser,
    setSettings,
    setRecords,
    setTodayStatus
  }), [state, refresh, setUser, setSettings, setRecords, setTodayStatus])

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext)
  if (!context) {
    throw new Error('useAppData 必须在 AppDataProvider 内使用')
  }
  return context
}
