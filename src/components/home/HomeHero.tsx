import { Text, View } from '@tarojs/components'

type HomeHeroProps = {
  displayName: string
  weekdayLabel: string
  dateLabel: string
  countdownText: string
}

export function HomeHero({ displayName, weekdayLabel, dateLabel, countdownText }: HomeHeroProps) {
  return (
    <View className='hero'>
      <View className='hero__info'>
        <Text className='hero__badge'>🌙 晚安小宇宙</Text>
        <Text className='hero__greeting'>你好，{displayName}</Text>
        <Text className='hero__subtitle'>{weekdayLabel}</Text>
        <Text className='hero__title'>{dateLabel}</Text>
      </View>
      <View className='hero__countdown'>
        <Text className='hero__countdown-icon'>⏰</Text>
        <Text className='hero__countdown-label'>距离推荐入睡</Text>
        <Text className='hero__countdown-time'>{countdownText}</Text>
      </View>
    </View>
  )
}
