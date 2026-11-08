const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
function fixture(saveError = 'saveImageToPhotosAlbum:fail auth deny') {
  const output = process.env.BEDTIME_TEST_OUTPUT, events = []
  let definition, uid = 'alice', privacy = true, saves = 0, privacyReply
  const record = { nightId: '20261107', confirmedAt: Date.parse('2026-11-07T22:30:00+08:00'), method: 'hold', phraseText: '今天先到这里。', phraseId: 'p1', phraseVersion: 1 }
  const store = { get: () => ({ snapshot: { userId: uid } }), activate: async () => true, hide() {}, lookup: async () => uid === 'alice' ? record : null }
  const wx = {
    getPrivacySetting(options) { if (privacy === 'pending') privacyReply = options.success; else options.success({ needAuthorization: privacy }) },
    saveImageToPhotosAlbum(options) { saves++; options.fail({ errMsg: saveError }) }
  }
  const context = vm.createContext({ Page: value => { definition = value }, wx, require(name) {
    if (name === '../../state/night-store') return { nightStore: store, nightEvents: { record: event => events.push(event) } }
    return require(path.resolve(output, 'pages/receipt', name + '.js'))
  }, exports: {} })
  vm.runInContext(fs.readFileSync(path.join(output, 'pages/receipt/index.js'), 'utf8'), context)
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  page.visible = true; page.nightId = record.nightId; page.record = record
  page.data.imagePath = 'tmp://private-alice.png'; page.preview = { userId: uid, nightId: record.nightId, path: page.data.imagePath }
  return { page, events, saves: () => saves, privacy: value => { privacy = value }, uid: value => { uid = value }, resolvePrivacy: () => privacyReply({ needAuthorization: false }) }
}

test('隐私尚未同意不访问相册；取消与相册拒绝都保留夜签预览', async () => {
  const f = fixture(), p = f.page
  await p.onSave(); assert.equal(f.saves(), 0); assert.equal(p.data.privacyNeeded, true)
  p.onPrivacyCancel(); assert.equal(p.data.privacyNeeded, false); assert.equal(p.data.imagePath, 'tmp://private-alice.png')
  assert.equal(f.events.length, 0, '主动暂不保存不记为权限拒绝')
  f.privacy(false); await p.onSave()
  assert.equal(f.saves(), 1); assert.equal(p.data.saveDenied, true); assert.equal(p.data.imagePath, 'tmp://private-alice.png')
  await p.onSave(); assert.equal(f.saves(), 1, '不重复弹出授权')
  p.deactivate(); p.visible = true; await p.reload()
  assert.equal(p.data.imagePath, 'tmp://private-alice.png', '从权限设置返回可重新查看预览')
  f.uid('bob'); await p.reload(); assert.equal(p.data.imagePath, ''); assert.equal(p.preview, null)
})

test('系统保存取消保留预览与重试入口，不显示设置或记录权限拒绝', async () => {
  const f = fixture('saveImageToPhotosAlbum:fail cancel'); f.privacy(false)
  await f.page.onSave()
  assert.equal(f.page.data.saveDenied, false); assert.equal(f.page.data.saving, false)
  assert.match(f.page.data.notice, /已取消保存/); assert.equal(f.page.data.imagePath, 'tmp://private-alice.png')
  assert.equal(f.events.length, 0)
  await f.page.onSave(); assert.equal(f.saves(), 2)
})

test('普通保存失败不冒充权限拒绝，仍允许重试', async () => {
  for (const error of ['saveImageToPhotosAlbum:fail system error', 'authorize:fail network error', 'scope.writePhotosAlbum unavailable']) {
    const f = fixture(error); f.privacy(false)
    await f.page.onSave()
    assert.equal(f.page.data.saveDenied, false); assert.equal(f.events[0].props.code, 'SAVE_FAILED')
    await f.page.onSave(); assert.equal(f.saves(), 2)
  }
})

test('保存前的异步隐私查询跨身份返回，不能继续保存旧账号图片', async () => {
  const f = fixture(); f.privacy('pending')
  const saving = f.page.onSave()
  f.uid('bob'); f.resolvePrivacy(); await saving
  assert.equal(f.saves(), 0)
  assert.equal(f.events.length, 0)
})
