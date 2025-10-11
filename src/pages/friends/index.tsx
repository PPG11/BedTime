import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  FriendProfile,
  readFriends,
  readUserUid,
  saveFriends
} from '../../utils/storage'
import { formatMinutesToTime } from '../../utils/time'
import './index.scss'

function createFriendProfile(uid: string, alias?: string): FriendProfile {
  const trimmedAlias = alias?.trim() ?? ''
  const nickname = trimmedAlias.length ? trimmedAlias : `早睡伙伴 ${uid.slice(-4)}`
  const digits = uid.split('').map(Number)
  const base = digits.reduce((sum, value, index) => sum + value * (index + 3), 0)
  const streak = (base % 12) + 1
  const total = streak + (base % 40) + 8
  const completion = Math.min(100, 60 + (base % 38))
  const checkInMinutes = 21 * 60 + (base % 120)
  const statusTexts = [
    `昨晚 ${formatMinutesToTime(checkInMinutes)} 完成打卡`,
    `最近连续 ${streak} 天按时休息`,
    `近一周完成率约 ${completion}%`
  ]
  const lastCheckInLabel = statusTexts[base % statusTexts.length]

  return {
    uid,
    nickname,
    streak,
    total,
    completion,
    lastCheckInLabel,
    remark: trimmedAlias || undefined
  }
}

export default function Friends() {
  const [friends, setFriends] = useState<FriendProfile[]>([])
  const [uidInput, setUidInput] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [userUid, setUserUid] = useState('')

  const hasFriends = useMemo(() => friends.length > 0, [friends])

  const hydrate = useCallback(() => {
    setFriends(readFriends())
    setUserUid(readUserUid())
  }, [])

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useDidShow(() => {
    hydrate()
  })

  const persistFriends = useCallback(
    (next: FriendProfile[]) => {
      setFriends(next)
      saveFriends(next)
    },
    []
  )

  const handleAddFriend = useCallback(() => {
    const normalizedUid = uidInput.trim()
    if (!/^\d{8}$/.test(normalizedUid)) {
      Taro.showToast({ title: '请输入 8 位好友 UID', icon: 'none' })
      return
    }
    if (normalizedUid === userUid) {
      Taro.showToast({ title: '不能关注自己哦', icon: 'none' })
      return
    }
    if (friends.some((item) => item.uid === normalizedUid)) {
      Taro.showToast({ title: '已经关注该好友', icon: 'none' })
      return
    }

    const profile = createFriendProfile(normalizedUid, aliasInput)
    const next = [...friends, profile]
    persistFriends(next)
    setUidInput('')
    setAliasInput('')
    Taro.showToast({ title: '已关注好友', icon: 'success' })
  }, [aliasInput, friends, persistFriends, uidInput, userUid])

  const handleRemoveFriend = useCallback(
    (targetUid: string) => {
      const target = friends.find((item) => item.uid === targetUid)
      if (!target) {
        return
      }
      Taro.showModal({
        title: '取消关注',
        content: `确定要取消关注 ${target.nickname} 吗？`,
        confirmColor: '#5c6cff',
        success: (res) => {
          if (res.confirm) {
            const next = friends.filter((item) => item.uid !== targetUid)
            persistFriends(next)
            Taro.showToast({ title: '已取消关注', icon: 'none' })
          }
        }
      })
    },
    [friends, persistFriends]
  )

  const handleRefreshFriend = useCallback(
    (targetUid: string) => {
      const next = friends.map((item) => {
        if (item.uid !== targetUid) {
          return item
        }
        const alias = item.remark ?? item.nickname
        return createFriendProfile(item.uid, alias)
      })
      persistFriends(next)
      Taro.showToast({ title: '好友状态已更新', icon: 'success' })
    },
    [friends, persistFriends]
  )

  return (
    <View className='friends'>
      <View className='friends__card friends__card--intro'>
        <Text className='friends__title'>我的 UID</Text>
        <Text className='friends__uid'>{userUid || '正在生成 UID...'}</Text>
        <Text className='friends__hint'>分享你的 UID，好友即可关注你的早睡打卡进展。</Text>
      </View>

      <View className='friends__card'>
        <Text className='friends__title'>关注好友</Text>
        <View className='friends__form'>
          <View className='friends__form-field'>
            <Text className='friends__label'>好友 UID</Text>
            <Input
              className='friends__input'
              value={uidInput}
              placeholder='输入好友的 8 位 UID'
              maxLength={8}
              onInput={(event) => setUidInput(event.detail.value)}
            />
          </View>
          <View className='friends__form-field'>
            <Text className='friends__label'>备注（可选）</Text>
            <Input
              className='friends__input'
              value={aliasInput}
              placeholder='帮好友起个称呼'
              maxLength={16}
              onInput={(event) => setAliasInput(event.detail.value)}
            />
          </View>
          <Button className='friends__submit' type='primary' onClick={handleAddFriend}>
            关注好友
          </Button>
        </View>
      </View>

      <View className='friends__card'>
        <Text className='friends__title'>好友早睡情况</Text>
        {hasFriends ? (
          <View className='friends__list'>
            {friends.map((friend) => (
              <View key={friend.uid} className='friends__item'>
                <View className='friends__item-header'>
                  <View>
                    <Text className='friends__item-name'>{friend.nickname}</Text>
                    <Text className='friends__item-uid'>UID：{friend.uid}</Text>
                  </View>
                  <View className='friends__item-actions'>
                    <Button size='mini' onClick={() => handleRefreshFriend(friend.uid)}>
                      刷新
                    </Button>
                    <Button
                      size='mini'
                      className='friends__remove'
                      onClick={() => handleRemoveFriend(friend.uid)}
                    >
                      取消
                    </Button>
                  </View>
                </View>
                <View className='friends__item-stats'>
                  <View className='friends__stat'>
                    <Text className='friends__stat-value'>{friend.streak}</Text>
                    <Text className='friends__stat-label'>连续天数</Text>
                  </View>
                  <View className='friends__stat'>
                    <Text className='friends__stat-value'>{friend.total}</Text>
                    <Text className='friends__stat-label'>累计打卡</Text>
                  </View>
                  <View className='friends__stat'>
                    <Text className='friends__stat-value'>{friend.completion}%</Text>
                    <Text className='friends__stat-label'>完成率</Text>
                  </View>
                </View>
                <Text className='friends__item-status'>{friend.lastCheckInLabel}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className='friends__empty'>暂未关注好友，输入 UID 即可开始互相监督早睡。</Text>
        )}
      </View>
    </View>
  )
}
