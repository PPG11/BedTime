const test = require('node:test'), assert = require('node:assert/strict')
const path = require('node:path'), fs = require('node:fs'), vm = require('node:vm')
const output = process.env.BEDTIME_TEST_OUTPUT
require.cache[require.resolve(path.join(output, 'config/runtime.js'))] = { exports: { runtime: { cloudEnvId: 'test-only', cloudEnabled: true } } }
const { growthApi, getChannelWrite, confirmChannelWrite } = require(path.join(output, 'services/growth.js'))
const { parseEntryRef, captureGrowthEntry } = require(path.join(output, 'utils/growth-entry.js'))
const now = Date.parse('2026-11-10T22:30:00+08:00'), cardId = 'a'.repeat(32)
const card = { cardId, nightId: '20261110', phraseText: '今天先到这里。', expiresAt: now + 30 * 86400000 }
const reply = data => ({ result: { code: 'OK', data } })
function transport(callback) { global.wx = { cloud: { init() {}, callFunction: callback } } }
const lights = () => ({ serverNow: now, nightId: '20261109', availableNightIds: ['20261109','20261108','20261107','20261106','20261105','20261104','20261103'], settledAt: now - 86400000, suppressed: true, total: null, buckets: [], currentNightId: '20261110', ownRecord: null })

test('M2 灯迹拒绝小样本泄漏和非法桶，公开夜签只投影允许公开的字段', async () => {
  for (const patch of [{ suppressed: true, total: 2 }, { suppressed: true, buckets: [{ startHour: 20, endHour: 30, count: 3 }] }, { suppressed: false, total: 5, buckets: [{ startHour: 20, endHour: 30, count: 2 }] }, { currentNightId: '20261109' }]) {
    transport(async () => reply({ ...lights(), ...patch }))
    await assert.rejects(growthApi.getLights(), e => e.code === 'INTERNAL')
  }
  transport(async ({name}) => { assert.equal(name, 'bedtimeGrowth'); return reply({ serverNow: now, status: 'active', card: { ...card, uid: 'private', confirmedAt: now } }) })
  assert.deepEqual((await growthApi.getPublicCard(cardId)).card, card)
  transport(async () => reply({ serverNow: now, status: 'active', card: { ...card, expiresAt: now - 1 } }))
  await assert.rejects(growthApi.getPublicCard(cardId), e => e.code === 'INTERNAL')
})

test('入口只解析合法ref，通用scene 0为未知，并发捕获合并且失败不影响页面', async () => {
  assert.equal(parseEntryRef({ query: { ref: 'rednote_nov' } }), 'rednote_nov')
  assert.equal(parseEntryRef({ query: { scene: encodeURIComponent('ref=share') } }), 'share')
  for (const value of ['0', '%xy', 'uid=abc', 'ref=bad%20value']) assert.equal(parseEntryRef({ query: { scene: value } }), null)
  let finish, calls = []
  transport(({data}) => { calls.push(data); return new Promise(resolve => { finish = resolve }) })
  const first = captureGrowthEntry(), second = captureGrowthEntry({query:{ref:'share'}})
  assert.equal(first, second); assert.deepEqual(calls, [{action:'captureEntry'}])
  finish(reply({serverNow:now,captured:true,source:'unknown'})); await first
  transport(async () => { throw new Error('offline') })
  await captureGrowthEntry({query:{ref:'share'}})
})

test('后台空样本保留null比例，错误分母与未经确认的汇总被拒绝', async () => {
  const empty = { activated:0,mature:0,immature:0,reachedThree:0,ratio:null }
  const data = { serverNow:now,from:'20261104',to:'20261110',totals:{users:0,records:0,activations:0,hold:0,tap:0},daily:[],retention:{...empty,cohorts:[]},channels:[],excludedAccounts:1,attributionHours:24,consistency:'checked' }
  transport(async () => reply(data)); assert.equal((await growthApi.getDashboard(data.from,data.to)).retention.ratio,null)
  transport(async () => reply({...data, retention:{...empty,ratio:0,cohorts:[]}})); await assert.rejects(growthApi.getDashboard(data.from,data.to), e=>e.code==='INTERNAL')
  transport(async () => reply({...data,consistency:'unknown'})); await assert.rejects(growthApi.getDashboard(data.from,data.to), e=>e.code==='INTERNAL')
})

function pageFixture(pageName) {
  let definition, uid='alice', creates=0, owned={serverNow:now,status:'none',card:null}, access=true
  const store={get:()=>({snapshot:{userId:uid}}),activate:async()=>true,hide(){},lookup:async()=>({nightId:card.nightId,phraseText:card.phraseText})}
  const api={getGrowthAccess:async()=>({serverNow:now,isAdmin:access}),getOwnedCard:async()=>owned,getPublicCard:async()=>owned,createPublicCard:async()=>{creates++;owned={serverNow:now,status:'active',card};return {...owned,created:true}},revokePublicCard:async()=>({serverNow:now,status:'revoked',card:null})}
  const context={Page:v=>{definition=v},exports:{},Date,Math,setTimeout,clearTimeout,wx:{showShareMenu(){},hideShareMenu(){},showModal(o){o.success({confirm:true})}},require(name){if(name==='../../state/night-store')return{nightStore:store};if(name==='../../services/growth')return{growthApi:api,isCardId:v=>/^[a-f0-9]{32}$/.test(v||''),isChannelCode:v=>/^[a-z0-9][a-z0-9_-]{1,31}$/.test(v||''),getChannelWrite:()=>null,waitChannelWrite:()=>null,confirmChannelWrite:()=>false};if(name==='../../utils/night-platform')return{restoreTabBar(){}};return require(path.resolve(output,'pages',pageName,name+'.js'))}}
  vm.runInNewContext(fs.readFileSync(path.join(output,'pages',pageName,'index.js'),'utf8'),context)
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(p){Object.assign(this.data,p)}};page.visible=true
  return {page,api,uid:v=>{uid=v},creates:()=>creates,owned:v=>{owned=v},access:v=>{access=v}}
}
test('公开卡先说明并同意再创建，创建回执不明可按原夜查回，不携带私人身份分享',async()=>{
 const f=pageFixture('public-card');f.page.onLoad({nightId:card.nightId});await f.page.reload();await f.page.onCreate();assert.equal(f.creates(),0)
 f.page.onConfirm({detail:{value:['agree']}});f.api.createPublicCard=async()=>{f.owned({serverNow:now,status:'active',card});throw new Error('lost ack')};await f.page.onCreate();assert.match(f.page.data.notice,/查看结果/)
 await f.page.reload();assert.equal(f.page.data.status,'active');assert.equal(f.page.onShareAppMessage().path,`/pages/public-card/index?cardId=${cardId}&ref=share`)
 await f.page.revoke(f.page.generation,cardId);assert.equal(f.page.data.card,null);assert.equal(f.page.data.status,'revoked')
})
test('公开卡晚到创建不更新隐藏或已切换身份页面，非法双地址不查询',async()=>{
 for(const outcome of ['hidden','identity']){const f=pageFixture('public-card');f.page.onLoad({nightId:card.nightId});await f.page.reload();f.page.onConfirm({detail:{value:['agree']}});let finish;f.api.createPublicCard=()=>new Promise(resolve=>{finish=resolve});const p=f.page.onCreate();if(outcome==='hidden')f.page.deactivate();else f.uid('bob');finish({serverNow:now,status:'active',card});await p;assert.equal(f.page.data.card,null,outcome)}
 const f=pageFixture('public-card');f.page.onLoad({nightId:card.nightId,cardId});let calls=0;f.api.getPublicCard=async()=>{calls++;throw new Error('must not call')};await f.page.reload();assert.equal(calls,0);assert.match(f.page.data.error,/地址无效/)
})
test('后台非管理员不请求统计，空权限态不泄漏上一身份数据',async()=>{
 const f=pageFixture('dashboard');f.access(false);let calls=0;f.api.getDashboard=async()=>{calls++;throw new Error('must not call')};await f.page.reload();assert.equal(calls,0);assert.equal(f.page.data.denied,true);assert.equal(f.page.data.report,null)
})

test('内置分享渠道可无创建时间，渠道列表不泄露管理员内部字段', async () => {
  const channel = { code: 'share', label: '句子卡分享', enabled: true, createdAt: 0, updatedAt: 0 }
  transport(async () => reply({ serverNow: now, channels: [{ ...channel, creatorUid: 'private' }] }))
  assert.deepEqual((await growthApi.getChannels()).channels, [channel])
})

test('撤销公开卡回执未知时停止分享，回读确认active后才恢复', async () => {
  const f = pageFixture('public-card'); f.page.onLoad({nightId:card.nightId}); f.owned({serverNow:now,status:'active',card}); await f.page.reload()
  f.api.revokePublicCard = async () => { throw new Error('lost acknowledgement') }
  await f.page.revoke(f.page.generation,cardId)
  assert.equal(f.page.data.revokeUnknown,true); assert.equal(f.page.onShareAppMessage().path, '/pages/night/index?ref=share'); assert.match(f.page.data.notice,/暂停分享/)
  await f.page.reload(); assert.equal(f.page.data.revokeUnknown,false); assert.equal(f.page.onShareAppMessage().path,`/pages/public-card/index?cardId=${cardId}&ref=share`)
})

test('渠道八秒仅改变等待感知，原写未结束不能发出后续写；结果不明须原内容恢复', async t => {
  t.mock.timers.enable({apis:['setTimeout']})
  let finish, calls=0
  const channel={code:'article',label:'文章入口',enabled:true,createdAt:now,updatedAt:now}
  transport(() => { calls++; return new Promise(resolve=>{finish=resolve}) })
  const saving=growthApi.saveChannel('article','文章入口',true,'channel-admin-test')
  t.mock.timers.tick(8000)
  assert.equal(getChannelWrite('channel-admin-test').pending,true)
  await assert.rejects(growthApi.saveChannel('article','文章入口',false,'channel-admin-test'),e=>e.code==='PENDING')
  assert.equal(calls,1)
  finish(reply({serverNow:now,channel}));await saving;assert.equal(getChannelWrite('channel-admin-test'),null)
  transport(async()=>{throw new Error('lost response')})
  await assert.rejects(growthApi.saveChannel('article','文章入口',false,'channel-admin-test'),e=>e.code==='NETWORK')
  assert.equal(getChannelWrite('channel-admin-test').unknown,true)
  await assert.rejects(growthApi.saveChannel('different','另一个入口',true,'channel-admin-test'),e=>e.code==='PENDING')
  assert.equal(confirmChannelWrite('channel-admin-test',[channel]),false)
  assert.equal(confirmChannelWrite('channel-admin-test',[{...channel,enabled:false}]),true)
})
test('灯迹七个日期均可选择，非法日期和加载期间不能触发读取',async()=>{
  const f=pageFixture('lights');const requests=[];f.api.getLights=async nightId=>{requests.push(nightId);return {...lights(),nightId:nightId||lights().nightId}}
  await f.page.reload();assert.equal(f.page.data.dates.length,7);assert.equal(f.page.data.hasDates,true);assert.match(f.page.data.dates[0].displayLabel,/当前选择/)
  f.page.onChooseNight();assert.equal(f.page.data.choosing,true)
  const last=f.page.data.dates[6].id;f.page.onNightSelected({currentTarget:{dataset:{night:last}}});for(let i=0;i<12;i++)await Promise.resolve()
  assert.equal(requests.at(-1),last);assert.equal(f.page.data.selected,6);assert.match(f.page.data.dates[6].displayLabel,/当前选择/);assert.equal(f.page.data.choosing,false)
  const count=requests.length;f.page.onNightSelected({currentTarget:{dataset:{night:'20260230'}}});assert.equal(requests.length,count)
})
test('渠道页保存期间重复操作不再写，隐藏后晚到结果不覆盖页面',async()=>{
  const f=pageFixture('channels');f.api.getChannels=async()=>({serverNow:now,channels:[{code:'article',label:'文章入口',enabled:true,createdAt:now,updatedAt:now}]});await f.page.reload()
  let finish,calls=0;f.api.saveChannel=()=>{calls++;return new Promise(resolve=>{finish=resolve})}
  const saving=f.page.save('article','文章入口',false)
  f.page.onToggle({currentTarget:{dataset:{code:'article'}}});assert.equal(calls,1);assert.equal(f.page.data.busy,true)
  f.page.deactivate();finish({serverNow:now,channel:{code:'article',label:'文章入口',enabled:false,createdAt:now,updatedAt:now}});await saving
  assert.equal(f.page.data.channels[0].enabled,true)
})
