import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {readMarketObservationBatch} from '../src/market-observation-source.mjs';
import {readMarketObservationProducer} from '../src/market-observation-producer.mjs';
import {marketObservationSnapshot} from '../src/market-observation-core.mjs';
import {ABLATION_SPEC,ABLATION_SPEC_HASH,compareObservationAblations} from '../src/market-observation-ablation.mjs';
import {stableJson,digest} from '../src/cvd-observation-core.mjs';

const [sourcePath,outputRoot,countText='20000']=process.argv.slice(2),count=Number(countText);
if(!sourcePath||!outputRoot||!path.isAbsolute(sourcePath)||!path.isAbsolute(outputRoot)||!Number.isInteger(count)||count<1||count>20000)throw Error('Usage: node scripts/replay-market-observation.mjs <absolute named ledger> <new private output> [1..20000]');
if(!/^2026-11-\d{2}\.(?:ndjson|checkpoint\.json)$/.test(path.basename(sourcePath)))throw Error('REPLAY_SCOPE_NOVEMBER_ONLY_NO_RESERVED_SEPTEMBER_OCTOBER');
if(fs.existsSync(outputRoot))throw Error('REPLAY_IMMUTABLE_OUTPUT_EXISTS');
fs.mkdirSync(outputRoot,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(outputRoot,name),`${stableJson(value)}\n`,{flag:'wx'});
// Freeze before opening any price/outcome records.
write('frozen-spec.json',{spec:ABLATION_SPEC,specHash:ABLATION_SPEC_HASH,sourceName:path.basename(sourcePath),maxPhysicalRecords:count});
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const calendar=loadGovernedTradingCalendar(path.join(root,'config/taifex-official-calendar-2026.json'));
let result=null,totalBytes=0;
if(sourcePath.endsWith('.checkpoint.json')){
 result=readMarketObservationProducer({checkpointPath:sourcePath,calendar});totalBytes=result.sourceProgress.readBytes;
}else while((result?.state?.cvd.state.ordinal??0)<count){
 const previous=result?.state?.cvd.state.ordinal??0;
 result=readMarketObservationBatch({sourcePath,calendar,maxRows:Math.min(2000,count-previous)});totalBytes+=result.readBytes;
 if((result.state?.cvd.state.ordinal??0)===previous)break;
}
if(!result?.state)throw Error('REPLAY_NO_INPUT');
const cutoff=result.state.fragmentSemantic?.availableAt??result.state.cvd?.state.snapshotAvailableAt;
if(!cutoff)throw Error('REPLAY_NO_LAWFUL_CUTOFF');
const snapshot=marketObservationSnapshot(result.state,{cutoff,mode:'REPLAY',sourceComplete:result.complete});
write('observation.json',snapshot);
const report=compareObservationAblations({events:snapshot.events,bars:snapshot.price.bars,datasetRole:'TRAINING',sourceIdentity:snapshot.identity?.sourceLedgerIdentity});
write('ablation.json',report);
const receipt={schemaVersion:'cru61-bounded-replay-receipt-v1',evidenceClass:result.state.fragmentSemantic?'REAL_HISTORICAL_PRODUCER_FRAGMENT':'REAL_HISTORICAL_PREFIX',sourceName:path.basename(sourcePath),
 cutoff,sourceIdentity:snapshot.identity,physicalRecords:result.state.cvd?.state.ordinal??null,sourceProgress:result.sourceProgress??null,bytesRead:totalBytes,sourceComplete:result.complete,
 snapshotId:snapshot.snapshotId,snapshotFileHash:digest(fs.readFileSync(path.join(outputRoot,'observation.json'))),
 eventCount:snapshot.events.length,profileVolume:snapshot.profile.totalVolume,cvd:snapshot.cvd.value,quality:snapshot.reasonCodes,
 performanceStatus:'BOUNDED_TRAINING_DESCRIPTION_NOT_STRATEGY_VALIDATION',formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false};
write('receipt.json',receipt);process.stdout.write(JSON.stringify(receipt));
