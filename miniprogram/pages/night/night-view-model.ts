import type { NightStoreState } from '../../state/create-night-store'
import { formatConfirmedAt, formatNight } from '../../utils/night-time'
import type { NightInteraction } from './night-controller'

export function createNightView(state: NightStoreState, view: NightInteraction) {
  const snapshot = state.snapshot
  const ready = state.status === 'ready' && !state.stale
  const isUnknown = view.interaction === 'unknown'
  const pendingCurrent = !!snapshot && state.pendingNightId === snapshot.nightId
  const canClose = ready && snapshot?.phase === 'open' && !snapshot.record && !pendingCurrent
  const busy = ['submitting', 'unknown'].includes(view.interaction) || view.immersive
  const currentRecord = snapshot?.record || null
  const receipt = view.demo || isUnknown ? null : currentRecord || (!canClose ? snapshot?.lastRecord || null : null)
  const stateText = view.demo ? '灯还亮着。' : isUnknown ? '暂时没确认。' : view.interaction === 'submitting' ? '正在确认'
    : currentRecord ? '这一晚已经关灯。' : !ready ? state.status === 'loading' ? '正在确认今晚状态' : '暂时无法确认'
    : pendingCurrent ? '上次结果待确认。' : snapshot?.phase === 'before' ? '今晚 20:00 可以关灯。'
    : snapshot?.phase === 'closed' ? '这一晚已经结束。' : '灯还亮着。'
  const notice = view.notice || (!ready ? state.error : '')
  const showDemo = ready && snapshot?.phase !== 'open' && !pendingCurrent && !busy && !view.demo
  return {
    ...view, stateText, notice, canPress: !busy && (view.demo || canClose),
    reduceMotion: snapshot?.prefs.reduceMotion || false,
    isUnknown, pendingCurrent, hasPending: !!state.pendingNightId,
    canClose: !!canClose, ready, loading: state.status === 'loading',
    showDemo, demoPrimary: showDemo && !currentRecord,
    extinguished: view.immersive || (!view.demo && !!currentRecord), done: view.interaction === 'done',
    buttonText: view.interaction === 'submitting' ? '正在确认' : '按住关灯',
    hasReceipt: !!receipt, currentReceipt: !!currentRecord,
    receiptNightId: receipt?.nightId || '',
    receiptNight: receipt ? formatNight(receipt.nightId) : '', receiptPhrase: receipt?.phraseText || '',
    receiptTime: receipt ? formatConfirmedAt(receipt.confirmedAt) : '', staleReceipt: !!receipt && state.stale,
    subtext: view.demo || canClose ? '准备结束今天时，来关一次灯。'
      : state.status === 'loading' ? '正在读取，请稍候。'
      : !ready ? '' : pendingCurrent ? '可以查看上次关灯的结果。'
      : snapshot?.phase === 'closed' ? '今晚 20:00 再见。' : '现在可以先看一次演示。'
  }
}
