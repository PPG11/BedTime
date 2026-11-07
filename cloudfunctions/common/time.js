const MINUTE = 60_000
const DAY = 1440 * MINUTE
const TARGET_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function dateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '')
}

function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false
  const ms = Date.parse(value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') + 'T00:00:00Z')
  return Number.isFinite(ms) && dateKey(ms) === value
}

function previousDay(value) {
  return dateKey(Date.parse(value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') + 'T00:00:00Z') - DAY)
}

function resolveCycle(user, now = Date.now()) {
  const [hours, minutes] = user.targetHM.split(':').map(Number)
  const localNow = now + user.tzOffset * MINUTE
  const localDay = Math.floor(localNow / DAY) * DAY
  let target = localDay + (hours * 60 + minutes) * MINUTE
  // After the window closes, advance to the next target. This also handles after-midnight targets.
  while (localNow >= target + 360 * MINUTE) target += DAY
  if (localNow < target - (1440 - 360) * MINUTE) target -= DAY

  return {
    date: dateKey(target),
    open: localNow >= target - 720 * MINUTE,
    status: localNow > target ? 'late' : 'hit'
  }
}

function quantizeSlotKey(targetHM) {
  return targetHM.slice(0, 3) + (Number(targetHM.slice(3)) < 30 ? '00' : '30')
}

module.exports = { TARGET_TIME, isDateKey, previousDay, resolveCycle, quantizeSlotKey }
