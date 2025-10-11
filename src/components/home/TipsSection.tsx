import { Text, View } from '@tarojs/components'

type TipsSectionProps = {
  tips: string[]
}

export function TipsSection({ tips }: TipsSectionProps) {
  return (
    <View className='tips'>
      <Text className='tips__title'>💗 早睡小贴士</Text>
      <Text className='tips__subtitle'>慢慢呼吸，轻轻进入梦乡</Text>
      <View className='tips__list'>
        {tips.map((tip) => (
          <Text key={tip} className='tips__item'>
            {tip}
          </Text>
        ))}
      </View>
    </View>
  )
}
