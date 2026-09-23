// Clock starts before the normal acceptance launcher, including its managed
// startup and the real server. Works against an unchanged baseline worktree.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const [root,data,port='3066']=process.argv.slice(2);
if(![root,data].every(p=>p&&path.isAbsolute(p)))throw Error('PERF_LAUNCH_ARGUMENTS');
const exp=JSON.parse(fs.readFileSync(path.join(data,'experiment.json')));
if(path.resolve(exp.configPath)!==path.join(root,'data','cru55-dynamic',path.basename(exp.configPath)))throw Error('PERF_CONFIG_LOCATION');
const startedAt=Date.now();fs.writeFileSync(path.join(data,'launch-clock.json'),JSON.stringify({head:exp.head,startedAt,osCache:exp.osCache}),{flag:'wx'});
const result=execFileSync(process.execPath,[path.join(root,'scripts/start-cru55-acceptance.mjs'),exp.configPath,port],{cwd:root,windowsHide:true,encoding:'utf8',timeout:90000});
process.stdout.write(result);
