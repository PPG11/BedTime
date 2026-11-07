import { refreshAppData } from './state/app-data'

App({
  onLaunch() {
    void refreshAppData()
  },
  onShow() {
    // Refresh after returning from the background, including a midnight rollover.
    void refreshAppData()
  }
})
