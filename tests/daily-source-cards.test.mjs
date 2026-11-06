import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inspectEngineeringDocument } from './ui-browser-engineering-helper.mjs';
import { guestBrowserPath } from './guest-browser-path.mjs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const cards=app.slice(app.indexOf('function metric('),app.indexOf("\n$('app').addEventListener('click'"));
const badges=app.slice(app.indexOf('function metricSourceKeys('),app.indexOf('\nfunction regimeLabel('));
const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
function dailyMonitorHarness({ busy = false, captureDuringRead = false, reloadError = false, changeSession = false } = {}) {
  const monitor = app.slice(app.indexOf('async function monitorDailyUpdate()'), app.indexOf("\n$('daily-update-button').addEventListener"));
  const dashboard = app.slice(app.indexOf('async function loadDashboard()'), app.indexOf('\nfunction reportDashboardLoadError('));
  const alerts = [], button = {}, locked = Object.freeze({ snapshotHash: 'locked-cutoff' });
  let polls = 0, rereads = 0, renders = 0, ticks = 0, session = 1;
  const context = { state: { decisionCaptureBusy: busy, dashboardRequestId: 0, guestReadOnly: true, locked },
    setTimeout: fn => { if (++ticks === 2) context.state.decisionCaptureBusy = false; fn(); },
    DAILY_STAGE_LABELS: {}, flowChannel: { ticket: () => session, isCurrentSession: t => t === session, merge() {} },
    $: id => id === 'daily-update-button' ? button : id === 'alert-area' ? { prepend: node => alerts.unshift(node) } : null,
    document: { createElement: () => ({}) },
    api: async url => {
      if (url === '/api/v2/daily-update') {
        polls++; if (changeSession) session++;
        return { processRunning: false, data: { state: 'failed', fatalError: 'Critical stage failed: data_continuity_audit' } };
      }
      assert.equal(url, '/api/v1/dashboard'); rereads++;
      if (captureDuringRead && rereads === 1) {
        context.state.decisionCaptureBusy = true;
        context.state.dashboardRequestId++;
      }
      if (reloadError) throw Error('DASHBOARD_READ_FAILED');
      return { data: {}, decisionWorkspace: {} };
    },
    // The real render starts by clearing this shared alert area.
    render: () => { renders++; alerts.length = 0; }, renderDecisionWorkspace() {},
    loadIndexLeadership: async () => {}, renderIndexLeadershipFailure() {},
    loadTxDecisionChart: async () => {}, loadLiveMarketPulse: async () => {} };
  vm.runInNewContext(`${dashboard}\n${monitor}`, context);
  return { context, alerts, locked, counts: () => ({ polls, rereads }), renders: () => renders };
}
test('daily monitor retries a response superseded by capture after the request began', async () => {
  const h = dailyMonitorHarness({ captureDuringRead: true });
  await h.context.monitorDailyUpdate();
  assert.deepEqual(h.counts(), { polls: 2, rereads: 2 });
  assert.equal(h.renders(), 1); assert.equal(h.context.state.locked, h.locked);
  assert.match(h.alerts[0]?.textContent || '', /data_continuity_audit/);
});
test('daily monitor rereads after capture settles and keeps the batch failure after render', async () => {
  const h = dailyMonitorHarness({ busy: true });
  await h.context.monitorDailyUpdate();
  assert.deepEqual(h.counts(), { polls: 2, rereads: 1 });
  assert.equal(h.context.state.locked, h.locked);
  assert.equal(h.alerts[0]?.className, 'alert bad');
  assert.match(h.alerts[0]?.textContent || '', /未完成.*data_continuity_audit/);
});
test('daily monitor retains the batch failure after a successful render', async () => {
  const h = dailyMonitorHarness(); await h.context.monitorDailyUpdate();
  assert.equal(h.counts().rereads, 1);
  assert.match(h.alerts[0]?.textContent || '', /data_continuity_audit/);
});
test('daily monitor distinguishes reload failure from starting the batch', async () => {
  const h = dailyMonitorHarness({ reloadError: true }); await h.context.monitorDailyUpdate();
  assert.match(h.alerts[0]?.textContent || '', /data_continuity_audit/);
  assert.match(h.alerts[0]?.textContent || '', /重讀失敗.*DASHBOARD_READ_FAILED/);
});
test('daily monitor does not apply an earlier login session result', async () => {
  const h = dailyMonitorHarness({ changeSession: true }); await h.context.monitorDailyUpdate();
  assert.equal(h.counts().rereads, 0); assert.equal(h.alerts.length, 0);
});
const binary=process.platform==='linux'?(()=>{const b=guestBrowserPath();return b.skip?null:b.executable;})():
  ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
for(const width of [390,1366])test(`each daily card retains its own mixed-source status at ${width}px`,{skip:!binary,timeout:40000},async()=>{
  const html=`<!doctype html><meta charset="utf-8"><style>${css}body{padding:12px}body::before{display:none}</style>
    <div id="market-cards"></div><div id="futures-cards"></div><div id="options-cards"></div><div id="spot-cards"></div><script>
    const $=id=>document.getElementById(id),FIELD_HELP={};
    const update=(status,date,reason=null)=>({status,dataDate:date,reason,sourceTime:'2026-11-04T08:01:00Z',lastSuccessfulAt:'2026-11-04T08:02:00Z',lastAttemptAt:'2026-11-04T08:03:00Z'});
    const state={snapshot:{largeTraders:{data:{marketOi:0}},sources:{
      marketOverview:{update:update('AVAILABLE','2026-11-04')},taiwanVix:{update:update('JOB_FAILED','2026-11-03','VIX_FETCH_FAILED')},
      futuresMarket:{update:update('STALE','2026-11-02','OLD_FUTURES')},largeTraders:{update:update('SOURCE_NOT_PUBLISHED','2026-11-03','WAIT_SOURCE')},
      options:{update:update('AVAILABLE','2026-11-04')}}}};
    ${cards}${badges}
    replaceCards('market-cards',[metric('加權指數','20000'),metric('臺指波動率指數','30'),metric('期現貨基差','10')]);
    replaceCards('futures-cards',[metric('台指期近月','20010'),metric('Top 5 L/S','1.2'),metric('市場未平倉','0'),metric('未平倉單日增減','50'),metric('價格 × OI 判讀','已取得比較資料')]);
    replaceCards('spot-cards',[metric('法人與指數背離','資料累積中')]);
    replaceCards('options-cards',[metric('Call 未平倉量','100')]);
    const find=label=>[...document.querySelectorAll('.metric-card')].find(c=>c.dataset.label===label);
    const vix=find('臺指波動率指數'),basis=find('期現貨基差');
    const result={width:innerWidth,docWidth:document.documentElement.scrollWidth,
      available:find('加權指數').textContent.includes('AVAILABLE'),failed:vix.textContent.includes('JOB_FAILED')&&!vix.textContent.includes('AVAILABLE'),
      ownDate:vix.textContent.includes('2026-11-03'),reason:vix.textContent.includes('VIX_FETCH_FAILED'),
      times:['來源時間','最後成功取得','最後嘗試'].every(k=>vix.textContent.includes(k)),
      composite:basis.querySelectorAll('[data-source-key]').length===2&&basis.textContent.includes('OLD_FUTURES'),
      large:find('Top 5 L/S').textContent.includes('SOURCE_NOT_PUBLISHED')&&find('市場未平倉').textContent.includes('WAIT_SOURCE'),
      oi:find('未平倉單日增減').textContent.includes('WAIT_SOURCE')&&find('價格 × OI 判讀').textContent.includes('HISTORICAL_SOURCE_EVIDENCE_INCOMPLETE'),
      unavailable:find('法人與指數背離').textContent.includes('DATA_NOT_CONNECTED')&&!find('法人與指數背離').textContent.includes('AVAILABLE'),
      everyCard:[...document.querySelectorAll('.metric-card')].every(c=>c.querySelector('[data-source-key]'))};
    state.snapshot.largeTraders.data.marketOi=null;
    replaceCards('futures-cards',[metric('Top 5 多方集中度','10%')]);
    result.denominator=find('Top 5 多方集中度').textContent.includes('WAIT_SOURCE')&&!find('Top 5 多方集中度').textContent.includes('OLD_FUTURES');
    const out=document.createElement('pre');out.id='ui-convergence-test-result';out.textContent=JSON.stringify(result);document.body.append(out);
    </script>`;
  const result=await inspectEngineeringDocument({binary,html,width,hostedLinuxResearchTest:true});
  for(const key of ['available','failed','ownDate','reason','times','composite','large','oi','unavailable','denominator','everyCard'])assert.equal(result[key],true,key);
  assert.ok(result.docWidth<=width+1,JSON.stringify(result));
});
