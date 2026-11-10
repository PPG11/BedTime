// Inject after night-simulator.js while the tonight page is visible. Recompile
// to restore real services. Fail closed: no fixture request can reach the cloud.
function installGrowthSimulatorFixture() {
  const base = getApp().__nightFixture;
  if (!base) throw new Error('Install night-simulator.js first');
  const state = { isAdmin: true, suppressed: false, empty: false, mode: 'normal', status: 'none', calls: [], channels: [{code:'share',label:'句子卡分享',enabled:true,createdAt:0,updatedAt:0}] };
  getApp().__growthFixture = state;
  base.record = { nightId:base.nightId,confirmedAt:base.now,method:'tap',phraseId:'layout-only',phraseText:base.phrase,phraseVersion:1 };
  const day = offset => new Date(Date.UTC(Number(base.nightId.slice(0,4)),Number(base.nightId.slice(4,6))-1,Number(base.nightId.slice(6,8))+offset)).toISOString().slice(0,10).replace(/-/g,'');
  const card = () => ({cardId:'a'.repeat(32),nightId:base.nightId,phraseText:base.phrase,expiresAt:base.now+30*86400000});
  const cardReply = () => ({serverNow:base.now,status:state.status,card:state.status==='active'?card():null});
  wx.cloud.callFunction = async ({name,data}) => {
    if(name!=='bedtimeGrowth') throw new Error('Unexpected cloud request blocked by growth fixture');
    state.calls.push(data.action);
    const ok = result => ({result:{code:'OK',data:{serverNow:base.now,...result}}});
    if(state.mode==='error') throw new Error('Simulated connection failure');
    if(data.action==='captureEntry') return ok({captured:true,source:data.ref||'unknown'});
    if(data.action==='getGrowthAccess') return ok({isAdmin:state.isAdmin});
    if(data.action==='getLights') return ok({nightId:data.nightId||day(-1),availableNightIds:[1,2,3,4,5,6,7].map(n=>day(-n)),settledAt:base.now-86400000,suppressed:state.suppressed,total:state.suppressed?null:12,buckets:state.suppressed?[]:[{startHour:20,endHour:22,count:3},{startHour:22,endHour:24,count:5},{startHour:24,endHour:30,count:4}],currentNightId:base.nightId,ownRecord:base.record});
    if(data.action==='createPublicCard') {state.status='active';if(state.mode==='unknown')throw new Error('Simulated lost creation response');return ok({...cardReply(),created:true});}
    if(data.action==='revokePublicCard') {state.status='revoked';return ok(cardReply());}
    if(data.action==='getOwnedCard') return ok(cardReply());
    if(data.action==='getPublicCard') return ok({...cardReply(),status:state.status==='active'?'active':'unavailable'});
    if(data.action==='getChannels') return ok({channels:state.channels});
    if(data.action==='saveChannel') {const row={code:data.code,label:data.label,enabled:data.enabled,createdAt:base.now,updatedAt:base.now};state.channels=[...state.channels.filter(c=>c.code!==row.code),row];return ok({channel:row});}
    if(data.action==='getDashboard') {
      const n=state.empty?0:1, retention={activated:8*n,mature:5*n,immature:3*n,reachedThree:2*n,ratio:n?0.4:null};
      return ok({from:data.from,to:data.to,totals:{users:12*n,records:12*n,activations:8*n,hold:7*n,tap:5*n},daily:state.empty?[]:[{nightId:data.to,users:12,activations:8,hold:7,tap:5}],retention:{...retention,cohorts:[]},channels:[{code:'share',label:'句子卡分享',enabled:true,arrivals:12*n,matureArrivals:10*n,immatureArrivals:2*n,activations:5*n,convertedMature:4*n,conversionRate:n?0.4:null}],excludedAccounts:1,attributionHours:24,consistency:'checked'});
    }
    throw new Error('Unknown growth fixture action');
  };
  return {installed:true};
}
