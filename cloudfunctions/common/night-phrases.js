const { DAY, nightDay } = require('./night-time')

// v1.1 initial pool, reviewed before its first cloud deployment (2026-11-08).
// Never edit a frozen n_phrases / n_nights document to change its wording.
const TEXTS = [
  '今天就到这里。剩下的，明天再说。',
  '今晚不卷，卷被子。',
  '手里的光，今晚就看到这里。',
  '不用替今天再补一个结尾。',
  '待办清单翻到背面，也是一张白纸。',
  '今天先收到这里，不急着整理。',
  '没回完的消息，明天会自己变旧。',
  '现在可以暂停，不用写理由。',
  '给今天留个句号，也留点余地。',
  '灯先关上，答案不用今晚交。',
  '手指也该下班了。',
  '先把这一刻，交还给自己。',
  '今晚就停在这一扇窗前。',
  '没收好的念头，可以先放在旁边。',
  '关灯不是认输，是给明天留电。',
  '明天的清单，明天再打开。',
  '灯关上了，话也可以少一点。',
  '谢谢你今晚没有硬撑。',
  '今晚的最后一件事，是停下来。',
  '先把手空出来，接住这一点安静。',
  '今天先装进抽屉，明天再打开。',
  '让这盏灯替今天说一句：到这里。',
  '没有说完的话，可以留在下一页。',
  '被子是今晚最小的避难所。',
  '夜里这点空白，就先空着。',
  '今天的尾巴，轻轻放下来。',
  '明天还没开始，今晚可以先结束。',
  '夜色不催交卷，这一页可以留白。',
  '暂停也是一个完整的动作。',
  '留下一句晚安，其他的先放一放。'
]

function phraseForNight(nightId, frozenAt) {
  const days = Math.round((nightDay(nightId) - nightDay('20261107')) / DAY)
  const index = ((days % TEXTS.length) + TEXTS.length) % TEXTS.length
  return { nightId, phraseId: `p${String(index + 1).padStart(3, '0')}`, text: TEXTS[index], phraseVersion: 1, poolVersion: 1, source: 'rotation', frozenAt }
}

module.exports = { phraseForNight }
