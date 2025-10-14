import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { FriendProfile, readFriends, readUserUid, saveFriends } from '../../utils/storage'
import { formatMinutesToTime } from '../../utils/time'
import { FriendUidCard } from '../../components/friends/FriendUidCard'
import { FriendForm } from '../../components/friends/FriendForm'
import { FriendList, FriendListItem } from '../../components/friends/FriendList'
import {
  CheckinStatus,
  FriendProfileSnapshot,
  UserDocument,
  ensureCurrentUser,
  fetchPublicProfiles,
  supportsCloud,
  updateCurrentUser
} from '../../services'
import './index.scss'

const statusLabels: Record<CheckinStatus, string> = {
  hit: '今日已按时休息',
  miss: '今日尚未达标',
  pending: '等待打卡'
}

function formatUpdatedAtLabel(date: Date): string {
  const target = date instanceof Date ? date : new Date(date)
  const month = `${target.getMonth() + 1}`.padStart(2, '0')
  const day = `${target.getDate()}`.padStart(2, '0')
  const hours = `${target.getHours()}`.padStart(2, '0')
  const minutes = `${target.getMinutes()}`.padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}

function createPlaceholderItem(uid: string, remark?: string): FriendListItem {
  const trimmedRemark = remark?.trim() ?? ''
  const digits = uid.split('').map(Number)
  const base = digits.reduce((sum, value, index) => sum + value * (index + 3), 0)
  const streak = (base % 12) + 1
  const statuses: CheckinStatus[] = ['hit', 'miss', 'pending']
  const todayStatus = statuses[base % statuses.length]
  const sleepMinutes = 21 * 60 + (base % 120)
  const fallbackName = `早睡伙伴 ${uid.slice(-4)}`
  const updatedAt = new Date(Date.now() - (base % 120) * 60 * 1000)

  return {
    uid,
    nickname: fallbackName,
    displayName: trimmedRemark || fallbackName,
    remark: trimmedRemark || undefined,
    streak,
    todayStatus,
    todayStatusLabel: statusLabels[todayStatus],
    sleeptime: formatMinutesToTime(sleepMinutes),
    updatedAtLabel: formatUpdatedAtLabel(updatedAt)
  }
}

function mergeAliasList(buddyList: string[], aliases: FriendProfile[]): FriendProfile[] {
  const aliasMap = new Map(aliases.map((item) => [item.uid, item.remark]))
  return buddyList.map((uid) => ({
    uid,
    remark: aliasMap.get(uid)
  }))
}

function buildFriendItems(
  buddyList: string[],
  snapshots: FriendProfileSnapshot[],
  aliases: FriendProfile[]
): FriendListItem[] {
  const aliasMap = new Map(aliases.map((item) => [item.uid, item.remark?.trim() ?? '']))
  const snapshotMap = new Map(snapshots.map((item) => [item.uid, item]))

  return buddyList.map((uid) => {
    const snapshot = snapshotMap.get(uid)
    const remark = aliasMap.get(uid) ?? ''
    if (!snapshot) {
      return createPlaceholderItem(uid, remark)
    }
    const updatedAt =
      snapshot.updatedAt instanceof Date ? snapshot.updatedAt : new Date(snapshot.updatedAt)
    const fallbackName = snapshot.nickname || `早睡伙伴 ${uid.slice(-4)}`
    const displayName = remark.length ? remark : fallbackName
    return {
      uid,
      nickname: fallbackName,
      displayName,
      remark: remark.length ? remark : undefined,
      streak: snapshot.streak,
      todayStatus: snapshot.todayStatus,
      todayStatusLabel: statusLabels[snapshot.todayStatus] ?? statusLabels.pending,
      sleeptime: snapshot.sleeptime,
      updatedAtLabel: formatUpdatedAtLabel(updatedAt)
    }
  })
}

export default function Friends() {
  const [friendItems, setFriendItems] = useState<FriendListItem[]>([])
  const [friendAliases, setFriendAliases] = useState<FriendProfile[]>([])
  const [uidInput, setUidInput] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [userUid, setUserUid] = useState('')
  const [userDoc, setUserDoc] = useState<UserDocument | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [canUseCloud] = useState(() => supportsCloud())

  const hydrate = useCallback(async () => {
    const aliases = readFriends()
    setFriendAliases(aliases)

    if (canUseCloud) {
      setIsSyncing(true)
      try {
        const user = await ensureCurrentUser()
        setUserDoc(user)
        setUserUid(user.uid)
        const normalizedAliases = mergeAliasList(user.buddyList ?? [], aliases)
        saveFriends(normalizedAliases)
        setFriendAliases(normalizedAliases)

        if (user.buddyList && user.buddyList.length > 0) {
          const snapshots = await fetchPublicProfiles(user.buddyList)
          setFriendItems(buildFriendItems(user.buddyList, snapshots, normalizedAliases))
        } else {
          setFriendItems([])
        }
      } catch (error) {
        console.error('同步好友数据失败，使用本地数据', error)
        Taro.showToast({ title: '云端同步失败，使用本地模式', icon: 'none', duration: 2000 })
        // 回退到本地模式
        const fallbackUid = readUserUid()
        if (!userUid) {
          setUserUid(fallbackUid)
        }
        setFriendItems(aliases.map((alias) => createPlaceholderItem(alias.uid, alias.remark)))
      } finally {
        setIsSyncing(false)
      }
      return
    }

    const fallbackUid = readUserUid()
    setUserUid(fallbackUid)
    setFriendItems(aliases.map((alias) => createPlaceholderItem(alias.uid, alias.remark)))
  }, [canUseCloud, userUid])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useDidShow(() => {
    void hydrate()
  })

  const persistAliases = useCallback((next: FriendProfile[]) => {
    setFriendAliases(next)
    saveFriends(next)
  }, [])

  const resetForm = useCallback(() => {
    setUidInput('')
    setAliasInput('')
  }, [])

  const knownUids = useMemo(() => new Set(friendItems.map((item) => item.uid)), [friendItems])

  const handleAddFriend = useCallback(async () => {
    if (isSyncing) {
      return
    }
    const normalizedUid = uidInput.trim()
    if (!/^\d{8}$/.test(normalizedUid)) {
      Taro.showToast({ title: '请输入 8 位好友 UID', icon: 'none' })
      return
    }
    if (normalizedUid === userUid) {
      Taro.showToast({ title: '不能关注自己哦', icon: 'none' })
      return
    }
    if (knownUids.has(normalizedUid)) {
      Taro.showToast({ title: '已经关注该好友', icon: 'none' })
      return
    }

    const remark = aliasInput.trim()

    if (canUseCloud && userDoc) {
      setIsSyncing(true)
      try {
        const nextBuddyList = [...(userDoc.buddyList ?? []), normalizedUid]
        const updatedUser = await updateCurrentUser({ buddyList: nextBuddyList })
        setUserDoc(updatedUser)
        const nextAliases = mergeAliasList(updatedUser.buddyList ?? [], [
          ...friendAliases.filter((item) => item.uid !== normalizedUid),
          { uid: normalizedUid, remark: remark || undefined }
        ])
        persistAliases(nextAliases)
        const snapshots = await fetchPublicProfiles(updatedUser.buddyList ?? [])
        setFriendItems(buildFriendItems(updatedUser.buddyList ?? [], snapshots, nextAliases))
        resetForm()
        Taro.showToast({ title: '已关注好友', icon: 'success' })
      } catch (error) {
        console.error('添加好友失败', error)
        Taro.showToast({ title: '添加好友失败，请稍后重试', icon: 'none' })
      } finally {
        setIsSyncing(false)
      }
      return
    }

    const nextAliases = [
      ...friendAliases,
      {
        uid: normalizedUid,
        remark: remark || undefined
      }
    ]
    persistAliases(nextAliases)
    setFriendItems((prev) => [...prev, createPlaceholderItem(normalizedUid, remark)])
    resetForm()
    Taro.showToast({ title: '已关注好友', icon: 'success' })
  }, [
    aliasInput,
    canUseCloud,
    friendAliases,
    isSyncing,
    knownUids,
    persistAliases,
    resetForm,
    uidInput,
    userDoc,
    userUid
  ])

  const handleRemoveFriend = useCallback(
    (targetUid: string) => {
      const target = friendItems.find((item) => item.uid === targetUid)
      if (!target || isSyncing) {
        return
      }
      Taro.showModal({
        title: '取消关注',
        content: `确定要取消关注 ${target.displayName} 吗？`,
        confirmColor: '#5c6cff',
        success: async (res) => {
          if (!res.confirm) {
            return
          }
          if (canUseCloud && userDoc) {
            setIsSyncing(true)
            try {
              const nextBuddyList = (userDoc.buddyList ?? []).filter((item) => item !== targetUid)
              const updatedUser = await updateCurrentUser({ buddyList: nextBuddyList })
              setUserDoc(updatedUser)
              const nextAliases = mergeAliasList(
                updatedUser.buddyList ?? [],
                friendAliases.filter((item) => item.uid !== targetUid)
              )
              persistAliases(nextAliases)
              const snapshots = updatedUser.buddyList?.length
                ? await fetchPublicProfiles(updatedUser.buddyList)
                : []
              setFriendItems(buildFriendItems(updatedUser.buddyList ?? [], snapshots, nextAliases))
              Taro.showToast({ title: '已取消关注', icon: 'none' })
            } catch (error) {
              console.error('取消关注失败', error)
              Taro.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
            } finally {
              setIsSyncing(false)
            }
            return
          }
          const nextAliases = friendAliases.filter((item) => item.uid !== targetUid)
          persistAliases(nextAliases)
          setFriendItems((prev) => prev.filter((item) => item.uid !== targetUid))
          Taro.showToast({ title: '已取消关注', icon: 'none' })
        }
      })
    },
    [canUseCloud, friendAliases, friendItems, isSyncing, persistAliases, userDoc]
  )

  const handleRefreshFriend = useCallback(
    async (targetUid: string) => {
      if (isSyncing) {
        return
      }
      if (canUseCloud && userDoc) {
        if (!(userDoc.buddyList ?? []).includes(targetUid)) {
          Taro.showToast({ title: '未找到该好友', icon: 'none' })
          return
        }
        setIsSyncing(true)
        try {
          const snapshots = await fetchPublicProfiles([targetUid])
          if (!snapshots.length) {
            Taro.showToast({ title: '暂无最新状态', icon: 'none' })
          } else {
            const alias = friendAliases.find((item) => item.uid === targetUid)?.remark
            const updated = buildFriendItems(
              [targetUid],
              snapshots,
              [{ uid: targetUid, remark: alias }]
            )[0]
            setFriendItems((prev) =>
              prev.map((item) => (item.uid === targetUid ? updated : item))
            )
            Taro.showToast({ title: '好友状态已更新', icon: 'success' })
          }
        } catch (error) {
          console.error('刷新好友失败', error)
          Taro.showToast({ title: '刷新失败，请稍后再试', icon: 'none' })
        } finally {
          setIsSyncing(false)
        }
        return
      }

      setFriendItems((prev) =>
        prev.map((item) =>
          item.uid === targetUid ? createPlaceholderItem(item.uid, item.remark) : item
        )
      )
      Taro.showToast({ title: '好友状态已更新', icon: 'success' })
    },
    [canUseCloud, friendAliases, isSyncing, userDoc]
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
      <FriendList friends={friendItems} onRefresh={handleRefreshFriend} onRemove={handleRemoveFriend} />
    </View>
  )
}
