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
    { label: '连续早睡天数', value: stats.streak, icon: '🌙', tone: 'dawn' },
    { label: '累计打卡次数', value: stats.total, icon: '✨', tone: 'twinkle' },
    { label: '最佳连续记录', value: stats.best, icon: '🌟', tone: 'glow' },
    { label: '坚持完成率', value: `${stats.completion}%`, icon: '💖', tone: 'blush' }
  ]

  return (
    <View className='stats-grid'>
      {items.map((item) => (
        <View key={item.label} className={`stats-card stats-card--${item.tone}`}>
          <View className='stats-card__header'>
            <Text className='stats-card__icon'>{item.icon}</Text>
            <Text className='stats-card__label'>{item.label}</Text>
          </View>
          <Text className='stats-card__value'>{item.value}</Text>
          <View className='stats-card__spark' />
        </View>
      ))}
    </View>
  )
}
