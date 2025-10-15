import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

type FriendUidCardProps = {
  uid: string
}

export function FriendUidCard({ uid }: FriendUidCardProps) {
  const handleCopy = async () => {
    if (!uid) {
      Taro.showToast({ title: 'UID 生成中，请稍候', icon: 'none' })
      return
    }

    try {
      await Taro.setClipboardData({ data: uid })
      Taro.showToast({ title: '已复制 UID', icon: 'success' })
    } catch (error) {
      console.error('复制 UID 失败', error)
      Taro.showToast({ title: '复制失败，请稍后再试', icon: 'none' })
    }
  }

  return (
    <View className='friends__card friends__card--intro' onClick={() => void handleCopy()}>
      <Text className='friends__title'>我的 UID</Text>
      <Text className='friends__uid'>{uid || '正在生成 UID...'}</Text>
      <Text className='friends__hint'>点击即可复制 UID，好友就能向你发送邀请，共同互助早睡。</Text>
    </View>
  )
}
