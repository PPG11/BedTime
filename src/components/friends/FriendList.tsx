import { Button, Text, View } from '@tarojs/components'
import { CheckinStatus } from '../../services'

export type FriendListItem = {
  uid: string
  nickname: string
  displayName: string
  remark?: string
  streak: number
  todayStatus: CheckinStatus
  todayStatusLabel: string
  sleeptime: string
  updatedAtLabel: string
}

type FriendListProps = {
  friends: FriendListItem[]
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
                  <Text className='friends__item-name'>{friend.displayName}</Text>
                  {friend.remark && friend.remark !== friend.nickname && (
                    <Text className='friends__item-remark'>原昵称：{friend.nickname}</Text>
                  )}
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
              <View className='friends__item-status'>
                <Text className={`friends__status friends__status--${friend.todayStatus}`}>
                  {friend.todayStatusLabel}
                </Text>
              </View>
              <View className='friends__item-stats'>
                <View className='friends__stat'>
                  <Text className='friends__stat-value'>{friend.streak}</Text>
                  <Text className='friends__stat-label'>当前连胜</Text>
                </View>
                <View className='friends__stat'>
                  <Text className='friends__stat-value'>{friend.sleeptime}</Text>
                  <Text className='friends__stat-label'>目标就寝</Text>
                </View>
                <View className='friends__stat'>
                  <Text className='friends__stat-value'>{friend.updatedAtLabel}</Text>
                  <Text className='friends__stat-label'>最近同步</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text className='friends__empty'>暂未关注好友，输入 UID 即可开始互相监督早睡。</Text>
      )}
    </View>
  )
}
