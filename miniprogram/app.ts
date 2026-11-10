import { captureGrowthEntry } from './utils/growth-entry'

App({
  // Pages refresh the authenticated night store on show. Never initialize the
  // legacy store here, or turn an app lifecycle event into a closeLight request.
  onLaunch() {},
  onShow(options: Partial<WechatMiniprogram.App.LaunchShowOption> = {}) { void captureGrowthEntry(options) }
})
