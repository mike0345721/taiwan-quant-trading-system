// Production HTML/CSS/chart factory and home layout with SYNTHETIC inputs. Not live acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {inspectEngineeringDocument} from './ui-browser-engineering-helper.mjs';
import {homeEngineeringDocument,homeBootstrapDocument} from './ui-home-engineering-document.mjs';
const binary=[process.env.BROWSER_BINARY,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
for(const [width,height,scenario] of [[1536,864,'normal'],[1366,768,'normal'],[1920,1080,'normal'],[2560,1440,'normal'],[3440,1440,'normal'],[2560,1440,'offline'],[720,1024,'normal'],[390,844,'normal'],[1366,768,'limited'],[1366,768,'offline'],[390,844,'offline'],[1366,768,'warming'],[1366,768,'noFocus'],[1366,768,'day']])test('decision-first real CSS layout and consent at '+width+'px / '+scenario+' (synthetic engineering only)',{skip:!binary,timeout:40000},async()=>{
 const r=await inspectEngineeringDocument({binary,html:homeEngineeringDocument({scenario}),width,height,evidenceDir:process.env.UI_LAYOUT_EVIDENCE_DIR ? path.join(process.env.UI_LAYOUT_EVIDENCE_DIR,scenario) : undefined});assert.equal(r.engineeringOnly,true);assert.equal(r.layout,'decision-first');assert.equal(r.viewport,width,'Test must use the exact CSS viewport');
 assert.ok(r.docWidth<=r.viewport+1,JSON.stringify(r));assert.ok(r.docWidthExpanded<=r.viewport+1,JSON.stringify(r));
 assert.ok(r.chart.h>=(width<=720?319:359),JSON.stringify(r));assert.ok(r.focusFont>=18);assert.ok(r.consentFont>=14);
 assert.ok(Math.abs(r.checkbox.w-18)<1,JSON.stringify(r));assert.ok(r.consentText.w>=180,JSON.stringify(r));assert.ok(r.consentText.right<=r.consent.right+1,JSON.stringify(r));
 if(width>=1200){assert.ok(r.focus.x>r.chartRegion.x);assert.ok(r.chartRegion.w>r.focus.w);}
 if(width>=1200){
  assert.ok(Math.abs(r.workspace.x)<1&&Math.abs(r.workspace.w-r.clientWidth)<1,'Full-width workspace '+JSON.stringify(r));
  assert.ok(Math.abs(r.chartRegion.x-16)<1,'Left gutter must be 16px '+JSON.stringify(r));
  assert.ok(Math.abs(r.clientWidth-r.focus.right-16)<1,'Right gutter must be 16px '+JSON.stringify(r));
  assert.ok(r.focus.w>=320&&r.focus.w<=360,'Reading rail must not stretch '+JSON.stringify(r));
  assert.ok(Math.abs(r.navigationWidthDelta-64)<1,'Hidden navigation must return its 64px to chart '+JSON.stringify(r));
 }
 for(const key of ['creditsInitiallyUnchecked','submitBefore','submitStillDisabled','settingsClosedAfterModels','settingsReopened','modelReady','selectedModelSummaryUpdated','backgroundInitiallyClosed','fallbackInitiallyClosed','recencyVisible','modeVisible','confirmVisible','rrNoteVisible','flowBelowChart','preservedIds','backgroundExpandable','fallbackExpandable','expandHidesRail','restoreShowsRail'])assert.equal(r[key],true,key+' '+JSON.stringify(r));
 for(const key of ['flowSelectionIndependent','chartSelectionIndependent','rowSelectionPreservesChart','actualAdapterRows','evidenceRowsVisible','relatedMarketVisible'])assert.equal(r[key],true,key+' '+JSON.stringify(r));
 for(const key of ['quickInitial','quickBeforeChart','quickSelectionSync','quickKeyboardReachable','quickTableToStrip','quickCanvasPreserved','quickMirrorValues','quickMountIdempotent','quickExpandedVisible','quickOfflineCleared','quickRecoveryRestores'])assert.equal(r[key],true,key+' '+JSON.stringify(r));
 assert.equal(r.quickFinal.length,6);assert.ok(r.quickFinal.every(b=>b.visible));
 if(scenario==='warming'){assert.equal(r.quickFinal[5].value,'—');assert.match(r.quickFinal[5].status,/暖機中/);assert.equal(r.quickFinal[0].value,'+0.250');}
 if(scenario==='offline'||scenario==='limited')assert.ok(r.quickFinal.every(b=>b.value==='—'));
 assert.equal(r.finalFlowRows.length,6);
 if(scenario==='warming'){assert.equal(r.finalFlowRows[5].state,'暖機中');assert.equal(r.finalFlowRows[5].net,'—');assert.equal(r.finalFlowRows[0].net,'+50');}
 if(scenario==='offline'||scenario==='limited')assert.ok(r.finalFlowRows.every(row=>row.net==='—'));
 assert.equal(r.finalContextBasisLabel,scenario==='day'?'期現貨差':'夜盤對現貨收盤差');
 if(scenario==='offline')assert.equal(r.finalContextBasis,'—');
 assert.equal(r.modelCalls,0);assert.deepEqual(r.duplicateCriticalIds,[]);assert.match(r.summaryAfterModels,/SYNTHETIC TEST MODEL/);
 assert.equal(r.productionChartFactory,true);assert.ok(r.canvasCount>=5);assert.deepEqual(r.runtimeErrors,[]);
 for(const key of ['navigationInitiallyHidden','menuInitiallyReachable','navigationOpens','navigationCloses','escapeRestoresFocus','modalInertPreserved','canvasIdentityPreserved','hiddenRailReclaimsWidth','aiInitiallyClosed','offlineSnapshotVisible','offlineFocusBlocked','offlineNoPriceError','offlineTimeUnchanged','offlineCanvasRetained','limitedStateVisible','recoveryClearsSnapshot','longErrorNoOverflow']) assert.equal(r[key],true,key+' '+JSON.stringify(r));

});

for(const authenticated of [false,true])test('home whole production entry preserves '+(authenticated?'authenticated offline state':'normal login gate')+' (synthetic transport only)',{skip:!binary,timeout:40000},async()=>{
 const r=await inspectEngineeringDocument({binary,html:homeBootstrapDocument(authenticated),width:1366,height:768});
 assert.equal(r.wholeProductionStack,true);assert.deepEqual(r.errors,[],JSON.stringify(r));assert.equal(r.homeVersion,'2');assert.equal(r.rows,6);assert.equal(r.idsUnique,true);assert.equal(r.modelWrites,0);assert.ok(r.sessionCalls>=1);
 assert.equal(r.loginVisible,!authenticated);assert.equal(r.dashboardVisible,authenticated);if(authenticated){assert.equal(r.loadState,'UNAVAILABLE');assert.equal(r.sourceFailureVisible,true);}
});
