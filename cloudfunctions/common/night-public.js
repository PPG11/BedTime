const { randomBytes, createHash } = require('node:crypto')
const { requireValue } = require('./errors')
const { DAY, isNightId, nightDay, resolveNight } = require('./night-time')
const { transact } = require('./night-transaction')
const { scanRows } = require('./night-growth-query')

const HOUR = 3600000
const SETTLEMENT_DELAY = 5 * 60000
const CARD_LIFETIME = 30 * DAY
const PUBLIC_FIELDS = {
  getLights: ['nightId'], createPublicCard: ['nightId'], getOwnedCard: ['nightId'],
  getPublicCard: ['cardId'], revokePublicCard: ['nightId', 'cardId']
}
const isCardId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
const keyFor = (uid, nightId) => createHash('sha256').update(`${uid}\0${nightId}`).digest('hex')
const nightAt = value => new Date(value).toISOString().slice(0, 10).replaceAll('-', '')
const closeAt = nightId => nightDay(nightId) + 22 * HOUR

function validatePublicRequest(event) {
  let size = Infinity
  try { size = Buffer.byteLength(JSON.stringify(event), 'utf8') } catch { /* Reject non-JSON input. */ }
  requireValue(event && typeof event === 'object' && !Array.isArray(event) && size <= 16384 && Object.hasOwn(PUBLIC_FIELDS, event.action), 'INVALID_ARG', '请求格式无效')
  requireValue(Object.keys(event).every(key => ['action', 'userInfo', 'tcbContext'].includes(key) || PUBLIC_FIELDS[event.action].includes(key)), 'INVALID_ARG', '包含不支持的字段')
  if (event.action !== 'getPublicCard') requireValue((event.action === 'getLights' && event.nightId === undefined) || isNightId(event.nightId), 'INVALID_ARG', '夜晚日期无效')
  if (['getPublicCard', 'revokePublicCard'].includes(event.action)) requireValue(isCardId(event.cardId), 'INVALID_ARG', '夜签编号无效')
}

function publicCard(card) {
  return { cardId: card.cardId, nightId: card.nightId, phraseText: card.phraseText, expiresAt: card.expiresAt }
}
function privateRecord(record) {
  if (!record) return null
  const { nightId, confirmedAt, method, phraseId, phraseText, phraseVersion } = record
  return { nightId, confirmedAt, method, phraseId, phraseText, phraseVersion }
}
async function readRecord(db, uid, nightId) {
  const record = (await db.collection('n_nights').doc(`${uid}_${nightId}`).get()).data
  requireValue(!record || (record.uid === uid && record.nightId === nightId), 'INTERNAL', '夜签暂不可用')
  return record || null
}
async function readKey(db, uid, nightId) {
  const key = (await db.collection('n_card_keys').doc(keyFor(uid, nightId)).get()).data
  requireValue(!key || (key.uid === uid && key.nightId === nightId && isCardId(key.cardId)), 'INTERNAL', '夜签暂不可用')
  return key || null
}
async function ownedResult(db, uid, nightId, serverNow, key) {
  key = key === undefined ? await readKey(db, uid, nightId) : key
  if (!key) return { serverNow, status: 'none', card: null }
  if (key.status === 'revoked') return { serverNow, status: 'revoked', card: null }
  if (serverNow >= key.expiresAt) return { serverNow, status: 'expired', card: null }
  const card = (await db.collection('n_cards').doc(key.cardId).get()).data
  const record = await readRecord(db, uid, nightId)
  if (!card || card.status !== 'active' || card.uid !== uid || card.nightId !== nightId || card.cardId !== key.cardId || card.expiresAt !== key.expiresAt || !record || card.sourceConfirmedAt !== record.confirmedAt) return { serverNow, status: 'unavailable', card: null }
  return { serverNow, status: 'active', card: publicCard(card) }
}

function aggregateLights(rows, nightId) {
  const start = closeAt(nightId) - 10 * HOUR
  const counts = [0, 0, 0, 0, 0], identities = new Set()
  for (const row of rows) {
    requireValue(typeof row.uid === 'string' && row.uid && row._id === `${row.uid}_${nightId}` && row.nightId === nightId && Number.isFinite(row.confirmedAt) && row.confirmedAt >= start && row.confirmedAt < closeAt(nightId) && !identities.has(row.uid), 'INTERNAL', '灯迹暂时无法完整确认')
    identities.add(row.uid)
    counts[Math.floor((row.confirmedAt - start) / (2 * HOUR))]++
  }
  if (rows.length < 3) return { suppressed: true, total: null, buckets: [] }
  const buckets = []
  let from = 20, count = 0
  for (let i = 0; i < counts.length; i++) {
    count += counts[i]
    if (count >= 3) { buckets.push({ startHour: from, endHour: 22 + i * 2, count }); from = 22 + i * 2; count = 0 }
  }
  if (from < 30) {
    const last = buckets[buckets.length - 1]
    last.endHour = 30; last.count += count
  }
  return { suppressed: false, total: rows.length, buckets }
}

function createPublicActions({ now = () => Date.now(), randomId = () => randomBytes(16).toString('hex') } = {}) {
  return {
    async getLights(db, uid, { nightId } = {}) {
      const serverNow = now(), current = resolveNight(serverNow)
      const latest = nightDay(current.nightId) - (serverNow < current.windowCloseAt + SETTLEMENT_DELAY ? DAY : 0)
      const availableNightIds = Array.from({ length: 7 }, (_, index) => nightAt(latest - index * DAY))
      nightId = nightId || availableNightIds[0]
      requireValue(availableNightIds.includes(nightId), 'INVALID_ARG', '只能查看最近七个已结束的夜晚')
      const rows = await scanRows(db, 'n_nights', { nightId }, { maxRows: 10000, pageSize: 100, fields: { uid: true, nightId: true, confirmedAt: true } })
      const ownRecord = privateRecord(await readRecord(db, uid, current.nightId))
      return { serverNow, nightId, availableNightIds, settledAt: closeAt(nightId) + SETTLEMENT_DELAY, ...aggregateLights(rows, nightId), currentNightId: current.nightId, ownRecord }
    },

    async createPublicCard(db, uid, { nightId }) {
      const candidate = randomId()
      requireValue(isCardId(candidate), 'INTERNAL', '夜签暂不可用')
      try {
        return await transact(db, async tx => {
          const serverNow = now(), key = await readKey(tx, uid, nightId)
          if (key) return { ...await ownedResult(tx, uid, nightId, serverNow, key), created: false }
          const record = await readRecord(tx, uid, nightId)
          requireValue(record && typeof record.phraseText === 'string' && record.phraseText.length > 0 && record.phraseText.length <= 40 && Number.isFinite(record.confirmedAt), 'INVALID_ARG', '这晚还没有可分享的夜签')
          const collision = (await tx.collection('n_cards').doc(candidate).get()).data
          requireValue(!collision, 'INTERNAL', '夜签暂不可用，请重试')
          const card = { uid, cardId: candidate, nightId, phraseText: record.phraseText, sourceConfirmedAt: record.confirmedAt, status: 'active', createdAt: serverNow, expiresAt: serverNow + CARD_LIFETIME }
          await tx.collection('n_cards').doc(candidate).set({ data: card })
          await tx.collection('n_card_keys').doc(keyFor(uid, nightId)).set({ data: { uid, nightId, cardId: candidate, status: 'active', createdAt: serverNow, expiresAt: card.expiresAt } })
          return { serverNow, status: 'active', card: publicCard(card), created: true }
        })
      } catch (error) {
        // An unknown commit may already have created both documents. Recover by
        // the business key; never mint a second card merely because its reply was lost.
        try {
          const key = await readKey(db, uid, nightId)
          if (key) return { ...await ownedResult(db, uid, nightId, now(), key), created: false }
        } catch { /* Preserve the original unknown result. */ }
        throw error
      }
    },

    async getOwnedCard(db, uid, { nightId }) {
      return ownedResult(db, uid, nightId, now())
    },

    async getPublicCard(db, _uid, { cardId }) {
      const serverNow = now(), unavailable = { serverNow, status: 'unavailable', card: null }
      const card = (await db.collection('n_cards').doc(cardId).get()).data
      if (!card || card.cardId !== cardId || card.status !== 'active' || !Number.isFinite(card.expiresAt) || serverNow >= card.expiresAt || typeof card.uid !== 'string' || !isNightId(card.nightId)) return unavailable
      const owned = await ownedResult(db, card.uid, card.nightId, serverNow)
      return owned.status === 'active' && owned.card.cardId === cardId ? { serverNow, status: 'active', card: owned.card } : unavailable
    },

    async revokePublicCard(db, uid, { nightId, cardId }) {
      try {
        return await transact(db, async tx => {
          const serverNow = now(), key = await readKey(tx, uid, nightId)
          if (!key || key.cardId !== cardId) return { serverNow, status: 'unavailable', card: null }
          const card = (await tx.collection('n_cards').doc(cardId).get()).data
          requireValue(!card || (card.uid === uid && card.nightId === nightId), 'INTERNAL', '夜签暂不可用')
          if (key.status !== 'revoked') await tx.collection('n_card_keys').doc(keyFor(uid, nightId)).update({ data: { status: 'revoked', revokedAt: serverNow } })
          if (card && card.status !== 'revoked') await tx.collection('n_cards').doc(cardId).update({ data: { status: 'revoked', revokedAt: serverNow } })
          return { serverNow, status: 'revoked', card: null }
        })
      } catch (error) {
        try {
          const key = await readKey(db, uid, nightId)
          if (key?.cardId === cardId && key.status === 'revoked') return { serverNow: now(), status: 'revoked', card: null }
        } catch { /* An unavailable read is not proof that revocation failed. */ }
        throw error
      }
    }
  }
}

module.exports = { createPublicActions, validatePublicRequest, PUBLIC_FIELDS, aggregateLights }
