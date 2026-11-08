const DAY = 86400000
const HOUR = 3600000
const OFFSET = 8 * HOUR

function dateKey(at) {
  const date = new Date(at)
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function isNightId(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value) || value < '19000101' || value > '99991231') return false
  const at = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)))
  return dateKey(at) === value
}

function nightDay(nightId) {
  return Date.UTC(Number(nightId.slice(0, 4)), Number(nightId.slice(4, 6)) - 1, Number(nightId.slice(6, 8)))
}

function resolveNight(serverNow) {
  const nightId = dateKey(serverNow + OFFSET - 12 * HOUR)
  const midnight = nightDay(nightId) - OFFSET
  const windowOpenAt = midnight + 20 * HOUR
  const windowCloseAt = midnight + 30 * HOUR
  const phase = serverNow < windowOpenAt ? 'before' : serverNow < windowCloseAt ? 'open' : 'closed'
  return { nightId, phase, windowOpenAt, windowCloseAt, nextOpenAt: serverNow < windowOpenAt ? windowOpenAt : windowOpenAt + DAY }
}

module.exports = { DAY, isNightId, nightDay, resolveNight }
