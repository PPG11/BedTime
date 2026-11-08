import { nightStore } from '../../state/night-store'
import { reminderApi } from '../../services/reminder'
import { CloudError } from '../../services/cloud'
import { restoreTabBar } from '../../utils/night-platform'
import { formatReminderAt, nextReminderChoice, quickReminderTime, REMINDER_STATUS_TEXT, validReminderTime } from '../../utils/night-reminder'
import type { ReminderReply, ReminderSchedule } from '../../types/reminder'

Page({
  visible: false, generation: 0, loadedAt: 0,
  state: null as ReminderReply | null,
  pending: null as { userId: string; input: ReminderSchedule } | null,
  data: { loading: true, enabled: false, busy: false, testing: false, testEnds: '', notice: '', time: '22:30', target: '', targetNightId: '', targetAt: 0,
    scheduledAt: '', statusText: '', canSchedule: false, canCancel: false, unknown: false, canRetry: false },
  onShow() { this.visible = true; restoreTabBar(); void this.reload() },
  onHide() { this.deactivate() },
  onUnload() { this.deactivate() },
  deactivate() { if (this.visible) { this.visible = false; this.generation++; nightStore.hide() } },
  isCurrent(generation: number, userId: string) {
    return this.visible && generation === this.generation && nightStore.get().snapshot?.userId === userId
  },
  applyState(state: ReminderReply) {
    this.state = state; this.loadedAt = Date.now()
    if (this.pending && (this.pending.userId !== state.userId || state.reminder?.requestId === this.pending.input.requestId || (state.reminder?.revision || 0) !== this.pending.input.revision)) this.pending = null
    const reminder = state.reminder
    const active = reminder?.status === 'pending' || reminder?.status === 'sending'
    const testing = Boolean(state.testUntil && state.testUntil > state.serverNow)
    if (testing && !active && !this.pending) this.setData({ time: quickReminderTime(state.serverNow) })
    this.setData({ loading: false, busy: false, enabled: state.enabled, scheduledAt: reminder ? formatReminderAt(reminder.dueAt) : '',
      testing, testEnds: state.testUntil ? formatReminderAt(state.testUntil) : '',
      statusText: reminder ? REMINDER_STATUS_TEXT[reminder.status] : '', canCancel: reminder?.status === 'pending',
      canSchedule: state.enabled && !active && !this.pending, unknown: Boolean(this.pending), canRetry: Boolean(this.pending) && !active })
    this.updateTarget()
  },
  updateTarget() {
    if (!this.state) return
    const now = this.state.serverNow + Math.max(0, Date.now() - this.loadedAt)
    const testing = Boolean(this.state.testUntil && this.state.testUntil > now)
    const choice = nextReminderChoice(now, this.data.time, testing ? null : nightStore.get().snapshot?.record?.nightId || null, this.state.lastAttemptNightId)
    const allowed = choice && (!testing || choice.dueAt < this.state.testUntil!) ? choice : null
    this.setData({ testing, target: allowed ? formatReminderAt(allowed.dueAt) : '', targetNightId: allowed?.nightId || '', targetAt: allowed?.dueAt || 0 })
  },
  async reload() {
    const generation = ++this.generation
    this.state = null
    this.setData({ loading: true, busy: false, enabled: false, testing: false, canSchedule: false, canCancel: false, canRetry: false, unknown: false, notice: '', scheduledAt: '', statusText: '', target: '' })
    try {
      if (!await nightStore.activate()) throw new Error('identity unavailable')
      const userId = nightStore.get().snapshot?.userId
      if (!userId || !this.isCurrent(generation, userId)) return
      const result = await reminderApi.get()
      if (!this.isCurrent(generation, userId)) return
      if (result.userId !== userId) throw new Error('identity changed')
      this.applyState(result)
      if (this.pending) this.setData({ notice: '这次安排还未确认。可以再次查看，或重试同一次安排。' })
    } catch { if (this.visible && generation === this.generation) this.setData({ loading: false, notice: '暂时无法读取提醒安排，请重试。' }) }
  },
  onTimeChange(event: WechatMiniprogram.PickerChange) {
    if (this.data.busy || !this.data.canSchedule) return
    const time = String(event.detail.value)
    if (!validReminderTime(time)) { this.setData({ notice: '请选择 20:00—次日 05:59 之间的时间。' }); return }
    this.setData({ time, notice: '' }); this.updateTarget()
  },
  async onSubscribe() {
    const state = this.state
    if (!this.visible || !state?.enabled || !state.templateId || !this.data.canSchedule || this.data.busy || !this.data.targetAt) return
    const generation = this.generation, userId = state.userId
    if (!this.isCurrent(generation, userId)) return
    if (this.data.targetAt < state.serverNow + Math.max(0, Date.now() - this.loadedAt) + 60000) {
      this.updateTarget(); this.setData({ notice: '时间已接近，请确认新的提醒日期后再订阅。' }); return
    }
    const input: ReminderSchedule = { requestId: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14).padEnd(12, '0')}`,
      revision: state.reminder?.revision || 0, nightId: this.data.targetNightId, time: this.data.time, templateId: state.templateId }
    this.setData({ busy: true, notice: '' })
    try {
      // Invoke directly in the tap handler, before any asynchronous server call.
      const consent = await new Promise<WechatMiniprogram.RequestSubscribeMessageSuccessCallbackResult>((resolve, reject) => wx.requestSubscribeMessage({ tmplIds: [state.templateId!], success: resolve, fail: reject }))
      if (!this.isCurrent(generation, userId)) return
      if (consent[state.templateId] !== 'accept') {
        this.setData({ busy: false, notice: '没有订阅，这次不会安排提醒。你仍然可以正常关灯。' }); return
      }
      this.pending = { userId, input }
      await this.savePending(generation)
    } catch {
      if (this.isCurrent(generation, userId)) this.setData({ busy: false, notice: '订阅没有完成，可以稍后再试。' })
    }
  },
  async savePending(generation: number) {
    const pending = this.pending
    if (!pending || !this.isCurrent(generation, pending.userId)) return
    this.setData({ busy: true, canSchedule: false, canRetry: false, notice: '' })
    try {
      const result = await reminderApi.schedule(pending.input)
      if (!this.isCurrent(generation, pending.userId)) return
      if (result.userId !== pending.userId) throw new Error('identity changed')
      this.applyState(result)
    } catch (error) {
      if (!this.isCurrent(generation, pending.userId)) return
      const definite = error instanceof CloudError && /^(REMINDER_|INVALID_ARG|UNAUTHORIZED)/.test(error.code)
      if (definite) this.pending = null
      this.setData({ busy: false, unknown: !definite, canRetry: !definite, canSchedule: false,
        notice: definite ? `${(error as Error).message} 请重新读取安排。` : '安排尚未确认，请查看结果。重试会沿用同一次安排。' })
    }
  },
  onRetrySchedule() { if (!this.data.busy) void this.savePending(this.generation) },
  async onCancel() {
    const state = this.state, reminder = state?.reminder
    if (!state || !reminder || !this.visible || this.data.busy || !this.data.canCancel || !this.isCurrent(this.generation, state.userId)) return
    const generation = this.generation
    this.setData({ busy: true, notice: '' })
    try {
      const result = await reminderApi.cancel(reminder.requestId, reminder.revision)
      if (!this.isCurrent(generation, state.userId)) return
      if (result.userId !== state.userId) throw new Error('identity changed')
      this.applyState(result)
    } catch {
      if (this.isCurrent(generation, state.userId)) this.setData({ busy: false, canSchedule: false, notice: '取消尚未确认，请重新读取安排；在确认取消前，仍可能收到提醒。' })
    }
  },
  onReload() { if (!this.data.busy) void this.reload() }
})
