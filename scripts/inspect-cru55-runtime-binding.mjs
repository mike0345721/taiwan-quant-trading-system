import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRuntimeBinding } from '../src/cru55-runtime-binding.mjs';
const [file,mode='plan']=process.argv.slice(2);
if(!['plan','activation-preflight'].includes(mode))throw Error('CRU55_BINDING_INSPECTION_MODE');
// Reads only. Even activation-preflight does not start, stop, deploy or install anything.
const runtimeRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
console.log(JSON.stringify(readRuntimeBinding(file,{runtimeRoot,activation:mode==='activation-preflight'})));
