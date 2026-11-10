import type { NightRecord } from './night'
export type LightBucket = { startHour: number; endHour: number; count: number }
export type LightsReply = { serverNow: number; nightId: string; availableNightIds: string[]; settledAt: number; suppressed: boolean; total: number | null; buckets: LightBucket[]; currentNightId: string; ownRecord: NightRecord | null }
export type PublicCard = { cardId: string; nightId: string; phraseText: string; expiresAt: number }
export type CardReply = { serverNow: number; status: 'none' | 'active' | 'expired' | 'revoked' | 'unavailable'; card: PublicCard | null; created?: boolean }
export type GrowthChannel = { code: string; label: string; enabled: boolean; createdAt: number; updatedAt: number }

export type Retention = { activated: number; mature: number; immature: number; reachedThree: number; ratio: number | null }
export type DashboardReply = { serverNow: number; from: string; to: string; totals: { users: number; records: number; activations: number; hold: number; tap: number }; daily: { nightId: string; users: number; activations: number; hold: number; tap: number }[]; retention: Retention & { cohorts: (Retention & { activationWeek: string })[] }; channels: { code: string; label: string; enabled: boolean; arrivals: number; matureArrivals: number; immatureArrivals: number; activations: number; convertedMature: number; conversionRate: number | null }[]; excludedAccounts: number; attributionHours: number; consistency: 'checked' }
