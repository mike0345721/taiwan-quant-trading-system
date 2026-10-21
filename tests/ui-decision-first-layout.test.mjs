// Production HTML/CSS/chart factory and home layout with SYNTHETIC inputs. Not live acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {inspectEngineeringDocument} from './ui-browser-engineering-helper.mjs';
import {homeEngineeringDocument} from './ui-home-engineering-document.mjs';
const binary=[process.env.BROWSER_BINARY,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
for(const [width,height,scenario] of [[1536,864,'normal'],[1366,768,'normal'],[1920,1080,'normal'],[720,1024,'normal'],[390,844,'normal'],[1366,768,'limited'],[1366,768,'offline'],[390,844,'offline']])test('decision-first real CSS layout and consent at '+width+'px / '+scenario+' (synthetic engineering only)',{skip:!binary,timeout:40000},async()=>{
 const r=await inspectEngineeringDocument({binary,html:homeEngineeringDocument({scenario}),width,height,evidenceDir:process.env.UI_LAYOUT_EVIDENCE_DIR ? path.join(process.env.UI_LAYOUT_EVIDENCE_DIR,scenario) : undefined});assert.equal(r.engineeringOnly,true);assert.equal(r.layout,'decision-first');assert.equal(r.viewport,width,'Test must use the exact CSS viewport');
 assert.ok(r.docWidth<=r.viewport+1,JSON.stringify(r));assert.ok(r.docWidthExpanded<=r.viewport+1,JSON.stringify(r));
 assert.ok(r.chart.h>=(width<=720?319:359),JSON.stringify(r));assert.ok(r.focusFont>=18);assert.ok(r.consentFont>=14);
 assert.ok(Math.abs(r.checkbox.w-18)<1,JSON.stringify(r));assert.ok(r.consentText.w>=180,JSON.stringify(r));assert.ok(r.consentText.right<=r.consent.right+1,JSON.stringify(r));
 if(width>=1200){assert.ok(r.focus.x>r.chartRegion.x);assert.ok(r.chartRegion.w>r.focus.w);}
 for(const key of ['creditsInitiallyUnchecked','submitBefore','submitStillDisabled','settingsClosedAfterModels','settingsReopened','modelReady','selectedModelSummaryUpdated','backgroundInitiallyClosed','fallbackInitiallyClosed','recencyVisible','modeVisible','confirmVisible','rrNoteVisible','flowBelowChart','preservedIds','backgroundExpandable','fallbackExpandable','expandHidesRail','restoreShowsRail'])assert.equal(r[key],true,key+' '+JSON.stringify(r));
 assert.equal(r.modelCalls,0);assert.deepEqual(r.duplicateCriticalIds,[]);assert.match(r.summaryAfterModels,/SYNTHETIC TEST MODEL/);
 assert.equal(r.productionChartFactory,true);assert.ok(r.canvasCount>=5);assert.deepEqual(r.runtimeErrors,[]);
 for(const key of ['navigationInitiallyHidden','menuInitiallyReachable','navigationOpens','navigationCloses','escapeRestoresFocus','modalInertPreserved','canvasIdentityPreserved','hiddenRailReclaimsWidth','aiInitiallyClosed','offlineSnapshotVisible','offlineFocusBlocked','offlineNoPriceError','offlineTimeUnchanged','offlineCanvasRetained','limitedStateVisible','recoveryClearsSnapshot','longErrorNoOverflow']) assert.equal(r[key],true,key+' '+JSON.stringify(r));

});
