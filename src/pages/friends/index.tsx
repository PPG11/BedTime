import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { FriendProfile, readFriends, readUserUid, saveFriends } from '../../utils/storage'
import { formatMinutesToTime } from '../../utils/time'
import { FriendUidCard } from '../../components/friends/FriendUidCard'
import { FriendForm } from '../../components/friends/FriendForm'
import { FriendList, FriendListItem } from '../../components/friends/FriendList'
import { FriendRequestItem, FriendRequestList } from '../../components/friends/FriendRequestList'
import {
  CheckinStatus,
  FriendProfileSnapshot,
  UserDocument,
  ensureCurrentUser,
  fetchPublicProfiles,
  removeFriend,
  respondFriendInvite,
  sendFriendInvite,
  supportsCloud
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

function buildRequestItems(
  requestList: string[],
  snapshots: FriendProfileSnapshot[]
): FriendRequestItem[] {
  const snapshotMap = new Map(snapshots.map((item) => [item.uid, item]))

  return requestList.map((uid) => {
    const snapshot = snapshotMap.get(uid)
    if (!snapshot) {
      const placeholder = createPlaceholderItem(uid)
      return {
        uid,
        nickname: placeholder.nickname,
        sleeptime: placeholder.sleeptime,
        updatedAtLabel: placeholder.updatedAtLabel
      }
    }
    const updatedAt =
      snapshot.updatedAt instanceof Date ? snapshot.updatedAt : new Date(snapshot.updatedAt)
    const fallbackName = snapshot.nickname || `早睡伙伴 ${uid.slice(-4)}`
    return {
      uid,
      nickname: fallbackName,
      sleeptime: snapshot.sleeptime,
      updatedAtLabel: formatUpdatedAtLabel(updatedAt)
    }
  })
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
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([])
  const [uidInput, setUidInput] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [userUid, setUserUid] = useState('')
  const [userDoc, setUserDoc] = useState<UserDocument | null>(null)
  const [outgoingRequests, setOutgoingRequests] = useState<string[]>([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [canUseCloud] = useState(() => supportsCloud())

  const friendAliasesRef = useRef<FriendProfile[]>([])

  const persistAliases = useCallback((next: FriendProfile[]) => {
    friendAliasesRef.current = next
    setFriendAliases(next)
    saveFriends(next)
  }, [])

  const applyUserDoc = useCallback(
    async (doc: UserDocument, aliasSource?: FriendProfile[]) => {
      setUserDoc(doc)
      setUserUid(doc.uid)
      setOutgoingRequests(doc.outgoingRequests ?? [])

      const source = aliasSource ?? friendAliasesRef.current
      const buddyUids = doc.buddyList ?? []
      const normalizedAliases = mergeAliasList(buddyUids, source)
      const aliasPool = new Set([
        ...buddyUids,
        ...(doc.incomingRequests ?? []),
        ...(doc.outgoingRequests ?? [])
      ])
      const sourceMap = new Map(source.map((item) => [item.uid, item.remark]))
      const storedAliases: FriendProfile[] = Array.from(aliasPool).map((uid) => ({
        uid,
        remark: sourceMap.get(uid)
      }))
      persistAliases(storedAliases)

      let friendSnapshots: FriendProfileSnapshot[] = []
      if (buddyUids.length) {
        try {
          friendSnapshots = await fetchPublicProfiles(buddyUids)
        } catch (error) {
          console.error('同步好友状态失败，使用占位信息', error)
          friendSnapshots = []
        }
      }
      setFriendItems(buildFriendItems(buddyUids, friendSnapshots, normalizedAliases))

      const incomingUids = doc.incomingRequests ?? []
      let requestSnapshots: FriendProfileSnapshot[] = []
      if (incomingUids.length) {
        try {
          requestSnapshots = await fetchPublicProfiles(incomingUids)
        } catch (error) {
          console.error('读取好友申请失败，使用占位信息', error)
          requestSnapshots = []
        }
      }
      setFriendRequests(buildRequestItems(incomingUids, requestSnapshots))
    },
    [persistAliases]
  )

  const hydrate = useCallback(async () => {
    const aliases = readFriends()
    friendAliasesRef.current = aliases
    setFriendAliases(aliases)

    if (canUseCloud) {
      setIsSyncing(true)
      try {
        const user = await ensureCurrentUser()
        await applyUserDoc(user, aliases)
      } catch (error) {
        console.error('同步好友数据失败，使用本地数据', error)
        Taro.showToast({ title: '云端同步失败，使用本地模式', icon: 'none', duration: 2000 })
        const fallbackUid = readUserUid()
        setUserUid((prev) => (prev ? prev : fallbackUid))
        setFriendItems(aliases.map((alias) => createPlaceholderItem(alias.uid, alias.remark)))
        setFriendRequests([])
        setOutgoingRequests([])
      } finally {
        setIsSyncing(false)
      }
      return
    }

    const fallbackUid = readUserUid()
    setUserUid((prev) => (prev ? prev : fallbackUid))
    setFriendItems(aliases.map((alias) => createPlaceholderItem(alias.uid, alias.remark)))
    setFriendRequests([])
    setOutgoingRequests([])
  }, [applyUserDoc, canUseCloud])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useDidShow(() => {
    void hydrate()
  })

  const resetForm = useCallback(() => {
    setUidInput('')
    setAliasInput('')
  }, [])

  const knownUids = useMemo(() => new Set(friendItems.map((item) => item.uid)), [friendItems])
  const outgoingRequestSet = useMemo(() => new Set(outgoingRequests), [outgoingRequests])
  const incomingRequestSet = useMemo(
    () => new Set(userDoc?.incomingRequests ?? []),
    [userDoc]
  )

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
      Taro.showToast({ title: '不能添加自己哦', icon: 'none' })
      return
    }
    if (knownUids.has(normalizedUid)) {
      Taro.showToast({ title: '已经是好友', icon: 'none' })
      return
    }
    if (incomingRequestSet.has(normalizedUid)) {
      Taro.showToast({ title: '对方已向你发出邀请，请在好友申请中查看', icon: 'none' })
      return
    }
    if (outgoingRequestSet.has(normalizedUid)) {
      Taro.showToast({ title: '已向对方发送邀请，请耐心等待', icon: 'none' })
      return
    }

    const remark = aliasInput.trim()

    if (canUseCloud && userDoc) {
      setIsSyncing(true)
      try {
        const result = await sendFriendInvite(normalizedUid)
        if (result.status === 'not-found') {
          Taro.showToast({ title: '未找到该用户', icon: 'none' })
          return
        }
        await applyUserDoc(result.user)
        if (remark) {
          persistAliases([
            ...friendAliases.filter((item) => item.uid !== normalizedUid),
            { uid: normalizedUid, remark }
          ])
        }
        resetForm()
        if (result.status === 'sent') {
          Taro.showToast({ title: '邀请已发送', icon: 'success' })
        } else if (result.status === 'already-friends') {
          Taro.showToast({ title: '已经是好友', icon: 'none' })
        } else if (result.status === 'incoming-exists') {
          Taro.showToast({ title: '对方已向你发出邀请，请在好友申请中查看', icon: 'none' })
        } else {
          Taro.showToast({ title: '已向对方发送邀请', icon: 'none' })
        }
      } catch (error) {
        console.error('发送好友邀请失败', error)
        Taro.showToast({ title: '发送邀请失败，请稍后重试', icon: 'none' })
      } finally {
        setIsSyncing(false)
      }
      return
    }

    Taro.showToast({ title: '当前模式不支持好友邀请', icon: 'none' })
  }, [
    aliasInput,
    applyUserDoc,
    canUseCloud,
    friendAliases,
    incomingRequestSet,
    isSyncing,
    knownUids,
    outgoingRequestSet,
    persistAliases,
    resetForm,
    sendFriendInvite,
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
        title: '解除好友',
        content: `确定要解除与 ${target.displayName} 的好友关系吗？`,
        confirmColor: '#5c6cff',
        success: async (res) => {
          if (!res.confirm) {
            return
          }
          if (canUseCloud && userDoc) {
            setIsSyncing(true)
            try {
              const result = await removeFriend(targetUid)
              await applyUserDoc(result.user)
              if (result.status === 'ok') {
                Taro.showToast({ title: '已解除好友关系', icon: 'none' })
              } else {
                Taro.showToast({ title: '未找到该好友', icon: 'none' })
              }
            } catch (error) {
              console.error('解除好友关系失败', error)
              Taro.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
            } finally {
              setIsSyncing(false)
            }
            return
          }
          const nextAliases = friendAliases.filter((item) => item.uid !== targetUid)
          persistAliases(nextAliases)
          setFriendItems((prev) => prev.filter((item) => item.uid !== targetUid))
          Taro.showToast({ title: '已解除好友关系', icon: 'none' })
        }
      })
    },
    [applyUserDoc, canUseCloud, friendAliases, friendItems, isSyncing, persistAliases, removeFriend, userDoc]
  )

  const handleAcceptRequest = useCallback(
    async (targetUid: string) => {
      if (isSyncing) {
        return
      }
      if (!canUseCloud || !userDoc) {
        Taro.showToast({ title: '当前模式不支持好友邀请', icon: 'none' })
        return
      }
      setIsSyncing(true)
      try {
        const result = await respondFriendInvite(targetUid, true)
        await applyUserDoc(result.user)
        if (result.status === 'accepted') {
          Taro.showToast({ title: '已成为好友', icon: 'success' })
        } else {
          Taro.showToast({ title: '该邀请已失效', icon: 'none' })
        }
      } catch (error) {
        console.error('接受好友邀请失败', error)
        Taro.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
      } finally {
        setIsSyncing(false)
      }
    },
    [applyUserDoc, canUseCloud, isSyncing, respondFriendInvite, userDoc]
  )

  const handleRejectRequest = useCallback(
    async (targetUid: string) => {
      if (isSyncing) {
        return
      }
      if (!canUseCloud || !userDoc) {
        Taro.showToast({ title: '当前模式不支持好友邀请', icon: 'none' })
        return
      }
      setIsSyncing(true)
      try {
        const result = await respondFriendInvite(targetUid, false)
        await applyUserDoc(result.user)
        if (result.status === 'declined') {
          Taro.showToast({ title: '已拒绝邀请', icon: 'none' })
        } else {
          Taro.showToast({ title: '该邀请已失效', icon: 'none' })
        }
      } catch (error) {
        console.error('拒绝好友邀请失败', error)
        Taro.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
      } finally {
        setIsSyncing(false)
      }
    },
    [applyUserDoc, canUseCloud, isSyncing, respondFriendInvite, userDoc]
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
      <FriendRequestList
        requests={friendRequests}
        onAccept={handleAcceptRequest}
        onReject={handleRejectRequest}
      />
      <FriendList friends={friendItems} onRefresh={handleRefreshFriend} onRemove={handleRemoveFriend} />
    </View>
  )
}
