// Headless browser with explicitly synthetic transport, never a user account or live acceptance.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {inspectEngineeringDocument} from './ui-browser-engineering-helper.mjs';
import {guestBrowserPath} from './guest-browser-path.mjs';
const binary=process.platform==='linux'?(()=>{const selected=guestBrowserPath();return selected.skip?null:selected.executable;})():[process.env.BROWSER_BINARY,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
const css=fs.readFileSync(new URL('../public/research-evidence.css',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../public/research-evidence.js',import.meta.url),'utf8');
for(const width of [390,1366])test('research UI renders, clears aged values and has no overflow at '+width+'px',{skip:!binary,timeout:40000},async()=>{
 let html=fs.readFileSync(new URL('../public/research.html',import.meta.url),'utf8')
  .replace('<link rel="stylesheet" href="/research-evidence.css">','<style>'+css+'</style>')
  .replace('<script type="module" src="/research-evidence.js"></script>','');
 const setup=`<script>window.errors=[];window.addEventListener('error',e=>errors.push(e.message));
 let fakeNow=Date.now();Date.now=()=>fakeNow;
 const quote={spreadTicks:1,imbalance5:.2,actualContract:'SYNTHETIC',sourceTime:new Date(fakeNow).toISOString(),bids:Array.from({length:5},(_,i)=>({price:10000-i,volume:10})),asks:Array.from({length:5},(_,i)=>({price:10001+i,volume:20}))};
 const good={state:'READY',value:quote,validUntil:new Date(fakeNow+5000).toISOString()};
 window.fetch=async()=>({ok:true,json:async()=>({data:{schemaVersion:'dashboard-research-evidence-v1',servedAt:new Date(fakeNow).toISOString(),depth:good,
 windows:[{label:'1分',classifiedCoverage:1,pressure:{...good,value:.3},response:{...good,value:{displacementPoints:2,efficiency:.5}}}],outcomes:[],comparison:{state:'BLOCKED',reason:'SYNTHETIC_NO_REAL_CORPUS',metrics:null}}})});</script>`;
 const verify=`<script>setTimeout(()=>{const before=document.getElementById('depth').textContent;const flow=document.getElementById('flow').textContent;
 fakeNow+=7000;setTimeout(()=>{const e=document.createElement('pre');e.id='ui-convergence-test-result';e.textContent=JSON.stringify({synthetic:true,width:innerWidth,docWidth:document.documentElement.scrollWidth,ready:before.includes('10,000'),flow:flow.includes('0.3'),expired:document.getElementById('depth').textContent.includes('不可用'),outcomeBlocked:document.getElementById('outcomes').textContent.includes('不可用'),errors});document.body.append(e);},1100);},150);</script>`;
 html=html.replace('</body>',setup+'<script type="module">'+script+'</script>'+verify+'</body>');
 const r=await inspectEngineeringDocument({binary,html,width,hostedLinuxResearchTest:true});assert.equal(r.width,width);assert.ok(r.docWidth<=width+1,JSON.stringify(r));
 for(const k of ['ready','flow','expired','outcomeBlocked'])assert.equal(r[k],true,k);assert.deepEqual(r.errors,[]);
});
