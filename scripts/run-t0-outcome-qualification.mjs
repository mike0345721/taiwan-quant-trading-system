// Offline, read-only sources. Results may only be created in the isolated repo.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadT0OutcomeLinkage} from '../src/t0-outcome-linkage.mjs';
import {inventoryResearchCorpus,probeHistoricalDepthTail} from '../src/research-corpus-inventory.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {digest,safety} from '../src/research-replay-outcome.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  const [sourceRoot,outputName,priorScreeningFile,sampleDate,...extra]=process.argv.slice(2);
  if(!sourceRoot||!outputName||extra.length)throw Error('USAGE: node scripts/run-t0-outcome-qualification.mjs SOURCE_ROOT NEW_OUTPUT.json [PRIOR_SCREENING.json|-] [SAMPLE_CALENDAR_DATE]');
  const data=fs.realpathSync(path.join(root,'data/research-validation')),output=path.resolve(outputName);
  const relative=path.relative(fs.realpathSync(root),data);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.realpathSync(path.dirname(output))!==data||!output.endsWith('.json'))throw Error('ISOLATED_OUTPUT_ROOT_REQUIRED');
  if(fs.existsSync(output))throw Error('OUTPUT_ALREADY_EXISTS');
  let linkage;
  try { linkage=loadT0OutcomeLinkage({repoRoot:root,sourceRoot}); }
  catch(e) { linkage={state:'BLOCKED',reason:e.message,rows:[],summary:null,...safety}; }
  const inventory=inventoryResearchCorpus({sourceRoot,priorScreeningFile:priorScreeningFile&&priorScreeningFile!=='-'?priorScreeningFile:null});
  let probe=null;
  if(sampleDate)probe=probeHistoricalDepthTail({sourceRoot,date:sampleDate,
    calendar:loadGovernedTradingCalendar(path.join(root,'config/taifex-official-calendar-2026.json'))});
  const body={schemaVersion:'t0-qualification-run-v1',generatedAt:new Date().toISOString(),
    state:linkage.state==='BLOCKED'||probe?.state==='BLOCKED'?'BLOCKED':'HISTORICAL_LINKAGE_PASS_MICROSTRUCTURE_QUALIFICATION_PENDING',
    linkage,inventory,probe,...safety};
  const result={...body,sha256:digest(body)};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({state:result.state,sha256:result.sha256,summary:linkage.summary,inventory:inventory.summary,probeState:probe?.state ?? null,output},null,2));
  if(result.state==='BLOCKED'||probe?.state==='BLOCKED')process.exitCode=2;
} catch(e) { console.error('QUALIFICATION_RUN_BLOCKED: '+e.message);process.exitCode=2; }
