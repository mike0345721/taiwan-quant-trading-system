import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDailyAcceptanceSweep, assertDailyAcceptanceOutputRoot } from '../src/daily-collection-acceptance-sweep.mjs';
import { stableDailyAcceptanceJson } from '../src/daily-collection-acceptance.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  if (!arg.startsWith('--') || !arg.includes('=')) throw new Error('DAILY_SWEEP_ARGUMENT_INVALID');
  const at=arg.indexOf('='); return [arg.slice(2,at),arg.slice(at+1)];
}));
const dates=(args.dates || '').split(',').filter(Boolean).sort();
if (!dates.length || dates.some((date)=>!/^\d{4}-\d{2}-\d{2}$/.test(date)) || new Set(dates).size!==dates.length) throw new Error('DAILY_SWEEP_DATES_INVALID');
const dataRoot=path.resolve(args['data-root'] || path.join(root,'data'));
const outputRoot=path.resolve(args['output-root'] || path.join(dataRoot,'quality','daily-collection-acceptance','phase-a1'));
assertDailyAcceptanceOutputRoot(dataRoot,outputRoot,[args['batch-evidence'],args['daily-status'],args.database,args.calendar,args.registry,...(args['derived-artifacts']||'').split('|').filter(Boolean)],['sweep.json']);
if(args['ledger-cutoffs']) throw new Error('DAILY_SWEEP_GLOBAL_CUTOFF_SET_UNSUPPORTED:use date-scoped daily CLI with exact cutoffs, then reuse-reports');
const forward=Object.entries(args).filter(([key])=>!['dates','output-root','reuse-reports'].includes(key)).map(([key,value])=>`--${key}=${value}`);
const reports=[];
for (const date of dates) {
  const reportPath=path.join(outputRoot,`${date}.json`);
  if(args['reuse-reports']!=='true') {
    const run=spawnSync(process.execPath,[path.join(root,'scripts','build-daily-collection-acceptance.mjs'),...forward,`--trade-date=${date}`,`--calendar-date=${date}`,`--output-root=${outputRoot}`],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,timeout:600_000,windowsHide:true});
    if(run.error || run.status!==0) throw new Error(`DAILY_SWEEP_DATE_FAILED:${date}:${run.error?.message || run.stderr}`);
  }
  const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  if(report.tradeDate!==date) throw new Error('DAILY_SWEEP_REPORT_DATE_MISMATCH');
  reports.push(report);
  console.log(JSON.stringify({tradeDate:date,state:report.overallState,...report.summary}));
}
const sweep=buildDailyAcceptanceSweep(reports);
fs.mkdirSync(outputRoot,{recursive:true});
const outputPath=path.join(outputRoot,'sweep.json');
const temporary=`${outputPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary,stableDailyAcceptanceJson(sweep),{encoding:'utf8',mode:0o600});
fs.renameSync(temporary,outputPath);
console.log(JSON.stringify({outputPath,storageStatistics:sweep.storageStatistics},null,2));
