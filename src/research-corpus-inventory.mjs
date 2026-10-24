// Stage 1 only: metadata and bounded field samples never certify a full session.
import fs from 'node:fs';
import path from 'node:path';
import {bytesHash,readBounded} from './t0-outcome-linkage.mjs';
import {safety} from './research-replay-outcome.mjs';
import {buildLiveEventRecord} from './live-event-ledger.mjs';
import {projectGovernedL5} from './microstructure-outcome-research-v1.mjs';
import {classifyTxChartSession} from './dashboard-tx-chart.mjs';
import {validCalendarDate} from './research-evidence-contract-v1.mjs';

const record = (file, bytes) => ({file,bytes:bytes.length,sha256:bytesHash(bytes)});
export function inventoryResearchCorpus({sourceRoot,priorScreeningFile=null}) {
  const ledgerRoot = path.join(sourceRoot,'data/live-events');
  const names = fs.readdirSync(ledgerRoot).filter(n => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(n)).sort();
  if (names.length > 1000) throw Error('CORPUS_METADATA_FILE_LIMIT');
  const evidence = [], files = names.map(file => {
    const stat = fs.statSync(path.join(ledgerRoot,file)), auditFile = path.join(ledgerRoot,'audits',file.replace('.ndjson','.json'));
    let existingAudit = null;
    if (fs.existsSync(auditFile)) {
      try {
        const bytes = readBounded(auditFile), audit = JSON.parse(bytes);
        evidence.push(record(auditFile,bytes));
        existingAudit = {generatedAt:audit.generatedAt ?? null,events:audit.events ?? null,
          hashFailures:audit.hashFailures ?? null,invalidLines:audit.invalidLines ?? null,
          status:'INHERITED_METADATA_NOT_CURRENT_PREFIX_PROOF'};
      } catch (e) { existingAudit = {status:'UNREADABLE_BOUNDED_METADATA',reason:e.message}; }
    }
    return {file,calendarDateFromFilename:file.slice(0,10),bytes:stat.size,mtime:stat.mtime.toISOString(),
      tradeDate:null,session:null,qualificationClass:null,qualificationState:'UNASSESSED',
      reasonCodes:['CALENDAR_FILE_IS_NOT_A_TRADING_SESSION','FULL_SESSION_AND_CANONICAL_FLOW_REPLAY_PENDING'],existingAudit};
  });
  let sessions = [], priorEvidence = null;
  if (priorScreeningFile) {
    const bytes = readBounded(priorScreeningFile), receiptFile = path.join(path.dirname(priorScreeningFile),'audit-receipt.json');
    const receiptBytes = readBounded(receiptFile), receipt = JSON.parse(receiptBytes);
    const pin = receipt.artifacts?.find(a => a.file === path.basename(priorScreeningFile));
    if (pin?.sha256 !== bytesHash(bytes) || pin?.bytes !== bytes.length) throw Error('PRIOR_SCREENING_RECEIPT_MISMATCH');
    const rows = JSON.parse(bytes);
    if (!Array.isArray(rows) || rows.length > 1000) throw Error('PRIOR_SCREENING_ROWS_INVALID');
    const identities = new Set();
    sessions = rows.map(s => {
      const key = `${s.tradeDate}|${s.session}`;
      if (!validCalendarDate(s.tradeDate) || !['DAY','NIGHT'].includes(s.session) || identities.has(key)) throw Error('PRIOR_SCREENING_IDENTITY_INVALID');
      identities.add(key);
      return {...s,previousClass:s.class ?? null,class:null,eligibleWindows:null,
        qualificationState:'PENDING_CURRENT_PREFIX_AND_SEMANTIC_VERIFICATION',
        evidenceStatus:'HISTORICAL_SCREENING_NOT_REVALIDATED',
        reasonCodes:[...new Set([...(s.reasonCodes || []),'RAW_PREFIX_NOT_REVERIFIED_THIS_RUN','CANONICAL_CVD_PRESSURE_RESPONSE_PARITY_PENDING'])]};
    });
    priorEvidence = {screening:record(priorScreeningFile,bytes),receipt:record(receiptFile,receiptBytes),
      receiptStatus:receipt.status ?? null,authenticity:'LOCAL_RECEIPT_BINDING_ONLY_NOT_NEW_ACCEPTANCE'};
  }
  return {schemaVersion:'research-corpus-stage1-inventory-v1',state:'STAGE1_INVENTORY_COMPLETE_STAGE2_PENDING',
    files,sessions,metadataEvidence:evidence,priorEvidence,
    summary:{calendarFiles:files.length,totalBytes:files.reduce((n,f)=>n+f.bytes,0),
      historicalScreeningSessions:sessions.length,daySessions:sessions.filter(s=>s.session==='DAY').length,
      nightSessions:sessions.filter(s=>s.session==='NIGHT').length,
      historicalExcludedSessions:sessions.filter(s=>s.screeningState==='EXCLUDED_MARKET_CLOSED').length,
      historicalApplicableSessions:sessions.filter(s=>s.screeningState!=='EXCLUDED_MARKET_CLOSED').length,
      qualifiedFullDays:null,qualifiedWindowDays:null,fragmentDays:null,rejectedDays:null,
      assessedCurrentSessions:0,unassessedCalendarFiles:files.length,
      hypothesisResearchReady:false,reason:'NO_CURRENT_SESSION_LEVEL_QUALIFICATION'},
    rawContentBytesRead:0,rawHashesComputed:0,fullCorpusAuditCompleted:false,...safety};
}

export function probeHistoricalDepthTail({sourceRoot,date,calendar,maxBytes=1024*1024}) {
  if (!validCalendarDate(date) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024*1024) throw Error('BOUNDED_SAMPLE_ARGUMENT_INVALID');
  const file = path.join(sourceRoot,'data/live-events',`${date}.ndjson`), before = fs.statSync(file);
  const start = Math.max(0,before.size-maxBytes), length = before.size-start, buffer = Buffer.alloc(length);
  const fd = fs.openSync(file,'r'); let read = 0;
  try { while(read < length) { const n=fs.readSync(fd,buffer,read,length-read,start+read); if(!n)break; read+=n; } } finally { fs.closeSync(fd); }
  const after = fs.statSync(file), unchanged = before.size===after.size && before.mtimeMs===after.mtimeMs && read===length;
  const chunk = buffer.subarray(0,read), first = start>0 ? chunk.indexOf(10)+1 : 0, last = chunk.lastIndexOf(10);
  const lines = last>=first ? chunk.subarray(first,last).toString('utf8').split('\n').filter(x=>x.trim()) : [];
  let malformed=0,hashFailures=0,txTicks=0,txQuotes=0,previous=null;
  const groups=new Map(),rejections={};
  for(const line of lines) {
    let r; try { r=JSON.parse(line); } catch { malformed++; continue; }
    const {recordHash,...body}=r;
    const valid=buildLiveEventRecord(body,body.previousHash).recordHash===recordHash && (previous===null || body.previousHash===previous);
    previous=recordHash;
    if (!valid) { hashFailures++; continue; }
    if (r.payload?.productFamily!=='TX') continue;
    if(r.kind==='futures_tick')txTicks++;
    if(r.kind!=='futures_bidask')continue;
    txQuotes++;
    let identity;
    try { identity=classifyTxChartSession(r.receivedAt,calendar); } catch { rejections.IDENTITY_UNAVAILABLE=(rejections.IDENTITY_UNAVAILABLE||0)+1; continue; }
    const sample=projectGovernedL5(r,{asOfAvailableAt:r.receivedAt,actualContract:r.payload.actualContract,
      tradeDate:identity.tradeDate,session:identity.session,tickSize:1,calendar});
    if(sample.state!=='FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED') { rejections[sample.reason]=(rejections[sample.reason]||0)+1; continue; }
    const key=`${sample.sessionId}|${sample.actualContract}`,g=groups.get(key)||{
      tradeDate:sample.tradeDate,session:sample.session,actualContract:sample.actualContract,validDepthSamples:0,
      firstAvailableAt:r.receivedAt,lastAvailableAt:r.receivedAt,qualificationClass:null,eligibleWindows:null};
    g.validDepthSamples++;g.lastAvailableAt=r.receivedAt;groups.set(key,g);
  }
  const structurallyValid=unchanged && malformed===0 && hashFailures===0;
  return {schemaVersion:'historical-depth-tail-probe-v1',state:structurallyValid?'BOUNDED_FIELD_PROBE_ONLY':'BLOCKED',
    file,sourceBytes:before.size,byteOffset:start,bytesRead:read,sliceSha256:bytesHash(chunk),sourceUnchangedDuringRead:unchanged,
    completeLines:lines.length,malformed,hashFailures,txTicks,txQuotes,
    groups:structurallyValid?[...groups.values()]:[],rejections,
    calendarSha256:calendar.fileHash,calendarScope:'FROZEN_BASE_MAPPING_EMERGENCY_EXCEPTIONS_NOT_REVALIDATED',
    marketSessionEligibility:null,fullSourceHashVerified:false,captureCompleteness:null,
    cvdQualified:null,pressureQualified:null,responseQualified:null,pathQualified:null,
    asOfBasis:'HISTORICAL_RECEIVED_AT_NOT_CURRENT_LIVE_FRESHNESS',fullOutcomeQualified:false,
    reason:'BOUNDED_TAIL_WITHOUT_SESSION_BOUNDARIES_OR_COLLECTOR_DROP_AUDIT',...safety};
}
