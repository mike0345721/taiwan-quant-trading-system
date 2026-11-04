import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeObservation, observationCopyText, plotObservation } from '../public/market-observation.js';
import { inspectEngineeringDocument } from './ui-browser-engineering-helper.mjs';
import { guestBrowserPath } from './guest-browser-path.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { SAFETY } from '../src/cvd-observation-core.mjs';
import { OBSERVATION_VERSION, createMarketObservationState, appendMarketObservationRecords, marketObservationSnapshot } from '../src/market-observation-core.mjs';

const start = Date.parse('2026-08-20T01:00:00Z');
function fixture() {
  const iso = seconds => new Date(start + seconds * 1000).toISOString();
  return { schemaVersion: OBSERVATION_VERSION, snapshotId: 'SYNTHETIC-snapshot-1', cutoff: iso(600),
    servedAt: iso(600), mode: 'FIXTURE', timeframe: '1m', status: 'OBSERVATION_CANDIDATE',
    identity: { actualContract: 'SYNTHETIC', tradeDate: '2026-08-20', session: 'DAY', continuityEpoch: 1 },
    price: { bars: Array.from({ length: 10 }, (_, i) => ({ time: iso(i * 60), endTime: iso((i + 1) * 60),
      availableAt: iso((i + 1) * 60), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i })) },
    cvd: { value: 15, observedStart: iso(0), classifiedCoverage: .75, unknownVolume: 5,
      series: [0, 3, null, 9, 15].map((value, i) => ({ value, eventTime: iso(i * 120), availableAt: iso(i * 120) })) },
    profile: { bins: [{ price: 104, volume: 5 }, { price: 105, volume: 10 }], poc: 105, vah: 105, val: 104,
      binSize: 1, observedStart: iso(0), observedEnd: iso(600), partial: true },
    previousProfile: { state: 'UNAVAILABLE', reason: 'COMPLETE_SESSION_NOT_PROVEN' },
    structure: { events: [{ id: 's1', type: 'BOS', price: 104, anchorTime: iso(60), confirmedAt: iso(240) }],
      zones: [{ kind: 'FVG', low: 103, high: 104, anchorTime: iso(120), confirmedAt: iso(240), invalidatedAt: null }] },
    events: [{ id: 'e1', title: '突破成交區候選', eventType: 'BOS', anchorTime: iso(60), confirmedAt: iso(240),
      location: { price: 104, poc: 103 }, structureState: 'BULLISH', deltaCvd: 8, priceResponse: 2,
      supportingEvidence: ['測試期 BUY_PROXY 增加'], contraryEvidence: ['分類不完整'],
      confirmationConditions: ['回測守住'], invalidationConditions: ['跌回測試位'],
      quality: 'QUALITY_INSUFFICIENT', sourceTimes: { from: iso(120), to: iso(240) } }],
    summary: { position: '價值區上方', force: '事件買進代理增加', structure: 'BOS 候選', counterEvidence: '分類不完整', dataStatus: 'FIXTURE・片段' },
    reasonCodes: ['SYNTHETIC_FIXTURE_ONLY'] };
}

function actualCoreFixture() {
  const prices = [100,102,105,103,101,104,107,106,103,99,97,100,103,108,109,104,99,96,98,101];
  let hash = 'GENESIS';
  const rows = prices.map((price, i) => { const time = new Date(start + i * 60000).toISOString();
    const row = buildLiveEventRecord({ kind: 'futures_tick', code: 'TXFH6', receivedAt: time, ...SAFETY,
      payload: { productFamily: 'TX', actualContract: 'TXFH6', tradeDate: '2026-08-20', session: 'DAY', eventTime: time, close: price, volume: 2, tick_type: i % 3 === 0 ? 2 : 1 } }, hash);
    hash = row.recordHash; return row; });
  const sourceLedgerIdentity = 'sha256:' + 'e'.repeat(64), resolverIdentity = 'ui-synthetic-v1';
  const state = appendMarketObservationRecords(createMarketObservationState(sourceLedgerIdentity, resolverIdentity), rows,
    { sourceLedgerIdentity, resolverIdentity, ledgerOrdinalOffset: 0 });
  return marketObservationSnapshot(state, { timeframe: '1m', mode: 'FIXTURE', cutoff: rows.at(-1).receivedAt });
}

test('actual canonical CVD, profile and SMC snapshot is accepted without replacing its evidence', () => {
  const source = actualCoreFixture(), snapshot = normalizeObservation(source, '1m');
  assert.equal(snapshot.snapshotId, source.snapshotId); assert.ok(snapshot.events.length > 0);
  assert.equal(snapshot.cvd.value, source.cvd.value); assert.deepEqual(snapshot.profile.bins, source.profile.bins);
  assert.deepEqual(snapshot.structure.zones, source.structure.zones);
  assert.match(observationCopyText(snapshot, snapshot.events[0]), new RegExp(snapshot.snapshotId));
});

test('same snapshot is preserved across summary, copy and event; unknown is not zero', () => {
  const original = fixture(), snapshot = normalizeObservation(original, '1m');
  assert.deepEqual(snapshot, original);
  const text = observationCopyText(snapshot, snapshot.events[0]);
  assert.match(text, /SYNTHETIC-snapshot-1/); assert.match(text, /"deltaCvd": 8/);
  assert.match(text, /"executionAuthorized": false/); assert.match(text, /不是三份獨立證據/);
  original.cvd.value = null;
  assert.match(observationCopyText(normalizeObservation(original, '1m')), /"value": null/);
  assert.equal(observationCopyText(null), '');
});

test('future or malformed observations cannot appear in an earlier cutoff chart', () => {
  const raw = fixture(), future = '2026-08-21T00:00:00Z';
  raw.price.bars.push({ ...raw.price.bars[0], availableAt: future });
  raw.price.bars.push({ ...raw.price.bars[0], close: null });
  raw.cvd.series.push({ value: 999, eventTime: future });
  raw.events.push({ id: 'future', confirmedAt: future });
  raw.structure.events.push({ id: 'future', confirmedAt: future });
  raw.structure.zones.push({ low: 1, high: 2, confirmedAt: future });
  const s = normalizeObservation(raw, '1m');
  assert.equal(s.price.bars.length, 10); assert.equal(s.cvd.series.length, 5);
  assert.equal(s.events.length, 1); assert.equal(s.structure.events.length, 1); assert.equal(s.structure.zones.length, 1);
  for (const change of [s => { s.timeframe = '5m'; }, s => { s.cutoff = null; }, s => { s.snapshotId = ''; }]) {
    const x = fixture(); change(x); assert.throws(() => normalizeObservation(x, '1m'), /INVALID/);
  }
});

test('plot uses one time mapping, breaks CVD paths at null and supports mobile coordinates', () => {
  const snapshot = normalizeObservation(fixture(), '1m'), desktop = plotObservation(snapshot), mobile = plotObservation(snapshot, 350);
  assert.equal((desktop.path.match(/M/g) || []).length, 2);
  assert.equal(mobile.x(mobile.t0), mobile.left); assert.equal(mobile.x(mobile.t1), mobile.right);
  assert.ok(mobile.profileLeft > mobile.right && mobile.edge < 350);
  assert.ok(mobile.y(105) >= 42 && mobile.y(105) <= 268);
  assert.equal(plotObservation({ price: { bars: [] } }), null);
});

test('delayed CVD is drawn at first available time, never backdated to exchange event time', () => {
  const raw = fixture(); raw.cvd.series = [{ eventTime: raw.price.bars[0].time, availableAt: raw.price.bars[5].time, value: 99 },
    { eventTime: raw.price.bars[0].time, value: 100 }];
  const snapshot = normalizeObservation(raw, '1m'), plot = plotObservation(snapshot);
  assert.equal(snapshot.cvd.series.length, 1, 'missing availability cannot be guessed from event time');
  assert.ok(plot.path.startsWith('M' + plot.x(raw.price.bars[5].time).toFixed(2) + ','));
  assert.ok(!plot.path.startsWith('M' + plot.x(raw.price.bars[0].time).toFixed(2) + ','));
});

test('nominal bar close cannot make a delayed structure event or zone available earlier', () => {
  const raw = fixture(), future = '2026-08-21T00:00:00Z';
  raw.structure.events[0].availableAt = future;
  raw.structure.zones[0].availableAt = future;
  raw.events[0].availableAt = future;
  const snapshot = normalizeObservation(raw, '1m');
  assert.equal(snapshot.structure.events.length, 0); assert.equal(snapshot.structure.zones.length, 0); assert.equal(snapshot.events.length, 0);
});

test('latest known CVD after the last completed bar remains visible without fabricating price bars', () => {
  const raw = fixture(), tail = '2026-08-20T01:10:30Z'; raw.cutoff = tail;
  raw.cvd.series.push({ eventTime: tail, availableAt: tail, value: 99 });
  const snapshot = normalizeObservation(raw, '1m'), plot = plotObservation(snapshot);
  assert.equal(plot.bars.length, 10); assert.equal(plot.t1, Date.parse(tail)); assert.equal(plot.points.at(-1).value, 99);
});

test('zone layer retains older active zones and ends at the first known terminal lifecycle event', () => {
  const raw = fixture(), early = '2026-08-20T00:59:00Z', filled = raw.price.bars[5].time;
  raw.structure.zones = [
    { kind: 'ORDER_BLOCK', low: 103, high: 104, availableAt: early, status: 'ACTIVE' },
    { kind: 'FVG', low: 103, high: 104, availableAt: early, status: 'FILLED', filledAt: filled },
    { kind: 'FVG', low: 103, high: 104, availableAt: early, status: 'UNAVAILABLE', unavailableAt: filled },
    { kind: 'FVG', low: 103, high: 104, availableAt: early, status: 'INVALIDATED', invalidatedAt: early },
  ];
  const plot = plotObservation(normalizeObservation(raw, '1m'));
  assert.equal(plot.zones.length, 3, 'already-ended offscreen zone is omitted');
  assert.equal(plot.x(plot.zones[0].start), plot.left, 'older active zone clips to left edge');
  assert.equal(plot.zones[0].end, Date.parse(raw.cutoff));
  assert.equal(plot.zones[1].end, Date.parse(filled));
  assert.equal(plot.zones[2].end, Date.parse(filled));
});

test('presentation work is bounded while retained copy metadata remains explicit', () => {
  const raw = fixture(); raw.price.bars = Array.from({ length: 1000 }, () => raw.price.bars[0]);
  raw.profile.bins = Array.from({ length: 3000 }, (_, i) => ({ price: i, volume: 1 }));
  raw.events = Array.from({ length: 300 }, (_, i) => ({ ...raw.events[0], id: String(i) }));
  const snapshot = normalizeObservation(raw, '1m');
  assert.equal(snapshot.price.bars.length, 400); assert.ok(snapshot.profile.bins.length <= 2000); assert.equal(snapshot.events.length, 200);
  assert.equal(snapshot.profile.sourceBinCount, 3000);
  assert.equal(snapshot.profile.displayedBinCount, snapshot.profile.bins.length);
});

test('large profile display cap retains current high-price bins and discloses its clipped range', () => {
  const raw = fixture();
  raw.profile.bins = Array.from({ length: 3000 }, (_, i) => ({ price: i, volume: i === 2990 ? 20 : 1 }));
  raw.profile.poc = 2990;
  raw.price.bars = raw.price.bars.map(b => ({ ...b, open: 2989, close: 2990, low: 2988, high: 2991 }));
  const snapshot = normalizeObservation(raw, '1m');
  assert.ok(snapshot.profile.bins.some(b => b.price === 2990 && b.volume === 20));
  assert.ok(snapshot.profile.bins.length <= 2000);
  assert.equal(snapshot.profile.poc, raw.profile.poc);
  assert.match(observationCopyText(snapshot), /SUMMARY_USES_FULL_SOURCE_PROFILE/);
});

const binary = process.platform === 'linux' ? (() => { const value = guestBrowserPath(); return value.skip ? null : value.executable; })()
  : [process.env.BROWSER_BINARY, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
for (const width of [390, 1366]) test(`synthetic observation controls, cursor, journal handoff, degradation and recovery at ${width}px`, { skip: !binary, timeout: 40000 }, async () => {
  const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const panel = index.slice(index.indexOf('          <details id="market-observation-workspace"'), index.indexOf('          <details class="dw-family-strip"'));
  const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8') + fs.readFileSync(new URL('../public/market-observation.css', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../public/market-observation.js', import.meta.url), 'utf8');
  const setup = `<script>const sample=${JSON.stringify(actualCoreFixture())};window.errors=[];window.addEventListener('error',e=>errors.push(e.message));let fail=false,journal=0,selected=0;
  window.addEventListener('market-observation-journal',e=>{if(e.detail.snapshot.snapshotId===sample.snapshotId&&e.detail.event.id===sample.events.at(-1).id)journal++;});
  window.addEventListener('market-observation-selected',()=>selected++);
  window.fetch=async url=>({ok:!fail,status:fail?503:200,json:async()=>({data:{...sample,timeframe:new URL(url,'http://synthetic').searchParams.get('timeframe')}})});</script>`;
  const verification = `<script type="module">const sleep=ms=>new Promise(r=>setTimeout(r,ms));await sleep(50);const $=id=>document.getElementById(id),api=window.MarketObservationWorkspace;
  $('market-observation-workspace').open=true;await api.refresh();await sleep(50);
  const ready=$('mo-position').textContent===sample.summary.position&&$('mo-chart').querySelectorAll('.mo-candle-up,.mo-candle-down').length===sample.price.bars.length*2;
  const compactMarkers=[...$('mo-chart').querySelectorAll('.mo-marker')].every(m=>m.childNodes[0].textContent.length<=1&&m.querySelector('title')?.textContent.includes('首次確認'));
  const before=$('mo-cursor').textContent;$('mo-chart').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));const cursor=$('mo-cursor').textContent!==before&&$('mo-cursor').textContent.includes('不是游標當時分布');
  $('mo-layer-cvd').click();const layerOff=!$('mo-chart').querySelector('.mo-cvd-path');$('mo-layer-cvd').click();const layerOn=!!$('mo-chart').querySelector('.mo-cvd-path');
  $('mo-event-journal').click();const copy=api.copyText().includes(sample.snapshotId)&&api.copyText().includes(sample.events.at(-1).id);
  $('mo-timeframe').value='5m';$('mo-timeframe').dispatchEvent(new Event('change'));await sleep(100);const timeframe=api.currentSnapshot()?.timeframe==='5m'&&api.currentSnapshot()?.cvd.value===sample.cvd.value;
  fail=true;await api.refresh();const cleared=api.currentSnapshot()===null&&$('mo-position').textContent==='未知'&&$('mo-copy').disabled&&$('mo-chart').children.length===0;
  fail=false;await api.refresh();const recovered=$('mo-position').textContent===sample.summary.position;
  const r=document.createElement('pre');r.id='ui-convergence-test-result';r.textContent=JSON.stringify({synthetic:true,width:innerWidth,docWidth:document.documentElement.scrollWidth,ready,compactMarkers,cursor,layerOff,layerOn,copy,timeframe,cleared,recovered,journal,selected,viewBox:$('mo-chart').getAttribute('viewBox'),errors});document.body.append(r);</script>`;
  const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{padding:12px;background:var(--bg)}body::before{display:none}</style><body>${panel}${setup}<script type="module">${script}</script>${verification}</body></html>`;
  const result = await inspectEngineeringDocument({ binary, html, width, hostedLinuxResearchTest: true });
  assert.equal(result.width, width); assert.ok(result.docWidth <= width + 1, JSON.stringify(result));
  for (const key of ['ready', 'compactMarkers', 'cursor', 'layerOff', 'layerOn', 'copy', 'timeframe', 'cleared', 'recovered']) assert.equal(result[key], true, key);
  assert.equal(result.journal, 1); assert.ok(result.selected >= 3); assert.deepEqual(result.errors, []);
});
