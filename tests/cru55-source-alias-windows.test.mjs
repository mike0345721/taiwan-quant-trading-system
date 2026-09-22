import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceDirectoryIdentity,verifyBoundSourceRoot,resolveBoundSourceFile,assertBoundWriteRoot } from '../src/cru55-runtime-binding.mjs';
import { assertPlainPath } from '../src/cvd-observation-isolation.mjs';
test('approved isolated Windows junction resolves pinned physical source; changed/unknown redirects and write escape are rejected',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-junction-test-')),data=path.join(root,'runtime','data'),physical=path.join(root,'physical-raw'),wrong=path.join(root,'wrong-target');
  fs.mkdirSync(data,{recursive:true});fs.mkdirSync(physical);fs.mkdirSync(wrong);
  const logical=path.join(data,'live-events'),output=path.join(data,'runtime','cru55-overview');fs.symlinkSync(physical,logical,'junction');
  const b={sourceRoot:logical,outputRoot:output,sourceAlias:{kind:'WINDOWS_JUNCTION',physicalRoot:physical,targetIdentity:sourceDirectoryIdentity(physical)}};
  const childLink=path.join(physical,'redirect'),writeLink=path.join(output,'redirect');
  try{
    fs.writeFileSync(path.join(physical,'2026-09-18.ndjson'),'{}\n');
    assert.throws(()=>assertPlainPath(logical),/PATH_REDIRECTION/); // frozen helper is still strict
    assert.equal(verifyBoundSourceRoot(b),physical);
    assert.equal(resolveBoundSourceFile(b,path.join(logical,'2026-09-18.ndjson')),path.join(physical,'2026-09-18.ndjson'));
    assert.throws(()=>verifyBoundSourceRoot({...b,sourceAlias:{...b.sourceAlias,physicalRoot:wrong}}),/ALIAS_TARGET/);
    fs.unlinkSync(logical);fs.symlinkSync(wrong,logical,'junction');assert.throws(()=>verifyBoundSourceRoot(b),/ALIAS_TARGET/);
    fs.unlinkSync(logical);fs.symlinkSync(physical,logical,'junction');
    assert.throws(()=>verifyBoundSourceRoot({...b,sourceAlias:{...b.sourceAlias,kind:'PLAIN'}}),/PATH_REDIRECTION/);
    fs.symlinkSync(wrong,childLink,'junction');assert.throws(()=>resolveBoundSourceFile(b,path.join(logical,'redirect','nested.ndjson')),/OUTSIDE_BINDING/);
    fs.mkdirSync(output,{recursive:true});fs.symlinkSync(wrong,writeLink,'junction');
    assert.throws(()=>assertBoundWriteRoot(b,path.join(writeLink,'escaped.json')),/PATH_REDIRECTION/);
    assert.throws(()=>assertBoundWriteRoot(b,path.join(wrong,'escaped.json')),/WRITE_ROOT_ESCAPE/);
    assert.deepEqual(fs.readdirSync(wrong),[]);
    fs.unlinkSync(logical);fs.renameSync(physical,path.join(root,'old-physical'));fs.mkdirSync(physical);fs.symlinkSync(physical,logical,'junction');
    assert.throws(()=>verifyBoundSourceRoot(b),/TARGET_IDENTITY/);
  }finally{
    for(const link of [logical,writeLink,path.join(root,'old-physical','redirect'),childLink])if(fs.existsSync(link)&&fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link);
    assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cru55-junction-test-'));fs.rmSync(root,{recursive:true,force:true});
  }
});
