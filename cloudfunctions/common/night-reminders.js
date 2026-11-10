const { requireValue } = require('./errors')
const { DAY, isNightId, nightDay, resolveNight } = require('./night-time')
const { transact } = require('./night-transaction')
const { createHash } = require('node:crypto')

const MINUTE = 60000
const MAX_DELAY = 5 * MINUTE
const PAGE = 'pages/night/index'
const REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/
const ACTIVE = ['pending', 'sending']
const STATUSES = [...ACTIVE, 'sent', 'cancelled', 'skipped', 'expired', 'failed', 'unknown']
const configured = require('./night-reminder-config')

// A deployment-only, account-bound permit. Never accept this from client input.
function quickTestUntil(uid, now, config) {
  const permit = config.quickTest
  return permit && Number.isSafeInteger(permit.until) && now < permit.until && now >= permit.until - 30 * MINUTE &&
    permit.userHash === createHash('sha256').update(uid).digest('hex') ? permit.until : null
}

function validTime(time) {
  return typeof time === 'string' && /^(?:2[0-3]|0[0-5]):[0-5]\d$/.test(time)
}
function dueAtFor(nightId, time) {
  const [hour, minute] = time.split(':').map(Number)
  return nightDay(nightId) + ((hour < 6 ? hour + 24 : hour) - 8) * 3600000 + minute * MINUTE
}
function nextNight(nightId) {
  return new Date(nightDay(nightId) + DAY).toISOString().slice(0, 10).replaceAll('-', '')
}
function hasStoredReminder(reminder) {
  return Boolean(reminder && typeof reminder === 'object' && !Array.isArray(reminder) &&
    typeof reminder.requestId === 'string' && REQUEST_ID.test(reminder.requestId) && Number.isSafeInteger(reminder.revision) && reminder.revision >= 1 &&
    isNightId(reminder.nightId) && validTime(reminder.time) && reminder.dueAt === dueAtFor(reminder.nightId, reminder.time) && STATUSES.includes(reminder.status))
}
function validateConfig(config) {
  if (!config.enabled) return false
  requireValue(typeof config.templateId === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(config.templateId) &&
    ['formal', 'trial', 'developer'].includes(config.miniprogramState) && Array.isArray(config.fields) && config.fields.length >= 1 && config.fields.length <= 5,
  'INTERNAL', '提醒配置无效')
  const keys = new Set()
  for (const field of config.fields) {
    requireValue(field && typeof field.key === 'string' && !keys.has(field.key) &&
      ((/^thing\d+$/.test(field.key) && typeof field.text === 'string' && Array.from(field.text).length > 0 && Array.from(field.text).length <= 20 && field.source === undefined) ||
       (/^(?:time|date)\d+$/.test(field.key) && field.source === 'dueAt' && field.text === undefined)), 'INTERNAL', '提醒模板字段无效')
    keys.add(field.key)
  }
  return true
}
function validateReminderRequest(event) {
  if (event.action === 'getReminder') return
  requireValue(typeof event.requestId === 'string' && REQUEST_ID.test(event.requestId) && Number.isSafeInteger(event.revision) && event.revision >= 0, 'INVALID_ARG', '提醒参数无效')
  if (event.action === 'scheduleReminder') {
    requireValue(isNightId(event.nightId) && validTime(event.time) && typeof event.templateId === 'string' && event.templateId.length <= 128, 'INVALID_ARG', '提醒时间无效')
  }
}
function projectReminder(reminder, now) {
  if (!reminder) return null
  const { requestId, revision, nightId, time, dueAt } = reminder
  let status = reminder.status
  if (status === 'sending' && now - reminder.attemptedAt >= MAX_DELAY) status = 'unknown'
  if (status === 'pending' && now >= dueAt + MAX_DELAY) status = 'expired'
  return { requestId, revision, nightId, time, dueAt, status }
}
function createReminderActions({ now = () => Date.now(), config = configured, readUser, newUser }) {
  const reply = (uid, user) => {
    const serverNow = now()
    // Configuration can stop new bookings without locking an existing owner
    // out of reading or cancelling their reservation.
    let enabled = false
    try { enabled = validateConfig(config) } catch { /* Existing reservations remain manageable. */ }
    return { serverNow, userId: uid, enabled, templateId: enabled ? config.templateId : null, testUntil: enabled ? quickTestUntil(uid, serverNow, config) : null,
      reminder: projectReminder(user?.reminder, serverNow), lastAttemptNightId: user?.reminderLastAttemptNightId || null }
  }
  return {
    async getReminder(db, uid) { return reply(uid, await readUser(db, uid)) },
    async scheduleReminder(db, uid, event) {
      requireValue(validateConfig(config) && event.templateId === config.templateId, 'REMINDER_UNAVAILABLE', '提醒暂未开放，请稍后再试。')
      return transact(db, async tx => {
        const user = await readUser(tx, uid)
        const previous = user?.reminder
        // The same operation never resurrects a cancelled/sent reminder.
        if (previous?.requestId === event.requestId) {
          requireValue(previous.nightId === event.nightId && previous.time === event.time, 'INVALID_ARG', '同一预约不能更改时间')
          return reply(uid, user)
        }
        requireValue((previous?.revision || 0) === event.revision, 'REMINDER_CHANGED', '提醒安排已变化，请重新读取。')
        const serverNow = now(), rules = resolveNight(serverNow)
        const previousActive = previous && ACTIVE.includes(projectReminder(previous, serverNow).status)
        requireValue(!previousActive, 'REMINDER_EXISTS', '已有一条提醒，请先取消后再安排。')
        requireValue(event.nightId === rules.nightId || event.nightId === nextNight(rules.nightId), 'INVALID_ARG', '只能安排最近的一个夜晚')
        const dueAt = dueAtFor(event.nightId, event.time)
        requireValue(dueAt >= serverNow + MINUTE, 'REMINDER_TIME_PASSED', '时间已接近，请重新选择。')
        const testUntil = quickTestUntil(uid, serverNow, config)
        const testMode = Boolean(testUntil && event.nightId === rules.nightId && dueAt < testUntil)
        requireValue(!user?.reminderLastAttemptNightId || event.nightId > user.reminderLastAttemptNightId, 'REMINDER_ALREADY_ATTEMPTED', '这个夜晚已经尝试提醒，请选择下一晚。')
        const record = (await tx.collection('n_nights').doc(`${uid}_${event.nightId}`).get()).data
        requireValue(!record || testMode, 'REMINDER_NIGHT_DONE', '这个夜晚已经关灯，请选择下一晚。')
        const reminder = { requestId: event.requestId, revision: event.revision + 1, nightId: event.nightId, time: event.time,
          dueAt, status: 'pending', templateId: config.templateId, createdAt: serverNow, ...(testMode ? { testMode: true } : {}) }
        if (user) await tx.collection('n_users').doc(uid).update({ data: { reminder, updatedAt: serverNow } })
        else await tx.collection('n_users').doc(uid).set({ data: { ...newUser(uid, serverNow), reminder } })
        return reply(uid, { ...user, reminder })
      })
    },
    async cancelReminder(db, uid, event) {
      return transact(db, async tx => {
        const user = await readUser(tx, uid), previous = user?.reminder
        requireValue(previous?.requestId === event.requestId, 'REMINDER_CHANGED', '提醒安排已变化，请重新读取。')
        if (previous.status === 'cancelled') return reply(uid, user)
        requireValue(previous.revision === event.revision, 'REMINDER_CHANGED', '提醒安排已变化，请重新读取。')
        requireValue(previous.status === 'pending', 'REMINDER_TOO_LATE', '这条提醒已开始处理，无法撤回，请查看最新状态。')
        const serverNow = now(), reminder = { ...previous, revision: previous.revision + 1, status: 'cancelled', finishedAt: serverNow }
        await tx.collection('n_users').doc(uid).update({ data: { reminder, updatedAt: serverNow } })
        return reply(uid, { ...user, reminder })
      })
    }
  }
}

function messageFor(uid, reminder, config) {
  const dateTime = new Date(reminder.dueAt + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
  const data = Object.fromEntries(config.fields.map(field => [field.key, { value: field.source === 'dueAt' ? (field.key.startsWith('date') ? dateTime.slice(0, 10) : dateTime) : reminder.testMode ? '这是一条测试提醒，今天先到这里。' : field.text }]))
  return { touser: uid, templateId: config.templateId, page: PAGE, miniprogramState: reminder.testMode ? 'developer' : config.miniprogramState, lang: 'zh_CN', data }
}

/** Claim before the external send. A claim is never retried, even after a crash. */
async function dispatchReminders(db, { now = () => Date.now(), config = configured, send, limit = 10, sendTimeoutMs = 6000 } = {}) {
  if (!validateConfig(config)) return { disabled: true, checked: 0 }
  requireValue(Number.isInteger(limit) && limit > 0 && limit <= 20 && typeof send === 'function' && Number.isInteger(sendTimeoutMs) && sendTimeoutMs > 0 && sendTimeoutMs <= 8000, 'INTERNAL', '发送配置无效')
  const rows = (await db.collection('n_users').where({ 'reminder.status': 'pending', 'reminder.dueAt': db.command.lt(now() + 1) })
    .orderBy('reminder.dueAt', 'asc').limit(limit).field({ _id: true, uid: true }).get()).data
  const counts = { checked: rows.length, sent: 0, skipped: 0, expired: 0, failed: 0, unknown: 0 }
  // Small bounded batches keep one invocation short; overlapping timer runs use
  // transactions to claim different users safely, with no second send per night.
  await Promise.all(rows.map(async row => {
    if (row._id !== row.uid) return
    let claimed
    try {
      claimed = await transact(db, async tx => {
        const user = (await tx.collection('n_users').doc(row.uid).get()).data
        const reminder = user?.reminder, at = now()
        if (!user || user.uid !== row.uid || reminder?.status !== 'pending' || reminder.dueAt > at) return null
        const record = (await tx.collection('n_nights').doc(`${row.uid}_${reminder.nightId}`).get()).data
        const rules = resolveNight(at)
        const testAllowed = reminder.testMode === true && Boolean(quickTestUntil(row.uid, at, config))
        let status = 'sending'
        if (at >= reminder.dueAt + MAX_DELAY || rules.nightId !== reminder.nightId || rules.phase !== 'open') status = 'expired'
        else if ((record && !testAllowed) || (reminder.testMode && !testAllowed) || (user.reminderLastAttemptNightId && user.reminderLastAttemptNightId >= reminder.nightId)) status = 'skipped'
        else if (reminder.templateId !== config.templateId) status = 'failed'
        const updated = { ...reminder, status, ...(status === 'sending' ? { attemptedAt: at } : { finishedAt: at }) }
        await tx.collection('n_users').doc(row.uid).update({ data: { reminder: updated, ...(status === 'sending' ? { reminderLastAttemptNightId: reminder.nightId } : {}), updatedAt: at } })
        return updated
      })
    } catch {
      // Unknown transaction commit: do not infer ownership from a later read.
      counts.unknown++; return
    }
    if (!claimed) return
    if (claimed.status !== 'sending') { counts[claimed.status]++; return }
    let outcome = 'unknown'
    let timer
    try {
      const result = await Promise.race([
        send(messageFor(row.uid, claimed, config)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('send outcome unknown')), sendTimeoutMs) })
      ])
      if (result?.errCode === 0 || result?.errcode === 0) outcome = 'sent'
      else if (Number.isInteger(result?.errCode) || Number.isInteger(result?.errcode)) outcome = 'failed'
    } catch (error) {
      // A documented WeChat refusal is definitive; network/SDK failures aren't.
      const code = Number(error?.errCode ?? error?.errcode)
      if ([40003, 40037, 41030, 43101, 47003].includes(code)) outcome = 'failed'
    } finally { clearTimeout(timer) }
    counts[outcome]++
    try {
      await transact(db, async tx => {
        const user = (await tx.collection('n_users').doc(row.uid).get()).data
        // Do not recreate a deleted profile or overwrite a newer reservation.
        if (!user || user.reminder?.requestId !== claimed.requestId || user.reminder.revision !== claimed.revision || user.reminder.status !== 'sending') return
        await tx.collection('n_users').doc(row.uid).update({ data: { reminder: { ...user.reminder, status: outcome, finishedAt: now() }, updatedAt: now() } })
      })
    } catch { /* Claim remains non-retryable; getReminder projects stale sending as unknown. */ }
  }))
  return counts
}

module.exports = { createReminderActions, validateReminderRequest, validateConfig, hasStoredReminder, dispatchReminders, validTime, dueAtFor, nextNight, projectReminder, MAX_DELAY }
