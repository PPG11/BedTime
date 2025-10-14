import { Text, View } from '@tarojs/components'

type FriendUidCardProps = {
  uid: string
}

export function FriendUidCard({ uid }: FriendUidCardProps) {
  return (
    <View className='friends__card friends__card--intro'>
      <Text className='friends__title'>我的 UID</Text>
      <Text className='friends__uid'>{uid || '正在生成 UID...'}</Text>
      <Text className='friends__hint'>分享你的 UID，好友即可向你发送邀请，共同互助早睡。</Text>
    </View>
  )
}
