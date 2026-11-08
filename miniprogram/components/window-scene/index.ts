import { EXPERIENCE } from '../../config/night-experience'
const properties = {
  progress: { type: Number, value: 0 },
  extinguished: { type: Boolean, value: false },
  reduceMotion: { type: Boolean, value: false },
  pressing: { type: Boolean, value: false },
  layoutKey: { type: String, value: '', observer: 'measureScene' }
}
Component<{ cancelMs: number; sceneWidth: number; sceneHeight: number }, typeof properties, { measureScene(): void }, { _layoutToken: number; _attached: boolean }>({
  options: { styleIsolation: 'isolated', multipleSlots: true },
  properties,
  data: { cancelMs: EXPERIENCE.cancelMs, sceneWidth: 0, sceneHeight: 0 },
  lifetimes: {
    attached() { this._attached = true; this._layoutToken = 0 },
    ready() { this.measureScene() },
    detached() { this._attached = false; this._layoutToken++ }
  },
  pageLifetimes: { resize() { this.measureScene() } },
  methods: {
    measureScene() {
      if (!this._attached) return
      const token = ++this._layoutToken
      wx.nextTick(() => {
        if (!this._attached || token !== this._layoutToken) return
        this.createSelectorQuery().select('.scene').boundingClientRect(result => {
          if (!this._attached || token !== this._layoutToken || !result) return
          const rect = result as WechatMiniprogram.BoundingClientRectCallbackResult
          const width = Math.min(rect.width, rect.height * 720 / 660)
          const height = width * 660 / 720
          if (width !== this.data.sceneWidth || height !== this.data.sceneHeight) this.setData({ sceneWidth: width, sceneHeight: height })
        }).exec()
      })
    }
  }
})
