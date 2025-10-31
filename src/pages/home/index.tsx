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
  normalizeDateKey,
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
  readCheckIns,
  readSettings,
  readUserUid,
  saveCheckIns
} from '../../utils/storage'
import { formatMinutesToTime, formatTime, parseTimeStringToMinutes } from '../../utils/time'
import { HomeHero } from '../../components/home/HomeHero'
import { CheckInCard } from '../../components/home/CheckInCard'
import { StatsOverview } from '../../components/home/StatsOverview'
import { RecentCheckIns } from '../../components/home/RecentCheckIns'
import { TipsSection } from '../../components/home/TipsSection'
import {
  CheckinDocument,
  type CheckinStatus,
  UserDocument,
  ensureCurrentUser,
  fetchCheckins,
  refreshPublicProfile,
  supportsCloud,
  submitCheckinRecord
} from '../../services'
import { GoodnightMessageCard } from '../../components/home/GoodnightMessageCard'
import { GoodnightMessageModal } from '../../components/home/GoodnightMessageModal'
import { GoodnightRewardCard } from '../../components/home/GoodnightRewardCard'
import {
  GOODNIGHT_MESSAGE_MAX_LENGTH,
  type GoodnightMessage,
  type GoodnightVoteType
} from '../../types/goodnight'
import { useGoodnightInteraction } from './useGoodnight'
import './index.scss'

const sleepTips = [
  '睡前 1 小时放下电子设备，让大脑慢慢放松。',
  '保持卧室安静、昏暗和舒适，营造入睡氛围。',
  '建立固定的睡前仪式，例如阅读或轻度伸展。'
]

function mapCheckinsToRecord(list: CheckinDocument[]): CheckInMap {
  return list.reduce<CheckInMap>((acc, item) => {
    if (item.status === 'hit' || item.status === 'late') {
      const ts = item.ts instanceof Date ? item.ts.getTime() : new Date(item.ts).getTime()
      const key = normalizeDateKey(item.date)
      if (key) {
        acc[key] = ts
      } else if (item.date) {
        acc[item.date] = ts
      }
    }
    return acc
  }, {})
}

function withLatestSettings(user: UserDocument, settings: UserSettings): UserDocument {
  return {
    ...user,
    nickname: settings.name,
    targetHM: formatMinutesToTime(settings.targetSleepMinute)
  }
}

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
  const [userDoc, setUserDoc] = useState<UserDocument | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [canUseCloud] = useState(() => supportsCloud())
  const [localUid] = useState(() => readUserUid())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const todayKey = useMemo(() => formatDateKey(currentTime), [currentTime])
  const todayLabel = useMemo(() => {
    const normalized = normalizeDateKey(todayKey)
    if (!normalized) {
      return todayKey
    }
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`
  }, [todayKey])
  const minutesNow = useMemo(() => getMinutesSinceMidnight(currentTime), [currentTime])
  const isWindowOpen = useMemo(
    () => isCheckInWindowOpen(minutesNow, settings.targetSleepMinute),
    [minutesNow, settings.targetSleepMinute]
  )
  const recommendedBedTime = useMemo(
    () => computeRecommendedBedTime(currentTime, settings.targetSleepMinute),
    [currentTime, settings.targetSleepMinute]
  )
  const countdownText = useMemo(() => {
    const diff = recommendedBedTime.getTime() - currentTime.getTime()
    return formatCountdown(diff)
  }, [currentTime, recommendedBedTime])
  const todayRecord = useMemo(() => records[todayKey] ?? null, [records, todayKey])
  const hasCheckedInToday = Boolean(todayRecord)
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
    if (!todayRecord) {
      return ''
    }
    return formatTime(new Date(todayRecord))
  }, [todayRecord])
  const isLateCheckIn = useMemo(() => {
    if (!todayRecord) {
      return false
    }
    const targetForRecord = computeRecommendedBedTime(
      new Date(todayRecord),
      settings.targetSleepMinute
    )
    return todayRecord > targetForRecord.getTime()
  }, [settings.targetSleepMinute, todayRecord])
  const isLateNow = useMemo(
    () => currentTime.getTime() > recommendedBedTime.getTime(),
    [currentTime, recommendedBedTime]
  )
  const displayName = useMemo(() => settings.name || DEFAULT_USER_NAME, [settings.name])
  const effectiveUid = userDoc?.uid ?? localUid

  const persistRecords = useCallback(
    (next: CheckInMap) => {
      setRecords(next)
      if (!canUseCloud) {
        saveCheckIns(next)
      }
    },
    [canUseCloud]
  )

  const hydrateFromCloud = useCallback(async () => {
    setIsSyncing(true)
    try {
      const user = await ensureCurrentUser()
      setUserDoc(user)
      setSettings({
        name: user.nickname || DEFAULT_USER_NAME,
        targetSleepMinute: parseTimeStringToMinutes(user.targetHM, DEFAULT_SLEEP_MINUTE)
      })
      try {
        await refreshPublicProfile(user, todayKey)
      } catch (error) {
        console.warn('刷新公开资料失败（将稍后重试）', error)
      }
      console.log('todayKey', todayKey)
      const checkins = await fetchCheckins(user.uid, 365)
      console.log('checkins', checkins)
      const record = mapCheckinsToRecord(checkins)
      console.log('record', record)
      setRecords(record)
    } catch (error) {
      console.error('同步云端数据失败', error)
      Taro.showToast({ title: '云端同步失败，请稍后再试', icon: 'none', duration: 2000 })
      setUserDoc(null)
      setRecords({})
    } finally {
      setIsSyncing(false)
    }
  }, [todayKey])

  const hydrateAll = useCallback(async () => {
    if (canUseCloud) {
      await hydrateFromCloud()
      return
    }

    setUserDoc(null)
    setRecords(readCheckIns())
    setSettings(readSettings())
  }, [canUseCloud, hydrateFromCloud])

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      return
    }

    timerRef.current = setInterval(() => {
      setCurrentTime(new Date())
    }, 60 * 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (!timerRef.current) {
      return
    }

    clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const {
    input: goodnightInput,
    setInput: setGoodnightInput,
    submittedMessage: submittedGoodnight,
    hasSubmitted: hasSubmittedGoodnight,
    isSubmitting: isSubmittingGoodnight,
    submit: handleGoodnightSubmit,
    presentReward: presentGoodnightReward,
    fetchRewardForToday,
    modalVisible: goodnightModalVisible,
    modalMessage: goodnightModalMessage,
    rewardMessage: receivedGoodnightMessage,
    closeModal: handleCloseGoodnightModal,
    vote: handleVoteGoodnight,
    hasVoted: hasVotedGoodnight,
    isVoting: isVotingGoodnight
  } = useGoodnightInteraction({
    canUseCloud,
    userDoc,
    effectiveUid,
    todayKey,
    hasCheckedInToday
  })

  const checkInWithCloud = useCallback(
    async (rewardCandidate: GoodnightMessage | null) => {
      if (!userDoc) {
        return
      }

      try {
        const latestUser = withLatestSettings(userDoc, settings)
        const tzOffset =
          typeof latestUser.tzOffset === 'number'
            ? latestUser.tzOffset
            : -new Date().getTimezoneOffset()
        const checkinStatus: CheckinStatus = isLateNow ? 'late' : 'hit'
        const { document: created, status: submitStatus } = await submitCheckinRecord({
          uid: latestUser.uid,
          date: todayKey,
          status: checkinStatus,
          tzOffset,
          goodnightMessageId: rewardCandidate?._id,
          message: rewardCandidate?._id
        })
        const timestamp =
          created.ts instanceof Date ? created.ts.getTime() : new Date(created.ts).getTime()
        persistRecords({ ...records, [todayKey]: timestamp })
        setUserDoc(latestUser)
        if (submitStatus === 'created') {
          try {
            await refreshPublicProfile(
              {
                ...latestUser,
                tzOffset
              },
              todayKey
            )
          } catch (error) {
            console.warn('刷新公开资料失败（将在后台重试）', error)
          }
        }
        if (submitStatus === 'created') {
          Taro.showToast({ title: '打卡成功，早睡加油！', icon: 'success' })
        } else {
          Taro.showToast({ title: '今天已经打过卡了', icon: 'none' })
        }
        await presentGoodnightReward({
          message: submitStatus === 'created' ? rewardCandidate : undefined,
          syncToCheckin: submitStatus === 'created',
          showModal: submitStatus === 'created'
        })
      } catch (error) {
        console.error('云端打卡失败', error)
        Taro.showToast({ title: '云端打卡失败，请稍后重试', icon: 'none' })
      }
    },
    [
      isLateNow,
      persistRecords,
      presentGoodnightReward,
      records,
      refreshPublicProfile,
      settings,
      todayKey,
      userDoc
    ]
  )

  const checkInLocally = useCallback(
    async (rewardCandidate: GoodnightMessage | null) => {
      const now = new Date()
      const key = formatDateKey(now)
      const updated = { ...records, [key]: now.getTime() }
      persistRecords(updated)
      Taro.showToast({ title: '打卡成功，早睡加油！', icon: 'success' })
      await presentGoodnightReward({
        message: rewardCandidate,
        syncToCheckin: true
      })
    },
    [persistRecords, presentGoodnightReward, records]
  )

  const handleCheckIn = useCallback(async () => {
    if (hasCheckedInToday || isSyncing) {
      Taro.showToast({ title: '今天已经打过卡了', icon: 'none' })
      return
    }

    if (!isWindowOpen) {
      Taro.showToast({ title: '不在打卡时间段内', icon: 'none' })
      return
    }

    setIsSyncing(true)
    try {
      let rewardCandidate: GoodnightMessage | null = null
      try {
        rewardCandidate = await fetchRewardForToday()
      } catch (error) {
        console.warn('获取今日晚安心语失败', error)
      }
      if (canUseCloud && userDoc) {
        await checkInWithCloud(rewardCandidate)
        return
      }

      await checkInLocally(rewardCandidate)
    } finally {
      setIsSyncing(false)
    }
  }, [
    canUseCloud,
    checkInLocally,
    checkInWithCloud,
    fetchRewardForToday,
    hasCheckedInToday,
    isSyncing,
    isWindowOpen,
    userDoc
  ])

  useLoad(() => {
    void hydrateAll()
  })

  useDidShow(() => {
    void hydrateAll()
    startTimer()
  })

  useDidHide(() => {
    stopTimer()
  })

  useEffect(() => {
    setCurrentTime(new Date())

    return () => {
      stopTimer()
    }
  }, [stopTimer])

  return (
    <View className='index'>
      <HomeHero
        displayName={displayName}
        weekdayLabel={weekdayLabels[currentTime.getDay()]}
        dateLabel={todayLabel}
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
        disabled={isSyncing}
        onCheckIn={handleCheckIn}
      />
      {receivedGoodnightMessage ? (
        <GoodnightRewardCard message={receivedGoodnightMessage} />
      ) : null}
      <GoodnightMessageCard
        value={goodnightInput}
        onChange={setGoodnightInput}
        onSubmit={() => void handleGoodnightSubmit()}
        isSubmitting={isSubmittingGoodnight}
        hasSubmitted={hasSubmittedGoodnight}
        submittedMessage={submittedGoodnight}
        maxLength={GOODNIGHT_MESSAGE_MAX_LENGTH}
      />
      <StatsOverview stats={stats} />
      <RecentCheckIns items={recentDays} />
      <TipsSection tips={sleepTips} />
      <GoodnightMessageModal
        visible={goodnightModalVisible}
        message={goodnightModalMessage}
        onClose={handleCloseGoodnightModal}
        onVote={(vote: GoodnightVoteType) => {
          void handleVoteGoodnight(vote)
        }}
        hasVoted={hasVotedGoodnight}
        isVoting={isVotingGoodnight}
      />
    </View>
  )
}
