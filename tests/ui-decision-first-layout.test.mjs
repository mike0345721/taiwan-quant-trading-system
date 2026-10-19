// Browser engineering checks only: real HTML/CSS/shell, synthetic account responses, no market runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {inspectEngineeringDocument} from './ui-browser-engineering-helper.mjs';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const binary=[process.env.BROWSER_BINARY,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
const script=s=>'<script>'+s.replaceAll('</script','<\\/script')+'</script>';
function documentForTest(){
 let html=read('public/index.html').replace(/\s*<link[^>]+rel="stylesheet"[^>]*>/g,'').replace(/\s*<script[^>]+src="[^"]+"[^>]*><\/script>/g,'');
 const styles=['public/styles.css','public/trader-terminal-shell.css','public/ask-gpt-inline.css'].map(f=>'<style>'+read(f)+'</style>').join('');
 const setup=`
 window.__calls=[];window.__uiAccountRows=[{key:'a'.repeat(64),label:'SYNTHETIC TEST ACCOUNT',accessReady:true,planPermission:true}];
 window.fetch=async function(url,options={}){window.__calls.push(String(url));
  if(url==='/api/session')return new Response(JSON.stringify({authenticated:true,csrfToken:crypto.randomUUID()}));
  if(url==='/api/v1/ask-gpt/status')return new Response(JSON.stringify({ok:true,data:{enabled:true,accounts:window.__uiAccountRows,reason:null,runtimeCommit:'TEST_ONLY'}}));
  if(url==='/api/v1/ask-gpt/models')return new Response(JSON.stringify({ok:true,data:{models:[{slug:'gpt-5.6-terra',display_name:'SYNTHETIC TEST MODEL'}]}}));
  throw Error('UNEXPECTED_TEST_FETCH '+url);
 };
 document.getElementById('loading-view').classList.add('hidden');document.getElementById('login-view').classList.add('hidden');
 document.getElementById('dashboard-view').classList.remove('hidden');
 const banner=document.createElement('div');banner.textContent='工程版面測試 · 非市場資料 · 非產品驗收';banner.style.cssText='padding:8px 12px;background:#3b2732;color:#fff;font:14px sans-serif;';document.body.prepend(banner);
 window.__originalIds=Array.from(document.querySelectorAll('[id]')).map(n=>n.id);
 `;
 const inspect=`
 (async()=>{const output=document.createElement('pre');output.id='ui-convergence-test-result';output.hidden=true;
 try{
  const r=document.getElementById('decision-workspace');window.TraderTerminalShell.mount(r);
  const sleep=()=>new Promise(resolve=>setTimeout(resolve,50));await sleep();await sleep();
  const $=id=>document.getElementById(id),rect=n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom};};
  const background=r.querySelector('.tt-context-section'),fallback=r.querySelector('.tt-copy-fallback');
  const checkbox=$('ai-credits'),consent=checkbox.closest('label'),span=consent.querySelector('span');
  const ids=Array.from(document.querySelectorAll('[id]')).map(n=>n.id);
  const beforeConsent=checkbox.checked,submitBefore=$('ai-submit').disabled;
  $('ai-models').click();await sleep();await sleep();
  const settingsClosedAfterModels=!$('ai-settings').open,summaryAfterModels=$('ai-settings-summary').textContent;
  const modelReady=$('ai-model').value==='gpt-5.6-terra',submitStillDisabled=$('ai-submit').disabled;
  $('ai-model').add(new Option('SYNTHETIC SECOND MODEL','test-second'));$('ai-model').value='test-second';$('ai-model').dispatchEvent(new Event('change'));
  const selectedModelSummaryUpdated=$('ai-settings-summary').textContent.includes('SYNTHETIC SECOND MODEL');
  $('ai-account').value='';$('ai-account').dispatchEvent(new Event('change'));const settingsReopened=$('ai-settings').open;
  const result={engineeringOnly:true,viewport:innerWidth,docWidth:document.documentElement.scrollWidth,layout:r.dataset.uiLayout,
   chart:rect(r.querySelector('.dw-chart-stage')),chartRegion:rect(r.querySelector('.dw-price-region')),focus:rect(r.querySelector('.tt-focus-card')),
   focusFont:parseFloat(getComputedStyle($('dw-next-watch-label')).fontSize),checkbox:rect(checkbox),consent:rect(consent),consentText:rect(span),
   consentFont:parseFloat(getComputedStyle(span).fontSize),creditsInitiallyUnchecked:!beforeConsent,submitBefore,submitStillDisabled,
   settingsClosedAfterModels,summaryAfterModels,settingsReopened,modelReady,selectedModelSummaryUpdated,modelCalls:window.__calls.filter(u=>u==='/api/v1/ask-gpt/ask').length,
   backgroundInitiallyClosed:!background.open,fallbackInitiallyClosed:!fallback.open,
   recencyVisible:rect($('tt-top-updated')).h>0,modeVisible:rect(r.querySelector('.dw-mode-switch')).h>0,
   confirmVisible:['dw-long-confirm','dw-long-invalidate','dw-short-confirm','dw-short-invalidate'].every(id=>!$(id).closest('details:not([open])')&&rect($(id)).h>0),
   rrNoteVisible:!$('dw-scenario-rr-note').closest('details:not([open])'),flowBelowChart:rect(r.querySelector('.tt-flow-overview')).y>=rect(r.querySelector('.tt-primary-grid')).bottom-1,
   preservedIds:window.__originalIds.every(id=>ids.includes(id)),missingIds:window.__originalIds.filter(id=>!ids.includes(id)),overflowElements:Array.from(document.querySelectorAll('body *')).filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(n=>({tag:n.tagName,id:n.id,class:n.className,rect:rect(n)})),duplicateCriticalIds:['ai-credits','ai-account','ai-model','dw-next-watch','dw-chart-canvas'].filter(id=>ids.filter(v=>v===id).length!==1)};
  background.open=true;fallback.open=true;
  result.backgroundExpandable=rect(background.querySelector('.tt-card-global')).h>0;result.fallbackExpandable=rect($('dw-copy-gpt-prompt')).h>0;
  result.docWidthExpanded=document.documentElement.scrollWidth;
  $('tt-chart-expand').click();result.expandHidesRail=getComputedStyle(r.querySelector('.tt-tier-one-grid')).display==='none';
  $('tt-chart-expand').click();result.restoreShowsRail=getComputedStyle(r.querySelector('.tt-tier-one-grid')).display!=='none';
  output.textContent=JSON.stringify(result);
 }catch(e){output.textContent=JSON.stringify({error:e.message,stack:e.stack});}
 document.body.append(output);
 })();`;
 return html.replace('</head>',styles+'</head>').replace('</body>',script(setup)+script(read('public/trader-terminal-shell.js'))+script(read('public/ask-gpt-inline.js'))+script(inspect)+'</body>');
}
async function inspect(width){return inspectEngineeringDocument({binary,html:documentForTest(),width,evidenceDir:process.env.UI_LAYOUT_EVIDENCE_DIR});}
for(const width of [1536,1366,720,390])test('decision-first real CSS layout and consent at '+width+'px (synthetic engineering only)',{skip:!binary,timeout:40000},async()=>{
 const r=await inspect(width);assert.equal(r.engineeringOnly,true);assert.equal(r.layout,'decision-first');assert.equal(r.viewport,width,'Test must use the exact CSS viewport');
 assert.ok(r.docWidth<=r.viewport+1,JSON.stringify(r));assert.ok(r.docWidthExpanded<=r.viewport+1,JSON.stringify(r));
 assert.ok(r.chart.h>=(width<=720?319:359),JSON.stringify(r));assert.ok(r.focusFont>=18);assert.ok(r.consentFont>=14);
 assert.ok(Math.abs(r.checkbox.w-18)<1,JSON.stringify(r));assert.ok(r.consentText.w>=180,JSON.stringify(r));assert.ok(r.consentText.right<=r.consent.right+1,JSON.stringify(r));
 if(width>1100){assert.ok(r.focus.x>r.chartRegion.x);assert.ok(r.chartRegion.w>r.focus.w);}
 for(const key of ['creditsInitiallyUnchecked','submitBefore','submitStillDisabled','settingsClosedAfterModels','settingsReopened','modelReady','selectedModelSummaryUpdated','backgroundInitiallyClosed','fallbackInitiallyClosed','recencyVisible','modeVisible','confirmVisible','rrNoteVisible','flowBelowChart','preservedIds','backgroundExpandable','fallbackExpandable','expandHidesRail','restoreShowsRail'])assert.equal(r[key],true,key+' '+JSON.stringify(r));
 assert.equal(r.modelCalls,0);assert.deepEqual(r.duplicateCriticalIds,[]);assert.match(r.summaryAfterModels,/SYNTHETIC TEST MODEL/);
});
