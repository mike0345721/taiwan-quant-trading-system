// One read-only snapshot powers the chart, summary, copy and selected-event handoff.
const NS = 'http://www.w3.org/2000/svg';
const LIMITS = Object.freeze({ bars: 400, cvd: 2000, bins: 2000, events: 200, zones: 100 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const timeMs = value => typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
const number = value => finite(value) ? value.toLocaleString('zh-TW', { maximumFractionDigits: 3 }) : '未知';
const describe = value => value == null ? '未知' : typeof value === 'string' ? value : JSON.stringify(value);
const list = value => Array.isArray(value) ? value.map(describe).join('；') || '尚無' : describe(value);
const stamp = value => Number.isFinite(timeMs(value)) ? new Date(timeMs(value)).toISOString() : '未知';

const CATCHUP_REASONS = new Set(['VERIFIED_SOURCE_PENDING_DERIVATION', 'VERIFIED_SOURCE_PERSISTED_PENDING_DERIVATION', 'DERIVATION_CATCHUP_PENDING',
  'DERIVED_HISTORY_VERIFYING', 'LEGACY_CACHE_MIGRATION_PENDING', 'LEGACY_CACHE_VALIDATION_PENDING', 'CHECKPOINT_PREFIX_VERIFYING']);
export function observationCatchup(snapshot, previous = null) {
  if (snapshot?.status !== 'UNAVAILABLE' || snapshot.snapshotId || !snapshot.reasonCodes?.length
      || !snapshot.reasonCodes.every(code => CATCHUP_REASONS.has(code))) return null;
  const progress = snapshot.sourceProgress || {};
  return { retryMs: 250, message: `WARMING_UP · ${snapshot.reasonCodes.join(' / ')} · 已處理來源序位 ${number(progress.derivedThroughOrdinal)} · 已發布序位 ${number(progress.publishedThroughOrdinal)}。`
    + (previous ? `仍顯示已驗證快照，截至 ${stamp(previous.cutoff)}；尚未發布新快照。` : '尚無可顯示的完整快照。') };
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

export function observationCopyText(snapshot, selectedEvent = null) {
  if (!snapshot) return '';
  return ['勢衡｜SMC＋觀測 CVD＋成交量分布（研究用途）',
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
  let catchupTimer = null, minimumRefreshMs = 4500;
  const selectedEvent = () => snapshot?.events.find(e => e.id === selectedEventId) || null;
  const timeframe = () => el('mo-timeframe').value;
  const visible = () => root.open && !document.hidden && root.getClientRects().length > 0;
  const enabled = name => el(`mo-layer-${name}`).checked;
  const plotNow = () => snapshot && plotObservation(snapshot, Math.max(320, Math.min(960, el('mo-chart').getBoundingClientRect().width || 960)));
  function handoff() {
    window.dispatchEvent(new CustomEvent('market-observation-selected', { detail: { snapshot, event: selectedEvent() } }));
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
    if (!snapshot) { el('mo-cursor').textContent = '等待同一快照的價格與觀測資料。'; return; }
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
    svg.append(svgNode('text', { x: plot.left, y: 450, class: 'mo-axis' }, stamp(plot.t0).slice(11, 19) + ' UTC'),
      svgNode('text', { x: plot.right, y: 450, class: 'mo-axis', 'text-anchor': 'end' }, stamp(plot.t1).slice(11, 19) + ' UTC'),
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
      el('mo-lineage').textContent = '沒有可驗證的同一快照。'; el('mo-profile-note').textContent = '成交量分布不可用。';
      el('mo-events').replaceChildren(); showEvent(); draw(); return;
    }
    const s = snapshot, identity = s.identity || {};
    for (const key of ['position', 'force', 'structure', 'counterEvidence', 'dataStatus']) el('mo-' + key).textContent = list(s.summary?.[key]);
    el('mo-lineage').textContent = `${identity.actualContract || '合約未知'} · ${identity.tradeDate || '交易日未知'} · ${identity.session || '盤別未知'} · 連續段 ${identity.continuityEpoch ?? '未知'} · ${s.mode || '模式未知'} · 截至 ${stamp(s.cutoff)} · snapshot ${s.snapshotId} · ${list(s.reasonCodes)}`;
    el('mo-profile-note').textContent = `本盤觀測：${stamp(s.profile.observedStart)} ～ ${stamp(s.profile.observedEnd || s.cutoff)}；價格粒度 ${number(s.profile.binSize)}；價值區比例 ${finite(s.profile.valueAreaFraction) ? number(s.profile.valueAreaFraction * 100) + '%' : '未知'}；${s.profile.partial === false ? '完整性依來源證據' : '片段／完整性未證明'}。POC ${number(s.profile.poc)}／VAH ${number(s.profile.vah)}（上界不含）／VAL ${number(s.profile.val)}。HVN ${list(s.profile.hvn)}；LVN ${list(s.profile.lvn)}。${s.profile.sourceBinCount ? `圖層僅呈現目前價格範圍前 ${number(s.profile.displayedBinCount)} 個價位（來源共 ${number(s.profile.sourceBinCount)}，上限 2,000）；摘要保留完整來源分布。` : ''}上一完整盤：${s.previousProfile?.state || s.previousProfile?.status || 'UNAVAILABLE'} · ${s.previousProfile?.reason || `POC ${number(s.previousProfile?.poc)}／VA ${number(s.previousProfile?.val)}–${number(s.previousProfile?.vah)}`}。CVD 起點 ${stamp(s.cvd.observedStart)}，分段原因 ${s.cvd.resetReason || '未知'}，分類覆蓋 ${finite(s.cvd.classifiedCoverage) ? number(s.cvd.classifiedCoverage * 100) + '%' : '未知'}，UNKNOWN ${number(s.cvd.unknownVolume)}；換週期不重置累積。`;
    const selector = el('mo-events'); selector.replaceChildren(node('option', '選擇已確認事件'));
    selector.firstChild.value = '';
    for (const e of [...s.events].reverse()) { const option = node('option', `${stamp(e.availableAt || e.confirmedAt)} · ${e.title || e.eventType || e.type || e.id}`); option.value = e.id; selector.append(option); }
    selector.value = selectedEventId || ''; showEvent(); draw();
  }
  async function refresh(force = false) {
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
      if (catchup) { el('mo-status').textContent = catchup.message; return; }
      snapshot = normalizeObservation(payload.data, selected);
      if (!snapshot.events.some(e => e.id === selectedEventId)) selectedEventId = snapshot.events.at(-1)?.id || null;
      el('mo-status').textContent = `${snapshot.reasonCodes?.includes('STALE') ? 'STALE · 已過期觀測，非即時' : snapshot.status || '候選觀測'} · ${snapshot.mode || '模式未知'} · ${snapshot.timeframe} · 非交易建議`;
      render(); handoff();
    } catch (error) {
      if (current !== requestId) return;
      snapshot = null; selectedEventId = null;
      el('mo-status').textContent = '觀測不可用 · ' + (error.name === 'AbortError' ? '讀取逾時' : error.message); render(); handoff();
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
  el('mo-timeframe').addEventListener('change', () => { snapshot = null; selectedEventId = null; cursorIndex = 0; render(); handoff(); refresh(true); });
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
    const text = observationCopyText(snapshot, selectedEvent()); if (!text) return;
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
    selectedEvent, copyText: () => observationCopyText(snapshot, selectedEvent()), refresh: () => refresh(true) });
  if (visible()) refresh();
}
if (typeof document !== 'undefined') mountObservation();
