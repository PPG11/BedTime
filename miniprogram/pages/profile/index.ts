import type { UserUpsertPayload } from '../../services/index'
import { getAppData, refreshAppData, subscribeAppData, updateProfile } from '../../state/app-data'
import { DEFAULT_SLEEP_MINUTE, DEFAULT_USER_NAME } from '../../utils/storage'
import { formatMinutesToTime, parseTimeStringToMinutes } from '../../utils/time'
import { getShareAppMessageOptions, getShareTimelineOptions, showPageShareMenu } from '../../utils/share'

type InputEvent = WechatMiniprogram.CustomEvent<{ value: string }>

Page({
  data: {
    uid: '',
    nameDraft: DEFAULT_USER_NAME,
    targetTimeText: '22:30',
    syncing: false,
    error: '',
    tips: [
      'UID 由云端生成并与微信账号关联，用于好友互相添加。',
      '目标入睡时间会影响打卡窗口与统计，请保持与你的作息一致。'
    ]
  },
  alive: false,
  editingName: false,
  unsubscribe: null as (() => void) | null,
  pendingPatch: {} as UserUpsertPayload,
  savingTask: null as Promise<void> | null,

  onLoad() {
    showPageShareMenu()
    this.alive = true
    this.unsubscribe = subscribeAppData(() => this.syncView())
    this.syncView()
  },
  onShow() {
    if (!getAppData().user && !getAppData().loading) void refreshAppData().catch(() => this.syncView())
    this.syncView()
  },
  onUnload() {
    this.alive = false
    this.unsubscribe?.()
    this.unsubscribe = null
  },
  async onPullDownRefresh() {
    try {
      if (!this.savingTask) await refreshAppData()
    } catch (error) {
      console.warn('刷新资料失败', error)
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  onShareAppMessage() {
    return getShareAppMessageOptions(this.data.uid)
  },
  onShareTimeline() {
    return getShareTimelineOptions(this.data.uid)
  },
  syncView() {
    if (!this.alive) return
    const state = getAppData()
    this.setData({
      uid: state.user?.uid ?? '',
      ...(!this.savingTask ? { targetTimeText: formatMinutesToTime(state.settings.targetSleepMinute) } : {}),
      error: state.error ?? '',
      ...(!this.editingName && !this.savingTask ? { nameDraft: state.settings.name || DEFAULT_USER_NAME } : {})
    })
  },
  onNameFocus() {
    this.editingName = true
  },
  onNameInput(event: InputEvent) {
    this.setData({ nameDraft: event.detail.value })
  },
  onNameBlur(event: InputEvent) {
    this.editingName = false
    const nickname = event.detail.value.trim() || DEFAULT_USER_NAME
    this.setData({ nameDraft: nickname })
    if (nickname !== getAppData().settings.name || this.savingTask) void this.savePatch({ nickname })
  },
  onTargetTimeChange(event: InputEvent) {
    const minutes = parseTimeStringToMinutes(event.detail.value, DEFAULT_SLEEP_MINUTE)
    if (minutes === getAppData().settings.targetSleepMinute && !this.savingTask) return
    const targetHM = formatMinutesToTime(minutes)
    this.setData({ targetTimeText: targetHM })
    void this.savePatch({ targetHM })
  },
  savePatch(patch: UserUpsertPayload): Promise<void> {
    if (!getAppData().user) {
      wx.showToast({ title: '未获取到用户信息，请稍后重试', icon: 'none' })
      this.syncView()
      return Promise.resolve()
    }
    // Blur and picker changes can arrive together; serialize their writes.
    this.pendingPatch = { ...this.pendingPatch, ...patch }
    if (this.savingTask) return this.savingTask
    this.setData({ syncing: true })
    const task = this.flushPatches().finally(() => {
      this.savingTask = null
      if (this.alive) {
        this.setData({ syncing: false })
        this.syncView()
      }
    })
    this.savingTask = task
    return task
  },
  async flushPatches() {
    let failed = false
    while (Object.keys(this.pendingPatch).length) {
      const patch = this.pendingPatch
      this.pendingPatch = {}
      try {
        await updateProfile(patch)
      } catch (error) {
        failed = true
        console.warn('保存个人偏好失败', error)
        if (this.alive) wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
        // A server write may have succeeded before the response was lost.
        await refreshAppData().catch(() => undefined)
      }
    }
    if (!failed && this.alive) wx.showToast({ title: '修改成功', icon: 'success', duration: 800 })
  },
  copyUid() {
    if (!this.data.uid) {
      wx.showToast({ title: 'UID 加载中，请稍候', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: this.data.uid,
      fail: () => wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' })
    })
  },
  async retry() {
    await refreshAppData().catch(() => this.syncView())
  }
})
