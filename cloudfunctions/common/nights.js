const { AppError, requireValue } = require('./errors')
const { isNightId, resolveNight } = require('./night-time')
const { phraseForNight } = require('./night-phrases')
const { validateEvents, receiveEvents } = require('./night-events')
const { transact } = require('./night-transaction')
const { createReminderActions, validateReminderRequest, validateConfig } = require('./night-reminders')
const defaultReminderConfig = require('./night-reminder-config')

const DEFAULT_PREFS = { sound: false, haptics: true, reduceMotion: false }
const FIELDS = {
  getState: [], closeLight: ['clientNightId', 'method'], getNight: ['nightId'], setPrefs: ['prefs'],
  getArchive: ['cursor', 'limit'], track: ['events'], getReminder: [],
  scheduleReminder: ['requestId', 'revision', 'nightId', 'time', 'templateId'], cancelReminder: ['requestId', 'revision']
}
const idFor = (uid, nightId) => `${uid}_${nightId}`

function validateNightRequest(event) {
  let size = Infinity
  try { size = Buffer.byteLength(JSON.stringify(event), 'utf8') } catch { /* Reject non-JSON input. */ }
  requireValue(event && typeof event === 'object' && !Array.isArray(event) && size <= 16384, 'INVALID_ARG', '请求格式无效')
  // WeChat injects userInfo and tcbContext into actual calls. Reserved transport metadata,
  // never an identity source: expose() uses only getWXContext().OPENID.
  requireValue(Object.hasOwn(FIELDS, event.action) && Object.keys(event).every(key => ['action', 'userInfo', 'tcbContext'].includes(key) || FIELDS[event.action].includes(key)), 'INVALID_ARG', '包含不支持的字段')
  if (event.action === 'closeLight') {
    requireValue(isNightId(event.clientNightId) && ['hold', 'tap'].includes(event.method), 'INVALID_ARG', '关灯参数无效')
  } else if (event.action === 'getNight') {
    requireValue(isNightId(event.nightId), 'INVALID_ARG', '夜晚日期无效')
  } else if (event.action === 'setPrefs') {
    const prefs = event.prefs
    requireValue(prefs && typeof prefs === 'object' && !Array.isArray(prefs) && Object.keys(prefs).length > 0 &&
      Object.keys(prefs).every(key => Object.hasOwn(DEFAULT_PREFS, key) && typeof prefs[key] === 'boolean'), 'INVALID_ARG', '偏好参数无效')
  } else if (event.action === 'getArchive') {
    requireValue(event.cursor === undefined || isNightId(event.cursor), 'INVALID_ARG', '分页日期无效')
    requireValue(event.limit === undefined || (Number.isInteger(event.limit) && event.limit >= 1 && event.limit <= 30), 'INVALID_ARG', '分页数量无效')
  } else if (event.action === 'track') {
    validateEvents(event.events)
  } else if (['getReminder', 'scheduleReminder', 'cancelReminder'].includes(event.action)) {
    validateReminderRequest(event)
  }
}

async function readUser(db, uid) {
  const user = (await db.collection('n_users').doc(uid).get()).data
  requireValue(!user || user.uid === uid, 'INTERNAL', '用户资料暂不可用')
  return user || null
}

async function readRecord(db, uid, nightId) {
  const record = (await db.collection('n_nights').doc(idFor(uid, nightId)).get()).data
  requireValue(!record || (record.uid === uid && record.nightId === nightId), 'INTERNAL', '关灯记录暂不可用')
  return record || null
}

function project(record) {
  if (!record) return null
  const { nightId, confirmedAt, method, phraseId, phraseText, phraseVersion } = record
  return { nightId, confirmedAt, method, phraseId, phraseText, phraseVersion }
}

function newUser(uid, now) {
  return { uid, prefs: { ...DEFAULT_PREFS }, firstNightId: null, lastNightId: null, eventBudget: { nightId: null, accepted: 0 }, createdAt: now, updatedAt: now }
}

function createNightActions({ now = () => Date.now(), reminderConfig = defaultReminderConfig } = {}) {
  function existingResult(record, user) {
    requireValue(user && user.firstNightId, 'INTERNAL', '记录摘要暂不可用')
    return { serverNow: now(), record: project(record), created: false, isFirstEver: user.firstNightId === record.nightId }
  }

  return {
    ...createReminderActions({ now, config: reminderConfig, readUser, newUser }),
    async getState(db, uid) {
      // A transaction prevents a bootstrap from resetting a concurrent close or
      // preferences update, and reads the record and summary consistently.
      return transact(db, async tx => {
        const serverNow = now()
        const rules = resolveNight(serverNow)
        const user = await readUser(tx, uid)
        const current = user || newUser(uid, serverNow)
        const record = await readRecord(tx, uid, rules.nightId)
        const lastRecord = current.lastNightId === rules.nightId ? record : current.lastNightId ? await readRecord(tx, uid, current.lastNightId) : null
        if (!user) await tx.collection('n_users').doc(uid).set({ data: current })
        // A configuration problem in an optional reminder cannot block closing a light.
        let reminderAvailable = false
        try { reminderAvailable = validateConfig(reminderConfig) } catch { /* Keep the entry hidden. */ }
        return { serverNow, userId: uid, ...rules, record: project(record), lastRecord: project(lastRecord), prefs: current.prefs, firstNightId: current.firstNightId, lastNightId: current.lastNightId, reminderAvailable }
      })
    },

    async closeLight(db, uid, { clientNightId, method }) {
      const existing = await readRecord(db, uid, clientNightId)
      if (existing) return existingResult(existing, await readUser(db, uid))
      // A miss outside the transaction says nothing about a concurrent writer.
      // In particular, do NOT check the current night or window here.
      try {
        return await transact(db, async tx => {
          const user = await readUser(tx, uid)
          const previous = await readRecord(tx, uid, clientNightId)
          if (previous) return existingResult(previous, user)
          const frozen = (await tx.collection('n_phrases').doc(clientNightId).get()).data
          const serverNow = now() // Re-evaluated on every transaction attempt.
          const rules = resolveNight(serverNow)
          const details = { serverNow, ...rules }
          if (rules.nightId !== clientNightId) throw new AppError('NIGHT_CHANGED', '已经是新的一晚，请重新确认。', details)
          if (rules.phase !== 'open') throw new AppError('WINDOW_NOT_OPEN', '现在不能新增关灯记录。', details)
          const phrase = frozen || phraseForNight(clientNightId, serverNow)
          requireValue(phrase.nightId === clientNightId && typeof phrase.text === 'string' && phrase.text.length > 0 && phrase.text.length <= 40, 'INTERNAL', '当夜句子暂不可用')
          const current = user || newUser(uid, serverNow)
          const record = { uid, nightId: clientNightId, confirmedAt: serverNow, method, phraseId: phrase.phraseId, phraseText: phrase.text, phraseVersion: phrase.phraseVersion, poolVersion: phrase.poolVersion, ruleVersion: 1 }
          if (!frozen) await tx.collection('n_phrases').doc(clientNightId).set({ data: phrase })
          await tx.collection('n_nights').doc(idFor(uid, clientNightId)).set({ data: record })
          const summary = { firstNightId: current.firstNightId || clientNightId, lastNightId: current.lastNightId && current.lastNightId > clientNightId ? current.lastNightId : clientNightId, updatedAt: serverNow }
          if (user) await tx.collection('n_users').doc(uid).update({ data: summary })
          else await tx.collection('n_users').doc(uid).set({ data: { ...current, ...summary } })
          return { serverNow, record: project(record), created: true, isFirstEver: summary.firstNightId === clientNightId }
        })
      } catch (error) {
        // A failed response is not evidence that the transaction did not commit.
        // Only an actual record read permits recovery; never replay on this path.
        try {
          const recovered = await readRecord(db, uid, clientNightId)
          if (recovered) return existingResult(recovered, await readUser(db, uid))
        } catch { /* Keep the original failure if verification is unavailable. */ }
        throw error
      }
    },

    async getNight(db, uid, { nightId }) {
      const serverNow = now()
      requireValue(nightId <= resolveNight(serverNow).nightId, 'INVALID_ARG', '不能查询未来夜晚')
      return { serverNow, record: project(await readRecord(db, uid, nightId)) }
    },

    async getArchive(db, uid, { cursor, limit = 30 }) {
      const where = { uid }
      if (cursor) where.nightId = db.command.lt(cursor)
      const result = await db.collection('n_nights').where(where).orderBy('nightId', 'desc').limit(limit + 1)
        .field({ _id: false, nightId: true, confirmedAt: true, method: true, phraseId: true, phraseText: true, phraseVersion: true }).get()
      const items = result.data.slice(0, limit).map(project)
      return { serverNow: now(), items, nextCursor: result.data.length > limit ? items[items.length - 1].nightId : null }
    },

    async track(db, uid, { events }) {
      return receiveEvents(db, uid, events, { now, readUser, newUser })
    },

    async setPrefs(db, uid, { prefs }) {
      return transact(db, async tx => {
        const user = await readUser(tx, uid)
        const serverNow = now()
        const current = user || newUser(uid, serverNow)
        const merged = { ...current.prefs, ...prefs }
        if (user) await tx.collection('n_users').doc(uid).update({ data: { prefs: merged, updatedAt: serverNow } })
        else await tx.collection('n_users').doc(uid).set({ data: { ...current, prefs: merged } })
        return { serverNow, prefs: merged }
      })
    }
  }
}

module.exports = { createNightActions, validateNightRequest, DEFAULT_PREFS }
