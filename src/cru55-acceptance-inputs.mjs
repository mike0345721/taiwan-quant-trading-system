import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertPlainPath} from './cvd-observation-isolation.mjs';
export function attestRealInputs(plan){
  if(plan.sourceKind!=='GOVERNED_FRAGMENT')return [];
  const receipt=JSON.parse(fs.readFileSync(assertPlainPath(path.join(plan.sourceRoot,'provenance.json'))));
  const files=fs.readdirSync(plan.sourceRoot).filter(n=>n.endsWith('.ndjson')).sort();
  if(!Array.isArray(receipt.sources)||JSON.stringify(files)!==JSON.stringify(receipt.sources.map(s=>s.name).sort()))throw Error('CRU55_ACCEPTANCE_SOURCE_SET');
  return receipt.sources.map(source=>{
    if(!/^\d{4}-\d{2}-\d{2}\.ndjson$/.test(source.name))throw Error('CRU55_ACCEPTANCE_SOURCE_NAME');
    const file=assertPlainPath(path.join(plan.sourceRoot,source.name)),stat=fs.statSync(file);
    if(!stat.isFile()||stat.nlink!==1)throw Error('CRU55_ACCEPTANCE_SOURCE_LINK');
    const stage=source.stages?.find(s=>s.bytes===stat.size);if(!stage)throw Error('CRU55_ACCEPTANCE_SOURCE_STAGE');
    const fd=fs.openSync(file,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);
    try{let offset=0;while(offset<stat.size){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,stat.size-offset),offset);if(!n)throw Error('CRU55_ACCEPTANCE_SOURCE_TRUNCATED');hash.update(buffer.subarray(0,n));offset+=n;}
      if(fs.fstatSync(fd).size!==stat.size||hash.digest('hex')!==stage.sha256)throw Error('CRU55_ACCEPTANCE_SOURCE_HASH');
    }finally{fs.closeSync(fd);}
    return {name:source.name,...stage};
  });
}
