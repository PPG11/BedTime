Component({
  properties: {
    opacity: { type: Number, value: 0 }, phraseOpacity: { type: Number, value: 0 },
    phrase: { type: String, value: '' }, done: { type: Boolean, value: false },
    top: { type: Number, value: 76 },
    demo: { type: Boolean, value: false }, notice: { type: String, value: '' }
  },
  methods: {
    onEnd() { this.triggerEvent('finish') },
    onReturn() { this.triggerEvent('returnnight') }
  }
})
