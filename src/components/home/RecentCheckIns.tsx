import { ScrollView, Text, View } from '@tarojs/components'
import { RecentDay } from '../../utils/checkin'

type RecentCheckInsProps = {
  items: RecentDay[]
}

export function RecentCheckIns({ items }: RecentCheckInsProps) {
  return (
    <View className='recent'>
      <Text className='recent__title'>🌙 最近 7 天打卡</Text>
      <Text className='recent__hint'>左右滑动，收集你的早睡星星</Text>
      <ScrollView className='recent__list' scrollX enableFlex>
        {items.map((item) => (
          <View key={item.key} className={`recent__item ${item.checked ? 'recent__item--checked' : ''}`}>
            <Text className='recent__date'>{item.label}</Text>
            <Text className='recent__weekday'>{item.weekday}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
