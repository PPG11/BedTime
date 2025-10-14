import { Button, Text, View } from '@tarojs/components'
import type { GoodnightMessage, GoodnightVoteType } from '../../types/goodnight'

type GoodnightMessageModalProps = {
  visible: boolean
  message: GoodnightMessage | null
  onClose: () => void
  onVote: (type: GoodnightVoteType) => void
  hasVoted: boolean
  isVoting: boolean
}

export function GoodnightMessageModal({
  visible,
  message,
  onClose,
  onVote,
  hasVoted,
  isVoting
}: GoodnightMessageModalProps) {
  if (!visible || !message) {
    return null
  }

  return (
    <View className='goodnight-modal'>
      <View className='goodnight-modal__backdrop' onClick={onClose} />
      <View className='goodnight-modal__panel'>
        <Text className='goodnight-modal__title'>今日晚安心语</Text>
        <Text className='goodnight-modal__content'>{message.content}</Text>
        <Text className='goodnight-modal__hint'>
          感谢分享者的温暖，如果喜欢可以点个赞哦～
        </Text>
        <View className='goodnight-modal__actions'>
          <Button
            className='goodnight-modal__button goodnight-modal__button--dislike'
            onClick={() => onVote('dislike')}
            disabled={hasVoted || isVoting}
          >
            👎 踩 {message.dislikes > 0 ? `(${message.dislikes})` : ''}
          </Button>
          <Button
            className='goodnight-modal__button goodnight-modal__button--like'
            onClick={() => onVote('like')}
            disabled={hasVoted || isVoting}
          >
            👍 赞 {message.likes > 0 ? `(${message.likes})` : ''}
          </Button>
        </View>
        <Button className='goodnight-modal__close' onClick={onClose}>
          收下祝福
        </Button>
      </View>
    </View>
  )
}
