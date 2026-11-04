import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspectEngineeringDocument } from './ui-browser-engineering-helper.mjs';
import { guestBrowserPath } from './guest-browser-path.mjs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const cards=app.slice(app.indexOf('function metric('),app.indexOf("\n$('app').addEventListener('click'"));
const badges=app.slice(app.indexOf('function metricSourceKeys('),app.indexOf('\nfunction regimeLabel('));
const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const binary=process.platform==='linux'?(()=>{const b=guestBrowserPath();return b.skip?null:b.executable;})():
  ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
for(const width of [390,1366])test(`each daily card retains its own mixed-source status at ${width}px`,{skip:!binary,timeout:40000},async()=>{
  const html=`<!doctype html><meta charset="utf-8"><style>${css}body{padding:12px}body::before{display:none}</style>
    <div id="market-cards"></div><div id="futures-cards"></div><div id="options-cards"></div><script>
    const $=id=>document.getElementById(id),FIELD_HELP={};
    const update=(status,date,reason=null)=>({status,dataDate:date,reason,sourceTime:'2026-11-04T08:01:00Z',lastSuccessfulAt:'2026-11-04T08:02:00Z',lastAttemptAt:'2026-11-04T08:03:00Z'});
    const state={snapshot:{largeTraders:{data:{marketOi:42}},sources:{
      marketOverview:{update:update('AVAILABLE','2026-11-04')},taiwanVix:{update:update('JOB_FAILED','2026-11-03','VIX_FETCH_FAILED')},
      futuresMarket:{update:update('STALE','2026-11-02','OLD_FUTURES')},largeTraders:{update:update('SOURCE_NOT_PUBLISHED','2026-11-03','WAIT_SOURCE')},
      options:{update:update('AVAILABLE','2026-11-04')}}}};
    ${cards}${badges}
    replaceCards('market-cards',[metric('加權指數','20000'),metric('臺指波動率指數','30'),metric('期現貨基差','10')]);
    replaceCards('futures-cards',[metric('台指期近月','20010'),metric('Top 5 L/S','1.2'),metric('市場未平倉','42')]);
    replaceCards('options-cards',[metric('Call 未平倉量','100')]);
    const find=label=>[...document.querySelectorAll('.metric-card')].find(c=>c.dataset.label===label);
    const vix=find('臺指波動率指數'),basis=find('期現貨基差');
    const result={width:innerWidth,docWidth:document.documentElement.scrollWidth,
      available:find('加權指數').textContent.includes('AVAILABLE'),failed:vix.textContent.includes('JOB_FAILED')&&!vix.textContent.includes('AVAILABLE'),
      ownDate:vix.textContent.includes('2026-11-03'),reason:vix.textContent.includes('VIX_FETCH_FAILED'),
      times:['來源時間','最後成功取得','最後嘗試'].every(k=>vix.textContent.includes(k)),
      composite:basis.querySelectorAll('[data-source-key]').length===2&&basis.textContent.includes('OLD_FUTURES'),
      large:find('Top 5 L/S').textContent.includes('SOURCE_NOT_PUBLISHED')&&find('市場未平倉').textContent.includes('WAIT_SOURCE'),
      everyCard:[...document.querySelectorAll('.metric-card')].every(c=>c.querySelector('[data-source-key]'))};
    const out=document.createElement('pre');out.id='ui-convergence-test-result';out.textContent=JSON.stringify(result);document.body.append(out);
    </script>`;
  const result=await inspectEngineeringDocument({binary,html,width,hostedLinuxResearchTest:true});
  for(const key of ['available','failed','ownDate','reason','times','composite','large','everyCard'])assert.equal(result[key],true,key);
  assert.ok(result.docWidth<=width+1,JSON.stringify(result));
});
