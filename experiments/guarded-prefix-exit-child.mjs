// Test-only child: intentional real process exit WITHOUT explicit guard cleanup.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GuardedPrefixContinuity} from './guarded-prefix-continuity.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/test-tmp/guarded-continuity');
const input=fs.realpathSync(process.argv[2]);
if(!input.startsWith(base+path.sep))throw Error('PRIVATE_SYNTHETIC_INPUT_REQUIRED');
const {context,target}=JSON.parse(fs.readFileSync(input,'utf8'));
if(!fs.realpathSync(context.sourceBinding.path).startsWith(path.dirname(input)+path.sep))throw Error('PRIVATE_SYNTHETIC_SOURCE_REQUIRED');
const p=new GuardedPrefixContinuity(context);
const result=p.verify(context,target);
fs.writeSync(1,JSON.stringify(result));
process.exit(0);
