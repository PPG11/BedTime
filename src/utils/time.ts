export function formatMinutesToTime(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, totalMinutes))
  const hours = `${Math.floor(normalized / 60)}`.padStart(2, '0')
  const minutes = `${normalized % 60}`.padStart(2, '0')
  return `${hours}:${minutes}`
}

export function parseTimeStringToMinutes(value: string, fallbackMinutes: number): number {
  const [hoursText = '0', minutesText = '0'] = value.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return fallbackMinutes
  }
  const normalizedHours = Math.max(0, Math.min(23, hours))
  const normalizedMinutes = Math.max(0, Math.min(59, minutes))
  return normalizedHours * 60 + normalizedMinutes
}

export function formatTime(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${hours}:${minutes}`
}
