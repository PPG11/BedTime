import { Text, View } from '@tarojs/components'
import type { GoodnightMessage } from '../../types/goodnight'

type GoodnightRewardCardProps = {
  message: GoodnightMessage
}

export function GoodnightRewardCard({ message }: GoodnightRewardCardProps) {
  return (
    <View className='goodnight-reward-card'>
      <Text className='goodnight-reward-card__badge'>今日收到的祝福</Text>
      <Text className='goodnight-reward-card__content'>{message.content}</Text>
      <Text className='goodnight-reward-card__footer'>来自早睡伙伴的温暖陪伴 ✨</Text>
    </View>
  )
}
