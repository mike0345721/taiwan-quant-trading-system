import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspectEngineeringDocument } from './ui-browser-engineering-helper.mjs';
import { guestBrowserPath } from './guest-browser-path.mjs';

const browser = process.platform === 'linux' ? (() => { const selected = guestBrowserPath(); return selected.skip ? null : selected.executable; })()
  : [process.env.BROWSER_BINARY, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
for (const width of [390, 1366]) test(`synthetic row times render without page overflow or JS errors at ${width}px`, { skip: !browser, timeout: 40000 }, async () => {
  const css = ['styles.css', 'data-operations.css'].map(file => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8')).join('\n');
  const script = fs.readFileSync(new URL('../public/data-operations.js', import.meta.url), 'utf8');
  const view = { rows: [{ sourceDate: '2026-09-09', sourceArtifactKnown: true,
    availableAt: '2026-09-09T07:10:00Z', observedAt: '2026-09-09T08:12:00Z' }] };
  const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${css}</style><body><main id="content"></main><script>window.errors=[];addEventListener('error', e=>errors.push(e.message));</script>
    <script>${script}</script><script>
    document.getElementById('content').innerHTML=DataOperations.render(${JSON.stringify(view)});
    document.querySelector('.dop-details').open=true;
    const content=document.getElementById('content').textContent;
    const result=document.createElement('pre');result.id='ui-convergence-test-result';
    result.textContent=JSON.stringify({synthetic:true,width:innerWidth,docWidth:document.documentElement.scrollWidth,
      source:content.includes('來源可用時間：2026-09-09 07:10:00 UTC'),
      observation:content.includes('資料觀測時間：2026-09-09 08:12:00 UTC'),
      unknownSuccess:content.includes('最後成功資料更新：未知'),errors});document.body.append(result);
    </script></body></html>`;
  const result = await inspectEngineeringDocument({ binary: browser, html, width, hostedLinuxResearchTest: true });
  assert.equal(result.width, width); assert.ok(result.docWidth <= width + 1, JSON.stringify(result));
  for (const key of ['source', 'observation', 'unknownSuccess']) assert.equal(result[key], true, key);
  assert.deepEqual(result.errors, []);
});
