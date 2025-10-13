import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, useLoad } from '@tarojs/taro'
import {
  RecentDay,
  computeBestStreak,
  computeCompletionRate,
  computeCurrentStreak,
  computeRecommendedBedTime,
  formatCountdown,
  formatDateKey,
  formatWindowHint,
  getMinutesSinceMidnight,
  getRecentDays,
  isCheckInWindowOpen,
  weekdayLabels
} from '../../utils/checkin'
import {
  CheckInMap,
  DEFAULT_SLEEP_MINUTE,
  DEFAULT_USER_NAME,
  UserSettings,
  ensureUserUid,
  readCheckIns,
  readSettings,
  saveCheckIns
} from '../../utils/storage'
import { formatMinutesToTime, formatTime } from '../../utils/time'
import { HomeHero } from '../../components/home/HomeHero'
import { CheckInCard } from '../../components/home/CheckInCard'
import { StatsOverview } from '../../components/home/StatsOverview'
import { RecentCheckIns } from '../../components/home/RecentCheckIns'
import { TipsSection } from '../../components/home/TipsSection'
import './index.scss'

const sleepTips = [
  '睡前 1 小时放下电子设备，让大脑慢慢放松。',
  '保持卧室安静、昏暗和舒适，营造入睡氛围。',
  '建立固定的睡前仪式，例如阅读或轻度伸展。'
]

type HomeStats = {
  streak: number
  total: number
  best: number
  completion: number
}

function createHomeStats(records: CheckInMap, currentTime: Date): HomeStats {
  const now = new Date(currentTime)
  return {
    total: Object.keys(records).length,
    streak: computeCurrentStreak(records, now),
    best: computeBestStreak(records),
    completion: computeCompletionRate(records, now)
  }
}

function createRecentCheckIns(records: CheckInMap, currentTime: Date): RecentDay[] {
  return getRecentDays(records, currentTime, 7)
}

export default function Index() {
  const [records, setRecords] = useState<CheckInMap>({})
  const [currentTime, setCurrentTime] = useState<Date>(new Date())
  const [settings, setSettings] = useState<UserSettings>({
    name: DEFAULT_USER_NAME,
    targetSleepMinute: DEFAULT_SLEEP_MINUTE
  })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const todayKey = useMemo(() => formatDateKey(currentTime), [currentTime])
  const minutesNow = useMemo(() => getMinutesSinceMidnight(currentTime), [currentTime])
  const isWindowOpen = useMemo(
    () => isCheckInWindowOpen(minutesNow, settings.targetSleepMinute),
    [minutesNow, settings.targetSleepMinute]
  )
  const hasCheckedInToday = Boolean(records[todayKey])

  const recommendedBedTime = useMemo(
    () => computeRecommendedBedTime(currentTime, settings.targetSleepMinute),
    [currentTime, settings.targetSleepMinute]
  )

  const countdownText = useMemo(() => {
    const diff = recommendedBedTime.getTime() - currentTime.getTime()
    return formatCountdown(diff)
  }, [currentTime, recommendedBedTime])

  const windowHint = useMemo(
    () =>
      formatWindowHint(
        currentTime,
        recommendedBedTime,
        isWindowOpen,
        settings.targetSleepMinute
      ),
    [currentTime, isWindowOpen, recommendedBedTime, settings.targetSleepMinute]
  )

  const targetTimeText = useMemo(
    () => formatMinutesToTime(settings.targetSleepMinute),
    [settings.targetSleepMinute]
  )

  const stats = useMemo(() => createHomeStats(records, currentTime), [records, currentTime])

  const recentDays = useMemo(
    () => createRecentCheckIns(records, currentTime),
    [records, currentTime]
  )

  const lastCheckInTime = useMemo(() => {
    const timestamp = records[todayKey]
    if (!timestamp) {
      return ''
    }
    return formatTime(new Date(timestamp))
  }, [records, todayKey])

  const isLateCheckIn = useMemo(() => {
    const timestamp = records[todayKey]
    if (!timestamp) {
      return false
    }
    const targetForRecord = computeRecommendedBedTime(new Date(timestamp), settings.targetSleepMinute)
    return timestamp > targetForRecord.getTime()
  }, [records, settings.targetSleepMinute, todayKey])

  const isLateNow = useMemo(
    () => currentTime.getTime() > recommendedBedTime.getTime(),
    [currentTime, recommendedBedTime]
  )

  const hydrateAll = useCallback(() => {
    setRecords(readCheckIns())
    setSettings(readSettings())
  }, [])

  const persistRecords = useCallback((next: CheckInMap) => {
    setRecords(next)
    saveCheckIns(next)
  }, [])

  const handleCheckIn = useCallback(() => {
    if (hasCheckedInToday) {
      Taro.showToast({ title: '今天已经打过卡了', icon: 'none' })
      return
    }

    if (!isWindowOpen) {
      Taro.showToast({ title: '不在打卡时间段内', icon: 'none' })
      return
    }

    const now = new Date()
    const key = formatDateKey(now)
    const updated = { ...records, [key]: now.getTime() }
    persistRecords(updated)
    Taro.showToast({ title: '打卡成功，早睡加油！', icon: 'success' })
  }, [hasCheckedInToday, isWindowOpen, persistRecords, records])

  useLoad(() => {
    ensureUserUid()
    hydrateAll()
  })

  useDidShow(() => {
    hydrateAll()
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setCurrentTime(new Date())
      }, 60 * 1000)
    }
  })

  useDidHide(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  })

  useEffect(() => {
    setCurrentTime(new Date())

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  const displayName = useMemo(() => settings.name || DEFAULT_USER_NAME, [settings.name])

  return (
    <View className='index'>
      <HomeHero
        displayName={displayName}
        weekdayLabel={weekdayLabels[currentTime.getDay()]}
        dateLabel={todayKey}
        countdownText={countdownText}
      />
      <CheckInCard
        windowHint={windowHint}
        lastCheckInTime={lastCheckInTime}
        isLateCheckIn={isLateCheckIn}
        targetTimeText={targetTimeText}
        isWindowOpen={isWindowOpen}
        hasCheckedInToday={hasCheckedInToday}
        isLateNow={isLateNow}
        onCheckIn={handleCheckIn}
      />
      <StatsOverview stats={stats} />
      <RecentCheckIns items={recentDays} />
      <TipsSection tips={sleepTips} />
    </View>
  )
}
