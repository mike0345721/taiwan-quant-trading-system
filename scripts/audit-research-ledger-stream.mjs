// One pass over a fixed byte prefix. Summary only; never writes the ledger.
import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {evidenceTimestampNs as ns} from '../src/research-evidence-contract-v1.mjs';
import {safety} from '../src/research-replay-outcome.mjs';
const file=process.argv[2];
if(!file||process.argv.length!==3){console.error('USAGE: node scripts/audit-research-ledger-stream.mjs LEDGER.ndjson');process.exit(2);}
const before=fs.statSync(file),hash=crypto.createHash('sha256');
const stream=fs.createReadStream(file,{start:0,end:before.size-1});stream.on('data',b=>hash.update(b));
const lines=readline.createInterface({input:stream,crlfDelay:Infinity});
let previous='GENESIS',events=0,hashFailures=0,malformed=0,txTicks=0,txQuotes=0,qualityRejects=0,timestampViolations=0,gapsOver5s=0;
let firstTx=null,lastTx=null,previousTx=null,unknownSide=0;
for await(const line of lines){
 if(!line.trim())continue;events++;
 try{
  const r=JSON.parse(line),{recordHash,...body}=r;
  if(body.previousHash!==previous||buildLiveEventRecord(body,previous).recordHash!==recordHash)hashFailures++;
  previous=recordHash;
  if(r.payload?.productFamily!=='TX'||!['futures_tick','futures_bidask'].includes(r.kind))continue;
  if(r.kind==='futures_tick'){txTicks++;if(![1,2].includes(r.payload.tick_type))unknownSide++;}else txQuotes++;
  const source=ns(r.exchangeTimestamp,{taipeiNaive:true}),received=ns(r.receivedAt);
  if(source===null||received===null||source>received||received-source>5000000000n)timestampViolations++;
  if(r.duplicate!==false||r.sequenceGap!==0||r.payload.simtrade!==false)qualityRejects++;
  if(r.kind==='futures_tick'&&received!==null){
   if(previousTx!==null&&received-previousTx>5000000000n)gapsOver5s++;
   firstTx??=r.receivedAt;lastTx=r.receivedAt;previousTx=received;
  }
 }catch{malformed++;}
}
const after=fs.statSync(file);
const result={schemaVersion:'research-ledger-inventory-v1',auditedAt:new Date().toISOString(),file,
 snapshotBytes:before.size,sourceSha256:hash.digest('hex'),unchangedDuringRead:before.size===after.size&&before.mtimeMs===after.mtimeMs,
 events,hashFailures,malformed,txTicks,txQuotes,qualityRejects,timestampViolations,gapsOver5s,firstTx,lastTx,unknownSide,
 captureStatus:'UNVERIFIED',fullOutcomeQualified:false,
 reason:'STREAM_INTEGRITY_NOT_FULL_SESSION_CAPTURE;NEEDS_SESSION_BOUNDARIES_AND_COLLECTOR_DROP_AUDIT',...safety};
console.log(JSON.stringify(result,null,2));
if(hashFailures||malformed||timestampViolations||qualityRejects||!txTicks)process.exitCode=2;
