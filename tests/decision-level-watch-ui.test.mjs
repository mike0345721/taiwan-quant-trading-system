import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('chart keeps one VWAP label by reusing the VWAP series and skipping a duplicate price line',()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/vwapSeriesLabel/);
  assert.match(app,/state\.txChartSeries\.vwap\.applyOptions/);
  assert.match(app,/if \(entry\.id === 'VWAP'\) continue;/);
});

test('next watch exposes transparent evidence reasons without making them first-layer chart clutter',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="dw-next-watch-basis"/);
  assert.match(app,/renderNextWatchBasis\(next\.basisReasons \|\| \[\]\)/);
  assert.match(html,/<summary>為什麼<\/summary>/);
});

test('owner-facing swing labels are plain-language local five-minute pivots',()=>{
  const source=fs.readFileSync(new URL('../src/decision-level-watch.mjs',import.meta.url),'utf8');
  assert.match(source,/近期5分K局部高點/);
  assert.match(source,/近期5分K局部低點/);
  assert.doesNotMatch(source,/label:'近期 Swing High'/);
  assert.doesNotMatch(source,/label:'近期 Swing Low'/);
});

test('next watch shows separate long and short targets with conditional RR without crowding the chart',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="dw-long-target"/);
  assert.match(html,/id="dw-short-target"/);
  assert.match(html,/id="dw-long-rr"/);
  assert.match(html,/id="dw-short-rr"/);
  assert.match(css,/\.dw-scenario-watch/);
  assert.match(app,/scenarioDirectionLabel/);
  assert.match(app,/條件式結構 R:R/);
  assert.match(app,/多方下一關/);
  assert.match(app,/空方下一關/);
});

test('AI contract uses backend scenario targets and RR only, with no invented win rate or EV',()=>{
  const inference=fs.readFileSync(new URL('../src/chatgpt-plan-inference.mjs',import.meta.url),'utf8');
  const context=fs.readFileSync(new URL('../src/ask-gpt-inline-context.mjs',import.meta.url),'utf8');
  assert.match(inference,/scenarioWatch\.long/);
  assert.match(inference,/scenarioWatch\.short/);
  assert.match(inference,/條件式結構 R:R/);
  assert.match(inference,/不是勝率、EV/);
  assert.match(context,/scenarioWatch/);
  assert.match(context,/confirmationThreshold/);
  assert.match(context,/invalidationThreshold/);
  assert.match(context,/rewardPoints/);
  assert.match(context,/riskPoints/);
});
