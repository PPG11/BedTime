import { Button, Text, Textarea, View } from '@tarojs/components'
import type { GoodnightMessage } from '../../types/goodnight'

export type GoodnightMessageCardProps = {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  isSubmitting: boolean
  hasSubmitted: boolean
  submittedMessage: GoodnightMessage | null
  maxLength: number
}

export function GoodnightMessageCard({
  value,
  onChange,
  onSubmit,
  isSubmitting,
  hasSubmitted,
  submittedMessage,
  maxLength
}: GoodnightMessageCardProps) {
  const remaining = Math.max(0, maxLength - value.length)

  return (
    <View className='goodnight-card'>
      <Text className='goodnight-card__title'>晚安心语</Text>
      <Text className='goodnight-card__description'>
        留下一句温暖的话语，陪伴正在努力早睡的伙伴们。
      </Text>
      {hasSubmitted && submittedMessage ? (
        <View className='goodnight-card__submitted'>
          <Text className='goodnight-card__submitted-label'>今日已分享</Text>
          <Text className='goodnight-card__submitted-content'>{submittedMessage.content}</Text>
        </View>
      ) : (
        <>
          <Textarea
            className='goodnight-card__textarea'
            value={value}
            maxlength={maxLength}
            placeholder='写下一句鼓励、祝福或睡前感悟~'
            onInput={(event) => onChange(event.detail.value)}
            disabled={hasSubmitted}
            autoHeight
          />
          <Text className='goodnight-card__counter'>还可以输入 {remaining} 字</Text>
        </>
      )}
      <Button
        className='goodnight-card__button'
        type='primary'
        onClick={onSubmit}
        disabled={hasSubmitted || isSubmitting}
        loading={isSubmitting}
      >
        {hasSubmitted ? '今日已分享' : '送出晚安心语'}
      </Button>
    </View>
  )
}
