import { Button, Text, View } from '@tarojs/components'

type CheckInCardProps = {
  windowHint: string
  lastCheckInTime: string
  isLateCheckIn: boolean
  targetTimeText: string
  isWindowOpen: boolean
  hasCheckedInToday: boolean
  isLateNow: boolean
  onCheckIn: () => void
  disabled?: boolean
}

export function CheckInCard({
  windowHint,
  lastCheckInTime,
  isLateCheckIn,
  targetTimeText,
  isWindowOpen,
  hasCheckedInToday,
  isLateNow,
  onCheckIn,
  disabled = false
}: CheckInCardProps) {
  const statusClasses = ['checkin-card__status']
  if (hasCheckedInToday) {
    statusClasses.push(isLateCheckIn ? 'checkin-card__status--late' : 'checkin-card__status--hit')
  } else if (isLateNow) {
    statusClasses.push('checkin-card__status--late')
  }

  const timestampClasses = ['checkin-card__timestamp']
  if (hasCheckedInToday) {
    timestampClasses.push(
      isLateCheckIn ? 'checkin-card__timestamp--late' : 'checkin-card__timestamp--hit'
    )
  }

  const statusText = hasCheckedInToday
    ? isLateCheckIn
      ? '⌛ 今日稍晚完成打卡，今晚早点休息'
      : '✨ 今日按时完成打卡，继续保持'
    : windowHint

  const timestampText = lastCheckInTime
    ? hasCheckedInToday
      ? isLateCheckIn
        ? `已在 ${lastCheckInTime} 完成打卡（晚于目标时间）`
        : `已在 ${lastCheckInTime} 完成打卡（吻合目标时间）`
      : `已在 ${lastCheckInTime} 完成打卡`
    : `目标入睡时间 ${targetTimeText} 之前完成打卡`

  const statePill = hasCheckedInToday
    ? { icon: '✅', text: '今日打卡完成' }
    : isWindowOpen
    ? { icon: '🚀', text: '打卡窗口开放' }
    : { icon: '🌙', text: '耐心等待适合入睡' }

  const progressWidth = hasCheckedInToday ? '100%' : isWindowOpen ? '72%' : '38%'

  return (
    <View className='checkin-card'>
      <View className='checkin-card__pill'>
        <Text className='checkin-card__pill-icon'>{statePill.icon}</Text>
        <Text className='checkin-card__pill-text'>{statePill.text}</Text>
      </View>
      <Text className='checkin-card__title'>今日早睡打卡</Text>
      <Text className='checkin-card__note'>💤 柔柔提醒：睡前给自己温柔拥抱</Text>
      <Text className={statusClasses.join(' ')}>{statusText}</Text>
      <Text className={timestampClasses.join(' ')}>{timestampText}</Text>
      <View className='checkin-card__progress'>
        <View className='checkin-card__progress-bar' style={{ width: progressWidth }} />
      </View>
      <Button
        className='checkin-card__button'
        type='primary'
        disabled={!isWindowOpen || hasCheckedInToday || disabled}
        onClick={onCheckIn}
      >
        {hasCheckedInToday ? '今日已完成' : isWindowOpen ? '立即打卡' : '等待打卡'}
      </Button>
    </View>
  )
}
