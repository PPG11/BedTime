import { normalizeDateKey } from './checkin'
import type { CheckInMap } from './storage'

type CheckinRecordLike = {
  status?: string
  date?: string
  ts?: Date | string | number
}

export function previousCheckinDate(key: string): string {
  const day = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)) - 1))
  return day.toISOString().slice(0, 10).replace(/-/g, '')
}

function normalizeTimestamp(value: CheckinRecordLike['ts']): number | null {
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isNaN(ts) ? null : ts
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value
  }
  if (typeof value === 'string' && value.length) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function createFallbackKey(timestamp: number | null): string | null {
  if (timestamp === null) {
    return null
  }
  const fallback = new Date(timestamp)
  const year = String(fallback.getFullYear()).padStart(4, '0')
  const month = String(fallback.getMonth() + 1).padStart(2, '0')
  const day = String(fallback.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function mapCheckinsToRecord(
  list: CheckinRecordLike[],
  statuses: readonly ('hit' | 'late')[] = ['hit', 'late']
): CheckInMap {
  if (!Array.isArray(list) || list.length === 0) {
    return {}
  }

  return list.reduce<CheckInMap>((acc, item) => {
    const normalizedStatus = typeof item.status === 'string' ? item.status.trim().toLowerCase() : ''
    if ((normalizedStatus !== 'hit' && normalizedStatus !== 'late') || !statuses.includes(normalizedStatus)) {
      return acc
    }

    const timestamp = normalizeTimestamp(item.ts)
    if (timestamp === null) {
      return acc
    }

    const normalizedKey = normalizeDateKey(item.date ?? '') ?? createFallbackKey(timestamp)
    if (!normalizedKey) {
      return acc
    }

    acc[normalizedKey] = timestamp
    return acc
  }, {})
}
