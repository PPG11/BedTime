import { Button, Text, View } from '@tarojs/components'
import { FriendProfile } from '../../utils/storage'

type FriendListProps = {
  friends: FriendProfile[]
  onRefresh: (uid: string) => void
  onRemove: (uid: string) => void
}

export function FriendList({ friends, onRefresh, onRemove }: FriendListProps) {
  const hasFriends = friends.length > 0

  return (
    <View className='friends__card'>
      <Text className='friends__title'>好友早睡情况</Text>
      {hasFriends ? (
        <View className='friends__list'>
          {friends.map((friend) => (
            <View key={friend.uid} className='friends__item'>
              <View className='friends__item-header'>
                <View>
                  <Text className='friends__item-name'>{friend.nickname}</Text>
                  <Text className='friends__item-uid'>UID：{friend.uid}</Text>
                </View>
                <View className='friends__item-actions'>
                  <Button size='mini' onClick={() => onRefresh(friend.uid)}>
                    刷新
                  </Button>
                  <Button size='mini' className='friends__remove' onClick={() => onRemove(friend.uid)}>
                    取消
                  </Button>
                </View>
              </View>
              <View className='friends__item-stats'>
                <View className='friends__stat'>
                  <Text className='friends__stat-value'>{friend.streak}</Text>
                  <Text className='friends__stat-label'>连续天数</Text>
                </View>
                <View className='friends__stat'>
                  <Text className='friends__stat-value'>{friend.total}</Text>
                  <Text className='friends__stat-label'>累计打卡</Text>
                </View>
                <View className='friends__stat'>
                  <Text className='friends__stat-value'>{friend.completion}%</Text>
                  <Text className='friends__stat-label'>完成率</Text>
                </View>
              </View>
              <Text className='friends__item-status'>{friend.lastCheckInLabel}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className='friends__empty'>暂未关注好友，输入 UID 即可开始互相监督早睡。</Text>
      )}
    </View>
  )
}
