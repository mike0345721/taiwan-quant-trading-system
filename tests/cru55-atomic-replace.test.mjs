import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {replaceDurableFileSync} from '../src/cru55-atomic-replace.mjs';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-replace-')),temp=path.join(root,'new.tmp'),target=path.join(root,'visible.json');fs.writeFileSync(temp,'new');fs.writeFileSync(target,'old');return {root,temp,target};}
test('transient Windows sharing failures retain old target and retry the same durable temp',{skip:process.platform!=='win32'},t=>{
  const f=fixture(),rename=fs.renameSync;let attempts=0,checks=0;
  try{t.mock.method(fs,'renameSync',(from,to)=>{assert.equal(from,f.temp);assert.equal(fs.readFileSync(f.target,'utf8'),'old');if(++attempts<3)throw Object.assign(Error('sharing'),{code:attempts===1?'EPERM':'EBUSY'});return rename(from,to);});
    assert.equal(replaceDurableFileSync(f.temp,f.target,{beforeReplace:()=>{checks++;return true;}}),true);assert.equal(attempts,3);assert.equal(checks,3);assert.equal(fs.readFileSync(f.target,'utf8'),'new');
  }finally{t.mock.restoreAll();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('exhausted contention is bounded; non-sharing failures are immediate; visible target survives',t=>{
  const f=fixture();let attempts=0;
  try{t.mock.method(fs,'renameSync',()=>{attempts++;throw Object.assign(Error('locked'),{code:'EACCES'});});assert.throws(()=>replaceDurableFileSync(f.temp,f.target),/locked/);assert.equal(attempts,process.platform==='win32'?6:1);assert.equal(fs.readFileSync(f.target,'utf8'),'old');assert.equal(fs.readFileSync(f.temp,'utf8'),'new');
    t.mock.restoreAll();attempts=0;t.mock.method(fs,'renameSync',()=>{attempts++;throw Object.assign(Error('disk'),{code:'EIO'});});assert.throws(()=>replaceDurableFileSync(f.temp,f.target),/disk/);assert.equal(attempts,1);
  }finally{t.mock.restoreAll();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('source veto after sharing delay prevents the second replacement attempt',{skip:process.platform!=='win32'},t=>{
  const f=fixture();let attempts=0,checks=0;
  try{t.mock.method(fs,'renameSync',()=>{attempts++;throw Object.assign(Error('sharing'),{code:'EPERM'});});assert.equal(replaceDurableFileSync(f.temp,f.target,{beforeReplace:()=>++checks===1}),false);assert.equal(attempts,1);assert.equal(checks,2);assert.equal(fs.readFileSync(f.target,'utf8'),'old');
  }finally{t.mock.restoreAll();fs.rmSync(f.root,{recursive:true,force:true});}
});
