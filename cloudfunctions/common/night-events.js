const { requireValue } = require('./errors')
const { resolveNight } = require('./night-time')
const { transact } = require('./night-transaction')

const empty = () => true
const SCHEMAS = {
  night_view: { phase: v => ['before', 'open', 'closed'].includes(v), hasRecord: v => typeof v === 'boolean' },
  ceremony_start: { method: v => ['hold', 'tap'].includes(v) },
  ceremony_done_view: {}, exit_tap: {},
  receipt_view: { source: v => ['home', 'archive'].includes(v) },
  card_export_result: { stage: v => ['render', 'save'].includes(v), ok: v => typeof v === 'boolean', code: v => ['OK', 'RENDER_FAILED', 'SAVE_DENIED', 'SAVE_FAILED'].includes(v) }
}
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

function validateEvents(events) {
  requireValue(Array.isArray(events) && events.length >= 1 && events.length <= 10, 'INVALID_ARG', '事件数量无效')
  for (const event of events) {
    requireValue(isObject(event) && Object.keys(event).length === 3 && Object.keys(event).every(k => ['eventId', 'name', 'props'].includes(k)), 'INVALID_ARG', '事件格式无效')
    requireValue(typeof event.eventId === 'string' && /^[a-f0-9]{32}$/.test(event.eventId) && Object.hasOwn(SCHEMAS, event.name), 'INVALID_ARG', '事件名称或编号无效')
    const schema = SCHEMAS[event.name], props = event.props
    requireValue(isObject(props) && Buffer.byteLength(JSON.stringify(props), 'utf8') <= 256 &&
      Object.keys(props).length === Object.keys(schema).length && Object.keys(props).every(k => Object.hasOwn(schema, k) && (schema[k] || empty)(props[k])), 'INVALID_ARG', '事件属性无效')
    if (event.name === 'card_export_result') {
      requireValue(props.ok ? props.code === 'OK' : props.stage === 'render' ? props.code === 'RENDER_FAILED' : ['SAVE_DENIED', 'SAVE_FAILED'].includes(props.code), 'INVALID_ARG', '事件结果无效')
    }
  }
}

async function receiveEvents(db, uid, events, { now, readUser, newUser }) {
  // All inputs have already passed validation, including duplicate entries.
  const unique = [...new Map(events.map(event => [event.eventId, event])).values()]
  return transact(db, async tx => {
    const serverNow = now(), nightId = resolveNight(serverNow).nightId
    const receivedDateKey = new Date(serverNow + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '')
    const user = await readUser(tx, uid)
    const current = user || newUser(uid, serverNow)
    const accepted = [], duplicateIds = []
    for (const event of unique) {
      const existing = (await tx.collection('n_events').doc(`${uid}_${event.eventId}`).get()).data
      if (existing) duplicateIds.push(event.eventId)
      else accepted.push(event)
    }
    const count = current.eventBudget?.nightId === nightId ? current.eventBudget.accepted : 0
    requireValue(count + accepted.length <= 100, 'RATE_LIMITED', '本夜事件额度已满')
    for (const event of accepted) {
      await tx.collection('n_events').doc(`${uid}_${event.eventId}`).set({ data: { uid, ...event, receivedNightId: nightId, receivedDateKey } })
    }
    if (accepted.length) {
      const patch = { eventBudget: { nightId, accepted: count + accepted.length } }
      if (user) await tx.collection('n_users').doc(uid).update({ data: patch })
      else await tx.collection('n_users').doc(uid).set({ data: { ...current, ...patch } })
    }
    return { serverNow, acceptedIds: accepted.map(event => event.eventId), duplicateIds }
  })
}
module.exports = { validateEvents, receiveEvents }
