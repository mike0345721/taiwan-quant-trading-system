// Local candidate oracle comparison. Reads existing accepted cutoffs only; never
// advances an existing producer, modifies a ledger or emits raw records/private
// paths. --archive also validates the NEW ignored/private candidate page store.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {readCvdGeneration} from '../src/cru55-dynamic-materializer.mjs';
import {REPO,assertCandidate,assertInputPath} from '../src/cru55-dynamic-isolation.mjs';
import {createStreamCheckpoint,appendStreamRecord,streamCurrent} from '../src/cru55-stream-core.mjs';
import {createStreamStore} from '../src/cru55-stream-store.mjs';
import {digest,stableJson} from '../src/cvd-observation-core.mjs';
import {evaluateBestQuoteEligibility} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {classifyTxChartSession} from '../src/dashboard-tx-chart.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {projectGeneration} from '../src/cru55-dynamic-projection.mjs';
assertCandidate();
if(process.env.CRU55_RUNTIME_BINDING)throw Error('CANDIDATE_ORACLE_ONLY');
const calendar=loadGovernedTradingCalendar(path.join(REPO,'config/taifex-official-calendar-2026.json'));
const resolveSessionTradeDate=t=>{const c=classifyTxChartSession(t,calendar);return {session:c.session,tradeDate:c.sessionTradeDate};};
const results=[];
const archive=process.argv.includes('--archive');
for(const run of process.argv.slice(2).filter(x=>x!=='--archive')){
  const g=readCvdGeneration(run);if(!g||g.endByteOffset>64*1024*1024)throw Error('BOUNDED_ORACLE_GENERATION_REQUIRED');
  const fd=fs.openSync(assertInputPath(g.sourceBinding.path),'r'),bytes=Buffer.alloc(g.endByteOffset);
  try{let n=0;while(n<bytes.length){const got=fs.readSync(fd,bytes,n,bytes.length-n,n);if(!got)throw Error('SOURCE_TRUNCATED');n+=got;}}
  finally{fs.closeSync(fd);}
  assert.equal(digest(bytes),g.prefixSha256);
  const rows=bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse),points=[],segments=[],quotes=[];
  let checkpoint=createStreamCheckpoint(g.sourceLedgerIdentity,g.checkpoint.state.resolverIdentity),maxCheckpointBytes=0;
  for(const record of rows){
    const next=appendStreamRecord(checkpoint,record,{resolveSessionTradeDate,lookupQuote:(tick,{afterOrdinal})=>quotes.findLast(q=>q.ledgerOrdinal>afterOrdinal&&evaluateBestQuoteEligibility(q,tick).eligible)??null});
    checkpoint=JSON.parse(JSON.stringify(next.checkpoint)); // process-restart serialization boundary
    if(next.event?.kind==='futures_bidask')quotes.push(next.event);
    if(next.point){points.push(next.point);segments[next.point.segment]=checkpoint.state.activeSegment;}
    maxCheckpointBytes=Math.max(maxCheckpointBytes,Buffer.byteLength(JSON.stringify(checkpoint)));
  }
  const expected=g.result.semantic,actual=streamCurrent(checkpoint);
  for(const key of ['sourceLedgerIdentity','resolverIdentity','cutoffLedgerOrdinal','cutoffRecordHash','value','availableAt','lastTradeAvailableAt','cutoffReceivedAt','currentReason','activeIdentity'])assert.deepEqual(actual[key],expected[key],key);
  assert.deepEqual(points,expected.series);assert.deepEqual(segments,expected.segments);
  // Reconstruct only this already accepted finite oracle, not a new paged public
  // contract or a fabricated truncated full-history hash.
  const reconstructed={...expected,series:points,segments};
  assert.equal(digest(stableJson(reconstructed)),g.result.semanticHash);
  const before=projectGeneration(g,rows,calendar).view;
  const after=projectGeneration({...g,result:{semantic:reconstructed,semanticHash:g.result.semanticHash}},rows,calendar).view;
  assert.deepEqual(after,before);
  let archiveEvidence=null;
  if(archive){
    const options={root:path.join(REPO,'data','cru55-stream-oracle',run),sourceLedgerIdentity:g.sourceLedgerIdentity,resolverIdentity:g.checkpoint.state.resolverIdentity};
    let store=createStreamStore(options),current=store.read(),processedRecords=0;
    assert.ok(current.checkpoint.state.ordinal<=rows.length,'archive cutoff cannot exceed oracle');
    if(current.checkpoint.state.ordinal)assert.equal(current.checkpoint.state.terminalHash,rows[current.checkpoint.state.ordinal-1].recordHash);
    for(let offset=current.checkpoint.state.ordinal;offset<rows.length;offset+=128){
      const batch=rows.slice(offset,offset+128);let quoteCursor=null,done;
      for(;;){try{done=store.append(batch,{resolveSessionTradeDate,quoteCursor});break;}catch(e){if(e.code!=='STREAM_QUOTE_QUERY_PENDING')throw e;quoteCursor=e.cursor;store=createStreamStore(options);}}
      processedRecords+=batch.length;store=createStreamStore(options);assert.equal(store.read().headPageHash,done.headPageHash);
      assert.equal(store.append(batch,{resolveSessionTradeDate}).state,'UNCHANGED');
    }
    current=store.read();assert.equal(current.checkpoint.stateHash,checkpoint.stateHash);
    let auditCursor=null,audit;
    do{audit=store.auditHistory({auditCursor});auditCursor=audit.cursor;}while(audit.state==='PENDING');
    archiveEvidence={processedRecords,headPageHash:current.headPageHash,checkpointHash:current.checkpoint.stateHash,audit};
  }
  results.push({run,sourceLedgerIdentity:g.sourceLedgerIdentity,generationHash:g.generationHash,cutoffLedgerOrdinal:actual.cutoffLedgerOrdinal,cutoffRecordHash:actual.cutoffRecordHash,cvd:actual.value,pointCount:points.length,segmentCount:segments.length,maxCheckpointBytes,
    sixWindowOracleParity:Object.keys(after.relationships),sessionParity:true,handoffNullPriorParity:true,oracleKind:'ACCEPTED_BOUNDED_REAL_HISTORY',restartBoundary:'JSON_EVERY_RECORD',fullDayProjectionReady:false,archiveEvidence});
}
if(!results.length)throw Error('RUN_IDS_REQUIRED');
console.log(JSON.stringify({state:'PASS',results},null,2));
