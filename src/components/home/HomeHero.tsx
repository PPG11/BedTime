import { Text, View } from '@tarojs/components'

type HomeHeroProps = {
  displayName: string
  weekdayLabel: string
  dateLabel: string
  countdownText: string
  recommendedSleepTime: string
  isLateNow: boolean
}

export function HomeHero({
  displayName,
  weekdayLabel,
  dateLabel,
  countdownText,
  recommendedSleepTime,
  isLateNow
}: HomeHeroProps) {
  const countdownLabel = isLateNow ? '已经超过推荐时间' : '距离推荐入睡'
  const countdownValue = isLateNow ? '请尽快准备休息' : countdownText

  return (
    <View className='hero'>
      <View className='hero__atmosphere'>
        <View className='hero__orb hero__orb--one' />
        <View className='hero__orb hero__orb--two' />
        <View className='hero__spark hero__spark--one' />
        <View className='hero__spark hero__spark--two' />
      </View>
      <View className='hero__info'>
        <Text className='hero__badge'>🌙 晚安小宇宙</Text>
        <Text className='hero__greeting'>你好，{displayName}</Text>
        <Text className='hero__subtitle'>{weekdayLabel}</Text>
        <Text className='hero__title'>{dateLabel}</Text>
      </View>
      <View className='hero__countdown'>
        <View className='hero__countdown-ring'>
          <Text className='hero__countdown-icon'>⏰</Text>
          <View className='hero__countdown-glow' />
        </View>
        <View className='hero__countdown-meta'>
          <Text className='hero__countdown-label'>
            {countdownLabel}
            {'\n'}
            <Text className='hero__countdown-time'>{countdownValue}</Text>
          </Text>
          <Text className='hero__countdown-target'>
            推荐
            <Text className='hero__countdown-target-value'>{recommendedSleepTime}</Text>
          </Text>
        </View>
      </View>
    </View>
  )
}
