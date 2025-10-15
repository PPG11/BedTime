import { Input, Picker, Text, View } from '@tarojs/components'

type ProfilePreferencesCardProps = {
  name: string
  targetTimeText: string
  onNameInput: (event: { detail: { value: string } }) => void
  onNameBlur: (event: { detail: { value: string } }) => void
  onTargetTimeChange: (event: { detail: { value: string } }) => void
}

export function ProfilePreferencesCard({
  name,
  targetTimeText,
  onNameInput,
  onNameBlur,
  onTargetTimeChange
}: ProfilePreferencesCardProps) {
  return (
    <View className='profile__card'>
      <Text className='profile__title'>个人偏好</Text>
      <View className='profile__field'>
        <Text className='profile__label'>称呼</Text>
        <Input
          className='profile__input'
          value={name}
          placeholder='输入你的称呼'
          onInput={onNameInput}
          onBlur={onNameBlur}
          maxLength={20}
        />
      </View>
      <View className='profile__field'>
        <Text className='profile__label'>目标入睡时间</Text>
        <Picker mode='time' value={targetTimeText} onChange={onTargetTimeChange}>
          <View className='profile__picker'>{targetTimeText}</View>
        </Picker>
      </View>
    </View>
  )
}
