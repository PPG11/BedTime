import { Text, View } from '@tarojs/components'

type ProfileTipsProps = {
  tips: string[]
}

export function ProfileTips({ tips }: ProfileTipsProps) {
  return (
    <View className='profile__tips'>
      <Text className='profile__tips-title'>功能说明</Text>
      {tips.map((tip) => (
        <Text key={tip} className='profile__tips-item'>
          {tip}
        </Text>
      ))}
    </View>
  )
}
