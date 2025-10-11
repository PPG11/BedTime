import { Button, Text, View } from '@tarojs/components'

type ProfileUidCardProps = {
  uid: string
  onCopy: () => void
}

export function ProfileUidCard({ uid, onCopy }: ProfileUidCardProps) {
  return (
    <View className='profile__card'>
      <Text className='profile__title'>我的账号</Text>
      <Text className='profile__uid'>{uid || '正在生成 UID...'}</Text>
      <Text className='profile__uid-hint'>将 UID 分享给好友，他们就能关注你的早睡打卡啦。</Text>
      <Button className='profile__copy' onClick={onCopy}>
        复制 UID
      </Button>
    </View>
  )
}
