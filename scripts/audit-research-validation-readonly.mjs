// Read-only, offline diagnostic: no network, model, broker, file writes or runtime starts.
// Only reads a JSON input under this isolated worktree's data/research-validation folder.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {auditCostedTxReplay,selectTrainingPlateau,auditPurgedWalkForward}
  from '../src/research-strategy-validation-v1.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataRoot=path.join(root,'data','research-validation');
function main(){
  const filename=process.argv[2];
  if(!filename||process.argv.length!==3||!filename.endsWith('.json'))
    throw Error('USAGE: node scripts/audit-research-validation-readonly.mjs <data/research-validation/frozen-input.json>');
  const realRoot=fs.realpathSync(dataRoot);
  const realFile=fs.realpathSync(path.resolve(filename));
  const relative=path.relative(realRoot,realFile);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))
    throw Error('RESEARCH_VALIDATION_INPUT_OUTSIDE_ISOLATED_DATA_ROOT');
  const stat=fs.statSync(realFile);
  if(!stat.isFile()||stat.size>2_000_000)throw Error('RESEARCH_INPUT_NOT_SAFE_TO_READ');
  const input=JSON.parse(fs.readFileSync(realFile,'utf8'));
  const calendar=loadGovernedTradingCalendar(path.join(root,'config','taifex-official-calendar-2026.json'));
  const tradeAudit=auditCostedTxReplay({...input.tradeReplay,calendar});
  const plateau=input.plateau?selectTrainingPlateau(input.plateau):null;
  const walkForward=input.purgedWalkForward?auditPurgedWalkForward(input.purgedWalkForward):null;
  const checks=[tradeAudit,plateau,walkForward].filter(Boolean);
  const verdict=checks.some(v=>v.state==='BLOCKED')?'BLOCKED':'HISTORICAL_RESEARCH_ONLY';
  console.log(JSON.stringify({
    schemaVersion:'tx-research-validation-audit-v1',verdict,
    tradeAudit,plateau,walkForward,
    researchOnly:true,formalWeight:0,executionAuthorized:false,
    orderRoutesEnabled:false,modelCalls:0,productionPromoted:false,
  },null,2));
  if(verdict==='BLOCKED')process.exitCode=2;
}
try{main();}catch(e){
  console.error('RESEARCH_VALIDATION_BLOCKED: '+String(e?.message||e));
  process.exitCode=2;
}
