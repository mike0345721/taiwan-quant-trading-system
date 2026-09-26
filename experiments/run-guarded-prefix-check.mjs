// Serial, cumulative local dynamic budget. Preserve every run and failed output.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(repo,'data/test-tmp/guarded-continuity');fs.mkdirSync(base,{recursive:true});
const ledger=path.join(base,'dynamic-budget.jsonl');
const events=fs.existsSync(ledger)?fs.readFileSync(ledger,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
if(events.filter(e=>e.kind==='start').length!==events.filter(e=>e.kind==='end').length)throw Error('UNFINISHED_RUN_REQUIRES_ACCOUNTING');
const used=events.filter(e=>e.kind==='end').reduce((n,e)=>n+e.elapsedMs,0),remaining=900000-used;
if(remaining<=0)throw Error('DYNAMIC_BUDGET_EXHAUSTED');
const id=String(events.filter(e=>e.kind==='start').length+1),start=Date.now();
fs.appendFileSync(ledger,JSON.stringify({kind:'start',id,at:new Date(start).toISOString(),remainingMs:remaining})+'\n');
const r=spawnSync(process.execPath,['--test',path.join(repo,'tests/guarded-prefix-continuity.test.mjs')],{
  cwd:repo,encoding:'utf8',windowsHide:true,timeout:Math.min(remaining,120000),
  env:{...process.env,TEMP:base,TMP:base,CONTINUITY_EVIDENCE_PATH:path.join(base,'run-'+id+'-evidence.json')},maxBuffer:4*1024*1024});
const end={kind:'end',id,at:new Date().toISOString(),elapsedMs:Date.now()-start,status:r.status,signal:r.signal,error:r.error?.message??null};
fs.writeFileSync(path.join(base,'run-'+id+'.txt'),(r.stdout??'')+'\n'+(r.stderr??''));
fs.appendFileSync(ledger,JSON.stringify(end)+'\n');
console.log(r.stdout,r.stderr,JSON.stringify({...end,cumulativeMs:used+end.elapsedMs,capMs:900000}));
process.exit(r.status===0?0:1);
