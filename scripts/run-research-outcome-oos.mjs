// No network/model/broker. Read frozen isolated inputs and emit an immutable result.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {resolveResearchOutcome,digest,safety} from '../src/research-replay-outcome.mjs';
import {compareResearchVariants} from '../src/research-incremental-oos.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function inside(parent,child){const r=path.relative(parent,child);return r&&!r.startsWith('..')&&!path.isAbsolute(r);}
try{
 const [inputName,outputName,...extra]=process.argv.slice(2);
 if(!inputName||extra.length)throw Error('USAGE: node scripts/run-research-outcome-oos.mjs INPUT.json [NEW_OUTPUT.json]');
 const data=fs.realpathSync(path.join(root,'data','research-validation'));
 if(!inside(fs.realpathSync(root),data))throw Error('ISOLATED_DATA_ROOT_REQUIRED');
 const inputFile=fs.realpathSync(inputName);
 if(!inside(data,inputFile)||!inputFile.endsWith('.json')||fs.statSync(inputFile).size>128*1024*1024)throw Error('INPUT_OUTSIDE_BOUNDED_RESEARCH_ROOT');
 const inputBytes=fs.readFileSync(inputFile),input=JSON.parse(inputBytes.toString('utf8'));
 if(!Array.isArray(input.events)||input.events.length>10000)throw Error('EVENT_ARRAY_REQUIRED');
 const calendar=loadGovernedTradingCalendar(path.join(root,'config','taifex-official-calendar-2026.json'));
 const outcomes=input.events.map(e=>resolveResearchOutcome({...e,rules:input.rules,calendar}));
 const comparison=compareResearchVariants({protocol:input.protocol,
   rows:input.events.map((e,i)=>({signal:e.signal,foldId:e.foldId,outcome:outcomes[i]}))});
 const body={schemaVersion:'research-replay-run-v1',generatedAt:new Date().toISOString(),
   inputSha256:digest(input),calendarSha256:calendar.fileHash,outcomes,comparison,
   state:outcomes.some(o=>o.state==='BLOCKED')||comparison.state==='BLOCKED'?'BLOCKED':'REPLAY_ONLY_NOT_FORWARD_CERTIFIED',...safety};
 const result={...body,sha256:digest(body)},text=JSON.stringify(result,null,2)+'\n';
 if(outputName){const output=path.resolve(outputName),parent=fs.realpathSync(path.dirname(output));
   if(parent!==data||!output.endsWith('.json'))throw Error('OUTPUT_MUST_BE_NEW_JSON_IN_RESEARCH_ROOT');
   fs.writeFileSync(output,text,{flag:'wx'});}
 process.stdout.write(text);if(result.state==='BLOCKED')process.exitCode=2;
}catch(e){console.error('RESEARCH_RUN_BLOCKED: '+e.message);process.exitCode=2;}
