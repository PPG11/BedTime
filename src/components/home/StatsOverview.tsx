import { Text, View } from '@tarojs/components'

type StatsOverviewProps = {
  stats: {
    streak: number
    total: number
    best: number
    completion: number
  }
}

export function StatsOverview({ stats }: StatsOverviewProps) {
  const items = [
    { label: '连续早睡天数', value: stats.streak },
    { label: '累计打卡次数', value: stats.total },
    { label: '最佳连续记录', value: stats.best },
    { label: '坚持完成率', value: `${stats.completion}%` }
  ]

  return (
    <View className='stats-grid'>
      {items.map((item) => (
        <View key={item.label} className='stats-card'>
          <Text className='stats-card__value'>{item.value}</Text>
          <Text className='stats-card__label'>{item.label}</Text>
        </View>
      ))}
    </View>
  )
}
