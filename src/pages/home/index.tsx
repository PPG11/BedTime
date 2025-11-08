import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "@tarojs/components";
import Taro, { useDidHide, useDidShow } from "@tarojs/taro";
import {
  RecentDay,
  type CheckInWindowOptions,
  computeBestStreak,
  computeCompletionRate,
  computeCurrentStreak,
  computeRecommendedBedTime,
  formatCountdown,
  normalizeDateKey,
  formatWindowHint,
  getMinutesSinceMidnight,
  getRecentDays,
  isCheckInWindowOpen,
  resolveCheckInCycle,
  weekdayLabels,
} from "../../utils/checkin";
import {
  CheckInMap,
  DEFAULT_USER_NAME,
  type UserSettings,
} from "../../utils/storage";
import {
  formatMinutesToTime,
  formatTime,
  parseTimeStringToMinutes,
} from "../../utils/time";
import { HomeHero } from "../../components/home/HomeHero";
import { CheckInCard } from "../../components/home/CheckInCard";
import { StatsOverview } from "../../components/home/StatsOverview";
import { RecentCheckIns } from "../../components/home/RecentCheckIns";
import { TipsSection } from "../../components/home/TipsSection";
import {
  type CheckinStatus,
  type UserDocument,
  fetchRandomGoodnightMessage,
  submitCheckinRecord,
  refreshPublicProfile,
} from "../../services";
import { GoodnightMessageCard } from "../../components/home/GoodnightMessageCard";
import { GoodnightMessageModal } from "../../components/home/GoodnightMessageModal";
import { GoodnightRewardCard } from "../../components/home/GoodnightRewardCard";
import {
  GOODNIGHT_MESSAGE_MAX_LENGTH,
  type GoodnightMessage,
  type GoodnightVoteType,
} from "../../types/goodnight";
import { pickRandomLocalGoodnightMessage } from "../../utils/goodnight";
import { useGoodnightInteraction } from "./useGoodnight";
import { useAppData } from "../../state/appData";
import "./index.scss";

const sleepTips = [
  "睡前 1 小时放下电子设备，让大脑慢慢放松。",
  "保持卧室安静、昏暗和舒适，营造入睡氛围。",
  "建立固定的睡前仪式，例如阅读或轻度伸展。",
];

function withLatestSettings(
  user: UserDocument,
  settings: UserSettings
): UserDocument {
  return {
    ...user,
    nickname: settings.name,
    targetHM: formatMinutesToTime(settings.targetSleepMinute),
  };
}

type HomeStats = {
  streak: number;
  total: number;
  best: number;
  completion: number;
};

function createHomeStats(
  records: CheckInMap,
  currentTime: Date,
  windowOptions: CheckInWindowOptions
): HomeStats {
  const now = new Date(currentTime);
  return {
    total: Object.keys(records).length,
    streak: computeCurrentStreak(records, now, windowOptions),
    best: computeBestStreak(records, windowOptions),
    completion: computeCompletionRate(records, now, windowOptions),
  };
}

function createRecentCheckIns(
  records: CheckInMap,
  currentTime: Date,
  windowOptions: CheckInWindowOptions
): RecentDay[] {
  return getRecentDays(records, currentTime, 7, windowOptions);
}

export default function Index() {
  const {
    canUseCloud,
    records,
    setRecords,
    settings,
    todayStatus,
    setTodayStatus,
    user: userDoc,
    setUser: setUserDoc,
    localUid,
    refresh,
  } = useAppData();
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousTodayKeyRef = useRef<string | null>(null);
  const lastRefreshRef = useRef(0);

  const windowOptions = useMemo<CheckInWindowOptions>(
    () => ({ targetSleepMinute: settings.targetSleepMinute }),
    [settings.targetSleepMinute]
  );

  const checkinCycle = useMemo(
    () =>
      resolveCheckInCycle(
        currentTime,
        settings.targetSleepMinute,
        windowOptions
      ),
    [currentTime, settings.targetSleepMinute, windowOptions]
  );
  const todayKey = checkinCycle.dateKey;
  const todayDate = useMemo(
    () => new Date(checkinCycle.date.getTime()),
    [checkinCycle.date]
  );
  const todayLabel = useMemo(() => {
    const year = String(todayDate.getFullYear()).padStart(4, "0");
    const month = String(todayDate.getMonth() + 1).padStart(2, "0");
    const day = String(todayDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [todayDate]);
  const minutesNow = useMemo(
    () => getMinutesSinceMidnight(currentTime),
    [currentTime]
  );
  const isWindowOpen = useMemo(
    () =>
      isCheckInWindowOpen(
        minutesNow,
        settings.targetSleepMinute,
        windowOptions
      ),
    [minutesNow, settings.targetSleepMinute, windowOptions]
  );
  const recommendedBedTime = useMemo(
    () =>
      computeRecommendedBedTime(
        currentTime,
        settings.targetSleepMinute,
        windowOptions
      ),
    [currentTime, settings.targetSleepMinute, windowOptions]
  );
  const countdownText = useMemo(() => {
    const diff = recommendedBedTime.getTime() - currentTime.getTime();
    return formatCountdown(diff);
  }, [currentTime, recommendedBedTime]);
  const todayRecord = useMemo(() => {
    const stored = records[todayKey];
    if (typeof stored === "number" && stored > 0) {
      return stored;
    }
    if (todayStatus?.checkedIn && todayStatus.timestamp) {
      return todayStatus.timestamp.getTime();
    }
    return null;
  }, [records, todayKey, todayStatus]);
  const hasCheckedInToday = useMemo(
    () => Boolean(todayStatus?.checkedIn) || typeof todayRecord === "number",
    [todayRecord, todayStatus, todayKey, records]
  );
  const windowHint = useMemo(
    () =>
      formatWindowHint(
        currentTime,
        recommendedBedTime,
        isWindowOpen,
        settings.targetSleepMinute,
        windowOptions
      ),
    [
      currentTime,
      isWindowOpen,
      recommendedBedTime,
      settings.targetSleepMinute,
      windowOptions,
    ]
  );
  const targetTimeText = useMemo(
    () => formatMinutesToTime(settings.targetSleepMinute),
    [settings.targetSleepMinute]
  );
  const stats = useMemo(
    () => createHomeStats(records, todayDate, windowOptions),
    [records, todayDate, windowOptions]
  );
  const recentDays = useMemo(
    () => createRecentCheckIns(records, todayDate, windowOptions),
    [records, todayDate, windowOptions]
  );
  const lastCheckInTime = useMemo(() => {
    if (!todayRecord) {
      return "";
    }
    return formatTime(new Date(todayRecord));
  }, [todayRecord]);
  const isLateCheckIn = useMemo(() => {
    if (!todayRecord) {
      return false;
    }
    const targetForRecord = computeRecommendedBedTime(
      new Date(todayRecord),
      settings.targetSleepMinute,
      windowOptions
    );
    return todayRecord > targetForRecord.getTime();
  }, [settings.targetSleepMinute, todayRecord, windowOptions]);
  const isLateNow = useMemo(
    () => currentTime.getTime() > recommendedBedTime.getTime(),
    [currentTime, recommendedBedTime]
  );
  const displayName = useMemo(
    () => settings.name || DEFAULT_USER_NAME,
    [settings.name]
  );
  const effectiveUid = userDoc?.uid ?? localUid;

  const persistRecords = useCallback(
    (next: CheckInMap | ((prev: CheckInMap) => CheckInMap)) => {
      setRecords(next);
    },
    [setRecords]
  );

  const requestRefresh = useCallback(
    (force = false) => {
      if (!canUseCloud) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastRefreshRef.current < 30 * 1000) {
        return;
      }
      lastRefreshRef.current = now;
      void refresh();
    },
    [canUseCloud, refresh]
  );

  useEffect(() => {
    if (previousTodayKeyRef.current === todayKey) {
      return;
    }
    previousTodayKeyRef.current = todayKey;
    setTodayStatus((prev) => {
      if (!prev) {
        return null;
      }
      const normalized = normalizeDateKey(prev.date);
      if (normalized === todayKey) {
        return prev;
      }
      return null;
    });
    requestRefresh(true);
  }, [todayKey, requestRefresh, setTodayStatus]);

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      return;
    }

    timerRef.current = setInterval(() => {
      setCurrentTime(new Date());
    }, 60 * 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (!timerRef.current) {
      return;
    }

    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

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
    isVoting: isVotingGoodnight,
  } = useGoodnightInteraction({
    canUseCloud,
    userDoc,
    effectiveUid,
    todayKey,
    hasCheckedInToday,
    prefetchedGoodnightId: todayStatus?.goodnightMessageId ?? null,
  });

  const checkInWithCloud = useCallback(
    async (status: CheckinStatus, rewardCandidate: GoodnightMessage | null) => {
      if (!userDoc) {
        return;
      }

      try {
        const latestUser = withLatestSettings(userDoc, settings);
        const tzOffset =
          typeof latestUser.tzOffset === "number"
            ? latestUser.tzOffset
            : -new Date().getTimezoneOffset();
        // 使用最新的目标睡眠时间重新计算应该使用的日期
        const actualTargetSleepMinute = parseTimeStringToMinutes(
          latestUser.targetHM,
          settings.targetSleepMinute
        );
        const actualWindowOptions: CheckInWindowOptions = {
          targetSleepMinute: actualTargetSleepMinute,
        };
        const actualCycle = resolveCheckInCycle(
          currentTime,
          actualTargetSleepMinute,
          actualWindowOptions
        );
        const actualDateKey = actualCycle.dateKey;
        const { document: created, status: submitStatus } =
          await submitCheckinRecord({
            uid: latestUser.uid,
            date: actualDateKey,
            status,
            tzOffset,
            goodnightMessageId: rewardCandidate?._id,
            message: rewardCandidate?._id,
          });
        const timestamp =
          created.ts instanceof Date
            ? created.ts.getTime()
            : new Date(created.ts).getTime();
        persistRecords({ ...records, [actualDateKey]: timestamp });
        const resolvedMessageId =
          typeof created.goodnightMessageId === "string" &&
          created.goodnightMessageId.trim().length
            ? created.goodnightMessageId.trim()
            : typeof created.message === "string" &&
              created.message.trim().length
            ? created.message.trim()
            : rewardCandidate?._id ?? null;
        setTodayStatus({
          checkedIn: true,
          date: actualDateKey,
          status: created.status,
          goodnightMessageId: resolvedMessageId,
          timestamp:
            created.ts instanceof Date ? created.ts : new Date(created.ts),
        });
        setUserDoc(latestUser);
        if (submitStatus === "created") {
          try {
            await refreshPublicProfile(
              {
                ...latestUser,
                tzOffset,
              },
              actualDateKey
            );
          } catch (error) {
            console.warn("刷新公开资料失败（将在后台重试）", error);
          }
        }
        if (submitStatus === "created") {
          Taro.showToast({ title: "打卡成功，早睡加油！", icon: "success" });
        } else {
          Taro.showToast({ title: "统计过今天已经打过卡了", icon: "none" });
        }
        await presentGoodnightReward({
          message: submitStatus === "created" ? rewardCandidate : undefined,
          syncToCheckin: submitStatus === "created",
          showModal: submitStatus === "created",
        });
      } catch (error) {
        console.error("云端打卡失败", error);
        Taro.showToast({ title: "云端打卡失败，请稍后重试", icon: "none" });
      }
    },
    [
      persistRecords,
      presentGoodnightReward,
      records,
      refreshPublicProfile,
      settings,
      currentTime,
      userDoc,
    ]
  );

  const checkInLocally = useCallback(
    async (status: CheckinStatus, rewardCandidate: GoodnightMessage | null) => {
      // 使用最新的目标睡眠时间重新计算应该使用的日期
      const actualWindowOptions: CheckInWindowOptions = {
        targetSleepMinute: settings.targetSleepMinute,
      };
      const actualCycle = resolveCheckInCycle(
        currentTime,
        settings.targetSleepMinute,
        actualWindowOptions
      );
      const actualDateKey = actualCycle.dateKey;
      const now = new Date();
      const updated = { ...records, [actualDateKey]: now.getTime() };
      persistRecords(updated);
      setTodayStatus({
        checkedIn: true,
        date: actualDateKey,
        status,
        goodnightMessageId: rewardCandidate?._id ?? null,
        timestamp: now,
      });
      Taro.showToast({ title: "打卡成功，早睡加油！", icon: "success" });
      await presentGoodnightReward({
        message: rewardCandidate,
        syncToCheckin: true,
      });
    },
    [
      persistRecords,
      presentGoodnightReward,
      records,
      settings.targetSleepMinute,
      currentTime,
    ]
  );

  const handleCheckIn = useCallback(async () => {
    if (hasCheckedInToday || isSyncing) {
      Taro.showToast({ title: "今天已经打过卡了", icon: "none" });
      return;
    }

    if (!isWindowOpen) {
      Taro.showToast({ title: "不在打卡时间段内", icon: "none" });
      return;
    }

    setIsSyncing(true);
    try {
      // 打卡时先通过 gnGetRandom 获取一个晚安心语
      let rewardCandidate: GoodnightMessage | null = null;
      try {
        if (canUseCloud && userDoc) {
          // 云端模式：调用 gnGetRandom 云函数获取随机晚安心语
          rewardCandidate = await fetchRandomGoodnightMessage(effectiveUid);
        } else {
          // 本地模式：从本地存储中随机选择一个晚安心语
          rewardCandidate = pickRandomLocalGoodnightMessage(effectiveUid);
        }
      } catch (error) {
        console.warn("获取今日晚安心语失败", error);
        // 如果获取失败，仍然允许打卡，只是不携带晚安心语ID
      }

      const checkinStatus: CheckinStatus = isLateNow ? "late" : "hit";
      if (canUseCloud && userDoc) {
        await checkInWithCloud(checkinStatus, rewardCandidate);
        return;
      }

      await checkInLocally(checkinStatus, rewardCandidate);
    } finally {
      setIsSyncing(false);
    }
  }, [
    canUseCloud,
    checkInLocally,
    checkInWithCloud,
    effectiveUid,
    hasCheckedInToday,
    isLateNow,
    isSyncing,
    isWindowOpen,
    userDoc,
  ]);

  useDidShow(() => {
    requestRefresh();
    startTimer();
  });

  useDidHide(() => {
    stopTimer();
  });

  useEffect(() => {
    setCurrentTime(new Date());

    return () => {
      stopTimer();
    };
  }, [stopTimer]);

  return (
    <View className="index">
      <HomeHero
        displayName={displayName}
        weekdayLabel={weekdayLabels[todayDate.getDay()]}
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
          void handleVoteGoodnight(vote);
        }}
        hasVoted={hasVotedGoodnight}
        isVoting={isVotingGoodnight}
      />
    </View>
  );
}
