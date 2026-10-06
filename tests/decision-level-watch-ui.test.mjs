import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const inference=fs.readFileSync(new URL('../src/chatgpt-plan-inference.mjs',import.meta.url),'utf8');

test('Next Watch is a compact chart-adjacent disclosure, not a new dominant panel',()=>{
 for(const id of ['dw-next-watch','dw-next-watch-label','dw-next-watch-distance','dw-next-watch-detail','dw-next-watch-why','dw-next-watch-response','dw-next-watch-confirm','dw-next-watch-invalidate']) assert.match(html,new RegExp(`id=["']${id}["']`));
 assert.ok(html.indexOf('dw-flow-window-strip')<html.indexOf('dw-next-watch'));
 assert.ok(html.indexOf('dw-next-watch')<html.indexOf('dw-chart-stage'));
 assert.match(css,/\.dw-next-watch\s*\{/);assert.match(css,/font-size:\s*9px|font-size:\s*10px/);
});
test('chart renders at most three deterministic level-watch lines and preserves optional legacy levels',()=>{
 assert.match(app,/watch\.levels\.slice\(0, 3\)/);
 assert.match(app,/show-optional-levels/);
 assert.match(app,/createPriceLine/);
 assert.match(app,/levelEventLabel/);
});
test('local watcher polls governed level endpoint without any model endpoint',()=>{
 assert.match(server,/\/api\/v1\/decision-level-watch/);
 assert.match(server,/currentDecisionLevelWatch/);
 const match=app.match(/async function loadDecisionLevelWatch\(\)[\s\S]*?function clearTxChartLevels/);
 assert.ok(match);assert.match(match[0],/\/api\/v1\/decision-level-watch/);
 assert.doesNotMatch(match[0],/ask-gpt\/ask|responses|analysePlan/);
 assert.match(app,/Key level watcher is deterministic\/local/);
});
test('decision-first model contract prioritizes levels and price response over engineering jargon',()=>{
 for(const heading of ['現在怎麼看','最值得盯的價位','確認 \/ 失效','現在不要做什麼','資料限制']) assert.match(inference,new RegExp(heading));
 assert.match(inference,/Pressure → Expected Response → Actual Response/);
 assert.match(inference,/不得自創價位/);
 assert.doesNotMatch(inference,/固定分四段/);
});

test('Next Watch keeps quality limitation visible without exposing engineering jargon',()=>{assert.match(app,/資料品質受限/);assert.match(app,/qualityStatus/);});
