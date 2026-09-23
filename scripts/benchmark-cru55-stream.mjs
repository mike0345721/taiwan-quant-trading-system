// Private, sequential frozen-input benchmark. Never points at a collector file.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
const [moduleRoot, input, output, expectedHash, limitArg = '10000'] = process.argv.slice(2);
if (![moduleRoot,input,output].every(p=>p&&path.isAbsolute(p)) || !/^[a-f0-9]{64}$/.test(expectedHash??'')) throw Error('BENCH_ARGUMENTS');
const bytes=fs.readFileSync(input), sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(sha(bytes)!==expectedHash) throw Error('BENCH_FROZEN_INPUT_HASH');
fs.mkdirSync(output,{recursive:true});
const source=path.join(output,'private-source.ndjson'); fs.writeFileSync(source,bytes,{flag:'wx'});
const {runStreamCycle}=await import(pathToFileURL(path.join(moduleRoot,'src/cru55-stream-pipeline.mjs')));
const begin=performance.now(),cpu=process.cpuUsage(),limit=Number(limitArg);
const log=path.join(output,'cycles.ndjson'); let result,cycles=0,peakRss=0;
fs.writeFileSync(log,JSON.stringify({kind:'start',at:new Date().toISOString(),inputHash:expectedHash,inputBytes:bytes.length,processCold:true,osCache:'UNCONTROLLED; input hash/copy warms file cache',moduleRoot})+'\n',{flag:'wx'});
while(cycles++<limit){
  result=runStreamCycle({sourcePath:source,runRoot:path.join(output,'run'),sourceKind:'GOVERNED_FRAGMENT',publishAtSessionBoundary:true});
  peakRss=Math.max(peakRss,process.memoryUsage().rss);
  fs.appendFileSync(log,JSON.stringify({kind:'cycle',elapsedMs:performance.now()-begin,result,rss:process.memoryUsage().rss})+'\n');
  if((result.state==='PUBLISHED'||result.state==='UNCHANGED')&&result.endByteOffset===bytes.length)break;
}
const receipt={kind:'end',at:new Date().toISOString(),elapsedMs:performance.now()-begin,cpu:process.cpuUsage(cpu),peakRss,cycles,result,complete:result?.endByteOffset===bytes.length&&['PUBLISHED','UNCHANGED'].includes(result.state),harness:'DIRECT_PIPELINE_NO_MANAGED_WAIT; not API/browser acceptance'};
fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
