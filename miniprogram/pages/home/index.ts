import { getAppData, subscribeAppData, refreshAppData, patchCheckins } from '../../state/app-data'
import { CloudError, submitCheckinRecord } from '../../services/index'
import type { GoodnightVoteType } from '../../types/goodnight'
import { getShareAppMessageOptions, getShareTimelineOptions, showPageShareMenu } from '../../utils/share'
import { createHomeView } from './view-model'
import { GoodnightController, initialGoodnightView } from './goodnight-controller'

const initialData = {
  ...createHomeView(getAppData(), new Date()),
  ...initialGoodnightView(),
  isSyncing: false,
  sleepTips: [
    '睡前 1 小时放下电子设备，让大脑慢慢放松。',
    '保持卧室安静、昏暗和舒适，营造入睡氛围。',
    '建立固定的睡前仪式，例如阅读或轻度伸展。'
  ]
}
type HomeData = typeof initialData
type HomeMethods = {
  controller: GoodnightController | null
  unsubscribe: (() => void) | null
  timer: ReturnType<typeof setInterval> | null
  lastRefresh: number
  previousDate: string
  disposed: boolean
  renderView(): void
  requestRefresh(force?: boolean): Promise<void>
  stopTimer(): void
  onCheckin(): Promise<void>
  onGoodnightInput(event: WechatMiniprogram.Input): void
  onSubmitGoodnight(): void
  onOpenReward(): void
  onCloseReward(): void
  onVote(event: WechatMiniprogram.TouchEvent): void
  onRetry(): void
  preventTouchMove(): void
}

Page<HomeData, HomeMethods>({
  data: initialData,
  controller: null,
  unsubscribe: null,
  timer: null,
  lastRefresh: 0,
  previousDate: '',
  disposed: false,

  onLoad() {
    showPageShareMenu()
    this.disposed = false
    this.controller = new GoodnightController(patch => {
      if (!this.disposed) this.setData(patch)
    })
    this.unsubscribe = subscribeAppData(() => this.renderView())
    this.renderView()
  },

  onShow() {
    this.renderView()
    void this.requestRefresh()
    if (!this.timer) this.timer = setInterval(() => this.renderView(), 60_000)
  },

  onHide() { this.stopTimer() },

  onUnload() {
    this.disposed = true
    this.stopTimer()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.controller?.dispose()
    this.controller = null
  },

  async onPullDownRefresh() {
    try {
      await this.requestRefresh(true)
      this.controller?.sync({ uid: this.data.uid, date: this.data.todayKey, checkedIn: this.data.checkedIn, rewardId: this.data.goodnightId }, true)
    } finally { wx.stopPullDownRefresh() }
  },

  onShareAppMessage() { return getShareAppMessageOptions(getAppData().user?.uid) },
  onShareTimeline() { return getShareTimelineOptions(getAppData().user?.uid) },

  renderView() {
    if (this.disposed) return
    const view = createHomeView(getAppData(), new Date())
    const cycleChanged = this.previousDate && this.previousDate !== view.todayKey
    this.previousDate = view.todayKey
    this.setData(view)
    this.controller?.sync({ uid: view.uid, date: view.todayKey, checkedIn: view.checkedIn, rewardId: view.goodnightId })
    if (cycleChanged) void this.requestRefresh(true)
  },

  async requestRefresh(force = false) {
    if (!force && Date.now() - this.lastRefresh < 30_000) return
    this.lastRefresh = Date.now()
    await refreshAppData()
  },

  stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  },

  async onCheckin() {
    if (this.data.isSyncing) return
    const snapshot = getAppData()
    const view = createHomeView(snapshot, new Date())
    if (!snapshot.ready || !snapshot.user) {
      wx.showToast({ title: '请等待用户信息加载后重试', icon: 'none' })
      return
    }
    if (view.checkedIn || !view.windowOpen) {
      wx.showToast({ title: view.checkedIn ? '今天已经打过卡了' : '不在打卡时间段内', icon: 'none' })
      return
    }
    this.setData({ isSyncing: true })
    try {
      const result = await submitCheckinRecord(view.todayKey)
      if (getAppData().user?.uid !== snapshot.user.uid) return
      patchCheckins(result.document)
      if (!this.disposed) {
        wx.showToast({ title: result.created ? '打卡成功，早睡加油！' : '今天已经打过卡了', icon: result.created ? 'success' : 'none' })
        if (result.created && this.data.todayKey === result.document.date) await this.controller?.presentReward()
      }
    } catch (error) {
      if (error instanceof CloudError && (error.code === 'CYCLE_CHANGED' || error.code === 'WINDOW_CLOSED')) void this.requestRefresh(true)
      console.error('云端打卡失败', error)
      if (!this.disposed) wx.showToast({ title: error instanceof Error ? error.message : '云端打卡失败，请稍后重试', icon: 'none' })
    } finally {
      if (!this.disposed) this.setData({ isSyncing: false })
    }
  },

  onGoodnightInput(event) { this.controller?.setInput(event.detail.value) },
  onSubmitGoodnight() {
    this.renderView()
    void this.controller?.submit()
  },
  onOpenReward() { this.controller?.openReward() },
  onCloseReward() { this.controller?.closeModal() },
  onVote(event) {
    const vote = event.currentTarget.dataset.vote as GoodnightVoteType
    if (vote === 'like' || vote === 'dislike') void this.controller?.vote(vote)
  },
  onRetry() { void this.requestRefresh(true) },
  preventTouchMove() {}
})
