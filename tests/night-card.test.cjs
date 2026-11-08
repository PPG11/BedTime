const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { wrapPhrase, renderNightCard, CARD_SIZE } = require(path.join(process.env.BEDTIME_TEST_OUTPUT, 'utils/night-card.js'))

test('夜签换行保留原句、避免标点开头和开括号行尾，不缩小长句', () => {
  for (const phrase of ['今天就到这里。剩下的，明天再说。', '给今天留个句号，也留点余地。（明天的事，明天再说。）', '窗'.repeat(40)]) {
    const lines = wrapPhrase(phrase, 800, text => Array.from(text).length * 54)
    assert.equal(lines.join(''), phrase); assert.ok(lines.length <= 4)
    assert.ok(lines.every(line => !'，。！？、；：）》】'.includes(line[0]) && !'（《【'.includes(line.at(-1))))
  }
})

test('导出画布固定1080×1440，只绘制原句、夜晚日期和品牌，不绘制精确动作时间或身份', async () => {
  const texts = [], images = []
  const ctx = { fillRect() {}, createLinearGradient() { return { addColorStop() {} } }, drawImage(...args) { images.push(args) }, measureText(value) { return { width: value.length * 54 } }, fillText(value) { texts.push(value) } }
  const canvas = { width: 0, height: 0, getContext() { return ctx }, createImage() { return { set src(value) { this.value = value; this.onload() } } } }
  let params
  global.wx = { canvasToTempFilePath(options) { params = options; options.success({ tempFilePath: '/local/card.png' }) } }
  const phrase = '窗'.repeat(40)
  const result = await renderNightCard(canvas, { nightId: '20261107', phraseText: phrase, confirmedAt: 1234567890, uid: 'private-uid' })
  assert.equal(result, '/local/card.png'); assert.deepEqual({ width: canvas.width, height: canvas.height }, CARD_SIZE)
  assert.equal(params.destWidth, 1080); assert.equal(params.destHeight, 1440); assert.equal(params.fileType, 'png')
  assert.equal(images.length, 3); assert.equal(texts.slice(0, -2).join(''), phrase)
  for (const [, x, y, width, height, , , destWidth, destHeight] of images) {
    assert.equal(x, 0); assert.ok(y >= 0 && y + height <= 660)
    assert.ok(Math.abs(destWidth / width - destHeight / height) < 1e-9, '等比例裁切，不拉伸楼与窗')
  }
  assert.deepEqual(texts.slice(-2), ['2026 年 11 月 7 日的夜晚', '今晚关灯'])
  assert.ok(!texts.join('').includes('private-uid') && !texts.join('').includes('1234567890'))
})
