'use strict';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D'];
const $ = (id) => document.getElementById(id);
let chart;
let candleSeries;
let volumeSeries;
let vwapSeries;
let workspace;
let activeChart;
let activeTimeframe = '5m';
let paletteName = 'red-up';
let previewMode = 'governed';

function finite(value) {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function format(value, digits = 0) {
  const number = finite(value);
  return number == null ? 'UNAVAILABLE' : number.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function setText(id, value, fallback = 'UNAVAILABLE') {
  const node = $(id);
  if (node) node.textContent = value == null || value === '' ? fallback : String(value);
}

function setTrack(id, state, level = null) {
  const row = $(id);
  if (!row) return;
  const status = row.querySelector('header strong');
  if (status) status.textContent = state;
  if (level == null) delete row.dataset.level;
  else row.dataset.level = String(level);
}

function setTrust(cardKey, value) {
  const node = $(`tt-${cardKey}-trust`);
  if (!node) return;
  node.textContent = value;
  const normalized = String(value || 'UNAVAILABLE').toUpperCase();
  const tone = normalized === 'LIVE' || normalized === 'READY'
    ? 'is-ready'
    : normalized.includes('SIMULATED') || normalized.includes('DELAYED') || normalized.includes('STALE')
      ? 'is-warning'
      : 'is-unavailable';
  node.className = `dw-status-pill ${tone}`;
}

function setLeadershipTrust(value, tone = 'is-unavailable') {
  const node = document.querySelector('.dw-leadership > header .dw-status-pill');
  if (!node) return;
  node.textContent = value;
  node.className = `dw-status-pill ${tone}`;
}

function setSeries(id, values, tone = 'positive') {
  const node = $(id);
  if (!node) return;
  const finiteValues = Array.isArray(values) ? values.map(finite).filter((value) => value != null) : [];
  node.classList.toggle('is-unavailable', finiteValues.length < 2);
  node.classList.toggle('is-negative', tone === 'negative');
  node.classList.toggle('is-warning', tone === 'warning');
  const lineNode = node.querySelector('polyline');
  const areaNode = node.querySelector('polygon');
  if (!lineNode || !areaNode || finiteValues.length < 2) {
    lineNode?.removeAttribute('points');
    areaNode?.removeAttribute('points');
    return;
  }
  const low = Math.min(...finiteValues);
  const high = Math.max(...finiteValues);
  const spread = high - low || 1;
  const points = finiteValues.map((value, index) => {
    const x = (index / (finiteValues.length - 1)) * 100;
    const y = 29 - ((value - low) / spread) * 23;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  lineNode.setAttribute('points', points);
  areaNode.setAttribute('points', `0,34 ${points} 100,34`);
}

function setRiskMetric(id, value, level = null, tone = 'warning') {
  setText(id, value, '—');
  const metric = $(id)?.closest('.tt-risk-metric');
  if (!metric) return;
  const normalized = finite(level);
  if (normalized == null) {
    delete metric.dataset.level;
    metric.style.removeProperty('--risk-level');
  } else {
    const bounded = Math.max(0, Math.min(100, normalized));
    metric.dataset.level = String(bounded);
    metric.style.setProperty('--risk-level', `${bounded}%`);
  }
  metric.dataset.tone = tone;
}

async function publicGet(url) {
  const response = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(`PREVIEW_REQUEST_FAILED:${response.status}`);
  return response.json();
}

function activePalette() {
  return window.TraderTerminalShell?.PALETTES?.[paletteName]
    || { up: '#ff6b6b', down: '#37d67a', upVolume: 'rgba(255,107,107,.34)', downVolume: 'rgba(55,214,122,.34)' };
}

function line(series, level, title, color, style = 2) {
  const value = level?.availability === 'AVAILABLE' ? finite(level.value) : null;
  if (value == null) return;
  series.createPriceLine({ price: value, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
}

function chartEpoch(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function ensureChart() {
  if (chart) chart.remove();
  const host = $('dw-chart-canvas');
  const palette = activePalette();
  chart = LightweightCharts.createChart(host, {
    layout: { background: { color: '#090f18' }, textColor: '#8290a4', attributionLogo: true },
    grid: { vertLines: { color: 'rgba(138,167,255,.055)' }, horzLines: { color: 'rgba(138,167,255,.055)' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(138,167,255,.16)', scaleMargins: { top: .08, bottom: .25 } },
    timeScale: { borderColor: 'rgba(138,167,255,.16)', timeVisible: true, secondsVisible: false },
    width: host.clientWidth,
    height: host.clientHeight,
  });
  candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: palette.up,
    downColor: palette.down,
    wickUpColor: palette.up,
    wickDownColor: palette.down,
    borderVisible: false,
  });
  volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: .78, bottom: 0 } });
  vwapSeries = chart.addSeries(LightweightCharts.LineSeries, { color: '#f5c86b', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
  chart.subscribeCrosshairMove((parameter) => {
    const bar = parameter.seriesData?.get(candleSeries);
    if (!bar || parameter.time == null) {
      setText('dw-chart-crosshair', '移到 K 棒查看 Time / OHLC / Volume / VWAP / 距離');
      return;
    }
    const volumePoint = parameter.seriesData?.get(volumeSeries);
    const vwapPoint = parameter.seriesData?.get(vwapSeries);
    const close = finite(bar.close);
    const vwap = finite(vwapPoint?.value);
    const distance = close == null || vwap == null ? 'UNAVAILABLE' : `${close - vwap >= 0 ? '+' : ''}${format(close - vwap, 2)}`;
    setText('dw-chart-crosshair', `${new Date(Number(parameter.time) * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} · O ${format(bar.open)} H ${format(bar.high)} L ${format(bar.low)} C ${format(bar.close)} · V ${format(volumePoint?.value)} · VWAP ${format(vwap, 2)} · 距離 ${distance}`);
  });
  new ResizeObserver(() => chart?.applyOptions({ width: host.clientWidth, height: host.clientHeight })).observe(host);
}

function available(level) {
  return level?.availability === 'AVAILABLE' ? finite(level.value) : null;
}

function renderLevels(data) {
  const levels = data.levels || {};
  const previous = [available(levels.previousDayHigh), available(levels.previousDayLow), available(levels.previousClose)];
  setText('dw-prior-levels', previous.every((value) => value != null) ? previous.map((value) => format(value)).join(' / ') : 'UNAVAILABLE');
  const high = available(levels.currentDayHigh) ?? available(levels.nightHigh);
  const low = available(levels.currentDayLow) ?? available(levels.nightLow);
  setText('dw-session-levels', high != null && low != null ? `${format(high)} / ${format(low)}` : 'UNAVAILABLE');
  setText('dw-or-state', data.openingRange?.status || 'UNAVAILABLE');
  setText('dw-vwap-state', available(levels.vwap) == null ? 'UNAVAILABLE' : format(levels.vwap.value, 2));
  setText('dw-chart-quality', data.qualityStatus || 'UNAVAILABLE');
}

function renderChart(data) {
  activeChart = data;
  ensureChart();
  const palette = activePalette();
  const bars = (data.bars || []).map(({ time, open, high, low, close }) => ({
    time: chartEpoch(time), open: finite(open), high: finite(high), low: finite(low), close: finite(close),
  })).filter((bar) => bar.time != null && [bar.open, bar.high, bar.low, bar.close].every((value) => value != null));
  candleSeries.setData(bars);
  volumeSeries.setData((data.bars || []).map((bar) => {
    const open = finite(bar.open);
    const close = finite(bar.close);
    return {
      time: chartEpoch(bar.time),
      value: finite(bar.volume),
      color: open == null || close == null ? 'rgba(131,145,167,.28)' : close >= open ? palette.upVolume : palette.downVolume,
    };
  }).filter((bar) => bar.time != null && bar.value != null));
  vwapSeries.setData((data.vwap || []).map(({ time, value }) => ({ time: chartEpoch(time), value: finite(value) })).filter((point) => point.time != null && point.value != null));
  if ($('decision-workspace')?.classList.contains('show-optional-levels')) {
    line(candleSeries, data.levels?.openingRangeHigh, 'OR H', '#8aa7ff');
    line(candleSeries, data.levels?.openingRangeLow, 'OR L', '#8aa7ff');
    line(candleSeries, data.levels?.previousDayHigh, 'Previous H', '#77869c', 3);
    line(candleSeries, data.levels?.previousDayLow, 'Previous L', '#77869c', 3);
    line(candleSeries, data.levels?.previousClose, 'Previous C', '#a1aec0', 3);
  }
  line(candleSeries, data.levels?.currentDayHigh, 'DAY H', '#77869c', 3);
  line(candleSeries, data.levels?.currentDayLow, 'DAY L', '#77869c', 3);
  chart.timeScale().fitContent();

  const isFixture = previewMode === 'fixture';
  const chartTitle = $('tt-chart-title');
  if (chartTitle) {
    chartTitle.replaceChildren(document.createTextNode(`台指期貨 ${data.actualContract || 'TX'} · ${data.timeframe || '—'}K`));
    const subtitle = document.createElement('small');
    subtitle.className = 'tt-chart-title-subtitle';
    subtitle.textContent = 'Price Structure';
    chartTitle.append(subtitle);
  }
  setText('dw-chart-contract', `${data.actualContract || 'TX'} · ${data.timeframe || 'UNAVAILABLE'}`);
  setText('dw-chart-mode', isFixture
    ? `SIMULATED_UI_FIXTURE · ${data.timeframe} · VISUAL ONLY`
    : `FROZEN_SNAPSHOT · ${data.tradeDate || 'UNAVAILABLE'} · ${data.session || 'UNAVAILABLE'} · READ ONLY`);
  setText('dw-pulse-price', format(data.lastPrice));
  const vwap = available(data.levels?.vwap);
  setText('dw-pulse-vwap', vwap == null ? 'UNAVAILABLE' : format(vwap, 2));
  const lastPrice = finite(data.lastPrice);
  const vwapDistance = lastPrice == null || vwap == null ? null : lastPrice - vwap;
  const vwapDistancePct = lastPrice == null || vwap == null || vwap === 0 ? null : (vwapDistance / vwap) * 100;
  setText('dw-pulse-vwap-mode', isFixture && vwapDistance != null && vwapDistancePct != null
    ? `${vwapDistance >= 0 ? '+' : ''}${format(vwapDistance, 2)} (${vwapDistancePct >= 0 ? '+' : ''}${format(vwapDistancePct, 2)}%) · SIMULATED`
    : data.vwapSession ? `${data.vwapSession} VWAP · FROZEN` : 'UNAVAILABLE');
  const sessionHigh = available(data.levels?.currentDayHigh);
  const sessionLow = available(data.levels?.currentDayLow);
  setText('dw-pulse-session', sessionHigh != null && sessionLow != null ? `${format(sessionHigh)} / ${format(sessionLow)}` : 'UNAVAILABLE');
  const latestVolume = Array.isArray(data.bars) ? finite(data.bars.at(-1)?.volume) : null;
  setText('dw-pulse-volume', latestVolume == null ? 'UNAVAILABLE' : format(latestVolume));
  setText('tt-pulse-rvol', isFixture ? '1.26' : 'UNAVAILABLE');
  setText('tt-pulse-basis', isFixture ? '+26.0' : 'UNAVAILABLE');
  setText('tt-summary-price', isFixture ? '偏多 · SIMULATED' : finite(data.lastPrice) == null ? 'UNAVAILABLE' : `${data.actualContract || 'TX'} ${format(data.lastPrice)}`);
  setText('tt-summary-vwap', isFixture ? 'VWAP 上方 · SIMULATED' : vwap == null ? 'UNAVAILABLE' : format(vwap, 2));
  setText('tt-health-main', data.qualityStatus || 'UNAVAILABLE');
  setTrust('health', data.qualityStatus || 'UNAVAILABLE');
  setText('tt-top-contract', `台指期貨 ${data.actualContract || 'TX'}`);
  setText('tt-top-price', finite(data.lastPrice) == null ? '—' : format(data.lastPrice));
  setText('tt-top-change', isFixture ? '▲ +112 (+0.50%)' : 'UNAVAILABLE');
  setText('tt-top-volume', latestVolume == null ? 'UNAVAILABLE' : format(latestVolume));
  setText('tt-top-oi', isFixture ? '89,512' : 'UNAVAILABLE');
  setText('tt-top-basis', isFixture ? '+26.0' : 'UNAVAILABLE');
  setText('tt-top-session', isFixture ? '2026/09 · 日盤' : `${data.tradeDate || 'UNAVAILABLE'} · ${data.session || 'UNAVAILABLE'}`);
  setText('tt-top-updated', isFixture ? '更新 15:30:10' : `快照 ${data.tradeDate || 'UNAVAILABLE'}`);
  setText('tt-top-trust', isFixture ? 'SIMULATED' : data.qualityStatus || 'UNAVAILABLE');
  setText('tt-futures-tx', isFixture ? format(data.lastPrice) : 'UNAVAILABLE');
  setText('tt-futures-vwap', isFixture ? `上方 ${format(Math.abs(vwapDistance), 2)}` : 'UNAVAILABLE');
  renderLevels(data);
}

function fixtureChart(timeframe) {
  const frameMinutes = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1D': 1440 }[timeframe] || 5;
  const bars = [];
  const vwap = [];
  const start = Date.parse('2026-08-21T00:45:00.000Z');
  let previous = 22410;
  let weighted = 0;
  let volumeTotal = 0;
  for (let index = 0; index < 56; index += 1) {
    const drift = index < 18 ? index * 2.1 : index < 37 ? 38 - (index - 18) * 1.2 : 15 + (index - 37) * 2.7;
    const wave = Math.sin(index * 0.72) * 18 + Math.cos(index * 0.21) * 8;
    const close = 22410 + drift + wave;
    const open = previous;
    const high = Math.max(open, close) + 7 + (index % 4) * 2;
    const low = Math.min(open, close) - 6 - (index % 3) * 2;
    const volume = 720 + ((index * 173) % 880);
    const time = new Date(start + index * frameMinutes * 60_000).toISOString();
    bars.push({ time, open, high, low, close, volume });
    weighted += ((high + low + close) / 3) * volume;
    volumeTotal += volume;
    vwap.push({ time, value: weighted / volumeTotal });
    previous = close;
  }
  const values = (name) => ({ availability: 'AVAILABLE', value: name });
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  return {
    source: 'SIMULATED_UI_FIXTURE',
    actualContract: 'SIM-TX',
    timeframe,
    tradeDate: 'SIMULATED',
    session: 'VISUAL_REVIEW_ONLY',
    qualityStatus: 'SIMULATED_FIXTURE',
    bars,
    vwap,
    lastPrice: bars.at(-1).close,
    vwapSession: 'SIMULATED',
    openingRange: { status: 'SIMULATED' },
    levels: {
      vwap: values(vwap.at(-1).value),
      openingRangeHigh: values(22472),
      openingRangeLow: values(22384),
      previousDayHigh: values(22536),
      previousDayLow: values(22298),
      previousClose: values(22402),
      currentDayHigh: values(Math.max(...highs)),
      currentDayLow: values(Math.min(...lows)),
    },
  };
}

function renderGovernedWorkspace(value) {
  window.TraderTerminalShell?.setPreviewIdentity(document, value.previewIdentity);
  setText('dw-now-price-fact', value.priceStructure?.actualContract
    ? `${value.priceStructure.actualContract} · ${value.priceStructure.tradeDate || 'UNAVAILABLE'} · ${value.priceStructure.status || 'UNAVAILABLE'}`
    : 'UNAVAILABLE');
  setText('dw-now-evidence-fact', 'FROZEN SNAPSHOT · UI REVIEW ONLY');
  setText('dw-now-trust-fact', `${value.globalStatus?.dataHealth || 'UNAVAILABLE'} · FROZEN_REPLAY`);
  setText('dw-readiness', value.decisionSummary?.readiness);
  setText('dw-no-trade-reason', value.decisionSummary?.noTradeReason);
  setText('dw-direction', value.decisionSummary?.direction);
  setText('dw-global-alignment', value.decisionSummary?.globalAlignment);
  setText('dw-risk', value.decisionSummary?.risk);
  setText('dw-entry-quality', value.globalStatus?.dataHealth);
  setText('tt-summary-strength', 'RESEARCH_PENDING');
  setText('tt-summary-breadth', 'UNAVAILABLE');
  setText('tt-summary-flow', 'UNAVAILABLE');
  setText('tt-summary-risk', value.decisionSummary?.risk);
  setText('dw-chart-status', 'FROZEN');
  setText('dw-pulse-status', 'FROZEN');
  setText('dw-conflict-status', 'UNAVAILABLE');
  setLeadershipTrust('NOT_REQUESTED');
  setText('tt-trend-main', '—');
  setText('tt-trend-direction', '—');
  setText('tt-trend-strength', '—');
  setText('tt-trend-change', '—');
  for (const [id, state] of [
    ['tt-trend-price-track', 'RESEARCH_PENDING'], ['tt-trend-vwap-track', 'RESEARCH_PENDING'],
    ['tt-trend-path-track', 'RESEARCH_PENDING'],
    ['tt-trend-breadth-track', 'UNAVAILABLE'], ['tt-trend-leadership-track', 'NOT_REQUESTED'],
    ['tt-trend-futures-track', 'UNAVAILABLE'],
  ]) setTrack(id, state);
  for (const id of [
    'tt-futures-tx', 'tt-futures-vwap', 'tt-futures-basis', 'tt-futures-oi', 'tt-futures-oi-change',
    'tt-futures-foreign', 'tt-futures-dealer', 'tt-futures-trust-position',
    'tt-options-ring-value', 'tt-options-call', 'tt-options-put', 'tt-options-max-pain', 'tt-options-oi',
    'tt-breadth-up', 'tt-breadth-flat', 'tt-breadth-down', 'tt-breadth-ratio', 'tt-breadth-strength',
    'tt-risk-ring-value', 'tt-risk-volatility', 'tt-risk-liquidity', 'tt-risk-event', 'tt-risk-breadth',
    'tt-health-ring-value', 'tt-health-market', 'tt-health-institutional', 'tt-health-futures', 'tt-health-options', 'tt-health-global',
  ]) setText(id, '—', '—');
  for (const key of ['futures', 'options', 'breadth', 'global']) {
    setText(`tt-${key}-main`, 'UNAVAILABLE');
    setTrust(key, 'UNAVAILABLE');
  }
  setText('tt-risk-ring-state', 'UNAVAILABLE');
  for (const id of ['tt-risk-volatility', 'tt-risk-liquidity', 'tt-risk-event', 'tt-risk-breadth']) setRiskMetric(id, '—');
  setSeries('tt-breadth-series', []);
  setSeries('tt-risk-series', []);
  for (let index = 1; index <= 6; index += 1) {
    setText(`tt-global-name-${index}`, `來源 ${index}`);
    setText(`tt-global-price-${index}`, '—', '—');
    setText(`tt-global-change-${index}`, 'UNAVAILABLE');
    const tile = $(`tt-global-change-${index}`)?.closest('.tt-global-tile');
    tile?.classList.remove('is-positive', 'is-negative');
    setSeries(`tt-global-series-${index}`, []);
  }
  for (const side of ['positive', 'negative']) {
    for (let index = 1; index <= 5; index += 1) setTrack(`tt-contribution-${side}-${index}`, '—');
  }
  setText('tt-contribution-net', 'NOT_REQUESTED');
  setText('tt-gpt-disabled-state', 'UI SHELL · DISABLED');
  setText('health-items', (value.dataHealth?.items || []).map((item) => `${item.sourceId}: ${item.freshnessState} · ${item.quality}`).join(' · '));
  setText('dw-pulse-change', '治理凍結快照 · 無即時市場解讀');
}

function renderFixtureWorkspace() {
  const identity = workspace?.previewIdentity || {};
  window.TraderTerminalShell?.setPreviewIdentity(document, { ...identity, dataMode: 'SIMULATED_UI_FIXTURE', generatedAt: 'STATIC LOCAL FIXTURE' });
  setText('dw-now-price-fact', 'SIM-TX · 視覺 Fixture · SIMULATED');
  setText('dw-now-evidence-fact', 'FOR VISUAL REVIEW ONLY');
  setText('dw-now-trust-fact', 'SIMULATED · NOT MARKET DATA');
  setText('dw-readiness', 'NOT_DECISION_ELIGIBLE');
  setText('dw-no-trade-reason', 'SIMULATED_UI_FIXTURE');
  setText('dw-direction', 'SIMULATED');
  setText('dw-global-alignment', 'SIMULATED');
  setText('dw-risk', 'SIMULATED');
  setText('dw-entry-quality', 'SIMULATED_FIXTURE');
  setText('tt-summary-price', '偏多 · SIMULATED');
  setText('tt-summary-strength', '強度 68 ↓ · SIMULATED');
  setText('tt-summary-vwap', 'VWAP 上方 · SIMULATED');
  setText('tt-summary-breadth', '參與擴張 · SIMULATED');
  setText('tt-summary-flow', 'Flow 支持 · SIMULATED');
  setText('tt-summary-risk', 'Risk 中低 · SIMULATED');
  setText('dw-chart-status', 'SIMULATED');
  setText('dw-pulse-status', 'SIMULATED');
  setText('dw-conflict-status', 'SIMULATED');
  setLeadershipTrust('SIMULATED', 'is-warning');
  setText('tt-trend-main', '偏多');
  setTrust('trend', 'SIMULATED');
  setText('tt-trend-direction', '偏多');
  setText('tt-trend-strength', '68 / 100');
  setText('tt-trend-change', '↓ 減弱');
  for (const [id, label, level] of [
    ['tt-trend-price-track', '結構延續', 7], ['tt-trend-vwap-track', '價格在 VWAP 上', 6],
    ['tt-trend-path-track', '路徑順暢', 6],
    ['tt-trend-breadth-track', '參與擴張', 6], ['tt-trend-leadership-track', '貢獻集中', 5],
    ['tt-trend-futures-track', '期貨支持', 5],
  ]) setTrack(id, `${label} · 模擬`, level);
  setText('tt-futures-main', '支持價格 · 模擬');
  setTrust('futures', 'SIMULATED');
  setText('tt-futures-tx', '22,495');
  setText('tt-futures-vwap', '上方 · SIMULATED');
  setText('tt-futures-basis', '+26.0');
  setText('tt-futures-oi', '89,512');
  setText('tt-futures-oi-change', '+1,204');
  setText('tt-futures-foreign', '+4,812 · EOD');
  setText('tt-futures-dealer', '+1,256 · EOD');
  setText('tt-futures-trust-position', '-342 · EOD');
  setText('tt-options-main', 'PCR 0.82 · 模擬');
  setTrust('options', 'SIMULATED');
  setText('tt-options-ring-value', '總 OI');
  setText('tt-options-call', '22,600');
  setText('tt-options-put', '22,200');
  setText('tt-options-max-pain', '22,400');
  setText('tt-options-oi', 'FIXTURE');
  setText('tt-breadth-main', '參與擴張 · 模擬');
  setTrust('breadth', 'SIMULATED');
  setText('tt-breadth-up', '1,102 · 62%');
  setText('tt-breadth-flat', '72 · 5%');
  setText('tt-breadth-down', '598 · 33%');
  setText('tt-breadth-ratio', '1.84');
  setText('tt-breadth-strength', '強');
  setText('tt-risk-ring-value', '42');
  setText('tt-risk-ring-state', 'SIMULATED');
  setRiskMetric('tt-risk-volatility', '低 · 32', 32, 'positive');
  setRiskMetric('tt-risk-liquidity', '低 · 28', 28, 'positive');
  setRiskMetric('tt-risk-event', '中 · 45', 45, 'warning');
  setRiskMetric('tt-risk-breadth', '中 · 52', 52, 'warning');
  setSeries('tt-risk-series', [38, 36, 39, 41, 40, 44, 43, 46, 42, 44, 41, 42], 'warning');
  setSeries('tt-breadth-series', [41, 43, 46, 44, 49, 54, 58, 56, 61, 65, 68, 66, 70, 74, 78, 82]);
  const globals = [
    ['小納期貨', '19,674', '+0.63%', [44, 45, 47, 46, 49, 51, 50, 54, 57, 60, 62, 66]],
    ['費城半導體', '5,032', '+0.81%', [42, 47, 45, 51, 49, 56, 54, 60, 57, 63, 61, 68]],
    ['日經 225', '38,256', '+0.28%', [50, 52, 49, 53, 55, 52, 56, 54, 58, 57, 60, 61]],
    ['韓股 KOSPI', '2,676', '-0.17%', [62, 60, 61, 57, 59, 55, 54, 56, 52, 50, 51, 48]],
    ['USD / TWD', '32.205', '-0.04%', [53, 52, 52, 51, 52, 50, 51, 49, 49, 48, 49, 47]],
    ['VIX', '19.82', '-2.04%', [70, 68, 66, 67, 62, 60, 58, 59, 54, 51, 48, 45]],
  ];
  setText('tt-global-main', '跨市場背景 · 模擬');
  setTrust('global', 'SIMULATED');
  globals.forEach(([name, price, change, series], index) => {
    setText(`tt-global-name-${index + 1}`, name);
    setText(`tt-global-price-${index + 1}`, price);
    setText(`tt-global-change-${index + 1}`, change);
    const tile = $(`tt-global-change-${index + 1}`)?.closest('.tt-global-tile');
    tile?.classList.toggle('is-positive', change.startsWith('+'));
    tile?.classList.toggle('is-negative', change.startsWith('-'));
    setSeries(`tt-global-series-${index + 1}`, series, change.startsWith('-') ? 'negative' : 'positive');
  });
  const contribution = {
    positive: [['台積電', '+42.8 點'], ['聯發科', '+18.7 點'], ['鴻海', '+15.3 點'], ['廣達', '+9.4 點'], ['中華電', '+7.1 點']],
    negative: [['台塑化', '-12.6 點'], ['長榮', '-8.9 點'], ['中信金', '-6.7 點'], ['日月光', '-5.4 點'], ['統一', '-4.8 點']],
  };
  for (const [side, rows] of Object.entries(contribution)) {
    rows.forEach(([name, points], index) => {
      const row = $(`tt-contribution-${side}-${index + 1}`);
      if (row) row.querySelector('header span').textContent = name;
      setTrack(`tt-contribution-${side}-${index + 1}`, points, Math.max(2, 7 - index));
    });
  }
  setText('tt-contribution-net', '+53.2 點 · SIMULATED');
  setText('tt-health-main', '98% · 模擬');
  setTrust('health', 'SIMULATED');
  setText('tt-health-ring-value', '98%');
  setText('tt-health-market', 'LIVE');
  setText('tt-health-institutional', 'LIVE');
  setText('tt-health-futures', 'LIVE');
  setText('tt-health-options', 'LIVE');
  setText('tt-health-global', 'DELAYED');
  setText('health-items', 'LOCAL_FIXTURE: SIMULATED · NOT MARKET DATA · NO EVIDENCE USE');
  setText('tt-gpt-disabled-state', 'FIXTURE · DISABLED');
  setText('dw-pulse-change', '視覺 Fixture · 數值為虛構且不得用於市場判斷');
}

function applyPreviewIdentity(mode) {
  const fixture = mode === 'fixture';
  document.body.classList.toggle('is-fixture-mode', fixture);
  $('decision-workspace')?.classList.toggle('is-fixture-mode', fixture);
  setText('tt-preview-data-label', fixture ? 'SIMULATED UI FIXTURE' : 'FROZEN GOVERNED SNAPSHOT');
  setText('tt-preview-safety-label', fixture ? 'NOT MARKET DATA' : 'NOT LIVE MARKET DATA');
  setText('tt-preview-purpose-label', fixture ? 'FOR VISUAL REVIEW ONLY' : 'NOT A TRADING SIGNAL');
  document.querySelectorAll('.tt-global-data-kind').forEach((node) => {
    node.textContent = fixture ? 'SIMULATED' : 'LATEST VALUE ONLY';
  });
  document.querySelectorAll('[data-preview-mode]').forEach((button) => {
    const selected = button.dataset.previewMode === mode;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const copyButton = $('copy-gpt');
  if (copyButton) {
    copyButton.disabled = fixture;
    copyButton.textContent = fixture ? 'Fixture 不可複製為證據' : '複製治理快照';
  }
  setText('tt-gpt-preview-note', fixture
    ? '視覺 Fixture 不會進入 Copy Snapshot、Ask GPT 或任何證據流程。'
    : '只會將治理凍結快照複製到瀏覽器剪貼簿。');
}

async function selectTimeframe(timeframe) {
  activeTimeframe = timeframe;
  const data = previewMode === 'fixture'
    ? fixtureChart(timeframe)
    : (await publicGet(`/api/public-preview/tx-chart?timeframe=${encodeURIComponent(timeframe)}`)).data;
  renderChart(data);
  document.querySelectorAll('[data-chart-timeframe]').forEach((button) => {
    const selected = button.dataset.chartTimeframe === timeframe;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

async function setPreviewMode(mode) {
  previewMode = mode === 'fixture' ? 'fixture' : 'governed';
  applyPreviewIdentity(previewMode);
  if (previewMode === 'fixture') renderFixtureWorkspace();
  else renderGovernedWorkspace(workspace);
  await selectTimeframe(activeTimeframe);
}

async function boot() {
  const root = $('decision-workspace');
  window.TraderTerminalShell?.mount(root);
  paletteName = root.dataset.candlePalette || 'red-up';

  const frameHost = $('timeframes');
  for (const timeframe of TIMEFRAMES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.chartTimeframe = timeframe;
    button.textContent = timeframe;
    button.addEventListener('click', () => selectTimeframe(timeframe));
    frameHost.append(button);
  }
  workspace = (await publicGet('/api/public-preview/workspace')).data;
  document.querySelectorAll('[data-preview-mode]').forEach((button) => button.addEventListener('click', () => setPreviewMode(button.dataset.previewMode)));
  $('copy-gpt').addEventListener('click', async () => {
    if (previewMode !== 'governed') return;
    const summary = { preview: true, snapshotMode: 'FROZEN_SNAPSHOT', workspace, chart: activeChart };
    await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
  });
  await setPreviewMode('governed');
}

window.addEventListener('trader-terminal:palette', (event) => {
  paletteName = event.detail?.name || 'red-up';
  if (activeChart) renderChart(activeChart);
});

window.addEventListener('trader-terminal:chart-layout', () => {
  window.setTimeout(() => chart?.timeScale().fitContent(), 0);
});

window.addEventListener('trader-terminal:levels', () => {
  if (activeChart) renderChart(activeChart);
});

boot().catch((error) => {
  setText('dw-chart-mode', `Preview failed: ${error.message}`);
});
