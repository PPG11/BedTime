import { fetchOwnGoodnightMessage, fetchGoodnightReward, submitGoodnightMessage, voteGoodnightMessage } from '../../services/index'
import { GOODNIGHT_MESSAGE_MAX_LENGTH, type GoodnightMessage, type GoodnightVoteType } from '../../types/goodnight'

export type MessageView = Pick<GoodnightMessage, '_id' | 'content' | 'likes' | 'dislikes'>
type Context = { uid: string; date: string; checkedIn: boolean; rewardId: string }
const messageView = (message: GoodnightMessage | null): MessageView | null => message
  ? { _id: message._id, content: message.content, likes: message.likes, dislikes: message.dislikes } : null

export function initialGoodnightView() {
  return {
    goodnightInput: '',
    remainingCharacters: GOODNIGHT_MESSAGE_MAX_LENGTH,
    maxLength: GOODNIGHT_MESSAGE_MAX_LENGTH,
    hasSubmitted: false,
    isSubmitting: false,
    submittedMessage: null as MessageView | null,
    rewardMessage: null as MessageView | null,
    modalVisible: false,
    modalMessage: null as MessageView | null,
    hasVoted: false,
    isVoting: false,
    goodnightError: ''
  }
}
type GoodnightView = ReturnType<typeof initialGoodnightView>

/** Owns asynchronous heart-message work for one page instance and one nightly cycle. */
export class GoodnightController {
  private context: Context = { uid: '', date: '', checkedIn: false, rewardId: '' }
  private generation = 0
  private disposed = false
  private submittedLoaded = false
  private submittedLoading = false
  private submittedRevision = 0
  private rewardLoaded = false
  private rewardRevision = 0
  private rewardLoading: Promise<GoodnightMessage | null> | null = null
  private reward: GoodnightMessage | null = null
  private view = initialGoodnightView()

  constructor(private readonly render: (patch: Partial<GoodnightView>) => void) {}

  private update(patch: Partial<GoodnightView>) {
    if (this.disposed) return
    this.view = { ...this.view, ...patch }
    this.render(patch)
  }

  private isCurrent(generation: number) {
    return !this.disposed && generation === this.generation
  }

  sync(context: Context, force = false) {
    const changed = context.uid !== this.context.uid || context.date !== this.context.date
    const rewardChanged = context.rewardId !== this.context.rewardId
    if (changed) {
      this.generation += 1
      this.submittedRevision += 1
      this.submittedLoading = false
      this.submittedLoaded = false
      this.rewardLoading = null
      this.rewardLoaded = false
      this.reward = null
      this.update(initialGoodnightView())
    }
    this.context = context
    if (!context.uid) return
    if (force) this.submittedLoaded = false
    if (!this.submittedLoaded && !this.submittedLoading) void this.loadSubmitted()
    if (rewardChanged) {
      this.rewardRevision += 1
      this.rewardLoaded = false
      this.rewardLoading = null
      this.reward = null
      this.update({ rewardMessage: null, modalMessage: null, modalVisible: false, hasVoted: false })
    }
    if (context.checkedIn && (!this.rewardLoaded || force)) void this.loadReward()
  }

  setInput(value: string) {
    if (this.view.hasSubmitted || this.view.isSubmitting) return
    this.update({ goodnightInput: value, remainingCharacters: Math.max(0, GOODNIGHT_MESSAGE_MAX_LENGTH - value.length) })
  }

  private async loadSubmitted() {
    const generation = this.generation
    const revision = this.submittedRevision
    const { date } = this.context
    this.submittedLoading = true
    try {
      const message = await fetchOwnGoodnightMessage(date)
      if (!this.isCurrent(generation) || revision !== this.submittedRevision) return
      this.submittedLoaded = true
      this.update({
        submittedMessage: messageView(message) || this.view.submittedMessage,
        hasSubmitted: Boolean(message) || this.view.hasSubmitted, goodnightError: '',
        ...(message ? { goodnightInput: message.content, remainingCharacters: Math.max(0, GOODNIGHT_MESSAGE_MAX_LENGTH - message.content.length) } : {})
      })
    } catch (error) {
      if (this.isCurrent(generation)) this.update({ goodnightError: '晚安心语暂未加载成功，可下拉重试。' })
      console.warn('加载晚安心语失败', error)
    } finally {
      if (this.isCurrent(generation)) this.submittedLoading = false
    }
  }

  private loadReward(): Promise<GoodnightMessage | null> {
    if (this.rewardLoading) return this.rewardLoading
    const generation = this.generation
    const revision = this.rewardRevision
    const context = { ...this.context }
    if (!context.rewardId) {
      this.rewardLoaded = true
      return Promise.resolve(null)
    }
    const task = (async () => {
      try {
        const message = await fetchGoodnightReward(context.date)
        if (!this.isCurrent(generation) || revision !== this.rewardRevision) return null
        this.rewardLoaded = true
        this.reward = message
        this.update({ rewardMessage: messageView(message), hasVoted: Boolean(message?.voted) })
        return message
      } catch (error) {
        console.warn('恢复今日晚安心语失败', error)
        return null
      } finally {
        if (this.isCurrent(generation) && revision === this.rewardRevision) this.rewardLoading = null
      }
    })()
    this.rewardLoading = task
    return task
  }

  async presentReward() {
    const generation = this.generation
    const revision = this.rewardRevision
    if (!this.context.checkedIn || !this.context.rewardId) return
    const message = await this.loadReward()
    if (!message || !this.isCurrent(generation) || revision !== this.rewardRevision) return
    this.update({ modalMessage: messageView(message), modalVisible: true })
  }

  openReward() {
    if (!this.reward) return
    this.update({ modalVisible: true, modalMessage: messageView(this.reward) })
  }

  closeModal() { this.update({ modalVisible: false }) }

  async submit() {
    if (this.view.isSubmitting || this.view.hasSubmitted) return
    const text = this.view.goodnightInput.trim()
    if (!text || text.length > GOODNIGHT_MESSAGE_MAX_LENGTH) {
      wx.showToast({ title: !text ? '请写下一句晚安心语' : `最多 ${GOODNIGHT_MESSAGE_MAX_LENGTH} 字`, icon: 'none' })
      return
    }
    const { uid, date } = this.context
    if (!uid) {
      wx.showToast({ title: '请等待用户信息加载后重试', icon: 'none' })
      return
    }
    const generation = this.generation
    this.submittedRevision += 1
    this.update({ isSubmitting: true })
    try {
      const message = await submitGoodnightMessage(date, text)
      if (!this.isCurrent(generation)) return
      this.submittedLoaded = true
      this.update({ submittedMessage: messageView(message), hasSubmitted: true, goodnightInput: message.content, goodnightError: '' })
      wx.showToast({ title: '已送出晚安心语', icon: 'success' })
    } catch (error) {
      if (!this.isCurrent(generation)) return
      wx.showToast({ title: error instanceof Error ? error.message : '提交失败，请稍后再试', icon: 'none' })
    } finally {
      if (this.isCurrent(generation)) this.update({ isSubmitting: false })
    }
  }

  async vote(vote: GoodnightVoteType) {
    if (!this.reward || this.view.hasVoted || this.view.isVoting) return
    const generation = this.generation
    const id = this.reward._id
    this.update({ isVoting: true })
    try {
      const updated = await voteGoodnightMessage(this.context.date, vote)
      if (!this.isCurrent(generation) || id !== this.reward?._id) return
      this.reward = updated
      this.update({ modalMessage: messageView(updated), rewardMessage: messageView(updated), hasVoted: true })
      wx.showToast({ title: vote === 'like' ? '已点赞' : '已收到反馈', icon: 'success' })
    } catch (error) {
      if (this.isCurrent(generation)) wx.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
      console.error('晚安心语投票失败', error)
    } finally {
      if (this.isCurrent(generation)) this.update({ isVoting: false })
    }
  }

  dispose() { this.disposed = true; this.generation += 1 }
}
