import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialTaiexClose, fetchOfficialTaiexClose, TWSE_INDEX_URL } from '../src/official-twse-cash-close.mjs';
import { buildLiveBasis } from '../src/market-pulse-live.mjs';

const now = new Date('2026-10-21T12:00:00.000Z');
const cashDate = '2026-10-21';
const receivedAt = '2026-10-21T06:01:00.000Z';
const rows = () => [
  { '日期': '1151021', '指數': '寶島股價指數', '收盤指數': '30000.10', '特殊處理註記': '' },
  { '日期': '1151021', '指數': '發行量加權股價指數', '收盤指數': '27,234.56', '特殊處理註記': '' },
];
const parse = (data=rows(), config={}) => parseOfficialTaiexClose(data, {
  expectedCashDate:cashDate,receivedAt,now,...config,
});
function nightChart() { return {
  session:'NIGHT',tradeDate:'2026-10-22',actualContract:'TXFK6',lastPrice:27300,
  availableAt:'2026-10-21T11:59:30.000Z',
  bars:[{sessionId:'2026-10-21-NIGHT'}],
}; }
const build=(ref,chart=nightChart())=>buildLiveBasis({
  chart, bridgeLatest:{state:'UNAVAILABLE',data:null},cashCloseReference:ref,now,
});
test('official parser accepts one exact TWSE weighted-index cash close with source evidence',()=>{
 const ref=parse();assert.equal(ref.kind,'TWSE_OFFICIAL_TAIEX_CASH_CLOSE');
 assert.equal(ref.indexName,'發行量加權股價指數');assert.equal(ref.close,27234.56);
 assert.equal(ref.date,cashDate);assert.equal(ref.sourceUrl,TWSE_INDEX_URL);
 assert.equal(ref.publisherTimestamp,null);assert.equal(ref.executionAuthorized,false);
 assert.equal(ref.orderRoutesEnabled,false);
});
test('official parser fails closed on wrong/ambiguous/future/special data',()=>{
 const mutations=[
  ()=>[],()=>[...rows(),rows()[1]],
  ()=>rows().map(v=>({...v,'日期':'1151020'})),
  ()=>rows().map(v=>({...v,'日期':'1151022'})),
  ()=>rows().map(v=>({...v,'特殊處理註記':'暫停'})),
  ()=>rows().map(v=>({...v,'收盤指數':'0'})),
  ()=>rows().map(v=>({...v,'收盤指數':'NaN'})),
  ()=>rows().map(v=>({...v,'收盤指數':'27,abc'})),
 ];
 for(const fn of mutations)assert.equal(parse(fn()),null);
 assert.equal(parse(rows(),{receivedAt:'2026-10-21T05:29:59.000Z'}),null);
 assert.equal(parse(rows(),{receivedAt:'2026-10-21T13:00:00.000Z'}),null);
 assert.equal(parse(rows(),{expectedCashDate:'2026-10-20'}),null);
});
test('only official exact cash-close date can qualify a NIGHT closed-session reference',()=>{
 const ref=parse();const r=build(ref);
 assert.equal(r.state,'SESSION_CLOSED_REFERENCE');assert.ok(Math.abs(r.points - 65.44) < 1e-8);
 assert.equal(r.spotPrice,27234.56);assert.equal(r.spotTradeDate,cashDate);
 assert.equal(r.referenceMode,'TWSE_OFFICIAL_LAST_CASH_CLOSE');
 assert.equal(r.sourceReference,'TWSE_OFFICIAL_CASH_CLOSE');
 assert.equal(r.sourcePublisherTimestamp,null);
 assert.equal(r.executionAuthorized,undefined);
});
test('NIGHT rejects wrong date, source, time, zero or unsafe reference',()=>{
 for(const delta of [
  {date:'2026-10-20'}, {source:'YAHOO'}, {kind:'unverified'},
  {receivedAt:'2026-10-21T05:00:00.000Z'},
  {close:0},{close:null},{executionAuthorized:true},{orderRoutesEnabled:true},
 ]){
  const result=build({...parse(),...delta});
  assert.equal(result.state,'UNAVAILABLE',JSON.stringify(delta));
  assert.equal(result.reason,'IX0001_REFERENCE_UNAVAILABLE');
 }
});
test('DAY cannot silently use official after-close reference as live IX0001',()=>{
 const r=build(parse(),{...nightChart(),session:'DAY',tradeDate:'2026-10-21'});
 assert.equal(r.state,'UNAVAILABLE');assert.equal(r.reason,'IX0001_REFERENCE_UNAVAILABLE');
});
test('fetch uses official exact source and refuses network or published-date failures',async()=>{
 let seen=null;
 const good=await fetchOfficialTaiexClose({expectedCashDate:cashDate,now,fetchImpl:async(url,options)=>{
  seen={url,signal:options.signal};return {ok:true,json:async()=>rows()};
 }});
 assert.equal(seen.url,TWSE_INDEX_URL);assert.ok(seen.signal);
 assert.equal(good.close,27234.56);
 assert.equal(await fetchOfficialTaiexClose({expectedCashDate:cashDate,now,fetchImpl:async()=>{throw Error('offline')}}),null);
 assert.equal(await fetchOfficialTaiexClose({expectedCashDate:cashDate,now,fetchImpl:async()=>({ok:false})}),null);
 assert.equal(await fetchOfficialTaiexClose({expectedCashDate:'2026-10-20',now,fetchImpl:async()=>({ok:true,json:async()=>rows()})}),null);
});

test('market pulse passes the vetted official night close without promoting RVOL or order access', async()=>{
 const {buildMarketPulseLive}=await import('../src/market-pulse-live.mjs');
 const pulse=buildMarketPulseLive({chart:nightChart(),bridgeLatest:{data:null},cashCloseReference:parse(),archiveDir:'/no-archive',now});
 assert.equal(pulse.basis.state,'SESSION_CLOSED_REFERENCE');
 assert.equal(pulse.basis.referenceMode,'TWSE_OFFICIAL_LAST_CASH_CLOSE');
 assert.equal(pulse.rvol.state,'UNAVAILABLE');
 assert.equal(pulse.executionAuthorized,false);
 assert.equal(pulse.orderRoutesEnabled,false);
});
