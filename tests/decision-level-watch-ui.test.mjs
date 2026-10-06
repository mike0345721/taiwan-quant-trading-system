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
