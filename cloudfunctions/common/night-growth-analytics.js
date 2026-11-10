const { createHash } = require('node:crypto')
const { requireValue } = require('./errors')
const { DAY, isNightId, nightDay, resolveNight } = require('./night-time')
const { transact } = require('./night-transaction')
const { scanRows } = require('./night-growth-query')
const defaultConfig = require('./night-growth-config')

const ATTRIBUTION_MS = DAY
const HASH = /^[a-f0-9]{64}$/
const CODE = /^[a-z0-9][a-z0-9_-]{1,31}$/
const SHARE = { code: 'share', label: '句子卡分享', enabled: true, createdAt: 0, updatedAt: 0 }
const FIELDS = { getGrowthAccess: [], captureEntry: ['ref'], getChannels: [], saveChannel: ['code', 'label', 'enabled'], getDashboard: ['from', 'to'] }
const hashUid = uid => createHash('sha256').update(uid, 'utf8').digest('hex')
const dateKey = value => new Date(value).toISOString().slice(0, 10).replace(/-/g, '')
const addDays = (id, days) => dateKey(nightDay(id) + days * DAY)
const validCode = code => typeof code === 'string' && CODE.test(code) && code !== 'unknown'
const validLabel = label => typeof label === 'string' && label === label.trim() && label.length > 0 && Array.from(label).length <= 24 && !/[\u0000-\u001f\u007f]/.test(label)

function validateGrowthAnalyticsRequest(event) {
  let size = Infinity
  try { size = Buffer.byteLength(JSON.stringify(event), 'utf8') } catch { /* reject */ }
  requireValue(event && typeof event === 'object' && !Array.isArray(event) && size <= 4096 && Object.hasOwn(FIELDS, event.action), 'INVALID_ARG', '请求格式无效')
  requireValue(Object.keys(event).every(key => ['action', 'userInfo', 'tcbContext'].includes(key) || FIELDS[event.action].includes(key)), 'INVALID_ARG', '包含不支持的字段')
  if (event.action === 'captureEntry') requireValue(event.ref === undefined || (typeof event.ref === 'string' && event.ref.length <= 64), 'INVALID_ARG', '入口参数无效')
  if (event.action === 'saveChannel') requireValue(validCode(event.code) && validLabel(event.label) && typeof event.enabled === 'boolean' && (event.code !== 'share' || event.label === SHARE.label), 'INVALID_ARG', '渠道参数无效')
  if (event.action === 'getDashboard') requireValue(isNightId(event.from) && isNightId(event.to) && event.from <= event.to && nightDay(event.to) - nightDay(event.from) <= 30 * DAY, 'INVALID_ARG', '请选择最多 31 个夜晚')
}

function checkedChannel(row, code) {
  requireValue(row && row.code === code && validCode(row.code) && validLabel(row.label) && typeof row.enabled === 'boolean' && Number.isFinite(row.createdAt) && Number.isFinite(row.updatedAt), 'INTERNAL', '渠道资料暂不可用')
  return { code: row.code, label: row.label, enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function checkedAttribution(row, uid) {
  requireValue(row && row.uid === uid && (row.sourceCode === 'unknown' || validCode(row.sourceCode)) && Number.isFinite(row.arrivedAt) && row.attributionUntil === row.arrivedAt + ATTRIBUTION_MS && (row.firstNightIdAtEntry === null || isNightId(row.firstNightIdAtEntry)) && row.version === 1, 'INTERNAL', '首次到达资料暂不可用')
  return row
}

function createGrowthAnalyticsActions({ now = () => Date.now(), config = defaultConfig, scan = scanRows, maxRows = 10000 } = {}) {
  const admins = new Set(Array.isArray(config.adminHashes) && config.adminHashes.every(hash => typeof hash === 'string' && HASH.test(hash)) ? config.adminHashes : [])
  const exclusionsValid = Array.isArray(config.excludeHashes) && config.excludeHashes.every(hash => typeof hash === 'string' && HASH.test(hash))
  const excluded = new Set([...admins, ...(exclusionsValid ? config.excludeHashes : [])])
  const isAdmin = uid => typeof uid === 'string' && admins.has(hashUid(uid))
  const demandAdmin = uid => requireValue(isAdmin(uid), 'UNAUTHORIZED', '此页面仅供项目管理员使用')
  const channelAt = async (db, code) => {
    const row = (await db.collection('n_channels').doc(code).get()).data
    return row ? checkedChannel(row, code) : code === 'share' ? { ...SHARE } : null
  }
  const channelsAt = async db => {
    const rows = await scan(db, 'n_channels', {}, { maxRows: 1000 })
    const channels = rows.map(row => checkedChannel(row, row._id))
    if (!channels.some(channel => channel.code === 'share')) channels.push({ ...SHARE })
    return channels.sort((a, b) => a.code.localeCompare(b.code))
  }

  return {
    async getGrowthAccess(db, uid) { return { serverNow: now(), isAdmin: isAdmin(uid) } },

    async captureEntry(db, uid, { ref } = {}) {
      return transact(db, async tx => {
        const previous = (await tx.collection('n_attributions').doc(uid).get()).data
        if (previous) {
          checkedAttribution(previous, uid)
          return { serverNow: now(), captured: false, source: previous.sourceCode }
        }
        const user = (await tx.collection('n_users').doc(uid).get()).data
        requireValue(!user || (user.uid === uid && (user.firstNightId === null || isNightId(user.firstNightId))), 'INTERNAL', '用户摘要暂不可用')
        const channel = validCode(ref) ? await channelAt(tx, ref) : null
        const serverNow = now()
        const entry = { uid, sourceCode: channel?.enabled ? channel.code : 'unknown', arrivedAt: serverNow, attributionUntil: serverNow + ATTRIBUTION_MS, firstNightIdAtEntry: user?.firstNightId || null, version: 1 }
        await tx.collection('n_attributions').doc(uid).set({ data: entry })
        return { serverNow, captured: true, source: entry.sourceCode }
      })
    },

    async getChannels(db, uid) {
      demandAdmin(uid)
      return { serverNow: now(), channels: await channelsAt(db) }
    },

    async saveChannel(db, uid, { code, label, enabled }) {
      demandAdmin(uid)
      // Validate here too: server-internal callers cannot bypass field restrictions.
      validateGrowthAnalyticsRequest({ action: 'saveChannel', code, label, enabled })
      return transact(db, async tx => {
        const existing = await channelAt(tx, code)
        const serverNow = now()
        const channel = { code, label, enabled, createdAt: existing?.createdAt || serverNow, updatedAt: serverNow }
        await tx.collection('n_channels').doc(code).set({ data: channel })
        return { serverNow, channel }
      })
    },

    async getDashboard(db, uid, { from, to }) {
      demandAdmin(uid)
      validateGrowthAnalyticsRequest({ action: 'getDashboard', from, to })
      requireValue(exclusionsValid, 'INTERNAL', '分析排除名单配置无效')
      const serverNow = now()
      requireValue(to <= resolveNight(serverNow).nightId, 'INVALID_ARG', '不能汇总未来夜晚')
      const users = await scan(db, 'n_users', {}, { maxRows, fields: { uid: true, firstNightId: true, lastNightId: true, updatedAt: true } })
      const nights = await scan(db, 'n_nights', {}, { maxRows, fields: { uid: true, nightId: true, confirmedAt: true, method: true } })
      const entries = await scan(db, 'n_attributions', {}, { maxRows })
      const channels = await channelsAt(db)
      const usersById = new Map(), nightsByUid = new Map(), nightKeys = new Set()
      for (const user of users) {
        requireValue(typeof user.uid === 'string' && user.uid && user._id === user.uid && !usersById.has(user.uid) && (user.firstNightId === null || isNightId(user.firstNightId)) && (user.lastNightId === null || isNightId(user.lastNightId)) && (user.firstNightId === null) === (user.lastNightId === null) && (!user.firstNightId || user.firstNightId <= user.lastNightId) && Number.isFinite(user.updatedAt) && user.updatedAt <= serverNow, 'INTERNAL', '用户摘要不完整或正在变化，请重新读取')
        usersById.set(user.uid, user)
      }
      for (const row of nights) {
        const rules = resolveNight(row.confirmedAt)
        requireValue(typeof row.uid === 'string' && usersById.has(row.uid) && isNightId(row.nightId) && row._id === `${row.uid}_${row.nightId}` && !nightKeys.has(row._id) && ['hold', 'tap'].includes(row.method) && Number.isFinite(row.confirmedAt) && row.confirmedAt <= serverNow && rules.nightId === row.nightId && rules.phase === 'open', 'INTERNAL', '真实记录不完整或正在变化，请重新读取')
        nightKeys.add(row._id)
        const list = nightsByUid.get(row.uid) || []
        list.push(row); nightsByUid.set(row.uid, list)
      }
      for (const [id, user] of usersById) {
        const list = (nightsByUid.get(id) || []).sort((a, b) => a.nightId.localeCompare(b.nightId))
        requireValue((list[0]?.nightId || null) === user.firstNightId && (list.at(-1)?.nightId || null) === user.lastNightId, 'INTERNAL', '记录与用户摘要不一致，请核对数据后再查看指标')
      }
      // Re-read summaries after the other scans. New users, deletions, new nights,
      // and preferences writes during this read cannot silently mix two versions.
      const finalUsers = await scan(db, 'n_users', {}, { maxRows, fields: { uid: true, firstNightId: true, lastNightId: true, updatedAt: true } })
      requireValue(JSON.stringify(finalUsers) === JSON.stringify(users), 'INTERNAL', '数据正在变化，请稍后重新读取')
      const excludedIds = new Set([...usersById.keys(), ...entries.map(entry => entry.uid)].filter(id => typeof id === 'string' && excluded.has(hashUid(id))))
      const daily = [], byNight = new Map(), uniqueUsers = new Set()
      for (let day = from; day <= to; day = addDays(day, 1)) {
        const item = { nightId: day, users: 0, activations: 0, hold: 0, tap: 0 }
        daily.push(item); byNight.set(day, item)
      }
      const totals = { users: 0, records: 0, activations: 0, hold: 0, tap: 0 }
      for (const row of nights) {
        if (excludedIds.has(row.uid) || !byNight.has(row.nightId)) continue
        const item = byNight.get(row.nightId)
        item.users++; item[row.method]++; totals.records++; totals[row.method]++; uniqueUsers.add(row.uid)
        if (usersById.get(row.uid).firstNightId === row.nightId) { item.activations++; totals.activations++ }
      }
      totals.users = uniqueUsers.size
      const weeks = new Map()
      const retention = { activated: 0, mature: 0, immature: 0, reachedThree: 0, ratio: null, cohorts: [] }
      for (const [id, user] of usersById) {
        const first = user.firstNightId
        if (excludedIds.has(id) || !first || first < from || first > to) continue
        const week = addDays(first, -((new Date(nightDay(first)).getUTCDay() + 6) % 7))
        const group = weeks.get(week) || { activationWeek: week, activated: 0, mature: 0, immature: 0, reachedThree: 0, ratio: null }
        group.activated++; retention.activated++
        // A+6 closes at 06:00 on the following Beijing calendar day (22:00 UTC).
        if (serverNow >= nightDay(first) + 6 * DAY + 22 * 3600000) {
          group.mature++; retention.mature++
          if (nightsByUid.get(id).filter(row => row.nightId <= addDays(first, 6)).length >= 3) { group.reachedThree++; retention.reachedThree++ }
        } else { group.immature++; retention.immature++ }
        weeks.set(week, group)
      }
      retention.ratio = retention.mature ? retention.reachedThree / retention.mature : null
      retention.cohorts = [...weeks.values()].sort((a, b) => a.activationWeek.localeCompare(b.activationWeek)).map(group => ({ ...group, ratio: group.mature ? group.reachedThree / group.mature : null }))
      const channelResults = new Map(channels.map(channel => [channel.code, { code: channel.code, label: channel.label, enabled: channel.enabled, arrivals: 0, matureArrivals: 0, immatureArrivals: 0, activations: 0, convertedMature: 0, conversionRate: null }]))
      channelResults.set('unknown', { code: 'unknown', label: '来源未知', enabled: false, arrivals: 0, matureArrivals: 0, immatureArrivals: 0, activations: 0, convertedMature: 0, conversionRate: null })
      const seenEntries = new Set()
      for (const entry of entries) {
        checkedAttribution(entry, entry._id)
        requireValue(!seenEntries.has(entry.uid) && entry.arrivedAt <= serverNow, 'INTERNAL', '首次到达数据不完整或正在变化，请重新读取')
        seenEntries.add(entry.uid)
        if (excludedIds.has(entry.uid)) continue
        const arrivalNight = resolveNight(entry.arrivedAt).nightId
        if (arrivalNight < from || arrivalNight > to) continue
        requireValue(channelResults.has(entry.sourceCode), 'INTERNAL', '历史渠道缺失，请恢复渠道登记后再查看指标')
        const result = channelResults.get(entry.sourceCode), firstRecord = nightsByUid.get(entry.uid)?.[0]
        const mature = serverNow >= entry.attributionUntil
        const activated = entry.firstNightIdAtEntry === null && firstRecord && firstRecord.confirmedAt >= entry.arrivedAt && firstRecord.confirmedAt < entry.attributionUntil
        result.arrivals++
        if (mature) result.matureArrivals++; else result.immatureArrivals++
        if (activated) { result.activations++; if (mature) result.convertedMature++ }
      }
      for (const result of channelResults.values()) result.conversionRate = result.matureArrivals ? result.convertedMature / result.matureArrivals : null
      return { serverNow, from, to, totals, daily, retention, channels: [...channelResults.values()], excludedAccounts: excludedIds.size, attributionHours: 24, consistency: 'checked' }
    }
  }
}

module.exports = { createGrowthAnalyticsActions, validateGrowthAnalyticsRequest, hashUid, ATTRIBUTION_MS }
