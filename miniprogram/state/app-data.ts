import { ensureCurrentUser, updateCurrentUser, supportsCloud, fetchCheckins, fetchTodayCheckinStatus } from '../services/index'
import { createAppDataStore } from './create-app-store'

const store = createAppDataStore({
  ensureCurrentUser, updateCurrentUser, supportsCloud,
  fetchCheckins, fetchTodayCheckinStatus
})

export const { getAppData, subscribeAppData, refreshAppData, updateProfile, patchCheckins } = store
export type { AppDataState } from './create-app-store'
