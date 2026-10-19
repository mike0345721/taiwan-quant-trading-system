import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=file=>fs.readFileSync(fileURLToPath(new URL('../'+file,import.meta.url)),'utf8');
test('account configuration can collapse but per-request consent and feedback remain outside it',()=>{
 const html=read('public/index.html');
 const start=html.indexOf('<details id="ai-settings" open>'),end=html.indexOf('</details>',start);
 assert.ok(start>0&&end>start);const settings=html.slice(start,end);
 for(const id of ['ai-account','ai-model','ai-models','ai-connect'])assert.ok(settings.includes('id="'+id+'"'),id);
 for(const id of ['ai-question','ai-credits','ai-submit','ai-status','ai-answer'])assert.ok(html.indexOf('id="'+id+'"')>end,id);
 assert.ok(html.indexOf('id="ai-connection"')<start);
 const checkbox=html.match(/<input\b[^>]*id="ai-credits"[^>]*>/)?.[0];assert.ok(checkbox);assert.match(checkbox,/type="checkbox"/);assert.doesNotMatch(checkbox,/\bchecked\b/);
});
test('checkbox width is bounded independently of the global input style and text may wrap',()=>{
 const css=read('public/ask-gpt-inline.css');const input=css.match(/#ai-inline \.ai-consent input\{([^}]+)\}/)?.[1];assert.ok(input);
 for(const rule of ['box-sizing:border-box','width:18px','max-width:18px','padding:0','flex:0 0 18px'])assert.ok(input.includes(rule),rule);
 assert.match(css,/#ai-inline \.ai-consent span\{[^}]*min-width:0[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
});
test('presentation convergence keeps submit authorization and puts existing conditions before optional context',()=>{
 const js=read('public/ask-gpt-inline.js'),shell=read('public/trader-terminal-shell.js');
 assert.match(js,/\$\('ai-submit'\)\.disabled=busy\|\|!enabled\|\|!csrf\|\|!\$\('ai-account'\)\.value\|\|!\$\('ai-model'\)\.value\|\|!\$\('ai-credits'\)\.checked/);
 assert.match(js,/creditsDisabledConfirmed:\$\('ai-credits'\)\.checked/);
 assert.doesNotMatch(js,/\$\('ai-credits'\)\.checked\s*=\s*true/);
 assert.match(shell,/focus\.append\(summary, primary, observations, aiWorkspace, background, progressive\)/);
 assert.match(shell,/conditions\.append\(paragraph\)/);assert.match(shell,/watch\.insertBefore\(note, detail\)/);
 assert.match(shell,/heading\.prepend\(workspaceTitle\)/);assert.match(shell,/recency\.append\(modeSwitch\)/);
 assert.doesNotMatch(shell,/executionAuthorized\s*=\s*true|orderRoutesEnabled\s*=\s*true/);
});
