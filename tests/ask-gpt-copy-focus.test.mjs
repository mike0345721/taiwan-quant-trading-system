import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.indexOf("$('dw-copy-gpt-prompt').addEventListener('click', async () => {");
const end=app.indexOf("$('dw-journal-form').addEventListener",start);
assert.ok(start>0&&end>start);
const source=app.slice(start,end);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
function setup({api,copy,open}={}){
 const events=[],status={},attributes={},classes=new Set(['hidden']);let handler,focused=true,timer,pair;
 const button={disabled:false,setAttribute:(k,v)=>attributes[k]=v,removeAttribute:k=>delete attributes[k],addEventListener:(_,fn)=>handler=fn};
 const link={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}};
 vm.runInNewContext(source,{$:id=>id==='dw-copy-gpt-prompt'?button:link,state:{gptQuestion:'test'},dwText:(id,t)=>status[id]=t,
  AbortController,encodeURIComponent,setTimeout:fn=>(timer=fn,1),clearTimeout:()=>{timer=null;},
  decisionCaptureController:{context:async options=>{events.push('api');const payload=api?await api('capture',options):{data:{prompt:'real bounded snapshot',snapshotHash:'a'.repeat(64)}};pair={copyText:payload?.data?.prompt,snapshot:{snapshotHash:payload?.data?.snapshotHash}};return pair;},locked:()=>pair},
  copyToClipboard:async text=>{events.push('copy');if(!focused)throw Error('Document is not focused');if(copy)await copy(text);events.push('copied');},
  window:{open:(...args)=>{events.push('open');focused=false;return open?open(...args):null;}}
 });
 return{run:()=>handler(),events,status,button,classes,attributes,abort:()=>timer?.()};
}
test('copy completes before tab opening can steal focus; noopener null is not treated as failure',async()=>{
 const s=setup();await s.run();assert.deepEqual(s.events,['api','copy','copied','open']);assert.equal(s.classes.has('hidden'),false);assert.equal(s.button.disabled,false);assert.match(s.status['dw-gpt-feedback'],/已複製/);assert.equal(s.attributes['aria-busy'],undefined);
});
test('slow API and slow clipboard cannot open the tab early; duplicate clicks are ignored',async()=>{
 const api=deferred(),copy=deferred(),s=setup({api:()=>api.promise,copy:()=>copy.promise});const run=s.run();await s.run();assert.deepEqual(s.events,['api']);assert.equal(s.button.disabled,true);api.resolve({data:{prompt:'snapshot',snapshotHash:'b'.repeat(64)}});await new Promise(r=>setImmediate(r));assert.deepEqual(s.events,['api','copy']);copy.resolve();await run;assert.deepEqual(s.events,['api','copy','copied','open']);
});
test('clipboard denial is visible beside Ask GPT and does not open a useless tab',async()=>{
 const s=setup({copy:()=>{throw Error('Document is not focused');}});await s.run();assert.deepEqual(s.events,['api','copy']);assert.match(s.status['dw-gpt-feedback'],/尚未複製.*Document is not focused/);assert.equal(s.classes.has('hidden'),true);assert.equal(s.button.disabled,false);
});
test('API failure and missing prompt do not claim copying or open a tab',async()=>{
 for(const api of [()=>{throw Error('HTTP 503');},()=>({data:{}})]){const s=setup({api});await s.run();assert.deepEqual(s.events,['api']);assert.match(s.status['dw-gpt-feedback'],/尚未複製/);assert.equal(s.button.disabled,false);}
});
test('popup blocking keeps the successful clipboard and visible manual-open link',async()=>{
 const s=setup({open:()=>{throw Error('popup blocked');}});await s.run();assert.match(s.status['dw-gpt-feedback'],/已複製/);assert.equal(s.classes.has('hidden'),false);assert.equal(s.events.filter(x=>x==='open').length,1);
});
test('snapshot timeout releases the control and reports no copied data',async()=>{
 const s=setup({api:(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted'))))});const run=s.run();s.abort();await run;assert.match(s.status['dw-gpt-feedback'],/逾時.*尚未複製/);assert.equal(s.button.disabled,false);assert.deepEqual(s.events,['api']);
});
test('legacy clipboard failure is not silently reported as a successful copy',async()=>{
 const from=app.indexOf('async function copyToClipboard(value) {'),to=app.indexOf('\nasync function loadDashboard()',from);let removed=0;
 const c={navigator:{},document:{createElement:()=>({setAttribute(){},style:{},select(){},remove(){removed++}}),body:{append(){}},execCommand:()=>false}};
 vm.runInNewContext(app.slice(from,to)+'\nglobalThis.copy=copyToClipboard;',c);await assert.rejects(c.copy('snapshot'),/CLIPBOARD_WRITE_FAILED/);assert.equal(removed,1);
});
test('handoff status and recovery link are inside the visible Ask GPT card',()=>{
 const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');const card=html.slice(html.indexOf('<section id="dw-ask-gpt"'),html.indexOf('</section>',html.indexOf('<section id="dw-ask-gpt"')));
 assert.match(card,/id="dw-gpt-feedback"[^>]*role="status"[^>]*aria-live="polite"/);assert.match(card,/id="dw-open-chatgpt"[^>]*href="https:\/\/chatgpt.com\/"[^>]*rel="noopener noreferrer"/);
});
