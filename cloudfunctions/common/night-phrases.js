const { DAY, nightDay } = require('./night-time')

// One canonical text per stable ID. Published IDs keep their original wording.
// New wording gets a new ID and a version that starts on a future night.
// Historical-only IDs stay here so the original schedules remain reproducible.
const PHRASE_CATALOG = {
  p001: '今天就到这里。剩下的，明天再说。',
  p002: '今晚不卷，卷被子。',
  p003: '手里的光，今晚就看到这里。',
  p004: '不用替今天再补一个结尾。',
  p005: '待办清单翻到背面，也是一张白纸。',
  p006: '今天先收到这里，不急着整理。',
  p007: '没回完的消息，明天会自己变旧。',
  p008: '现在可以暂停，不用写理由。',
  p009: '给今天留个句号，也留点余地。',
  p010: '灯先关上，答案不用今晚交。',
  p011: '手指也该下班了。',
  p012: '先把这一刻，交还给自己。',
  p013: '今晚就停在这一扇窗前。',
  p014: '没收好的念头，可以先放在旁边。',
  p015: '关灯不是认输，是给明天留电。',
  p016: '明天的清单，明天再打开。',
  p017: '灯关上了，话也可以少一点。',
  p018: '谢谢你今晚没有硬撑。',
  p019: '今晚的最后一件事，是停下来。',
  p020: '先把手空出来，接住这一点安静。',
  p021: '今天先装进抽屉，明天再打开。',
  p022: '让这盏灯替今天说一句：到这里。',
  p023: '没有说完的话，可以留在下一页。',
  p024: '被子是今晚最小的避难所。',
  p025: '夜里这点空白，就先空着。',
  p026: '今天的尾巴，轻轻放下来。',
  p027: '明天还没开始，今晚可以先结束。',
  p028: '夜色不催交卷，这一页可以留白。',
  p029: '暂停也是一个完整的动作。',
  p030: '留下一句晚安，其他的先放一放。',
  q001: '枕头从不已读不回。',
  q002: '今天走了很远，现在可以停下来。',
  q003: '被窝没有广告，也不弹通知。',
  q004: '这一天，到这里刚好。',
  q005: '月亮已经上岗，你可以下线了。',
  q006: '不必圆满，到这里就好。',
  q007: '屏幕熄灭的那一秒，最像句号。',
  q008: '今天没做完的，不算欠账。',
  q009: '热搜今晚也会自己降温。',
  q010: '有些事，天亮了会换个样子。',
  q011: '没刷完的视频，明天它们还在。',
  q012: '屋里留一点暗，也留一点安静。',
  q013: '再刷一条，和上一条也没什么不同。',
  q014: '慢一点，今天已经够了。',
  q015: '这不是偷懒，是关机维护。',
  q016: '把今天放回原处，明天再取。',
  q017: '进入省电模式：今晚不接新任务。',
  q018: '想不明白的事，先放一晚。',
  q019: '今晚不接新需求，明天再议。',
  q020: '灯光暗下来，心事也可以小声一点。',
  q021: '今天存个档，不用通关。',
  q022: '悄悄把今天合上。',
  q023: '今天的烦恼已打包，明天自提。',
  q024: '手一空，心也松一点。',
  q025: '别人的生活，今晚可以静音。',
  q026: '今天也尽力了，轻轻道个别。',
  q027: '夜里想通的事，天亮再认一遍。',
  q028: '今天做到哪里，就是哪里。',
  q029: '灯一关，今天的烂摊子归明天管。',
  q030: '一天的收尾，只需要一个很小的动作。',
  q031: '眼睛忙了一天，让它看一会儿黑。',
  q032: '灯一熄，今天就有了边界。',
  q033: '把今天折一折，塞到枕头底下。',
  q034: '剩下的力气，留给明天的你。',
  q035: '晚安不用发出去，留给自己就行。',
  q036: '终于，没有什么要再看的了。',
  q037: '世界更新不完，今晚先不更。',
  q038: '一个人的夜，也可以很完整。',
  q039: '群消息已排队，明天依次处理。',
  q040: '让这一晚，慢慢变暗。',
  q041: '今晚的最佳操作，是不操作。',
  q042: '夜很长，不必赶。',
  q043: '白天的你很能干，夜里可以随便一点。',
  q044: '此刻不用成为谁。',
  q045: '床是一个不用回复的地方。',
  q046: '手心里的世界，先合上一会儿。',
  q047: '把自己放平，就算离线。',
  q048: '今天的信息太多，留到明天消化。',
  q049: '灯关上，手机又变回一块玻璃。',
  q050: '夜里有点凉，把被子拉高一点。',
  q051: '夜里适合收东西：杯子、外套，还有今天。',
  q052: '明天的事，交给明天的你。',
  q053: '今晚的你，不欠谁一个回复。',
  q054: '今晚的路，先走到枕边。',
  q055: '截止日期之外，也留一点夜晚。',
  q056: '把今天说过的话，都放轻一点。',
  q057: '你关灯，月亮替你值夜。',
  q058: '窗外不管多热闹，这里可以静一会儿。',
  q059: '什么时候关灯，都算刚刚好。',
  q060: '今天不必打分，到这里就好。',
  q061: '白天已经熬过了，夜里不用再熬。',
  q062: '今天不必夸，也不必怪。',
  q063: '把亮着的东西，一样一样熄掉。',
  q064: '夜晚替你把今天收拢。',
  q065: '今天不必总结陈词。',
  q066: '呼出一口气，今天就轻了一点。',
  q067: '你离线这一晚，世界照常运转。',
  q068: '暗下来的屏幕，是今天的最后一页。',
  q069: '未读的红点不会跑，它们很有耐心。',
  q070: '手机放下了，今天也可以放下了。',
  s001: '冬至的长夜，不用急着过完。',
  s002: '跨年不一定要醒着，新的一年天亮会到。',
  s003: '新年第一晚，先好好关一次灯。',
  s004: '除夕，一整年收个尾，轻轻合上。',
  s005: '年才刚开始，不用一晚上用完。',
  s006: '元宵夜灯多，你只需要关自己这一盏。'
}

// Versioned schedules contain only IDs; shared texts are never copied between pools.
// v1: the original 30-night order. v2: 70 new lines and 20 retained original lines.
// v2 starts with 30 new lines, preserving the no-repeat window at the transition.
const PHRASE_SCHEDULES = [
  {
    poolVersion: 1, effectiveNightId: '19000101', anchorNightId: '20261107',
    ids: [
      'p001', 'p002', 'p003', 'p004', 'p005', 'p006', 'p007', 'p008', 'p009', 'p010',
      'p011', 'p012', 'p013', 'p014', 'p015', 'p016', 'p017', 'p018', 'p019', 'p020',
      'p021', 'p022', 'p023', 'p024', 'p025', 'p026', 'p027', 'p028', 'p029', 'p030'
    ],
    specialIds: {}
  },
  {
    poolVersion: 2, effectiveNightId: '20261111', anchorNightId: '20261111',
    ids: [
      'q001', 'q002', 'q003', 'q004', 'q005', 'q006', 'q007', 'q008', 'q009', 'q010',
      'q011', 'q012', 'q013', 'q014', 'q015', 'q016', 'q017', 'q018', 'q019', 'q020',
      'q021', 'q022', 'q023', 'q024', 'q025', 'q026', 'q027', 'q028', 'q029', 'q030',
      'q031', 'q032', 'p002', 'q033', 'q034', 'p001', 'q035', 'q036', 'p005', 'q037',
      'q038', 'p004', 'q039', 'q040', 'p007', 'q041', 'q042', 'p010', 'q043', 'q044',
      'p011', 'q045', 'q046', 'p013', 'q047', 'q048', 'p015', 'q049', 'q050', 'p019',
      'q051', 'q052', 'p018', 'q053', 'q054', 'p027', 'q055', 'q056', 'p024', 'q057',
      'q058', 'p029', 'q059', 'q060', 'p028', 'q061', 'q062', 'p009', 'q063', 'q064',
      'p012', 'q065', 'q066', 'p025', 'q067', 'q068', 'p026', 'q069', 'q070', 'p003'
    ],
    // Special dates replace the rotation slot. The night ID is the evening's date,
    // including when a user closes the light after midnight.
    specialIds: {
      '20261222': 's001',
      '20261231': 's002',
      '20270101': 's003',
      '20270205': 's004',
      '20270206': 's005',
      '20270220': 's006'
    }
  }
]

const entryFor = id => ({ id, text: PHRASE_CATALOG[id] })
const PHRASE_SEGMENTS = PHRASE_SCHEDULES.map(({ ids, specialIds, ...segment }) => ({
  ...segment,
  pool: ids.map(entryFor),
  specials: Object.fromEntries(Object.entries(specialIds).map(([night, id]) => [night, entryFor(id)]))
}))

// Keep the last version whose effective night is not later than the requested night.
// Schedules are append-only after deployment; frozen database rows always win.
function segmentFor(nightId) {
  let found = PHRASE_SEGMENTS[0]
  for (const segment of PHRASE_SEGMENTS) if (segment.effectiveNightId <= nightId) found = segment
  return found
}

function phraseForNight(nightId, frozenAt) {
  const segment = segmentFor(nightId)
  const base = { nightId, phraseVersion: segment.poolVersion, poolVersion: segment.poolVersion, frozenAt }
  const special = segment.specials[nightId]
  if (special) return { ...base, phraseId: special.id, text: special.text, source: 'special' }
  const { pool } = segment
  const days = Math.round((nightDay(nightId) - nightDay(segment.anchorNightId)) / DAY)
  const entry = pool[((days % pool.length) + pool.length) % pool.length]
  return { ...base, phraseId: entry.id, text: entry.text, source: 'rotation' }
}

module.exports = { phraseForNight, PHRASE_SEGMENTS, PHRASE_CATALOG }
