import {
  fetchFriendsOverview,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  type FriendsOverview
} from '../../services/index'
import { getAppData, refreshAppData, subscribeAppData } from '../../state/app-data'
import { readFriends, saveFriends, type FriendProfile } from '../../utils/storage'
import { getShareAppMessageOptions, getShareTimelineOptions, showPageShareMenu } from '../../utils/share'
import { buildFriendItems, buildRequestItems, mergeFriendItems, type FriendItem, type RequestItem } from './view-model'

type InputEvent = WechatMiniprogram.CustomEvent<{ value: string }>
type ActionEvent = WechatMiniprogram.TouchEvent

function showError(error: unknown, fallback: string): void {
  const title = error instanceof Error && error.message ? error.message : fallback
  wx.showToast({ title, icon: 'none' })
}

Page({
  data: {
    uid: '',
    uidInput: '',
    aliasInput: '',
    friends: [] as FriendItem[],
    incoming: [] as RequestItem[],
    outgoing: [] as RequestItem[],
    nextCursor: null as string | null,
    syncing: false,
    loaded: false,
    error: ''
  },
  alive: false,
  unsubscribe: null as (() => void) | null,
  aliases: [] as FriendProfile[],
  lastHydratedAt: 0,

  onLoad() {
    showPageShareMenu()
    this.alive = true
    this.aliases = readFriends()
    this.unsubscribe = subscribeAppData((state) => {
      if (this.alive) this.setData({ uid: state.user?.uid ?? '' })
    })
    this.setData({ uid: getAppData().user?.uid ?? '' })
  },
  onShow() {
    void this.hydrate(false)
  },
  onUnload() {
    this.alive = false
    this.unsubscribe?.()
    this.unsubscribe = null
  },
  async onPullDownRefresh() {
    try {
      await this.hydrate(true)
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  onReachBottom() {
    void this.loadMore()
  },
  onShareAppMessage() {
    return getShareAppMessageOptions(this.data.uid)
  },
  onShareTimeline() {
    return getShareTimelineOptions(this.data.uid)
  },
  onUidInput(event: InputEvent) {
    this.setData({ uidInput: event.detail.value })
  },
  onAliasInput(event: InputEvent) {
    this.setData({ aliasInput: event.detail.value })
  },
  copyUid() {
    if (!this.data.uid) {
      wx.showToast({ title: 'UID 加载中，请稍候', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: this.data.uid,
      fail: () => wx.showToast({ title: '复制失败，请稍后再试', icon: 'none' })
    })
  },
  applyOverview(overview: FriendsOverview, append = false) {
    if (!this.alive) return
    const incoming = buildFriendItems(overview.friends, this.aliases)
    this.setData({
      friends: append ? mergeFriendItems(this.data.friends, incoming) : incoming,
      incoming: buildRequestItems(overview.requests.incoming),
      outgoing: buildRequestItems(overview.requests.outgoing),
      // The server may return a cursor for its final non-empty page.
      nextCursor: overview.friends.length ? overview.nextCursor : null,
      loaded: true,
      error: ''
    })
  },
  async refreshOverview() {
    this.applyOverview(await fetchFriendsOverview({}))
    this.lastHydratedAt = Date.now()
  },
  async hydrate(force = false) {
    if (this.data.syncing) return
    if (!force && this.data.loaded && Date.now() - this.lastHydratedAt < 30_000) return
    this.setData({ syncing: true, error: '' })
    try {
      if (!getAppData().user) await refreshAppData()
      if (!getAppData().user) throw new Error('未获取到用户信息，请稍后再试')
      this.aliases = readFriends()
      await this.refreshOverview()
    } catch (error) {
      if (this.alive) {
        this.setData({ error: '好友数据同步失败，下拉页面可重试' })
        showError(error, '好友数据同步失败，请稍后再试')
      }
    } finally {
      if (this.alive) this.setData({ syncing: false })
    }
  },
  async loadMore() {
    const cursor = this.data.nextCursor
    if (!cursor || this.data.syncing) return
    this.setData({ syncing: true })
    try {
      const overview = await fetchFriendsOverview({ cursor })
      this.applyOverview(overview, true)
    } catch (error) {
      if (this.alive) showError(error, '加载好友失败，请重试')
    } finally {
      if (this.alive) this.setData({ syncing: false })
    }
  },
  async refreshFriends() {
    await this.hydrate(true)
  },
  async addFriend() {
    if (this.data.syncing) return
    const uid = this.data.uidInput.trim()
    if (!/^[0-9A-Za-z]{6,12}$/.test(uid)) return showError(null, '请输入有效的好友 UID')
    if (!getAppData().user) return showError(null, '未获取到用户信息，请稍后再试')
    if (uid === this.data.uid) return showError(null, '不能添加自己哦')
    if (this.data.friends.some((item) => item.uid === uid)) return showError(null, '已经是好友啦')
    if (this.data.incoming.some((item) => item.uid === uid)) return showError(null, '对方已发来申请，请在好友申请中查看')
    if (this.data.outgoing.some((item) => item.uid === uid)) return showError(null, '已发送申请，请耐心等待')
    const remark = this.data.aliasInput.trim()
    this.setData({ syncing: true })
    let sent = false
    try {
      await sendFriendRequest(uid)
      sent = true
      if (remark) {
        this.aliases = [...this.aliases.filter((item: FriendProfile) => item.uid !== uid), { uid, remark }]
        saveFriends(this.aliases)
      }
      if (this.alive) this.setData({ uidInput: '', aliasInput: '' })
      await this.refreshOverview()
      if (this.alive) wx.showToast({ title: '好友申请已发送', icon: 'success' })
    } catch (error) {
      if (this.alive) {
        if (sent) showError(null, '申请已发送，列表刷新失败，请下拉重试')
        else showError(error, '发送好友申请失败，请稍后重试')
      }
    } finally {
      if (this.alive) this.setData({ syncing: false })
    }
  },
  async handleRequest(event: ActionEvent) {
    if (this.data.syncing) return
    const requestId = String(event.currentTarget.dataset.id || '')
    const accept = event.currentTarget.dataset.accept === 'yes'
    if (!requestId || !this.data.incoming.some((item) => item.requestId === requestId)) return
    if (!getAppData().user) return showError(null, '未获取到用户信息，请稍后再试')
    this.setData({ syncing: true })
    let changed = false
    try {
      const status = await respondFriendRequest(requestId, accept)
      changed = true
      if (this.alive) this.setData({ incoming: this.data.incoming.filter((item) => item.requestId !== requestId) })
      await this.refreshOverview()
      if (this.alive) wx.showToast({
        title: status === 'accepted' ? '已成为好友' : status === 'rejected' ? '已拒绝申请' : '该申请已失效',
        icon: status === 'accepted' ? 'success' : 'none'
      })
    } catch (error) {
      if (this.alive) {
        if (changed) showError(null, '申请已处理，列表刷新失败，请下拉重试')
        else showError(error, '处理申请失败，请稍后重试')
      }
    } finally {
      if (this.alive) this.setData({ syncing: false })
    }
  },
  removeFriend(event: ActionEvent) {
    if (this.data.syncing) return
    const uid = String(event.currentTarget.dataset.uid || '')
    const target = this.data.friends.find((item) => item.uid === uid)
    if (!target) return
    wx.showModal({
      title: '解除好友',
      content: `确定要解除与 ${target.displayName} 的好友关系吗？`,
      confirmColor: '#6f63ff',
      success: async (result) => {
        if (!result.confirm || !this.alive || this.data.syncing) return
        this.setData({ syncing: true })
        let removed = false
        try {
          await removeFriend(uid, target.relationshipId)
          removed = true
          this.aliases = this.aliases.filter((item: FriendProfile) => item.uid !== uid)
          saveFriends(this.aliases)
          if (this.alive) this.setData({ friends: this.data.friends.filter((item) => item.uid !== uid) })
          await this.refreshOverview()
          if (this.alive) wx.showToast({ title: '已解除好友关系', icon: 'none' })
        } catch (error) {
          if (this.alive) {
            if (removed) showError(null, '已解除好友，列表刷新失败，请下拉重试')
            else showError(error, '解除好友失败，请稍后重试')
          }
        } finally {
          if (this.alive) this.setData({ syncing: false })
        }
      }
    })
  }
})
