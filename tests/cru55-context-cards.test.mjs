import test from 'node:test';
import assert from 'node:assert/strict';
import {contextModels} from '../public/cru55-context-cards.mjs';
test('context cards preserve missing data, gated institutional deltas and separate source dates',()=>{
 const rows=contextModels({futuresInstitutional:{ok:true,dataDate:'2026-09-15',data:{foreignNet:0,foreignNetDelta:0,deltaAvailable:false}},marketOverview:{ok:true,dataDate:'2026-09-14',data:{twii:{price:42000}}}});
 assert.equal(rows[0].date,'2026-09-14');assert.equal(rows[2].date,'2026-09-15');assert.deepEqual(rows[2].values[0],['外資淨未平倉 · 口','0']);assert.deepEqual(rows[2].values[1],['單日變化 · 口','不可用']);assert.ok(rows[3].values.every(([k,v])=>!v.includes('0')));
 assert.equal(contextModels(null).length,6);assert.ok(contextModels(null)[0].values.every(([k,v])=>v==='不可用'));
});
test('failed sources cannot leak cached values and NDX remains explicitly a proxy',()=>{
 const rows=contextModels({marketOverview:{ok:false,data:{twii:{price:123}}},globalContext:{latest:[{symbol:'NDX',tradeDate:'2026-09-09',close:29000}]}});
 assert.equal(rows[0].values[0][1],'不可用');assert.match(rows[4].values[0][0],/NDX 代理/);assert.equal(rows[4].global.some(x=>x.symbol==='NQ'),false);
});
