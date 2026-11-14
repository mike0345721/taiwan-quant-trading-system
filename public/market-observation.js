// One read-only snapshot powers the chart, summary, copy and selected-event handoff.
const NS = 'http://www.w3.org/2000/svg';
const LIMITS = Object.freeze({ bars: 400, cvd: 2000, bins: 2000, events: 200, zones: 100 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const timeMs = value => typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
const number = value => finite(value) ? value.toLocaleString('zh-TW', { maximumFractionDigits: 3 }) : '未知';
const describe = value => value == null ? '未知' : typeof value === 'string' ? value : JSON.stringify(value);
const list = value => Array.isArray(value) ? value.map(describe).join('；') || '尚無' : describe(value);
// Taiwan has no daylight saving: Taipei is always UTC+8, so a fixed offset is exact and deterministic in tests.
const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;
export function taipeiTime(value, { date = true, seconds = true } = {}) {
  const ms = timeMs(value);
  if (!Number.isFinite(ms)) return '未知';
  const iso = new Date(ms + TAIPEI_OFFSET_MS).toISOString();
  return `${date ? `${iso.slice(5, 7)}/${iso.slice(8, 10)} ` : ''}${iso.slice(11, seconds ? 19 : 16)}`;
}
const stamp = value => taipeiTime(value);

// Plain-language meaning and "do I need to act" for machine reason codes; codes stay in technical details.
const ACTION = Object.freeze({
  AUTO: '不用處理，每 5 秒自動重試',
  WATCH: '會自動重試；若超過 5 分鐘仍未恢復，請通知維護',
  HANDLE: '需要處理：不會自動恢復，請通知維護（代碼見技術細節）',
  LOGIN: '需要處理：請重新登入',
});
const SEVERITY = { AUTO: 1, WATCH: 2, LOGIN: 3, HANDLE: 4 };
const REASON_RULES = [
  [/^請先正常登入$|^HTTP_401$/, '登入已失效', 'LOGIN'],
  [/REACQUISITION|_GAP$|BACKDATED|NOT_RETAINED/, '觀測來源中斷，無法接續', 'HANDLE'],
  [/PENDING|VERIFYING|CATCHUP|PERSISTING|CAUGHT_UP/, '觀測正在補算', 'AUTO'],
  [/^STALE$/, '觀測資料已過期', 'AUTO'],
  [/^READ_TIMEOUT$|^HTTP_/, '網頁讀取觀測失敗', 'AUTO'],
  [/BUDGET/, '資料量超過單次讀取上限', 'WATCH'],
  [/COMPLETE_SESSION_NOT_PROVEN/, '本盤資料尚未完整', null],
  [/FIXTURE|SYNTHETIC/, '測試資料', null],
  [/UNAVAILABLE|MISSING/, '觀測來源暫時讀不到', 'WATCH'],
  [/HASH|INVALID|INTEGRITY|MISMATCH|CHANGED|BINDING|NONCANONICAL|SCHEMA|REQUIRED/, '觀測資料檢查未通過', 'WATCH'],
];
export function reasonText(code) {
  const value = String(code ?? '');
  for (const [pattern, text, action] of REASON_RULES) if (pattern.test(value)) return { code: value, text, action };
  return { code: value, text: '觀測暫時無法使用', action: 'WATCH' };
}
export function explainReasons(codes) {
  const items = (Array.isArray(codes) ? codes : [codes]).filter(code => code != null && code !== '').map(reasonText);
  const texts = [...new Set(items.map(item => item.text))];
  const worst = items.filter(item => item.action).sort((a, b) => SEVERITY[b.action] - SEVERITY[a.action])[0];
  return { text: texts.join('；') || '沒有異常', action: worst ? ACTION[worst.action] : '', handle: worst?.action === 'HANDLE' || worst?.action === 'LOGIN',
    codes: items.map(item => item.code) };
}
const STATUS_TEXT = { OBSERVATION_CANDIDATE: '候選觀測', USABLE: '可用', UNAVAILABLE: '不可用' };
const MODE_TEXT = { LIVE: '即時', REPLAY: '回放', FIXTURE: '測試資料', TRAINING: '訓練資料' };
const QUOTE_UNAFFECTED = '主圖報價不受影響，僅此觀測圖層暫停';

export function observationForceText(snapshot) {
  const cvd = snapshot?.cvd || {};
  if (!finite(cvd.value)) return '買賣力道未知（可分類成交不足）｜品質：僅供參考';
  const signed = `${cvd.value > 0 ? '+' : ''}${number(cvd.value)}`;
  const coverage = finite(cvd.classifiedCoverage) ? `${(cvd.classifiedCoverage * 100).toFixed(1)}%` : '未知';
  const unknown = finite(cvd.unknownVolume) ? `${number(cvd.unknownVolume)} 口無法分類` : '無法分類口數未知';
  return `買賣力道 ${signed} 口｜可分類 ${coverage}｜${unknown}｜品質：僅供參考`;
}

const CATCHUP_REASONS = new Set(['VERIFIED_SOURCE_PENDING_DERIVATION', 'VERIFIED_SOURCE_PERSISTED_PENDING_DERIVATION', 'DERIVATION_CATCHUP_PENDING',
  'DERIVED_HISTORY_VERIFYING', 'LEGACY_CACHE_MIGRATION_PENDING', 'LEGACY_CACHE_VALIDATION_PENDING', 'CHECKPOINT_PREFIX_VERIFYING']);
export function observationCatchup(snapshot, previous = null) {
  if (snapshot?.status !== 'UNAVAILABLE' || snapshot.snapshotId || !snapshot.reasonCodes?.length
      || !snapshot.reasonCodes.every(code => CATCHUP_REASONS.has(code))) return null;
  const progress = snapshot.sourceProgress || {};
  return { retryMs: 250, codes: snapshot.reasonCodes,
    technical: `WARMING_UP · ${snapshot.reasonCodes.join(' / ')} · 已處理來源序位 ${number(progress.derivedThroughOrdinal)} · 已發布序位 ${number(progress.publishedThroughOrdinal)}`,
    message: '觀測補算中，不用處理，會自動接上。'
    + (previous ? `仍顯示舊資料，截至 ${stamp(previous.cutoff)}（台北），非即時。` : '尚無可顯示的完整快照。') + QUOTE_UNAFFECTED + '。' };
}

export function normalizeObservation(snapshot, timeframe) {
  if (snapshot?.status === 'UNAVAILABLE' && !snapshot.snapshotId) throw new Error((snapshot.reasonCodes || ['OBSERVATION_UNAVAILABLE']).join(' / '));
  if (!snapshot || snapshot.schemaVersion !== 'cru61-market-observation-v1' || !snapshot.snapshotId
      || !Number.isFinite(timeMs(snapshot.cutoff)) || snapshot.timeframe !== timeframe) {
    throw new Error('SNAPSHOT_IDENTITY_OR_TIMEFRAME_INVALID');
  }
  const cutoff = timeMs(snapshot.cutoff);
  const before = value => Number.isFinite(timeMs(value)) && timeMs(value) <= cutoff;
  const bars = (snapshot.price?.bars || []).filter(b => before(b.endTime || b.time) &&
    (!b.availableAt || before(b.availableAt)) && [b.open, b.high, b.low, b.close].every(finite) &&
    b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close)).slice(-LIMITS.bars);
  const cvd = (snapshot.cvd?.series || []).filter(p => before(p.eventTime) && before(p.availableAt)).slice(-LIMITS.cvd);
  const events = (snapshot.events || []).filter(e => before(e.availableAt || e.confirmedAt)).slice(-LIMITS.events);
  const structureEvents = (snapshot.structure?.events || []).filter(e => before(e.availableAt || e.confirmedAt)).slice(-LIMITS.events);
  const zones = (snapshot.structure?.zones || []).filter(z => before(z.availableAt || z.confirmedAt) &&
    finite(z.low) && finite(z.high)).slice(-LIMITS.zones);
  const sourceBins = (snapshot.profile?.bins || []).filter(b => finite(b.price) && finite(b.volume) && b.volume >= 0);
  let bins = sourceBins;
  if (bins.length > LIMITS.bins) {
    if (bars.length) {
      const low = Math.min(...bars.map(b => b.low)), high = Math.max(...bars.map(b => b.high));
      const pad = Math.max(1, (high - low) * .06);
      bins = bins.filter(b => b.price >= low - pad && b.price <= high + pad);
    }
    bins = bins.slice(0, LIMITS.bins);
  }
  const binDisplay = sourceBins.length > LIMITS.bins ? { sourceBinCount: sourceBins.length, displayedBinCount: bins.length,
    binDisplayRule: 'VISIBLE_PRICE_RANGE_THEN_FIRST_2000; SUMMARY_USES_FULL_SOURCE_PROFILE' } : {};
  return { ...snapshot, price: { ...snapshot.price, bars }, cvd: { ...snapshot.cvd, series: cvd },
    profile: { ...snapshot.profile, bins, ...binDisplay }, structure: { ...snapshot.structure, events: structureEvents, zones }, events };
}

export function observationCopyText(snapshot, selectedEvent = null, { staleNote = '' } = {}) {
  if (!snapshot) return '';
  return ['勢衡｜SMC＋觀測 CVD＋成交量分布（研究用途）',
    ...(staleNote ? [`注意：${staleNote}`] : []),
    '共用價格與成交來源，不是三份獨立證據。分類代理不是主力／外資真實買賣；成交量分布不是持倉成本。',
    '請分開描述位置、事件期間成交、結構、反證與失效條件；吸收僅為候選假說，不產生 BUY／SELL 或勝率。',
    JSON.stringify({ snapshotId: snapshot.snapshotId, cutoff: snapshot.cutoff, timeframe: snapshot.timeframe,
      identity: snapshot.identity, mode: snapshot.mode, status: snapshot.status, summary: snapshot.summary,
      cvd: { ...snapshot.cvd, series: undefined }, profile: { ...snapshot.profile, bins: undefined },
      previousProfile: snapshot.previousProfile, structure: { ...snapshot.structure, events: undefined, zones: undefined },
      event: selectedEvent, reasonCodes: snapshot.reasonCodes, researchOnly: true, formalWeight: 0,
      executionAuthorized: false, orderRoutesEnabled: false }, null, 2)].join('\n\n');
}

export function plotObservation(snapshot, width = 960) {
  const bars = snapshot.price.bars;
  if (!bars.length) return null;
  const t0 = timeMs(bars[0].time);
  let t1 = Math.max(t0 + 1, timeMs(bars.at(-1).endTime || bars.at(-1).time));
  // CVD can advance inside a forming minute while price structure stays closed-bar only.
  // Include those already-known points without inventing a completed price bar.
  for (const point of snapshot.cvd.series) if (Number.isFinite(timeMs(point.availableAt)) && timeMs(point.availableAt) <= timeMs(snapshot.cutoff)) t1 = Math.max(t1, timeMs(point.availableAt));
  let low = Infinity, high = -Infinity;
  for (const b of bars) { low = Math.min(low, b.low); high = Math.max(high, b.high); }
  const pad = Math.max(1, (high - low) * .06); low -= pad; high += pad;
  const left = width < 600 ? 42 : 54, right = width * .735, profileLeft = width * .79, edge = width - 8;
  const x = time => left + Math.max(0, Math.min(1, (timeMs(time) - t0) / (t1 - t0))) * (right - left);
  const y = price => 42 + (high - price) / (high - low) * 226;
  const points = snapshot.cvd.series.filter(p => timeMs(p.availableAt) >= t0 && timeMs(p.availableAt) <= t1);
  let cLow = Infinity, cHigh = -Infinity;
  for (const p of points) if (finite(p.value)) { cLow = Math.min(cLow, p.value); cHigh = Math.max(cHigh, p.value); }
  if (!finite(cLow)) { cLow = -1; cHigh = 1; }
  const cPad = Math.max(1, (cHigh - cLow) * .06); cLow -= cPad; cHigh += cPad;
  const cy = value => 326 + (cHigh - value) / (cHigh - cLow) * 94;
  // Nulls create separate paths, never an interpolated bridge across unknown CVD.
  let path = '', started = false;
  for (const p of points) {
    if (!finite(p.value)) { started = false; continue; }
    path += `${started ? 'L' : 'M'}${x(p.availableAt).toFixed(2)},${cy(p.value).toFixed(2)} `; started = true;
  }
  const zones = (snapshot.structure?.zones || []).map(zone => {
    const start = timeMs(zone.availableAt || zone.confirmedAt);
    const terminal = [zone.invalidatedAt, zone.filledAt, zone.unavailableAt].map(timeMs).filter(Number.isFinite);
    const end = Math.min(timeMs(snapshot.cutoff), ...terminal);
    return { zone, start, end };
  }).filter(({ zone, start, end }) => Number.isFinite(start) && Number.isFinite(end) && end >= start &&
    start <= t1 && end >= t0 && zone.high >= low && zone.low <= high);
  return { bars, x, y, cy, path, t0, t1, low, high, cLow, cHigh, points, zones, left, right, profileLeft, edge, width };
}

function mountObservation() {
  const root = document.getElementById('market-observation-workspace');
  if (!root) return;
  const el = id => document.getElementById(id);
  const node = (tag, text, className) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; };
  const svgNode = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v)); if (text != null) e.textContent = text; return e; };
  let snapshot = null, selectedEventId = null, controller = null, requestId = 0, lastRequestAt = 0, cursorIndex = 0;
  let catchupTimer = null, minimumRefreshMs = 4500, captured = false;
  // failure: why the latest read did not produce a new snapshot. A retained snapshot is then shown as old, never as live.
  let failure = null, lastGoodCutoff = null;
  const staleNote = () => failure && snapshot ? `這是舊資料，截至 ${stamp(snapshot.cutoff)}（台北），非即時` : '';
  const setTechnical = () => { el('mo-tech-status').textContent = failure?.technical ? `最近一次讀取：${failure.technical}` : ''; };
  const selectedEvent = () => snapshot?.events.find(e => e.id === selectedEventId) || null;
  const timeframe = () => el('mo-timeframe').value;
  const visible = () => root.open && !document.hidden && root.getClientRects().length > 0;
  const enabled = name => el(`mo-layer-${name}`).checked;
  const plotNow = () => snapshot && plotObservation(snapshot, Math.max(320, Math.min(960, el('mo-chart').getBoundingClientRect().width || 960)));
  function handoff() {
    window.dispatchEvent(new CustomEvent('market-observation-selected', { detail: { snapshot, event: selectedEvent(), stale: Boolean(failure && snapshot) } }));
  }
  function showEvent() {
    const event = selectedEvent(), target = el('mo-event-detail'); target.replaceChildren();
    if (!event) { target.append(node('p', '尚無已確認事件。未確認圖形不列入事件序列。')); return; }
    target.append(node('h4', event.title || event.eventType || event.type || event.id));
    const pairs = [['圖形錨點', stamp(event.anchorTime)], ['首次確認', stamp(event.availableAt || event.confirmedAt)],
      ['名義收盤時間', stamp(event.nominalCloseTime || event.confirmedTime)],
      ['位置', describe(event.location)], ['結構狀態', describe(event.structureState)],
      ['事件 ΔCVD', describe(event.deltaCvd)], ['價格反應', describe(event.priceResponse)],
      ['接近位置前', describe(event.windows?.approach)], ['測試期間', describe(event.windows?.test)], ['確認之後', describe(event.windows?.after)],
      ['支持證據', list(event.supportingEvidence)], ['反證／其他解釋', list(event.contraryEvidence)],
      ['確認條件', list(event.confirmationConditions)], ['失效條件', list(event.invalidationConditions)],
      ['資料品質', describe(event.quality)], ['來源時間', describe(event.sourceTimes)]];
    const dl = node('dl'); for (const [name, value] of pairs) dl.append(node('dt', name), node('dd', value)); target.append(dl);
  }
  function draw() {
    const svg = el('mo-chart'); svg.replaceChildren();
    root.classList.toggle('mo-is-stale', Boolean(failure && snapshot));
    if (!snapshot) {
      // Never leave a silent black box: say why, when it last worked and whether it retries by itself.
      svg.setAttribute('viewBox', '0 0 960 470');
      const lines = failure ? [`觀測圖暫停：${failure.text}`, `上次成功：${lastGoodCutoff ? `${stamp(lastGoodCutoff)}（台北）` : '本次開啟尚未成功'}`, failure.action, QUOTE_UNAFFECTED]
        : ['等待觀測資料…', '展開面板後每 5 秒自動讀取'];
      lines.forEach((line, i) => svg.append(svgNode('text', { x: 480, y: 180 + i * 30, 'text-anchor': 'middle', class: i ? 'mo-empty' : 'mo-empty-title' }, line)));
      el('mo-cursor').textContent = failure ? `觀測圖暫停：${failure.text}。` : '等待同一快照的價格與觀測資料。';
      return;
    }
    const plot = plotNow();
    if (!plot) { svg.append(svgNode('text', { x: 32, y: 80, class: 'mo-axis' }, '價格資料不足；其他模組狀態請見摘要。')); return; }
    svg.setAttribute('viewBox', `0 0 ${plot.width} 470`);
    svg.append(svgNode('text', { x: plot.left, y: 22, class: 'mo-axis' }, '價格＋已確認 SMC'),
      svgNode('text', { x: plot.left, y: 310, class: 'mo-axis' }, 'CVD · 可知時間／分類代理'),
      svgNode('text', { x: plot.profileLeft, y: 22, class: 'mo-axis' }, '成交分布'));
    for (let i = 0; i <= 4; i++) {
      const value = plot.low + (plot.high - plot.low) * i / 4, y = plot.y(value);
      svg.append(svgNode('line', { x1: plot.left, x2: plot.edge, y1: y, y2: y, class: 'mo-grid' }),
        svgNode('text', { x: plot.left - 5, y: y + 4, 'text-anchor': 'end', class: 'mo-axis' }, number(Math.round(value))));
    }
    if (enabled('smc')) {
      for (const { zone: z, start: knownStart, end: knownEnd } of plot.zones) {
        const start = plot.x(knownStart), end = plot.x(knownEnd);
        const rect = svgNode('rect', { x: start, y: plot.y(Math.min(plot.high, z.high)), width: end - start,
          height: Math.max(1, plot.y(Math.max(plot.low, z.low)) - plot.y(Math.min(plot.high, z.high))), class: 'mo-zone' });
        rect.append(svgNode('title', {}, `${z.kind || z.type} 候選區域；錨點 ${stamp(z.anchorTime)}；首次確認 ${stamp(z.availableAt || z.confirmedAt)}；狀態 ${z.status || '未知'}；失效 ${stamp(z.invalidatedAt)}／填滿 ${stamp(z.filledAt)}／不可用 ${stamp(z.unavailableAt)}`)); svg.append(rect);
      }
    }
    const width = Math.max(1, Math.min(9, (plot.right - plot.left) * .8 / plot.bars.length));
    for (const b of plot.bars) {
      const x = plot.x(b.time), cls = b.close >= b.open ? 'mo-candle-up' : 'mo-candle-down';
      svg.append(svgNode('line', { x1: x, x2: x, y1: plot.y(b.high), y2: plot.y(b.low), class: cls }),
        svgNode('rect', { x: x - width / 2, y: plot.y(Math.max(b.open, b.close)), width,
          height: Math.max(1, Math.abs(plot.y(b.open) - plot.y(b.close))), class: cls }));
    }
    if (enabled('smc')) for (const e of snapshot.structure.events) {
      const known = e.availableAt || e.confirmedAt;
      if (timeMs(known) < plot.t0 || !finite(e.price)) continue;
      const kind = e.eventType || e.type || e.kind;
      const symbol = { SWING_HIGH: '△', SWING_LOW: '▽', BOS: 'B', CHOCH: 'C', CHoCH: 'C', SWEEP_HIGH: '↶', SWEEP_LOW: '↷' }[kind] || '·';
      const marker = svgNode('text', { x: plot.x(known), y: plot.y(e.price) - 7, class: 'mo-marker', 'text-anchor': 'middle' }, symbol);
      marker.append(svgNode('title', {}, `${kind}；錨點 ${stamp(e.anchorTime)}；首次確認 ${stamp(known)}`)); svg.append(marker);
    }
    if (enabled('cvd')) {
      svg.append(svgNode('path', { d: plot.path, class: 'mo-cvd-path' }),
        svgNode('text', { x: plot.left - 5, y: 334, 'text-anchor': 'end', class: 'mo-axis' }, number(Math.round(plot.cHigh))),
        svgNode('text', { x: plot.left - 5, y: 420, 'text-anchor': 'end', class: 'mo-axis' }, number(Math.round(plot.cLow))));
      if (!plot.points.some(p => finite(p.value))) svg.append(svgNode('text', { x: plot.left + 8, y: 370, class: 'mo-axis' }, 'CVD 未知 · 不補零'));
    }
    if (enabled('profile')) {
      const bins = snapshot.profile.bins, maximum = Math.max(1, ...bins.map(b => b.volume));
      for (const b of bins) {
        if (b.price < plot.low || b.price > plot.high) continue;
        const h = Math.max(1, Math.min(14, 226 / Math.max(1, bins.length)));
        const rect = svgNode('rect', { x: plot.profileLeft, y: plot.y(b.price) - h / 2, width: b.volume / maximum * (plot.edge - plot.profileLeft), height: h,
          class: b.price === snapshot.profile.poc ? 'mo-profile-poc' : 'mo-profile-bin' });
        rect.append(svgNode('title', {}, `${number(b.price)}：${number(b.volume)} 口`)); svg.append(rect);
      }
      for (const [key, label] of [['poc', 'POC'], ['vah', 'VAH'], ['val', 'VAL']]) {
        const price = snapshot.profile[key]; if (!finite(price) || price < plot.low || price > plot.high) continue;
        svg.append(svgNode('line', { x1: plot.left, x2: plot.edge, y1: plot.y(price), y2: plot.y(price), class: 'mo-profile-level' }),
          svgNode('text', { x: plot.edge, y: plot.y(price) - 4, 'text-anchor': 'end', class: 'mo-axis' }, `${label} ${number(price)}`));
      }
    }
    if (failure) svg.append(svgNode('text', { x: plot.right, y: 22, 'text-anchor': 'end', class: 'mo-stale-badge' }, `舊資料 · 截至 ${taipeiTime(snapshot.cutoff, { date: false })} · 非即時`));
    svg.append(svgNode('text', { x: plot.left, y: 450, class: 'mo-axis' }, taipeiTime(plot.t0, { date: false, seconds: false }) + ' 台北'),
      svgNode('text', { x: plot.right, y: 450, class: 'mo-axis', 'text-anchor': 'end' }, taipeiTime(plot.t1, { date: false, seconds: false }) + ' 台北'),
      svgNode('line', { id: 'mo-crosshair', x1: plot.left, x2: plot.left, y1: 36, y2: 426, class: 'mo-crosshair' }));
    moveCursor(Math.min(cursorIndex, plot.bars.length - 1));
  }
  function moveCursor(index) {
    if (!snapshot) return;
    const plot = plotNow(); if (!plot) return;
    cursorIndex = Math.max(0, Math.min(plot.bars.length - 1, index));
    const bar = plot.bars[cursorIndex], t = timeMs(bar.endTime || bar.time);
    const point = plot.points.filter(p => timeMs(p.availableAt) <= t && timeMs(p.eventTime) <= t).at(-1);
    const line = el('mo-crosshair'); if (line) { line.setAttribute('x1', plot.x(bar.time)); line.setAttribute('x2', plot.x(bar.time)); }
    el('mo-cursor').textContent = `${stamp(bar.time)} · O ${number(bar.open)} H ${number(bar.high)} L ${number(bar.low)} C ${number(bar.close)} · CVD ${number(point?.value)} · 成交時間 ${stamp(point?.eventTime)}／首次可知 ${stamp(point?.availableAt)}。右側分布截至 ${stamp(snapshot.cutoff)}，不是游標當時分布。`;
  }
  function render() {
    el('mo-copy').disabled = !snapshot;
    el('mo-event-journal').disabled = !snapshot || !selectedEvent();
    if (!snapshot) {
      for (const key of ['position', 'force', 'structure', 'counterEvidence', 'dataStatus']) el('mo-' + key).textContent = '未知';
      if (failure) el('mo-dataStatus').textContent = `${failure.text}｜${failure.action}`;
      el('mo-lineage').textContent = '沒有可驗證的同一快照。'; el('mo-profile-note').textContent = '成交量分布不可用。';
      setTechnical(); el('mo-events').replaceChildren(); showEvent(); draw(); return;
    }
    const s = snapshot, identity = s.identity || {};
    for (const key of ['position', 'structure', 'counterEvidence']) el('mo-' + key).textContent = list(s.summary?.[key]);
    el('mo-force').textContent = observationForceText(s);
    el('mo-dataStatus').textContent = failure ? `舊資料，非即時｜${failure.text}｜${failure.action}` : explainReasons(s.reasonCodes).text;
    el('mo-lineage').textContent = `${identity.actualContract || '合約未知'} · ${identity.tradeDate || '交易日未知'} · ${identity.session || '盤別未知'} · 連續段 ${identity.continuityEpoch ?? '未知'} · ${s.mode || '模式未知'} · 截至 ${stamp(s.cutoff)}（台北） · snapshot ${s.snapshotId} · ${list(s.reasonCodes)} · CVD 分段原因 ${s.cvd.resetReason || '未知'} · 上一完整盤 ${s.previousProfile?.state || s.previousProfile?.status || 'UNAVAILABLE'} ${s.previousProfile?.reason || ''}`;
    setTechnical();
    const previous = s.previousProfile || {}, previousReady = finite(previous.poc) && !previous.reason;
    el('mo-profile-note').textContent = `本盤觀測：${stamp(s.profile.observedStart)} ～ ${stamp(s.profile.observedEnd || s.cutoff)}；價格粒度 ${number(s.profile.binSize)}；價值區比例 ${finite(s.profile.valueAreaFraction) ? number(s.profile.valueAreaFraction * 100) + '%' : '未知'}；${s.profile.partial === false ? '完整性依來源證據' : '片段／完整性未證明'}。POC ${number(s.profile.poc)}／VAH ${number(s.profile.vah)}（上界不含）／VAL ${number(s.profile.val)}。HVN ${list(s.profile.hvn)}；LVN ${list(s.profile.lvn)}。${s.profile.sourceBinCount ? `圖層僅呈現目前價格範圍前 ${number(s.profile.displayedBinCount)} 個價位（來源共 ${number(s.profile.sourceBinCount)}，上限 2,000）；摘要保留完整來源分布。` : ''}上一完整盤：${previousReady ? `POC ${number(previous.poc)}／VA ${number(previous.val)}–${number(previous.vah)}` : `暫無（${explainReasons(previous.reason || previous.state || previous.status || 'UNAVAILABLE').text}）`}。CVD 起點 ${stamp(s.cvd.observedStart)}，分類覆蓋 ${finite(s.cvd.classifiedCoverage) ? number(s.cvd.classifiedCoverage * 100) + '%' : '未知'}，無法分類 ${number(s.cvd.unknownVolume)} 口；換週期不重置累積。時間皆為台北時間。`;
    const selector = el('mo-events'); selector.replaceChildren(node('option', '選擇已確認事件'));
    selector.firstChild.value = '';
    for (const e of [...s.events].reverse()) { const option = node('option', `${stamp(e.availableAt || e.confirmedAt)} · ${e.title || e.eventType || e.type || e.id}`); option.value = e.id; selector.append(option); }
    selector.value = selectedEventId || ''; showEvent(); draw();
  }
  async function refresh(force = false) {
    if (captured && !force) return;
    if (force) captured = false;
    if (!force && (!visible() || controller || Date.now() - lastRequestAt < minimumRefreshMs)) return;
    clearTimeout(catchupTimer); catchupTimer = null; minimumRefreshMs = 4500;
    if (controller) controller.abort();
    const current = ++requestId, selected = timeframe(), pending = new AbortController(); controller = pending;
    const timeout = setTimeout(() => pending.abort(), 8000); lastRequestAt = Date.now(); let catchup = null;
    el('mo-status').textContent = `讀取 ${selected} 同一快照…`; root.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/v1/market-observation?timeframe=' + encodeURIComponent(selected), { credentials: 'same-origin', cache: 'no-store', signal: pending.signal });
      if (!response.ok) throw new Error(response.status === 401 ? '請先正常登入' : `HTTP_${response.status}`);
      const payload = await response.json(); if (current !== requestId) return;
      catchup = observationCatchup(payload.data, snapshot);
      if (catchup) {
        failure = { ...explainReasons(catchup.codes), technical: catchup.technical };
        el('mo-status').textContent = catchup.message; render(); return;
      }
      snapshot = normalizeObservation(payload.data, selected); failure = null; lastGoodCutoff = snapshot.cutoff;
      if (!snapshot.events.some(e => e.id === selectedEventId)) selectedEventId = snapshot.events.at(-1)?.id || null;
      const expired = snapshot.reasonCodes?.includes('STALE');
      el('mo-status').textContent = `${expired ? '已過期觀測，非即時' : STATUS_TEXT[snapshot.status] || '候選觀測'} · ${MODE_TEXT[snapshot.mode] || '模式未知'} · ${snapshot.timeframe} · 截至 ${stamp(snapshot.cutoff)}（台北）${expired ? ` · ${QUOTE_UNAFFECTED}` : ''} · 非交易建議`;
      render(); handoff();
    } catch (error) {
      if (current !== requestId) return;
      // Keep the last good picture of the same timeframe, clearly marked old, instead of blanking the panel.
      const codes = error.name === 'AbortError' ? ['READ_TIMEOUT'] : String(error.message || 'OBSERVATION_UNAVAILABLE').split(' / ');
      failure = { ...explainReasons(codes), technical: codes.join(' / ') };
      el('mo-status').textContent = snapshot
        ? `舊資料，截至 ${stamp(snapshot.cutoff)}（台北），非即時 · ${failure.text} · ${failure.action} · ${QUOTE_UNAFFECTED}`
        : `觀測暫停 · ${failure.text} · ${failure.action} · ${QUOTE_UNAFFECTED}`;
      render(); handoff();
    } finally {
      clearTimeout(timeout); if (current === requestId) {
        controller = null; root.setAttribute('aria-busy', 'false');
        if (catchup) {
          minimumRefreshMs = catchup.retryMs;
          catchupTimer = setTimeout(() => { catchupTimer = null; refresh(); }, catchup.retryMs);
        }
      }
    }
  }
  el('mo-timeframe').addEventListener('change', () => { snapshot = null; selectedEventId = null; cursorIndex = 0; failure = null; lastGoodCutoff = null; render(); handoff(); refresh(true); });
  el('mo-refresh').addEventListener('click', () => refresh(true));
  for (const layer of ['smc', 'cvd', 'profile']) el('mo-layer-' + layer).addEventListener('change', draw);
  el('mo-events').addEventListener('change', event => { selectedEventId = event.target.value || null; showEvent(); el('mo-event-journal').disabled = !selectedEvent(); handoff(); });
  el('mo-chart').addEventListener('pointermove', event => {
    if (!snapshot) return; const plot = plotNow(); if (!plot) return;
    const rect = event.currentTarget.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * plot.width;
    const time = plot.t0 + Math.max(0, Math.min(1, (x - plot.left) / (plot.right - plot.left))) * (plot.t1 - plot.t0);
    let nearest = 0; for (let i = 1; i < plot.bars.length; i++) if (Math.abs(timeMs(plot.bars[i].time) - time) < Math.abs(timeMs(plot.bars[nearest].time) - time)) nearest = i;
    moveCursor(nearest);
  });
  el('mo-chart').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); moveCursor(event.key === 'Home' ? 0 : event.key === 'End' ? LIMITS.bars : cursorIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  el('mo-copy').addEventListener('click', async () => {
    const text = observationCopyText(snapshot, selectedEvent(), { staleNote: staleNote() }); if (!text) return;
    try { await navigator.clipboard.writeText(text); el('mo-feedback').textContent = '已複製同一快照與選取事件；未呼叫 AI。'; }
    catch { el('mo-copy-fallback').value = text; el('mo-copy-fallback').hidden = false; el('mo-copy-fallback').focus(); el('mo-copy-fallback').select(); el('mo-feedback').textContent = '剪貼簿不可用，請複製下方已選取文字。'; }
  });
  el('mo-event-journal').addEventListener('click', () => {
    if (!snapshot || !selectedEvent()) return;
    window.dispatchEvent(new CustomEvent('market-observation-journal', { detail: { snapshot, event: selectedEvent() } }));
    el('mo-feedback').textContent = '事件已交給手動日誌，請核對快照與欄位後儲存；不會自動建立交易。';
  });
  root.addEventListener('toggle', () => { if (visible()) refresh(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (visible()) draw(); }).observe(el('mo-chart'));
  setInterval(() => refresh(), 5000);
  window.MarketObservationWorkspace = Object.freeze({ currentSnapshot: () => snapshot,
    reset: () => {
      clearTimeout(catchupTimer); catchupTimer = null;
      controller?.abort(); controller = null; requestId += 1; captured = false;
      snapshot = null; selectedEventId = null; failure = null; lastGoodCutoff = null; root.setAttribute('aria-busy', 'false');
      el('mo-status').textContent = '登入後重新讀取觀測快照。'; render(); handoff();
    },
    capture: value => {
      clearTimeout(catchupTimer); catchupTimer = null;
      controller?.abort(); controller = null; requestId += 1; captured = true;
      root.setAttribute('aria-busy', 'false'); failure = null;
      if (value?.snapshotId) {
        snapshot = normalizeObservation(value, value.timeframe); el('mo-timeframe').value = value.timeframe; lastGoodCutoff = snapshot.cutoff;
        selectedEventId = snapshot.events.at(-1)?.id || null;
        el('mo-status').textContent = `已鎖定快照 · 截至 ${stamp(snapshot.cutoff)}（台北） · ${explainReasons(snapshot.reasonCodes).text} · 成交來源截至 ${stamp(snapshot.profile.observedEnd)} · 主行情繼續更新；按「更新觀測」重新追蹤。`;
      } else {
        snapshot = null; selectedEventId = null;
        failure = { ...explainReasons(value?.reasonCodes || ['OBSERVATION_UNAVAILABLE']), technical: list(value?.reasonCodes) };
        el('mo-status').textContent = `本次擷取觀測尚未就緒 · ${failure.text}；按「更新觀測」接續。`;
      }
      render(); handoff();
    },
    selectedEvent, copyText: () => observationCopyText(snapshot, selectedEvent(), { staleNote: staleNote() }), refresh: () => refresh(true) });
  if (visible()) refresh();
}
if (typeof document !== 'undefined') mountObservation();
