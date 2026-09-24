import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionPrimitives } from '../src/cru55-stream-projection.mjs';
import { beginRangeAppend, createRangeReader, beginRangeQuery, advanceRangeQuery, beginRangeQueries, advanceRangeQueries } from '../src/cru55-projection-range-index.mjs';
const {accumulator,accumulate}=projectionPrimitives;
function fixture(count,{fractional=false,late=false}={}){
  let buy=0;return Array.from({length:count},(_,i)=>{
    const volume=fractional?[.1,.2,.3,.7][i%4]:1+i%7;buy+=volume;
    const eventMs=100000+i*1000-(late&&i%13===0?5000:0),availableMs=200000+i*1000;
    return {e:{ledgerOrdinal:i+1,recordHash:'record'+i,availableMs,eventMs,availableAt:new Date(availableMs).toISOString(),eventTime:new Date(eventMs).toISOString(),identityStatus:'USABLE',availabilityLineageStatus:'USABLE',payload:{close:100+i%5+(fractional?.1:0),volume}},
      p:{ledgerOrdinal:i+1,recordHash:'record'+i,value:buy,buyProxyVolume:buy,sellProxyVolume:0,availableAt:new Date(availableMs).toISOString(),eventTime:new Date(eventMs).toISOString(),reason:null},pressure:{buyProxyVolume:volume,sellProxyVolume:0,totalExecutedVolume:volume,unknownVolume:0}};
  });
}
function index(rows,size=8){const files=new Map();let roots=[];for(let start=0;start<rows.length;start+=size){const b=beginRangeAppend(roots,(h,p)=>files.set(h,JSON.parse(JSON.stringify(p))));for(let i=start;i<Math.min(start+size,rows.length);i++){const r=rows[i];b.append(r.e,r.p,rows[i-1]?.p??null,r.pressure);}roots=b.finish();}return{roots,files};}
test('range queries exactly preserve physical predecessor, selected path, late windows and fractional folds',()=>{
  for(const fractional of [false,true])for(const late of [false,true]){
    const rows=fixture(97,{fractional,late}),{roots,files}=index(rows),read=createRangeReader(h=>files.get(h));
    for(const [lower,upper]of [[90000,300000],[120000,143000],[150000,190000],[129000,131000]]){
      const expected=accumulator();rows.forEach((r,i)=>{if(r.e.eventMs>lower&&r.e.eventMs<=upper)accumulate(expected,r.e,r.p,rows[i-1]?.p??null,r.pressure);});
      const q=advanceRangeQuery(beginRangeQuery(roots,{lo:1,hi:97,lower,upper,available:Infinity}),read);
      assert.deepEqual(q.acc,expected,{fractional,late,lower,upper});
      if(!fractional&&lower===90000)assert.ok(q.aggregateNodes>0);
      if(fractional&&lower===90000)assert.equal(q.orderedLeaves,97,'unsafe aggregate must retain exact leaf fold');
    }
  }
});
test('query cursor survives byte/page budget interruptions without replaying completed nodes',()=>{
  const {roots,files}=index(fixture(97)),q=beginRangeQuery(roots,{lo:3,hi:94},'display');
  let current=q,interruptions=0;
  while(current.stack.length){let reads=0;const read=createRangeReader(h=>{if(++reads>2)throw Error('BUDGET');return files.get(h);});try{advanceRangeQuery(current,read);}catch(e){assert.equal(e.message,'BUDGET');interruptions++;current=JSON.parse(JSON.stringify(current));}}
  const expected=advanceRangeQuery(beginRangeQuery(roots,{lo:3,hi:94},'display'),createRangeReader(h=>files.get(h)));
  assert.ok(interruptions>0);assert.deepEqual(current,expected);
});
test('content addressed range pages reject tampering',()=>{
  const {roots,files}=index(fixture(5));const page=files.get(roots[0].ref.hash);page.nodes[0].summary.acc.buy++;
  assert.throws(()=>advanceRangeQuery(beginRangeQuery(roots,{lo:1,hi:5},'display'),createRangeReader(h=>files.get(h))),/RANGE_PAGE_CHANGED/);
});

test('simultaneous fractional/late window and display queries resume exactly across page budgets',()=>{
  const {roots,files}=index(fixture(97,{fractional:true,late:true}));
  const specs=[{kind:'window',filter:{lo:1,hi:97,lower:90000,upper:300000,available:400000}},{kind:'window',filter:{lo:3,hi:94,lower:120000,upper:143000,available:260000}},{kind:'display',filter:{lo:7,hi:81}},{kind:'display',filter:{lo:85,hi:84}}];
  let state=beginRangeQueries(roots,specs,80),interruptions=0;
  while(state.stack.length){let reads=0;const read=createRangeReader(h=>{if(++reads>2)throw Error('BUDGET');return files.get(h);});try{advanceRangeQueries(state,read);}catch(e){assert.equal(e.message,'BUDGET');interruptions++;state=JSON.parse(JSON.stringify(state));}}
  assert.ok(interruptions>0);assert.ok(state.unsafeHistoricalLeaves>=80);
  assert.deepEqual(state,advanceRangeQueries(beginRangeQueries(roots,specs,80),createRangeReader(h=>files.get(h))));
  for(let i=0;i<specs.length;i++){const q=advanceRangeQuery(beginRangeQuery(roots,specs[i].filter,specs[i].kind),createRangeReader(h=>files.get(h)));assert.deepEqual(state.results[i].acc,q.acc);assert.deepEqual(state.results[i].display,q.display);}
});
