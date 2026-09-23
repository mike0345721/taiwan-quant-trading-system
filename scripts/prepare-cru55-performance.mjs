// Copies only a previously frozen private input and manifest-listed acceptance
// inputs. Does not read formal raw, inherit credentials, or start a collector.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [root,frozen,background,runId,mode='steady']=process.argv.slice(2);
if(![root,frozen,background].every(p=>p&&path.isAbsolute(p))||!/^candidate-perf-[a-z0-9-]+$/.test(runId??'')||!['steady','cold'].includes(mode))throw Error('PERF_ARGUMENTS');
const {digest,stableJson,SAFETY}=await import(pathToFileURL(path.join(root,'src/cvd-observation-core.mjs')));
const {sourceDirectoryIdentity}=await import(pathToFileURL(path.join(root,'src/cru55-runtime-binding.mjs')));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const original=JSON.parse(fs.readFileSync(path.join(frozen,'provenance.json'))),sourceName='2026-09-18.ndjson';
const source=original.sources.find(s=>s.name===sourceName),full=fs.readFileSync(path.join(frozen,sourceName));
if(full.length!==source.stages.at(-1).bytes||digest(full)!==source.stages.at(-1).sha256)throw Error('PERF_FROZEN_HASH');
const offsets=[0];for(let i=0;i<full.length;i++)if(full[i]===10)offsets.push(i+1);
if(offsets.length!==62001)throw Error('PERF_RECORD_COUNT');
const initialOrdinal=mode==='cold'?62000:10000,initial=full.subarray(0,offsets[initialOrdinal]);
const base=path.join(root,'data/cru55-dynamic'),sourceRoot=path.join(base,'real-inputs',runId),data=path.join(base,'acceptance',runId);
fs.mkdirSync(sourceRoot,{recursive:true});fs.writeFileSync(path.join(sourceRoot,sourceName),initial,{flag:'wx'});
const last=JSON.parse(initial.subarray(initial.lastIndexOf(10,initial.length-2)+1).toString('utf8'));
const provenance={schemaVersion:original.schemaVersion,evidenceKind:'GOVERNED_FRAGMENT',naturalLiveAcceptance:false,sourceAccess:'PREVIOUSLY_FROZEN_PRIVATE_COPY_ONLY',reference:source.stages.at(-1).sha256,sources:[{name:sourceName,firstRecordHash:source.firstRecordHash,stages:[{ordinal:initialOrdinal,bytes:initial.length,sha256:digest(initial),terminalHash:last.recordHash}]}]};
fs.writeFileSync(path.join(sourceRoot,'provenance.json'),JSON.stringify(provenance),{flag:'wx'});
const manifest=JSON.parse(fs.readFileSync(path.join(background,'input-manifest.json')));
fs.mkdirSync(data,{recursive:true});
for(const f of manifest.files){if(path.isAbsolute(f.path)||f.path.split(/[\\/]/).includes('..'))throw Error('PERF_BACKGROUND_PATH');const b=fs.readFileSync(path.join(background,f.path));if(digest(b)!==f.sha256)throw Error('PERF_BACKGROUND_HASH');const out=path.join(data,f.path);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,b,{flag:'wx'});}
fs.writeFileSync(path.join(data,'input-manifest.json'),JSON.stringify(manifest),{flag:'wx'});
const config={schemaVersion:'cru55-managed-candidate-v1',runtimeCommit:head,runId,sourceKind:'GOVERNED_FRAGMENT',producer:'STREAM_PAGED_V2',sourceVerification:'FULL_PREFIX_BEFORE_PUBLICATION',provenanceHash:digest(stableJson(provenance)),sourceSelection:{kind:'DATED_CALENDAR_LEDGER',startDate:'2026-09-18'},sourceAlias:{kind:'PLAIN',physicalRoot:sourceRoot,targetIdentity:sourceDirectoryIdentity(sourceRoot)},...SAFETY};
const configPath=path.join(base,runId+'.json');fs.writeFileSync(configPath,JSON.stringify(config),{flag:'wx'});
fs.writeFileSync(path.join(data,'experiment.json'),JSON.stringify({head,configPath,sourcePath:path.join(sourceRoot,sourceName),frozenInput:path.join(frozen,sourceName),frozenHash:digest(full),mode,initialOrdinal,normalRate:27,rateBasis:'62000 / 2293 observed active seconds = 27.039 records/s; p95 active-second rate 72, max1009; compressed replay preserves original bytes/order/market clocks; not peak-load/full-day proof',warmupDeadlineMs:900000,durationMs:1800000,burstStartMs:600000,burstDurationMs:60000,burstRate:54,drainMs:180000,osCache:'UNCONTROLLED; input hash/copy warms filesystem cache'}),{flag:'wx'});
console.log(JSON.stringify({head,configPath,data,initialOrdinal,mode}));
