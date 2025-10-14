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
  UserDocument,
  ensureCurrentUser,
  fetchCheckins,
  fetchGoodnightMessageForDate,
  fetchRandomGoodnightMessage,
  refreshPublicProfile,
  submitGoodnightMessage,
  supportsCloud,
  upsertCheckin,
  voteGoodnightMessage
} from '../../services'
import { GoodnightMessageCard } from '../../components/home/GoodnightMessageCard'
import { GoodnightMessageModal } from '../../components/home/GoodnightMessageModal'
import {
  GOODNIGHT_ERROR_ALREADY_SUBMITTED,
  GOODNIGHT_MESSAGE_MAX_LENGTH,
  type GoodnightMessage,
  type GoodnightVoteType
} from '../../types/goodnight'
import {
  createLocalGoodnightMessage,
  pickRandomLocalGoodnightMessage,
  readLocalGoodnightMessage,
  voteLocalGoodnightMessage
} from '../../utils/goodnight'
import './index.scss'

const sleepTips = [
  '睡前 1 小时放下电子设备，让大脑慢慢放松。',
  '保持卧室安静、昏暗和舒适，营造入睡氛围。',
  '建立固定的睡前仪式，例如阅读或轻度伸展。'
]

function mapCheckinsToRecord(list: CheckinDocument[]): CheckInMap {
  return list.reduce<CheckInMap>((acc, item) => {
    if (item.status === 'hit') {
      const ts = item.ts instanceof Date ? item.ts.getTime() : new Date(item.ts).getTime()
      acc[item.date] = ts
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
  const [goodnightInput, setGoodnightInput] = useState('')
  const [submittedGoodnight, setSubmittedGoodnight] = useState<GoodnightMessage | null>(null)
  const [hasSubmittedGoodnight, setHasSubmittedGoodnight] = useState(false)
  const [isSubmittingGoodnight, setIsSubmittingGoodnight] = useState(false)
  const [goodnightModalVisible, setGoodnightModalVisible] = useState(false)
  const [goodnightModalMessage, setGoodnightModalMessage] = useState<GoodnightMessage | null>(null)
  const [hasVotedGoodnight, setHasVotedGoodnight] = useState(false)
  const [isVotingGoodnight, setIsVotingGoodnight] = useState(false)
  const [hasShownGoodnightToday, setHasShownGoodnightToday] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastGoodnightDateRef = useRef<string | null>(null)

  const todayKey = useMemo(() => formatDateKey(currentTime), [currentTime])
  const minutesNow = useMemo(() => getMinutesSinceMidnight(currentTime), [currentTime])
  const isWindowOpen = useMemo(
    () => isCheckInWindowOpen(minutesNow, settings.targetSleepMinute),
    [minutesNow, settings.targetSleepMinute]
  )
  const hasCheckedInToday = Boolean(records[todayKey])
  const effectiveUid = useMemo(() => (userDoc ? userDoc.uid : localUid), [userDoc, localUid])

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

  const hydrateAll = useCallback(async () => {
    if (canUseCloud) {
      setIsSyncing(true)
      try {
        const user = await ensureCurrentUser()
        setUserDoc(user)
        setSettings({
          name: user.nickname || DEFAULT_USER_NAME,
          targetSleepMinute: parseTimeStringToMinutes(user.targetHM, DEFAULT_SLEEP_MINUTE)
        })
        // Ensure public profile exists/updates on first entry
        try {
          await refreshPublicProfile(user, todayKey)
        } catch (e) {
          console.warn('刷新公开资料失败（将稍后重试）', e)
        }
        const checkins = await fetchCheckins(user.uid, 365)
        setRecords(mapCheckinsToRecord(checkins))
      } catch (error) {
        console.error('同步云端数据失败，使用本地数据', error)
        Taro.showToast({ title: '云端同步失败，使用本地模式', icon: 'none', duration: 2000 })
        // 回退到本地模式
        setUserDoc(null)
        setRecords(readCheckIns())
        setSettings(readSettings())
      } finally {
        setIsSyncing(false)
      }
      return
    }
    setUserDoc(null)
    setRecords(readCheckIns())
    setSettings(readSettings())
  }, [canUseCloud])

  const persistRecords = useCallback(
    (next: CheckInMap) => {
      setRecords(next)
      if (!canUseCloud) {
        saveCheckIns(next)
      }
    },
    [canUseCloud]
  )

  const presentGoodnightReward = useCallback(async () => {
    if (!effectiveUid || hasShownGoodnightToday) {
      return
    }

    try {
      let message: GoodnightMessage | null
      if (canUseCloud && userDoc) {
        message = await fetchRandomGoodnightMessage(effectiveUid)
      } else {
        message = pickRandomLocalGoodnightMessage(effectiveUid)
      }

      if (message) {
        setGoodnightModalMessage(message)
        setGoodnightModalVisible(true)
        setHasVotedGoodnight(false)
        setHasShownGoodnightToday(true)
      } else {
        setHasShownGoodnightToday(true)
      }
    } catch (error) {
      console.warn('抽取晚安心语失败', error)
    }
  }, [canUseCloud, effectiveUid, hasShownGoodnightToday, userDoc])

  const handleCheckIn = useCallback(async () => {
    if (hasCheckedInToday || isSyncing) {
      Taro.showToast({ title: '今天已经打过卡了', icon: 'none' })
      return
    }

    if (!isWindowOpen) {
      Taro.showToast({ title: '不在打卡时间段内', icon: 'none' })
      return
    }

    if (canUseCloud && userDoc) {
      try {
        setIsSyncing(true)
        const latestUser = withLatestSettings(userDoc, settings)
        const tzOffset = typeof latestUser.tzOffset === 'number' ? latestUser.tzOffset : -new Date().getTimezoneOffset()
        const created = await upsertCheckin({
          uid: latestUser.uid,
          date: todayKey,
          status: 'hit',
          tzOffset
        })
        const timestamp = created.ts instanceof Date ? created.ts.getTime() : new Date(created.ts).getTime()
        persistRecords({ ...records, [todayKey]: timestamp })
        setUserDoc(latestUser)
        await refreshPublicProfile(
          {
            ...latestUser,
            tzOffset
          },
          todayKey
        )
        Taro.showToast({ title: '打卡成功，早睡加油！', icon: 'success' })
        void presentGoodnightReward()
      } catch (error) {
        console.error('云端打卡失败', error)
        Taro.showToast({ title: '云端打卡失败，请稍后重试', icon: 'none' })
      } finally {
        setIsSyncing(false)
      }
      return
    }

    const now = new Date()
    const key = formatDateKey(now)
    const updated = { ...records, [key]: now.getTime() }
    persistRecords(updated)
    Taro.showToast({ title: '打卡成功，早睡加油！', icon: 'success' })
    void presentGoodnightReward()
  }, [
    canUseCloud,
    hasCheckedInToday,
    isSyncing,
    isWindowOpen,
    presentGoodnightReward,
    persistRecords,
    records,
    settings,
    todayKey,
    userDoc
  ])

  useEffect(() => {
    setHasShownGoodnightToday(false)
  }, [todayKey])

  useEffect(() => {
    if (!effectiveUid) {
      return
    }

    let active = true
    const loadMessage = async () => {
      try {
        let message: GoodnightMessage | null
        if (canUseCloud && userDoc) {
          message = await fetchGoodnightMessageForDate(effectiveUid, todayKey)
        } else {
          message = readLocalGoodnightMessage(effectiveUid, todayKey)
        }

        if (!active) {
          return
        }

        setSubmittedGoodnight(message)
        setHasSubmittedGoodnight(Boolean(message))
        if (message) {
          setGoodnightInput(message.content)
        } else if (lastGoodnightDateRef.current !== todayKey) {
          setGoodnightInput('')
        }
        lastGoodnightDateRef.current = todayKey
      } catch (error) {
        console.warn('加载晚安心语失败', error)
      }
    }

    void loadMessage()

    return () => {
      active = false
    }
  }, [canUseCloud, effectiveUid, todayKey, userDoc])

  const handleGoodnightSubmit = useCallback(async () => {
    if (isSubmittingGoodnight || hasSubmittedGoodnight) {
      return
    }

    const trimmed = goodnightInput.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请写下一句晚安心语', icon: 'none' })
      return
    }

    if (trimmed.length > GOODNIGHT_MESSAGE_MAX_LENGTH) {
      Taro.showToast({ title: `最多 ${GOODNIGHT_MESSAGE_MAX_LENGTH} 字`, icon: 'none' })
      return
    }

    if (!effectiveUid) {
      Taro.showToast({ title: '请稍后再试', icon: 'none' })
      return
    }

    setIsSubmittingGoodnight(true)
    try {
      let message: GoodnightMessage
      if (canUseCloud && userDoc) {
        message = await submitGoodnightMessage({
          uid: userDoc.uid,
          content: trimmed,
          date: todayKey
        })
      } else {
        message = createLocalGoodnightMessage({
          uid: effectiveUid,
          content: trimmed,
          date: todayKey
        })
      }

      setSubmittedGoodnight(message)
      setHasSubmittedGoodnight(true)
      setGoodnightInput(message.content)
      Taro.showToast({ title: '已送出晚安心语', icon: 'success' })
    } catch (error) {
      const err = error as Error
      if (err?.message === GOODNIGHT_ERROR_ALREADY_SUBMITTED) {
        Taro.showToast({ title: '今天已经写过啦', icon: 'none' })
        let existing: GoodnightMessage | null = null
        if (canUseCloud && userDoc) {
          existing = await fetchGoodnightMessageForDate(effectiveUid, todayKey)
        } else {
          existing = readLocalGoodnightMessage(effectiveUid, todayKey)
        }
        if (existing) {
          setSubmittedGoodnight(existing)
          setHasSubmittedGoodnight(true)
          setGoodnightInput(existing.content)
        }
      } else {
        console.error('提交晚安心语失败', error)
        Taro.showToast({ title: '提交失败，请稍后再试', icon: 'none' })
      }
    } finally {
      setIsSubmittingGoodnight(false)
    }
  }, [
    canUseCloud,
    effectiveUid,
    goodnightInput,
    hasSubmittedGoodnight,
    isSubmittingGoodnight,
    todayKey,
    userDoc
  ])

  const handleVoteGoodnight = useCallback(
    async (vote: GoodnightVoteType) => {
      if (!goodnightModalMessage || hasVotedGoodnight || isVotingGoodnight) {
        return
      }

      setIsVotingGoodnight(true)
      try {
        let updated: GoodnightMessage | null
        if (canUseCloud && userDoc) {
          updated = await voteGoodnightMessage(goodnightModalMessage._id, vote)
        } else {
          updated = voteLocalGoodnightMessage(goodnightModalMessage._id, vote)
        }

        if (!updated) {
          Taro.showToast({ title: '当前晚安心语不可用', icon: 'none' })
          setGoodnightModalVisible(false)
          return
        }

        setGoodnightModalMessage(updated)
        setHasVotedGoodnight(true)
        Taro.showToast({ title: vote === 'like' ? '已点赞' : '已收到反馈', icon: 'success' })
      } catch (error) {
        console.error('晚安心语投票失败', error)
        Taro.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
      } finally {
        setIsVotingGoodnight(false)
      }
    },
    [
      canUseCloud,
      goodnightModalMessage,
      hasVotedGoodnight,
      isVotingGoodnight,
      userDoc
    ]
  )

  const handleCloseGoodnightModal = useCallback(() => {
    setGoodnightModalVisible(false)
    setGoodnightModalMessage(null)
  }, [])

  useLoad(() => {
    void hydrateAll()
  })

  useDidShow(() => {
    void hydrateAll()
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
        disabled={isSyncing}
        onCheckIn={handleCheckIn}
      />
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
