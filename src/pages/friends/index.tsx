import { useCallback, useEffect, useState } from 'react'
import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { FriendProfile, readFriends, readUserUid, saveFriends } from '../../utils/storage'
import { createFriendProfile } from '../../utils/friends'
import { FriendUidCard } from '../../components/friends/FriendUidCard'
import { FriendForm } from '../../components/friends/FriendForm'
import { FriendList } from '../../components/friends/FriendList'
import './index.scss'

export default function Friends() {
  const [friends, setFriends] = useState<FriendProfile[]>([])
  const [uidInput, setUidInput] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [userUid, setUserUid] = useState('')

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

  const persistFriends = useCallback((next: FriendProfile[]) => {
    setFriends(next)
    saveFriends(next)
  }, [])

  const resetForm = useCallback(() => {
    setUidInput('')
    setAliasInput('')
  }, [])

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
    resetForm()
    Taro.showToast({ title: '已关注好友', icon: 'success' })
  }, [aliasInput, friends, persistFriends, resetForm, uidInput, userUid])

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
      <FriendUidCard uid={userUid} />
      <FriendForm
        uidInput={uidInput}
        aliasInput={aliasInput}
        onUidInputChange={setUidInput}
        onAliasInputChange={setAliasInput}
        onSubmit={handleAddFriend}
      />
      <FriendList friends={friends} onRefresh={handleRefreshFriend} onRemove={handleRemoveFriend} />
    </View>
  )
}
