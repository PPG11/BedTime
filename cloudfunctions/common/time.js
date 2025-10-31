const MS_PER_MINUTE = 60 * 1000

function toDateString(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function formatDateFromMs(ms) {
  return toDateString(new Date(ms))
}

function normalizeHm(value, fallback = '22:00') {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    return fallback
  }
  const [h, m] = trimmed.split(':').map((part) => Number(part))
  if (Number.isNaN(h) || Number.isNaN(m)) {
    return fallback
  }
  const hour = Math.min(Math.max(h, 0), 23)
  const minute = Math.min(Math.max(m, 0), 59)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function quantizeSlotKey(targetHm) {
  const normalized = normalizeHm(targetHm)
  const [hourStr, minuteStr] = normalized.split(':')
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  const slotMinute = minute < 30 ? '00' : '30'
  return `${String(hour).padStart(2, '0')}:${slotMinute}`
}

function getTodayFromOffset(tzOffsetMinutes, now = Date.now()) {
  const tzMinutes = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0
  const localMs = now + tzMinutes * MS_PER_MINUTE
  return formatDateFromMs(localMs)
}

function getYesterday(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{8}$/.test(dateStr)) {
    return null
  }
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(4, 6)) - 1
  const day = Number(dateStr.slice(6, 8))
  const date = new Date(Date.UTC(year, month, day))
  date.setUTCDate(date.getUTCDate() - 1)
  return toDateString(date)
}

module.exports = {
  getTodayFromOffset,
  getYesterday,
  quantizeSlotKey,
  normalizeHm,
  formatDateFromMs,
  toDateString
}
