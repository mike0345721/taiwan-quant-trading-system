import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {attestRealInputs} from '../src/cru55-acceptance-inputs.mjs';import {digest} from '../src/cvd-observation-core.mjs';
test('real candidate attestation rejects wrong bytes and extra sources, accepts only recorded prefix stages',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-real-attest-')),name='2026-09-18.ndjson',first=Buffer.from('original\n'),last=Buffer.from('original\nsuffix\n');
 const plan={sourceKind:'GOVERNED_FRAGMENT',sourceRoot:root},file=path.join(root,name);
 try{fs.writeFileSync(path.join(root,'provenance.json'),JSON.stringify({sources:[{name,stages:[first,last].map(b=>({bytes:b.length,sha256:digest(b)}))}]}));
 fs.writeFileSync(file,first);assert.equal(attestRealInputs(plan)[0].bytes,first.length);
 fs.appendFileSync(file,last.subarray(first.length));assert.equal(attestRealInputs(plan)[0].bytes,last.length);
 fs.writeFileSync(file,Buffer.alloc(last.length));assert.throws(()=>attestRealInputs(plan),/SOURCE_HASH/);
 fs.writeFileSync(path.join(root,'2026-09-19.ndjson'),first);assert.throws(()=>attestRealInputs(plan),/SOURCE_SET/);
 }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cru55-real-attest-'));fs.rmSync(root,{recursive:true,force:true});}
});
