import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const moduleUrl=new URL('../src/chatgpt-plan-store.mjs',import.meta.url).href;
test('Windows DPAPI roundtrip preserves host and separate account registrations without plaintext files',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru21-synthetic-store-'));
 const code=`import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createWindowsPlanStore} from ${JSON.stringify(moduleUrl)};
 const a=createWindowsPlanStore();const host=a.hostId;const item={issuer:'https://auth.openai.com',subject:'fixture-sub',client_id:'oaiapp_fixture_one',email:'same@example.invalid',access_token:randomUUID(),expiresAt:Date.now()+100000};
 const first=a.save(item);const second=a.save({...item,client_id:'oaiapp_fixture_two'});assert.notEqual(first,second);assert.equal(a.get('__proto__'),null);
 const b=createWindowsPlanStore();assert.equal(b.hostId,host);assert.equal(b.list().length,2);assert.equal(b.get(first).access_token,item.access_token);
 const file=path.join(process.env.LOCALAPPDATA,'TaiwanQuantDashboard','ChatGPTPlan','siwc-v1.dpapi');const raw=fs.readFileSync(file,'utf8');assert.equal(raw.includes(item.access_token),false);assert.equal(raw.includes('fixture-sub'),false);assert.equal(raw.includes(host),false);
 console.log('SYNTHETIC_DPAPI_ROUNDTRIP_PASS');`;
 try{const child=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,LOCALAPPDATA:root},encoding:'utf8',timeout:40000,windowsHide:true});assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/SYNTHETIC_DPAPI_ROUNDTRIP_PASS/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
