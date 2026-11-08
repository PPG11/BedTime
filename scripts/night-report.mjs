import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import time from '../cloudfunctions/common/night-time.js'
import { parseArgs, assert, asOf, privatePath, loadExport, writePrivate, isNightId, nightDay, addDays, DAY, beijingDay } from './lib/night-admin.mjs'

export function buildReport({ manifest, collections }, { from, to, cutoff, exclude }) {
  assert(isNightId(from) && isNightId(to) && from <= to, '激活夜范围无效')
  assert(Array.isArray(exclude) && exclude.every(uid => typeof uid === 'string' && uid), '排除名单必须显式提供 OPENID 数组')
  const excluded = new Set(exclude), currentNight = time.resolveNight(cutoff).nightId
  const requiredEnd = [addDays(to, 6), currentNight].sort()[0]
  assert(from <= currentNight, '分析截止时间早于激活范围')
  const meta = manifest.collections.n_nights
  assert(meta.scope === 'all', '汇总必须包含范围内所有用户的夜晚记录')
  if (collections.n_events) assert(manifest.collections.n_events.complete === true && manifest.collections.n_events.scope === 'all', '事件汇总必须使用完整范围导出')
  assert(isNightId(meta.from) && isNightId(meta.to) && meta.from <= from && meta.to >= requiredEnd && meta.complete === true, '夜晚记录导出范围不足以覆盖 A 至 A+6')
  assert(manifest.collections.n_users.complete === true && manifest.collections.n_users.scope === 'all', '必须提供完整用户摘要')
  assert(Date.parse(manifest.exportedAt) >= cutoff, '导出时间早于分析截止时间')
  const users = new Map(collections.n_users.map(user => [user.uid, user]))
  assert(users.size === collections.n_users.length, '用户摘要 uid 重复')
  const nights = collections.n_nights
  const seen = new Set(), issues = []
  for (const row of nights) {
    assert(typeof row.uid === 'string' && isNightId(row.nightId) && row.nightId >= meta.from && row.nightId <= meta.to && ['hold', 'tap'].includes(row.method) && Number.isFinite(row.confirmedAt), '夜晚记录字段或范围无效')
    const key = `${row.uid}_${row.nightId}`
    assert(row._id === key && !seen.has(key), '单人单夜记录重复或 ID 无效'); seen.add(key)
    const user = users.get(row.uid)
    if (!user || !isNightId(user.firstNightId) || row.nightId < user.firstNightId || row.nightId > user.lastNightId) issues.push('记录与用户摘要不一致')
  }
  for (const user of users.values()) {
    assert(typeof user.uid === 'string' && user._id === user.uid && (user.firstNightId === null || isNightId(user.firstNightId)) && (user.lastNightId === null || isNightId(user.lastNightId)), '用户摘要字段无效')
    if ((user.firstNightId === null) !== (user.lastNightId === null) || (user.firstNightId && user.firstNightId > user.lastNightId)) issues.push('摘要范围不一致')
    for (const id of new Set([user.firstNightId, user.lastNightId])) {
      if (id && id >= meta.from && id <= meta.to && !seen.has(`${user.uid}_${id}`)) issues.push('摘要指向的记录缺失')
    }
  }
  const eligible = nights.filter(row => !excluded.has(row.uid) && row.confirmedAt <= cutoff)
  const perNight = new Map(), methods = { hold: 0, tap: 0 }, weeks = new Map()
  for (const row of eligible.filter(row => row.nightId >= from && row.nightId <= requiredEnd)) {
    const item = perNight.get(row.nightId) || { nightId: row.nightId, users: 0, activations: 0 }
    item.users++; if (users.get(row.uid)?.firstNightId === row.nightId) item.activations++
    perNight.set(row.nightId, item); methods[row.method]++
  }
  for (const user of users.values()) {
    const a = user.firstNightId
    if (excluded.has(user.uid) || !a || a < from || a > to) continue
    const first = eligible.find(row => row.uid === user.uid && row.nightId === a)
    if (!first) continue
    const day = new Date(nightDay(a)).getUTCDay(), week = addDays(a, -((day + 6) % 7))
    const group = weeks.get(week) || { activationWeek: week, activated: 0, mature: 0, immature: 0, reachedThree: 0, ratio: null }
    group.activated++
    if (cutoff >= nightDay(a) + 6 * DAY + 22 * 3600000) {
      group.mature++
      const count = eligible.filter(row => row.uid === user.uid && row.nightId >= a && row.nightId <= addDays(a, 6)).length
      if (count >= 3) group.reachedThree++
    } else group.immature++
    weeks.set(week, group)
  }
  for (const group of weeks.values()) group.ratio = issues.length || !group.mature ? null : group.reachedThree / group.mature
  const imageResults = {}, eventStart = addDays(beijingDay(cutoff), -29), eventEnd = beijingDay(cutoff)
  const eventSeen = new Set()
  for (const event of collections.n_events || []) {
    const key = `${event.uid}_${event.eventId}`
    assert(typeof event.uid === 'string' && /^[a-f0-9]{32}$/.test(event.eventId) && event._id === key && isNightId(event.receivedDateKey), '事件字段无效')
    if (excluded.has(event.uid) || eventSeen.has(key) || event.receivedDateKey < eventStart || event.receivedDateKey > eventEnd) continue
    eventSeen.add(key)
    if (event.name !== 'card_export_result') continue
    assert(['render','save'].includes(event.props?.stage) && typeof event.props.ok === 'boolean' && ['OK','RENDER_FAILED','SAVE_DENIED','SAVE_FAILED'].includes(event.props.code), '图片事件字段无效')
    const label = `${event.props.stage}:${event.props.code}`; imageResults[label] = (imageResults[label] || 0) + 1
  }
  return { version: 1, env: manifest.env, from, to, asOf: new Date(cutoff).toISOString(), excludedAccounts: excluded.size,
    consistent: !issues.length, consistencyIssueCount: issues.length, nightly: [...perNight.values()].sort((a,b) => a.nightId.localeCompare(b.nightId)),
    cohorts: [...weeks.values()].sort((a,b) => a.activationWeek.localeCompare(b.activationWeek)), methods, imageResults,
    events: { supplied: !!collections.n_events, from: eventStart, to: eventEnd, receivedSamples: eventSeen.size, incompleteByDesign: true },
    source: { exportedAt: manifest.exportedAt, collections: manifest.collections },
    interpretation: '3/7 衡量当前 M1 组合的复用；事件可能丢失，不证明入睡或停止使用手机。' }
}
export function markdown(report) {
  return `# 今晚关灯只读汇总\n\n范围：${report.from}—${report.to}；截止：${report.asOf}。排除 ${report.excludedAccounts} 个作者或测试账号。\n\n一致性：${report.consistent ? '通过' : `发现 ${report.consistencyIssueCount} 项，先修复再解释指标`}。\n\n| 激活周 | 激活 | 成熟 | 未成熟 | 至少三夜 | 3/7 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${report.cohorts.map(row => `| ${row.activationWeek} | ${row.activated} | ${row.mature} | ${row.immature} | ${row.reachedThree} | ${row.ratio === null ? '暂无结论' : (row.ratio * 100).toFixed(1) + '%'} |`).join('\n')}\n\n已完成记录的方式：长按 ${report.methods.hold}，轻点 ${report.methods.tap}。\n\n${report.interpretation}\n\n逐夜人数、图片结果样本和导出校验清单见同目录 report.json；不输出逐人记录。\n`
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2)), input = privatePath(args.input), output = privatePath(args.out)
    const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'), 'utf8'))
    const data = loadExport(input, ['n_users', 'n_nights', ...(manifest.collections?.n_events ? ['n_events'] : [])])
    const exclude = JSON.parse(fs.readFileSync(privatePath(args.exclude), 'utf8'))
    const report = buildReport(data, { from: args.from, to: args.to, cutoff: asOf(args['as-of']), exclude })
    writePrivate(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); writePrivate(path.join(output, 'report.md'), markdown(report))
    console.log(`聚合报告已写入 ${output}；一致性${report.consistent ? '通过' : '有缺口'}`)
    if (!report.consistent) process.exitCode = 2
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
