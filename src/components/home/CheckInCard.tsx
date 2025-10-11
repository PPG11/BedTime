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
}

export function CheckInCard({
  windowHint,
  lastCheckInTime,
  isLateCheckIn,
  targetTimeText,
  isWindowOpen,
  hasCheckedInToday,
  isLateNow,
  onCheckIn
}: CheckInCardProps) {
  return (
    <View className='checkin-card'>
      <Text className='checkin-card__title'>今日早睡打卡</Text>
      <Text className={`checkin-card__status ${isLateNow ? 'checkin-card__status--late' : ''}`}>
        {windowHint}
      </Text>
      {lastCheckInTime ? (
        <Text
          className={`checkin-card__timestamp ${
            isLateCheckIn ? 'checkin-card__timestamp--late' : ''
          }`}
        >
          已在 {lastCheckInTime} 完成打卡{isLateCheckIn ? '（晚于目标时间）' : ''}
        </Text>
      ) : (
        <Text className='checkin-card__timestamp'>目标入睡时间 {targetTimeText} 之前完成打卡</Text>
      )}
      <Button
        className='checkin-card__button'
        type='primary'
        disabled={!isWindowOpen || hasCheckedInToday}
        onClick={onCheckIn}
      >
        {hasCheckedInToday ? '今日已完成' : isWindowOpen ? '立即打卡' : '等待打卡'}
      </Button>
    </View>
  )
}
