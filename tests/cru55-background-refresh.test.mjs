import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FRAMES,relationshipExplanation } from '../public/cru55-presentation.mjs';

import {observationV1} from '../public/cru55-observation.mjs';
const source=fs.readFileSync(new URL('../public/cru55-formal-overview.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const snapshot=date=>({asOfDate:date,marketOverview:{ok:true,dataDate:date,data:{twii:{price:date==='A'?100:200}}}});
const cvd=()=>({artifactHash:'same-artifact',chart:{actualContract:'TXFJ6'},relationship:{current:{current:{deltaCvd:7}}}});

// Execute the real browser module and event wiring. Only chart drawing and card
// layout are replaced: this test covers request scheduling and independent truth.
async function harness(){
  let now=0,interval,lowerValue=snapshot('A'),cvdValue=cvd();
  const nodes=new Map(),requests=[],signals=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{dataset:{},style:{},open:false,hidden:false,textContent:'',value:'',listeners:{},
      classList:{remove(){},add(){},toggle(){}},setAttribute(name,value){this[name]=value;},replaceChildren(...children){this.children=children;},append(){},
      addEventListener(name,fn){this.listeners[name]=fn;},close(){this.open=false;this.listeners.close?.();},focus(){},reset(){}});
    return nodes.get(id);
  };
  const document={listeners:{},hidden:false,body:{dataset:{}},getElementById:node,querySelector:node,createElement:()=>node(Symbol()),addEventListener(name,fn){this.listeners[name]=fn;}};
  node('login').hidden=true;
  const fetch=async(route,{signal}={})=>{
    requests.push(route);const value=route==='/api/auth/login'?{}:route==='/api/lower'?lowerValue:cvdValue;
    const pending=typeof value==='function'?value():value;
    const data=await Promise.race([Promise.resolve(pending),new Promise((_,reject)=>signal?.addEventListener('abort',()=>reject(Error('timeout')),{once:true}))]);
    if(data instanceof Error)throw data;
    return {ok:!data?.httpStatus,status:data?.httpStatus??200,json:async()=>data};
  };
  const context={document,fetch,FRAMES,relationshipExplanation,window:{addEventListener(){}},Option:function(text,value){return {text,value};},
    Date:{now:()=>now},AbortSignal:{timeout(ms){const controller=new AbortController();signals.push({ms,controller});return controller.signal;}},
    renderObservation(host,data,frame){const m=observationV1(data,frame,now);host.dataset.state=m.state;return m;},contextSummary:()=>'',
    renderContextCards(host,data){host.data=data;},setInterval(fn){interval=fn;return 1;},clearInterval(){},Promise,
    windowPresentation:()=>({state:'UNAVAILABLE',label:'不可用',tone:'neutral'}),pressureCells:()=>({cells:0,direction:'neutral'}),
    evidenceDirection:()=>({symbol:'—',direction:'neutral'}),signed:()=>'',fmt:()=>''};
  vm.createContext(context);
  const code=source.replace(/^import .*;\r?\n/gm,'').replace(/\r?\nawait bootstrap\(\);/,
    '\nrender=data=>{document.body.dataset.endpoint="7";document.body.dataset.error="false";renderLower();};\nawait bootstrap();');
  const api=await vm.runInContext(`(async()=>{${code}\nreturn {refreshLower,load,state:()=>({lower,current,lowerLoading,lowerError})};})()`,context);
  return {api,node,document,requests,signals,setLower:value=>lowerValue=value,setCvd:value=>cvdValue=value,
    advance(ms){now+=ms;interval();},async refresh(){node('refresh').listeners.click();await tick();}};
}

test('manual refresh replaces background A with B without reload/login; timer respects 60s TTL',async()=>{
  const h=await harness();assert.equal(h.node('lower-cards').data.asOfDate,'A');
  h.setLower(snapshot('B'));await h.refresh();
  assert.equal(h.node('lower-cards').data.asOfDate,'B');assert.match(h.node('lower-date').textContent,/HISTORICAL · B/);
  assert.equal(h.requests.filter(x=>x==='/api/lower').length,2);
  h.advance(59_999);await tick();assert.equal(h.requests.filter(x=>x==='/api/lower').length,2);
  h.advance(1);await tick();assert.equal(h.requests.filter(x=>x==='/api/lower').length,3);
  assert.ok(h.requests.every(x=>x==='/api/lower'||x.startsWith('/api/v1/cvd-overview?')));
});

test('overlapping refreshes share one background request; timeout clears only background and permits recovery',async()=>{
  const h=await harness(),wait=deferred();h.setLower(()=>wait.promise);
  const first=h.api.refreshLower({force:true}),signal=h.signals.at(-1);
  assert.equal(h.api.refreshLower({force:true}),first);await h.refresh();
  assert.equal(h.requests.filter(x=>x==='/api/lower').length,2);assert.equal(signal.ms,10000);
  assert.match(h.node('lower-date').textContent,/HISTORICAL · A.*更新中/);
  h.node('drawer').open=true;h.node('drawer').dataset.source='background';
  signal.controller.abort();await first;
  assert.equal(h.api.state().lower,null);assert.equal(h.node('lower-cards').data,null);
  assert.match(h.node('lower-date').textContent,/UNAVAILABLE.*失敗/);assert.equal(h.node('drawer').open,false);
  assert.equal(h.api.state().current.artifactHash,'same-artifact');assert.equal(h.document.body.dataset.endpoint,'7');
  h.advance(5000);await tick();assert.equal(h.requests.filter(x=>x==='/api/lower').length,2);
  h.setLower(snapshot('B'));await h.refresh();assert.equal(h.node('lower-cards').data.asOfDate,'B');
  wait.resolve(snapshot('LATE'));await tick();assert.equal(h.node('lower-cards').data.asOfDate,'B');
});

test('CVD failure does not erase refreshed background; null background stays unavailable',async()=>{
  const h=await harness();h.setCvd(Error('CVD unavailable'));h.setLower(snapshot('B'));await h.refresh();
  assert.equal(h.api.state().current,null);assert.equal(h.document.body.dataset.endpoint,'null');
  assert.equal(h.node('lower-cards').data.asOfDate,'B');assert.match(h.node('lower-date').textContent,/HISTORICAL · B/);
  h.setLower(null);h.setCvd(cvd());await h.refresh();
  assert.equal(h.node('lower-cards').data,null);assert.match(h.node('lower-date').textContent,/UNAVAILABLE/);
  assert.equal(h.document.body.dataset.endpoint,'7');assert.equal(h.api.state().lowerError,null);
});

test('background TTL runs independently during a pending CVD read and stops in hidden tabs',async()=>{
  const h=await harness(),wait=deferred();h.setCvd(()=>wait.promise);const pending=h.api.load();
  h.setLower(snapshot('B'));h.advance(60000);await tick();
  assert.equal(h.node('lower-cards').data.asOfDate,'B');
  const count=h.requests.length;h.document.hidden=true;h.advance(60000);await tick();assert.equal(h.requests.length,count);
  wait.resolve(cvd());await pending;
});

test('background 401 keeps login visible even when concurrent CVD succeeds',async()=>{
  const h=await harness(),wait=deferred();h.setLower({httpStatus:401});h.setCvd(()=>wait.promise);
  await h.refresh();assert.equal(h.node('login').hidden,false);assert.equal(h.node('lower-cards').data,null);
  wait.resolve(cvd());await tick();
  assert.equal(h.document.body.dataset.endpoint,'7');assert.equal(h.node('login').hidden,false);
});

test('successful reauthentication discards pre-login background success or 401 without clearing new inflight read',async()=>{
  for(const oldResponse of [snapshot('OLD'),{httpStatus:401}]){
    const h=await harness(),old=deferred(),fresh=deferred();h.setLower(()=>old.promise);
    const obsolete=h.api.refreshLower({force:true});
    h.setLower(()=>fresh.promise);h.node('access').value='test-password';
    const login=h.node('login').listeners.submit({preventDefault(){}});await tick();
    assert.equal(h.requests.filter(x=>x==='/api/lower').length,3);
    old.resolve(oldResponse);await obsolete;
    assert.equal(h.node('login').hidden,true);assert.equal(h.api.state().lowerLoading,true);
    assert.equal(h.api.state().lower.asOfDate,'A');
    fresh.resolve(snapshot('B'));await login;
    assert.equal(h.node('lower-cards').data.asOfDate,'B');assert.equal(h.node('login').hidden,true);
    assert.equal(h.api.state().lowerLoading,false);assert.equal(h.node('access').value,'');
  }
});

test('display clock ages while CVD request is pending and on returning to the tab',async()=>{
  const h=await harness(),stamp=new Date(0).toISOString();
  const d={...cvd(),kind:'SYNTHETIC_FIXTURE',chart:{actualContract:'TXFI6',lastTradeAvailableAt:stamp,sourceMode:'PINNED_STREAM_CANDIDATE_GENERATION',freshness:{state:'HISTORICAL'}},
    context:{scope:'OBSERVED_SEGMENT_TO_NOW',cumulativeCvd:7},relationship:{current:{anchorEventTime:stamp,current:{deltaCvd:7}}}};
  h.setCvd(d);await h.api.load();const wait=deferred();h.setCvd(()=>wait.promise);const pending=h.api.load();
  h.advance(10001);await tick();assert.equal(h.node('cvd-observation').dataset.state,'DEGRADED');
  h.advance(20000);await tick();assert.equal(h.node('cvd-observation').dataset.state,'DELAYED');
  h.document.hidden=true;h.advance(70000);h.document.hidden=false;h.document.listeners.visibilitychange();
  assert.equal(h.node('cvd-observation').dataset.state,'STALE');
  wait.resolve(d);await pending;
});
