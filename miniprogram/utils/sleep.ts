import { formatMinutesToTime, parseTimeStringToMinutes } from './time'

const DEFAULT_TARGET_MINUTES = 22 * 60 + 30

export function clampSleeptimeBucket(targetHM: string): string {
  const minutes = parseTimeStringToMinutes(targetHM, DEFAULT_TARGET_MINUTES)
  const bucket = Math.round(minutes / 30) * 30
  return formatMinutesToTime(bucket)
}
