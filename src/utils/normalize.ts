export function normalizeString(value: unknown, fallback: string | undefined): string {
  const resolvedFallback = typeof fallback === 'string' ? fallback : ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return resolvedFallback
}

export function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value, undefined)
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

export function coerceDate(value: unknown): Date | null {
  const visited = new Set<unknown>()

  function parse(candidate: unknown): Date | null {
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
      return candidate
    }

    if (typeof candidate === 'number' || typeof candidate === 'string') {
      const parsed = new Date(candidate)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed
      }
    }

    if (candidate && typeof candidate === 'object') {
      if (visited.has(candidate)) {
        return null
      }
      visited.add(candidate)

      const { toDate } = candidate as { toDate?: unknown }
      if (typeof toDate === 'function') {
        try {
          const converted = toDate.call(candidate)
          if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
            return converted
          }
        } catch {
          // fall through
        }
      }

      const record = candidate as Record<string, unknown>
      const nestedKeys = ['time', 'value', '$date', '$numberLong', '$numberDecimal']
      for (const key of nestedKeys) {
        if (key in record) {
          const nested = parse(record[key])
          if (nested) {
            return nested
          }
        }
      }
    }

    return null
  }

  return parse(value)
}
