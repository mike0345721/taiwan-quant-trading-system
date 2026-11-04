import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSourceFreshness, SOURCE_METADATA, dailySourceStatus,sourceStatusesForSnapshot } from '../src/data-quality.mjs';
import {combineMarketBreadthSources} from '../src/market-data.mjs';

test('margin is pending before official 21:00 production window', () => {
  const source = { ok: true, stale: true, dataDate: '2026-07-09', fallbackFromCache: false };
  assert.equal(evaluateSourceFreshness('margin', source, '2026-07-13', new Date('2026-07-13T10:00:00Z')), 'pending_publication');
});

test('old margin becomes stale after production window', () => {
  const source = { ok: true, stale: true, dataDate: '2026-07-09', fallbackFromCache: false };
  assert.equal(evaluateSourceFreshness('margin', source, '2026-07-13', new Date('2026-07-13T14:00:00Z')), 'stale');
});

test('daily official sources remain pending before their own publication windows', () => {
  const old = { ok: true, stale: true, dataDate: '2026-07-16' };
  assert.equal(evaluateSourceFreshness('spotInstitutional', old, '2026-07-17', new Date('2026-07-17T06:00:00Z')), 'pending_publication');
  assert.equal(evaluateSourceFreshness('options', old, '2026-07-17', new Date('2026-07-17T08:00:00Z')), 'pending_publication');
  assert.equal(evaluateSourceFreshness('options', old, '2026-07-17', new Date('2026-07-17T09:00:00Z')), 'stale');
});

test('cache and failures are never shown as current', () => {
  assert.equal(evaluateSourceFreshness('options', { ok: true, stale: true, fallbackFromCache: true }, '2026-07-13'), 'cached');
  assert.equal(evaluateSourceFreshness('options', { ok: false }, '2026-07-13'), 'failed');
  assert.match(SOURCE_METADATA.largeTraders.scope, /TX\+MTX\/4\+TMF\/20/);
});

test('latest Friday data remains current on a closed weekend', () => {
  const source = { ok: true, stale: true, dataDate: '2026-07-17', fallbackFromCache: false };
  assert.equal(evaluateSourceFreshness('options', source, '2026-07-17', new Date('2026-07-18T10:00:00Z')), 'current');
});

const calendar={tradingDates:new Set(['2026-11-03','2026-11-04','2026-11-06']),nonTradingDates:new Set(['2026-11-05','2026-11-07']),exceptions:new Map()};
test('daily cards distinguish due time, missing run, failed run, source delay, stale quality and qualified data',()=>{
  const old={ok:true,stale:true,dataDate:'2026-11-03',fetchedAt:'2026-11-04T00:30:00Z'};
  const status=(source,time='2026-11-04T10:00:00Z')=>dailySourceStatus('options',source,{now:new Date(time),calendar});
  assert.equal(status(old,'2026-11-04T07:00:00Z').status,'NOT_DUE');
  assert.equal(status(old).status,'JOB_NOT_RUN');
  assert.equal(status({...old,ok:false,error:'HTTP 503',fetchedAt:'2026-11-04T09:00:00Z'}).status,'JOB_FAILED');
  assert.equal(status({...old,fetchedAt:'2026-11-04T09:00:00Z'}).status,'SOURCE_NOT_PUBLISHED');
  assert.equal(status({...old,dataDate:'2026-11-04',fetchedAt:'2026-11-04T09:00:00Z'}).status,'STALE');
  const good={...old,stale:false,dataDate:'2026-11-04',fetchedAt:'2026-11-04T09:00:00Z'};
  assert.equal(status(good).status,'AVAILABLE');
  assert.equal(status(good).sourceTime,null,'fetch time is not a source publication timestamp');
  assert.equal(status(good).lastSuccessfulAt,good.fetchedAt);
  assert.equal(status({...old,fallbackFromCache:true,error:'timeout',fetchedAt:'2026-11-04T09:00:00Z'}).lastSuccessfulAt,null,
    'a legacy cache with overwritten fetchedAt cannot manufacture an earlier success');
});
test('governed holiday uses the actual last trading date and aggregate batch failure cannot hide eligible card data',()=>{
  const now=new Date('2026-11-05T10:00:00Z'),source={ok:true,stale:true,staleReason:'DATA_DATE_BEFORE_CALENDAR_DAY',dataDate:'2026-11-04',fetchedAt:'2026-11-04T09:00:00Z'};
  const snapshot={asOfDate:'2026-11-04',options:source,batchStatus:'FAILED',sources:{options:{ok:true}}};
  const result=sourceStatusesForSnapshot(snapshot,{now,calendar});
  assert.equal(result.options.update.targetDate,'2026-11-04');assert.equal(result.options.update.status,'AVAILABLE');
  assert.equal(snapshot.sources.options.update,undefined,'reader decoration must not mutate the stored source');
  assert.equal(dailySourceStatus('options',source,{now}).reason,'CALENDAR_UNVERIFIED');
  assert.equal(dailySourceStatus('options',{...source,staleReason:'SOURCE_QUALITY_STALE'},{now,calendar}).status,'STALE');
  assert.equal(dailySourceStatus('options',{...source,stale:false,fetchedAt:'2026-11-06T00:00:00Z'},{now,calendar}).status,'STALE');
});

test('breadth composite preserves failed refresh and never promotes attempt time or fresher child to complete success',()=>{
  const old={ok:true,stale:true,dataDate:'2026-11-03',fetchedAt:'2026-11-04T09:00:00Z',fallbackFromCache:true,error:'timeout',data:{advance:1}};
  const good={ok:true,stale:false,dataDate:'2026-11-04',fetchedAt:'2026-11-04T09:00:00Z',data:{advance:2}};
  const mixed=combineMarketBreadthSources(old,good,{fetchedAt:'2026-11-04T09:00:00Z'});
  assert.equal(mixed.lastSuccessfulAt,null);assert.equal(mixed.fallbackFromCache,true);assert.equal(mixed.dataDate,'2026-11-03');
  assert.equal(dailySourceStatus('marketBreadth',mixed,{calendar,now:new Date('2026-11-04T10:00:00Z')}).status,'JOB_FAILED');
  const preserved=combineMarketBreadthSources(old,old,{previous:{lastSuccessfulAt:'2026-11-03T09:00:00Z'}});
  assert.equal(preserved.lastSuccessfulAt,'2026-11-03T09:00:00Z');
});
