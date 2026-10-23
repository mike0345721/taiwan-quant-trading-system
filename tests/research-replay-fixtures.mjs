// SYNTHETIC ENGINEERING FIXTURES ONLY. These attestations are not market evidence.
import {fileURLToPath} from 'node:url';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {digest,safety} from '../src/research-replay-outcome.mjs';
export const calendar=loadGovernedTradingCalendar(fileURLToPath(new URL('../config/taifex-official-calendar-2026.json',import.meta.url)));
export const seal=body=>({...body,sha256:digest(body)});
export const rules=seal({schemaVersion:'tx-replay-rules-v1',frozenAt:'2026-01-01T00:00:00Z',horizonMs:10000,maxGapMs:5000,
 stopPoints:3,targetPoints:6,feeTwdPerSide:50,pointValueTwd:200,slippageTicksPerSide:1,tickSize:1,taxRatePerSide:.00002,
 taxRounding:'CEIL_TWD_PER_SIDE',costSource:'SYNTHETIC_ENGINEERING_NOT_BROKER_QUOTE'});
export function fixture(date='2026-10-22',index=0){
 const at=Date.parse(date+'T02:00:00Z'),iso=x=>new Date(at+x).toISOString();
 const signal={eventId:'SYNTHETIC:'+date,actualContract:'TXFK6',tradeDate:date,session:'DAY',side:'LONG',
  signalAvailableAt:iso(0),featureAvailableAt:iso(-100),rulesSha256:rules.sha256,...safety,
  features:{quality:'READY',classifiedCoverage:1,actualContract:'TXFK6',tradeDate:date,session:'DAY',availableAt:iso(-100),
   imbalance5:index%2?.5:-.5,spreadTicks:index%3?1:8,bidDepth5:50,askDepth5:50,realizedVolPoints:10}};
 const tape=[10000,10000,10002,10008,9995,9997,10000,10003,10004,10002,10002].map((price,i)=>({
  actualContract:'TXFK6',exchangeTimestamp:iso(i*1000),availableAt:iso(i*1000+50),recordHash:digest([date,i]),
  price,simtrade:false,duplicate:false,sequenceGap:0}));
 const coverage=seal({schemaVersion:'tx-captured-path-audit-v1',sourceMode:'REAL_CAPTURE',captureStatus:'COMPLETE_VERIFIED',
  timestampViolations:0,sequenceGaps:0,droppedEvents:0,hashFailures:0,sourceSha256:digest('SYNTHETIC SOURCE'),
  auditReceiptSha256:digest('SYNTHETIC AUDIT'),calendarSha256:calendar.fileHash,tapeSha256:digest(tape),
  signalSha256:digest(signal),rulesSha256:rules.sha256,startAt:iso(0),endAt:iso(10000)});
 return {signal,rules,tape,coverage,calendar};
}
export function resealPath(f){f.coverage=seal({...Object.fromEntries(Object.entries(f.coverage).filter(([k])=>k!=='sha256')),
 tapeSha256:digest(f.tape),signalSha256:digest(f.signal)});return f;}
export const dates=[...calendar.tradingDates].filter(d=>d>='2026-08-03').sort().slice(0,24);
export function protocolFor(){
 const folds=Array.from({length:3},(_,i)=>({id:'fold'+i,trainEndAt:'2026-07-01T00:00:00Z',trainOutcomeAvailableAt:'2026-07-01T01:00:00Z',
  frozenAt:'2026-07-02T00:00:00Z',testStartAt:dates[i*8]+'T01:00:00Z',testEndAt:dates[i*8+7]+'T06:00:00Z',embargoMs:86400000,
  gates:{minDirectionalImbalance:.1,maxSpreadTicks:3,minDepth5:10,maxRealizedVolPoints:20}}));
 return seal({schemaVersion:'tx-incremental-protocol-v1',frozenAt:'2026-07-02T00:00:00Z',folds,oosDates:dates,
  horizonMs:10000,outcomeRulesSha256:rules.sha256,blockLength:5,bootstrapDraws:5000});
}
