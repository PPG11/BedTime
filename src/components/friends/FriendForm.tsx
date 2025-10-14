import { Button, Input, Text, View } from '@tarojs/components'

type FriendFormProps = {
  uidInput: string
  aliasInput: string
  onUidInputChange: (value: string) => void
  onAliasInputChange: (value: string) => void
  onSubmit: () => void
}

export function FriendForm({
  uidInput,
  aliasInput,
  onUidInputChange,
  onAliasInputChange,
  onSubmit
}: FriendFormProps) {
  return (
    <View className='friends__card'>
      <Text className='friends__title'>添加好友</Text>
      <View className='friends__form'>
        <View className='friends__form-field'>
          <Text className='friends__label'>好友 UID</Text>
          <Input
            className='friends__input'
            value={uidInput}
            placeholder='输入好友的 8 位 UID'
            maxLength={8}
            onInput={(event) => onUidInputChange(event.detail.value)}
          />
        </View>
        <View className='friends__form-field'>
          <Text className='friends__label'>备注（可选）</Text>
          <Input
            className='friends__input'
            value={aliasInput}
            placeholder='帮好友起个称呼'
            maxLength={16}
            onInput={(event) => onAliasInputChange(event.detail.value)}
          />
        </View>
        <Button className='friends__submit' type='primary' onClick={onSubmit}>
          发送邀请
        </Button>
      </View>
    </View>
  )
}
