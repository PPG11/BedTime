import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, useLoad } from '@tarojs/taro'
import './index.scss'

type CheckInMap = Record<string, number>
type RecentDay = {
  key: string
  label: string
  weekday: string
  checked: boolean
}

const STORAGE_KEY = 'bedtime-checkins'
const CHECK_IN_START_MINUTE = 20 * 60 // 20:00
const CHECK_IN_END_MINUTE = 23 * 60 + 59 // 23:59
const RECOMMENDED_SLEEP_MINUTE = 22 * 60 + 30 // 22:30
const ONE_DAY_MS = 24 * 60 * 60 * 1000

const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatTime(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${hours}:${minutes}`
}

function getMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function formatCountdown(durationMs: number): string {
  if (durationMs <= 0) {
    return '已经超过推荐就寝时间'
  }
  const totalMinutes = Math.ceil(durationMs / (60 * 1000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) {
    return `${minutes} 分钟后`
  }

  if (minutes === 0) {
    return `${hours} 小时后`
  }

  return `${hours} 小时 ${minutes} 分钟后`
}

function computeCurrentStreak(records: CheckInMap, today: Date): number {
  let streak = 0
  const cursor = new Date(today)
  cursor.setHours(0, 0, 0, 0)

  while (true) {
    const key = formatDateKey(cursor)
    if (!records[key]) {
      break
    }
    streak += 1
    cursor.setTime(cursor.getTime() - ONE_DAY_MS)
  }

  return streak
}

function computeBestStreak(records: CheckInMap): number {
  const keys = Object.keys(records)
  if (keys.length === 0) {
    return 0
  }

  const sorted = keys
    .map((key) => parseDateKey(key))
    .sort((a, b) => a.getTime() - b.getTime())

  let best = 1
  let streak = 1

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const current = sorted[i]
    const diffDays = Math.round((current.getTime() - prev.getTime()) / ONE_DAY_MS)
    if (diffDays === 1) {
      streak += 1
    } else {
      streak = 1
    }
    best = Math.max(best, streak)
  }

  return best
}

function getRecentDays(records: CheckInMap, current: Date, length: number): RecentDay[] {
  const items: RecentDay[] = []
  const cursor = new Date(current)
  cursor.setHours(0, 0, 0, 0)

  for (let i = length - 1; i >= 0; i -= 1) {
    const day = new Date(cursor.getTime() - i * ONE_DAY_MS)
    const key = formatDateKey(day)
    items.push({
      key,
      label: `${day.getMonth() + 1}.${day.getDate()}`,
      weekday: weekdayLabels[day.getDay()],
      checked: Boolean(records[key])
    })
  }

  return items
}

function computeCompletionRate(records: CheckInMap, today: Date): number {
  const keys = Object.keys(records)
  if (!keys.length) {
    return 0
  }

  const sorted = keys
    .map(parseDateKey)
    .sort((a, b) => a.getTime() - b.getTime())

  const first = sorted[0]
  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)
  const spanDays = Math.floor((todayMidnight.getTime() - first.getTime()) / ONE_DAY_MS) + 1
  if (spanDays <= 0) {
    return 100
  }
  const rate = Math.round((keys.length / spanDays) * 100)
  return Math.max(0, Math.min(100, rate))
}

function formatWindowHint(minutesNow: number): string {
  if (minutesNow < CHECK_IN_START_MINUTE) {
    const diffMinutes = CHECK_IN_START_MINUTE - minutesNow
    const hours = Math.floor(diffMinutes / 60)
    const minutes = diffMinutes % 60
    if (hours === 0) {
      return `打卡将在 ${minutes} 分钟后开启`
    }
    return `打卡将在 ${hours} 小时 ${minutes} 分钟后开启`
  }
  if (minutesNow > CHECK_IN_END_MINUTE) {
    return '今日打卡已关闭'
  }
  return '打卡进行中，准备早点入睡吧'
}

export default function Index() {
  const [records, setRecords] = useState<CheckInMap>({})
  const [currentTime, setCurrentTime] = useState<Date>(new Date())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const todayKey = useMemo(() => formatDateKey(currentTime), [currentTime])
  const minutesNow = useMemo(() => getMinutesSinceMidnight(currentTime), [currentTime])
  const isWindowOpen = minutesNow >= CHECK_IN_START_MINUTE && minutesNow <= CHECK_IN_END_MINUTE
  const hasCheckedInToday = Boolean(records[todayKey])

  const recommendedBedTime = useMemo(() => {
    const target = new Date(currentTime)
    const hours = Math.floor(RECOMMENDED_SLEEP_MINUTE / 60)
    const minutes = RECOMMENDED_SLEEP_MINUTE % 60
    target.setHours(hours, minutes, 0, 0)
    return target
  }, [currentTime])

  const countdownText = useMemo(() => {
    const diff = recommendedBedTime.getTime() - currentTime.getTime()
    return formatCountdown(diff)
  }, [currentTime, recommendedBedTime])

  const stats = useMemo(() => {
    const today = new Date(currentTime)
    today.setHours(0, 0, 0, 0)
    return {
      total: Object.keys(records).length,
      streak: computeCurrentStreak(records, today),
      best: computeBestStreak(records),
      completion: computeCompletionRate(records, new Date(today))
    }
  }, [currentTime, records])

  const recentDays = useMemo(
    () => getRecentDays(records, currentTime, 7),
    [records, currentTime]
  )

  const lastCheckInTime = useMemo(() => {
    const timestamp = records[todayKey]
    if (!timestamp) {
      return ''
    }
    return formatTime(new Date(timestamp))
  }, [records, todayKey])

  const hydrateRecords = useCallback(() => {
    try {
      const stored = Taro.getStorageSync(STORAGE_KEY) as CheckInMap | undefined
      if (stored && typeof stored === 'object') {
        setRecords(stored)
      }
    } catch (error) {
      console.warn('读取早睡打卡数据失败', error)
    }
  }, [])

  const persistRecords = useCallback((next: CheckInMap) => {
    setRecords(next)
    try {
      Taro.setStorageSync(STORAGE_KEY, next)
    } catch (error) {
      console.warn('保存早睡打卡数据失败', error)
    }
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
    hydrateRecords()
  })

  useDidShow(() => {
    hydrateRecords()
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

  return (
    <View className='index'>
      <View className='hero'>
        <View>
          <Text className='hero__subtitle'>{weekdayLabels[currentTime.getDay()]}</Text>
          <Text className='hero__title'>{todayKey}</Text>
        </View>
        <View className='hero__countdown'>
          <Text className='hero__countdown-label'>距离推荐入睡</Text>
          <Text className='hero__countdown-time'>{countdownText}</Text>
        </View>
      </View>

      <View className='checkin-card'>
        <Text className='checkin-card__title'>今日早睡打卡</Text>
        <Text className='checkin-card__status'>{formatWindowHint(minutesNow)}</Text>
        {lastCheckInTime ? (
          <Text className='checkin-card__timestamp'>已在 {lastCheckInTime} 完成打卡</Text>
        ) : (
          <Text className='checkin-card__timestamp'>推荐入睡时间 22:30 之前完成打卡</Text>
        )}
        <Button
          className='checkin-card__button'
          type='primary'
          disabled={!isWindowOpen || hasCheckedInToday}
          onClick={handleCheckIn}
        >
          {hasCheckedInToday ? '今日已完成' : isWindowOpen ? '立即打卡' : '等待打卡'}
        </Button>
      </View>

      <View className='stats-grid'>
        <View className='stats-card'>
          <Text className='stats-card__value'>{stats.streak}</Text>
          <Text className='stats-card__label'>连续早睡天数</Text>
        </View>
        <View className='stats-card'>
          <Text className='stats-card__value'>{stats.total}</Text>
          <Text className='stats-card__label'>累计打卡次数</Text>
        </View>
        <View className='stats-card'>
          <Text className='stats-card__value'>{stats.best}</Text>
          <Text className='stats-card__label'>最佳连续记录</Text>
        </View>
        <View className='stats-card'>
          <Text className='stats-card__value'>{stats.completion}%</Text>
          <Text className='stats-card__label'>坚持完成率</Text>
        </View>
      </View>

      <View className='recent'>
        <Text className='recent__title'>最近 7 天打卡</Text>
        <View className='recent__list'>
          {recentDays.map((item) => (
            <View
              key={item.key}
              className={`recent__item ${item.checked ? 'recent__item--checked' : ''}`}
            >
              <Text className='recent__date'>{item.label}</Text>
              <Text className='recent__weekday'>{item.weekday}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='tips'>
        <Text className='tips__title'>早睡小贴士</Text>
        <View className='tips__list'>
          <Text className='tips__item'>睡前 1 小时放下电子设备，让大脑慢慢放松。</Text>
          <Text className='tips__item'>保持卧室安静、昏暗和舒适，营造入睡氛围。</Text>
          <Text className='tips__item'>建立固定的睡前仪式，例如阅读或轻度伸展。</Text>
        </View>
      </View>
    </View>
  )
}
