import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import {
  fetchGoodnightMessageForDate,
  fetchRandomGoodnightMessage,
  submitGoodnightMessage,
  voteGoodnightMessage,
  type GoodnightVoteType,
  type UserDocument
} from '../../services'
import {
  createLocalGoodnightMessage,
  pickRandomLocalGoodnightMessage,
  readLocalGoodnightMessage,
  voteLocalGoodnightMessage
} from '../../utils/goodnight'
import {
  GOODNIGHT_ERROR_ALREADY_SUBMITTED,
  GOODNIGHT_MESSAGE_MAX_LENGTH,
  type GoodnightMessage
} from '../../types/goodnight'

type UseGoodnightInteractionParams = {
  canUseCloud: boolean
  userDoc: UserDocument | null
  effectiveUid: string | null
  todayKey: string
}

type UseGoodnightInteractionResult = {
  input: string
  setInput: (value: string) => void
  submittedMessage: GoodnightMessage | null
  hasSubmitted: boolean
  isSubmitting: boolean
  submit: () => Promise<void>
  presentReward: () => Promise<void>
  modalVisible: boolean
  modalMessage: GoodnightMessage | null
  rewardMessage: GoodnightMessage | null
  closeModal: () => void
  vote: (vote: GoodnightVoteType) => Promise<void>
  hasVoted: boolean
  isVoting: boolean
}

export function useGoodnightInteraction({
  canUseCloud,
  userDoc,
  effectiveUid,
  todayKey
}: UseGoodnightInteractionParams): UseGoodnightInteractionResult {
  const [input, setInput] = useState('')
  const [submittedMessage, setSubmittedMessage] = useState<GoodnightMessage | null>(null)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [modalMessage, setModalMessage] = useState<GoodnightMessage | null>(null)
  const [rewardMessage, setRewardMessage] = useState<GoodnightMessage | null>(null)
  const [hasVoted, setHasVoted] = useState(false)
  const [isVoting, setIsVoting] = useState(false)
  const [hasPresentedToday, setHasPresentedToday] = useState(false)
  const lastLoadedDateRef = useRef<string | null>(null)

  const loadSubmittedMessage = useCallback(async () => {
    if (!effectiveUid) {
      setSubmittedMessage(null)
      setHasSubmitted(false)
      if (lastLoadedDateRef.current !== todayKey) {
        setInput('')
        lastLoadedDateRef.current = todayKey
      }
      return
    }

    try {
      let message: GoodnightMessage | null
      if (canUseCloud && userDoc) {
        message = await fetchGoodnightMessageForDate(effectiveUid, todayKey)
      } else {
        message = readLocalGoodnightMessage(effectiveUid, todayKey)
      }

      setSubmittedMessage(message)
      setHasSubmitted(Boolean(message))

      if (message) {
        setInput(message.content)
      } else if (lastLoadedDateRef.current !== todayKey) {
        setInput('')
      }

      lastLoadedDateRef.current = todayKey
    } catch (error) {
      console.warn('加载晚安心语失败', error)
    }
  }, [canUseCloud, effectiveUid, todayKey, userDoc])

  useEffect(() => {
    let active = true

    const run = async () => {
      if (!active) {
        return
      }
      await loadSubmittedMessage()
    }

    void run()

    return () => {
      active = false
    }
  }, [loadSubmittedMessage])

  useEffect(() => {
    setHasPresentedToday(false)
    setRewardMessage(null)
  }, [todayKey])

  const presentReward = useCallback(async () => {
    if (!effectiveUid || hasPresentedToday) {
      return
    }

    try {
      let message: GoodnightMessage | null
      if (canUseCloud && userDoc) {
        message = await fetchRandomGoodnightMessage(effectiveUid)
      } else {
        message = pickRandomLocalGoodnightMessage(effectiveUid)
      }

      if (message) {
        setRewardMessage(message)
        setModalMessage(message)
        setModalVisible(true)
        setHasVoted(false)
      }

      setHasPresentedToday(true)
    } catch (error) {
      console.warn('抽取晚安心语失败', error)
    }
  }, [canUseCloud, effectiveUid, hasPresentedToday, userDoc])

  const submit = useCallback(async () => {
    if (isSubmitting || hasSubmitted) {
      return
    }

    const trimmed = input.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请写下一句晚安心语', icon: 'none' })
      return
    }

    if (trimmed.length > GOODNIGHT_MESSAGE_MAX_LENGTH) {
      Taro.showToast({ title: `最多 ${GOODNIGHT_MESSAGE_MAX_LENGTH} 字`, icon: 'none' })
      return
    }

    if (!effectiveUid) {
      Taro.showToast({ title: '请稍后再试', icon: 'none' })
      return
    }

    setIsSubmitting(true)
    try {
      let message: GoodnightMessage
      if (canUseCloud && userDoc) {
        message = await submitGoodnightMessage({
          uid: userDoc.uid,
          content: trimmed,
          date: todayKey
        })
      } else {
        message = createLocalGoodnightMessage({
          uid: effectiveUid,
          content: trimmed,
          date: todayKey
        })
      }

      setSubmittedMessage(message)
      setHasSubmitted(true)
      setInput(message.content)
      Taro.showToast({ title: '已送出晚安心语', icon: 'success' })
    } catch (error) {
      const err = error as Error
      if (err?.message === GOODNIGHT_ERROR_ALREADY_SUBMITTED) {
        Taro.showToast({ title: '今天已经写过啦', icon: 'none' })
        await loadSubmittedMessage()
      } else {
        console.error('提交晚安心语失败', error)
        Taro.showToast({ title: '提交失败，请稍后再试', icon: 'none' })
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    canUseCloud,
    effectiveUid,
    hasSubmitted,
    input,
    isSubmitting,
    loadSubmittedMessage,
    todayKey,
    userDoc
  ])

  const vote = useCallback(
    async (voteType: GoodnightVoteType) => {
      if (!modalMessage || hasVoted || isVoting) {
        return
      }

      setIsVoting(true)
      try {
        let updated: GoodnightMessage | null
        if (canUseCloud && userDoc) {
          updated = await voteGoodnightMessage(modalMessage._id, voteType)
        } else {
          updated = voteLocalGoodnightMessage(modalMessage._id, voteType)
        }

        if (!updated) {
          Taro.showToast({ title: '当前晚安心语不可用', icon: 'none' })
          setModalVisible(false)
          return
        }

        setModalMessage(updated)
        setRewardMessage(updated)
        setHasVoted(true)
        Taro.showToast({ title: voteType === 'like' ? '已点赞' : '已收到反馈', icon: 'success' })
      } catch (error) {
        console.error('晚安心语投票失败', error)
        Taro.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
      } finally {
        setIsVoting(false)
      }
    },
    [canUseCloud, hasVoted, isVoting, modalMessage, userDoc]
  )

  const closeModal = useCallback(() => {
    setModalVisible(false)
    setModalMessage(null)
  }, [])

  return {
    input,
    setInput,
    submittedMessage,
    hasSubmitted,
    isSubmitting,
    submit,
    presentReward,
    modalVisible,
    modalMessage,
    rewardMessage,
    closeModal,
    vote,
    hasVoted,
    isVoting
  }
}
