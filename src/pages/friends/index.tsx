import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from '@tarojs/components'
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { FriendProfile, readFriends, saveFriends } from '../../utils/storage'
import { formatMinutesToTime } from '../../utils/time'
import { FriendUidCard } from '../../components/friends/FriendUidCard'
import { FriendForm } from '../../components/friends/FriendForm'
import { FriendList, type FriendListItem } from '../../components/friends/FriendList'
import { FriendRequestList, type FriendRequestItem } from '../../components/friends/FriendRequestList'
import {
  type CheckinStatus,
  type FriendsOverview,
  confirmFriendRequest,
  fetchFriendsOverview,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest
} from '../../services'
import { useAppData } from '../../state/appData'
import { getShareAppMessageOptions, getShareTimelineOptions } from '../../utils/share'
import './index.scss'

const statusLabels: Record<CheckinStatus, string> = {
  hit: '✅ 今日按时完成打卡',
  late: '⌛ 今日稍晚完成打卡',
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
  const statuses: CheckinStatus[] = ['hit', 'late', 'miss', 'pending']
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

type FriendSummary = FriendsOverview['friends'][number]
type FriendRequestSummary = FriendsOverview['requests']['incoming'][number]

function buildFriendItemsFromSummaries(
  summaries: FriendSummary[],
  aliases: FriendProfile[]
): FriendListItem[] {
  const aliasMap = new Map(aliases.map((item) => [item.uid, item.remark?.trim() ?? '']))

  return summaries.map((summary) => {
    const remark = aliasMap.get(summary.uid) ?? ''
    const fallbackName = summary.nickname || `早睡伙伴 ${summary.uid.slice(-4)}`
    const displayName = remark.length ? remark : fallbackName
    const todayStatus = summary.todayStatus ?? 'pending'
    const statusLabel = statusLabels[todayStatus] ?? statusLabels.pending
    const sleeptime =
      typeof summary.targetHM === 'string' && summary.targetHM.length
        ? summary.targetHM
        : formatMinutesToTime(22 * 60 + 30)

    return {
      uid: summary.uid,
      nickname: fallbackName,
      displayName,
      remark: remark.length ? remark : undefined,
      streak: summary.streak ?? 0,
      todayStatus,
      todayStatusLabel: statusLabel,
      sleeptime,
      updatedAtLabel: formatUpdatedAtLabel(new Date())
    }
  })
}

function buildRequestItemsFromSummaries(requests: FriendRequestSummary[]): FriendRequestItem[] {
  return requests.map((request) => {
    const fallbackName = request.nickname || `早睡伙伴 ${request.uid.slice(-4)}`
    const sleeptime =
      typeof request.targetHM === 'string' && request.targetHM.length
        ? request.targetHM
        : formatMinutesToTime(22 * 60 + 30)
    const updatedAt = request.createdAt instanceof Date ? request.createdAt : new Date()

    return {
      requestId: request.requestId,
      uid: request.uid,
      nickname: fallbackName,
      sleeptime,
      updatedAtLabel: formatUpdatedAtLabel(updatedAt)
    }
  })
}

export default function Friends() {
  const { canUseCloud, user: userDoc, localUid, refresh } = useAppData()
  const [friendItems, setFriendItems] = useState<FriendListItem[]>([])
  const [, setFriendAliases] = useState<FriendProfile[]>([])
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendsOverview['requests']['outgoing']>([])
  const [uidInput, setUidInput] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const userUid = useMemo(() => (canUseCloud && userDoc ? userDoc.uid : localUid), [canUseCloud, localUid, userDoc])
  useShareAppMessage(() => getShareAppMessageOptions(userUid))
  useShareTimeline(() => getShareTimelineOptions(userUid))
  const userDocRef = useRef(userDoc)
  useEffect(() => {
    userDocRef.current = userDoc
  }, [userDoc])
  const [isSyncing, setIsSyncing] = useState(false)

  const friendAliasesRef = useRef<FriendProfile[]>([])

  const persistAliases = useCallback((next: FriendProfile[]) => {
    friendAliasesRef.current = next
    setFriendAliases(next)
    saveFriends(next)
  }, [])

  const upsertAlias = useCallback(
    (uid: string, remark?: string) => {
      const trimmed = remark?.trim() ?? ''
      const current = friendAliasesRef.current
      const filtered = current.filter((item) => item.uid !== uid)
      if (!trimmed.length) {
        persistAliases(filtered)
        return
      }

      const next: FriendProfile[] = [
        ...filtered,
        {
          uid,
          remark: trimmed
        }
      ]
      persistAliases(next)
    },
    [persistAliases]
  )

  const removeAlias = useCallback(
    (uid: string) => {
      const current = friendAliasesRef.current
      const next = current.filter((item) => item.uid !== uid)
      if (next.length !== current.length) {
        persistAliases(next)
      }
    },
    [persistAliases]
  )

  const applyOverview = useCallback(
    (overview: FriendsOverview, aliasSource?: FriendProfile[]) => {
      const source = aliasSource ?? friendAliasesRef.current
      const sourceMap = new Map(source.map((item) => [item.uid, item.remark]))
      const aliasPool = new Set<string>([
        ...overview.friends.map((item) => item.uid),
        ...overview.requests.incoming.map((item) => item.uid),
        ...overview.requests.outgoing.map((item) => item.uid)
      ])
      const storedAliases: FriendProfile[] = Array.from(aliasPool).map((uid) => ({
        uid,
        remark: sourceMap.get(uid) ?? ''
      }))

      persistAliases(storedAliases)
      setFriendItems(buildFriendItemsFromSummaries(overview.friends, storedAliases))
      setFriendRequests(buildRequestItemsFromSummaries(overview.requests.incoming))
      setOutgoingRequests(overview.requests.outgoing)
    },
    [persistAliases]
  )

  const confirmedRequestsRef = useRef<Set<string>>(new Set())

  const ensureOutgoingConfirmed = useCallback(
    async (outgoing: FriendsOverview['requests']['outgoing']) => {
      if (!outgoing.length) {
        return
      }
      const pending = outgoing.filter(
        (request) =>
          request.status === 'accepted' && !confirmedRequestsRef.current.has(request.requestId)
      )
    if (!pending.length) {
      return
    }

    let didConfirm = false

    for (const request of pending) {
      try {
        const confirmed = await confirmFriendRequest(request.requestId)
        if (confirmed) {
          confirmedRequestsRef.current.add(request.requestId)
          didConfirm = true
        } else {
          console.warn('好友申请确认返回未建立关系', request.requestId)
        }
      } catch (error) {
        console.warn('确认好友申请结果失败', request.requestId, error)
      }
    }

    if (didConfirm) {
      try {
        const refreshed = await fetchFriendsOverview()
        applyOverview(refreshed)
      } catch (error) {
        console.warn('刷新好友数据失败', error)
      }
    }
  },
  [applyOverview]
)

  const lastHydrateRef = useRef(0)

  const hydrate = useCallback(
    async (force = false) => {
      const now = Date.now()
      if (!force && now - lastHydrateRef.current < 30 * 1000 && friendItems.length) {
        return
      }

      const aliases = readFriends()
      friendAliasesRef.current = aliases
      setFriendAliases(aliases)

      if (!canUseCloud) {
        setFriendItems(aliases.map((alias) => createPlaceholderItem(alias.uid, alias.remark)))
        setFriendRequests([])
        setOutgoingRequests([])
        lastHydrateRef.current = now
        return
      }

      if (!userDocRef.current) {
        try {
          await refresh()
        } catch (error) {
          console.warn('刷新用户信息失败', error)
        }
      }

      if (!userDocRef.current) {
        setFriendItems(aliases.map((alias) => createPlaceholderItem(alias.uid, alias.remark)))
        setFriendRequests([])
        setOutgoingRequests([])
        return
      }

      setIsSyncing(true)
      try {
        const overview = await fetchFriendsOverview()
        applyOverview(overview, aliases)
        await ensureOutgoingConfirmed(overview.requests.outgoing)
        lastHydrateRef.current = Date.now()
      } catch (error) {
        console.error('同步好友数据失败，使用本地数据', error)
        Taro.showToast({ title: '云端同步失败，使用本地模式', icon: 'none', duration: 2000 })
        setFriendItems(aliases.map((alias) => createPlaceholderItem(alias.uid, alias.remark)))
        setFriendRequests([])
        setOutgoingRequests([])
      } finally {
        setIsSyncing(false)
      }
    },
    [applyOverview, canUseCloud, ensureOutgoingConfirmed, friendItems.length, refresh]
  )

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
  const outgoingRequestSet = useMemo(
    () => new Set(outgoingRequests.map((item) => item.uid)),
    [outgoingRequests]
  )
  const incomingRequestSet = useMemo(
    () => new Set(friendRequests.map((item) => item.uid)),
    [friendRequests]
  )

  const refreshOverview = useCallback(async () => {
    const overview = await fetchFriendsOverview()
    applyOverview(overview)
    await ensureOutgoingConfirmed(overview.requests.outgoing)
  }, [applyOverview, ensureOutgoingConfirmed])

  const handleAddFriend = useCallback(async () => {
    if (isSyncing) {
      return
    }
    const normalizedUid = uidInput.trim()
    if (!/^[0-9A-Za-z]{6,12}$/.test(normalizedUid)) {
      Taro.showToast({ title: '请输入有效的好友 UID', icon: 'none' })
      return
    }
    if (normalizedUid === userUid) {
      Taro.showToast({ title: '不能添加自己哦', icon: 'none' })
      return
    }
    if (knownUids.has(normalizedUid)) {
      Taro.showToast({ title: '已经是好友啦', icon: 'none' })
      return
    }
    if (incomingRequestSet.has(normalizedUid)) {
      Taro.showToast({ title: '对方已向你发出申请，请在好友申请中查看', icon: 'none' })
      return
    }
    if (outgoingRequestSet.has(normalizedUid)) {
      Taro.showToast({ title: '已向对方发送申请，请耐心等待', icon: 'none' })
      return
    }

    const remark = aliasInput.trim()

    if (canUseCloud && userDoc) {
      setIsSyncing(true)
      try {
        await sendFriendRequest(normalizedUid)
        if (remark) {
          upsertAlias(normalizedUid, remark)
        }
        await refreshOverview()
        resetForm()
        Taro.showToast({ title: '好友申请已发送', icon: 'success' })
      } catch (error) {
        console.error('发送好友申请失败', error)
        const message =
          error instanceof Error && typeof error.message === 'string' && error.message.length
            ? error.message
            : '发送好友申请失败，请稍后重试'
        Taro.showToast({ title: message, icon: 'none' })
      } finally {
        setIsSyncing(false)
      }
      return
    }

    Taro.showToast({ title: '当前模式不支持好友申请', icon: 'none' })
  }, [
    aliasInput,
    canUseCloud,
    incomingRequestSet,
    isSyncing,
    knownUids,
    outgoingRequestSet,
    refreshOverview,
    resetForm,
    uidInput,
    upsertAlias,
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
        confirmColor: '#6f63ff',
        success: async (res) => {
          if (!res.confirm) {
            return
          }
          if (canUseCloud && userDoc) {
            setIsSyncing(true)
            try {
              await removeFriend(targetUid)
              removeAlias(targetUid)
              await refreshOverview()
              Taro.showToast({ title: '已解除好友关系', icon: 'none' })
            } catch (error) {
              console.error('解除好友关系失败', error)
              const message =
                error instanceof Error && typeof error.message === 'string' && error.message.length
                  ? error.message
                  : '操作失败，请稍后再试'
              Taro.showToast({ title: message, icon: 'none' })
            } finally {
              setIsSyncing(false)
            }
            return
          }
          removeAlias(targetUid)
          setFriendItems((prev) => prev.filter((item) => item.uid !== targetUid))
          Taro.showToast({ title: '已解除好友关系', icon: 'none' })
        }
      })
    },
    [canUseCloud, friendItems, isSyncing, refreshOverview, removeAlias, userDoc]
  )

  const handleAcceptRequest = useCallback(
    async (requestId: string) => {
      if (isSyncing) {
        return
      }
      if (!canUseCloud || !userDoc) {
        Taro.showToast({ title: '当前模式不支持好友申请', icon: 'none' })
        return
      }
      setIsSyncing(true)
      try {
        const status = await respondFriendRequest(requestId, true)
        await refreshOverview()
        if (status === 'accepted') {
          Taro.showToast({ title: '已成为好友', icon: 'success' })
        } else {
          Taro.showToast({ title: '该申请已失效', icon: 'none' })
        }
      } catch (error) {
        console.error('接受好友申请失败', error)
        const message =
          error instanceof Error && typeof error.message === 'string' && error.message.length
            ? error.message
            : '操作失败，请稍后再试'
        Taro.showToast({ title: message, icon: 'none' })
      } finally {
        setIsSyncing(false)
      }
    },
    [canUseCloud, isSyncing, refreshOverview, userDoc]
  )

  const handleRejectRequest = useCallback(
    async (requestId: string) => {
      if (isSyncing) {
        return
      }
      if (!canUseCloud || !userDoc) {
        Taro.showToast({ title: '当前模式不支持好友申请', icon: 'none' })
        return
      }
      setIsSyncing(true)
      try {
        const status = await respondFriendRequest(requestId, false)
        await refreshOverview()
        if (status === 'rejected') {
          Taro.showToast({ title: '已拒绝申请', icon: 'none' })
        } else {
          Taro.showToast({ title: '该申请已失效', icon: 'none' })
        }
      } catch (error) {
        console.error('拒绝好友申请失败', error)
        const message =
          error instanceof Error && typeof error.message === 'string' && error.message.length
            ? error.message
            : '操作失败，请稍后再试'
        Taro.showToast({ title: message, icon: 'none' })
      } finally {
        setIsSyncing(false)
      }
    },
    [canUseCloud, isSyncing, refreshOverview, userDoc]
  )

  const handleRefreshFriend = useCallback(
    async (targetUid: string) => {
      if (isSyncing) {
        return
      }
      if (canUseCloud && userDoc) {
        if (!friendItems.some((item) => item.uid === targetUid)) {
          Taro.showToast({ title: '未找到该好友', icon: 'none' })
          return
        }
        setIsSyncing(true)
        try {
          await refreshOverview()
          Taro.showToast({ title: '好友状态已更新', icon: 'success' })
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
          item.uid === targetUid
            ? createPlaceholderItem(item.uid, item.remark)
            : item
        )
      )
      Taro.showToast({ title: '好友状态已更新', icon: 'success' })
    },
    [canUseCloud, friendItems, isSyncing, refreshOverview, userDoc]
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
        onAccept={(requestId) => {
          void handleAcceptRequest(requestId)
        }}
        onReject={(requestId) => {
          void handleRejectRequest(requestId)
        }}
      />
      <FriendList friends={friendItems} onRefresh={handleRefreshFriend} onRemove={handleRemoveFriend} />
    </View>
  )
}
