'use strict';

const TIMEFRAMES = ['1m','5m','15m','30m','1h','4h','1D'];
const $ = (id) => document.getElementById(id);
let chart;
let candleSeries;
let volumeSeries;
let vwapSeries;
let workspace;
let activeChart;
let paletteName = 'red-up';

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
    width: host.clientWidth, height: host.clientHeight,
  });
  candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: palette.up, downColor: palette.down,
    wickUpColor: palette.up, wickDownColor: palette.down, borderVisible: false,
  });
  volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: .78, bottom: 0 } });
  vwapSeries = chart.addSeries(LightweightCharts.LineSeries, { color: '#f5c86b', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
  new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth, height: host.clientHeight })).observe(host);
}

function renderLevels(data) {
  const levels = data.levels || {};
  const available = (level) => level?.availability === 'AVAILABLE' ? finite(level.value) : null;
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
  const bars = (data.bars || []).map(({time,open,high,low,close}) => ({
    time: chartEpoch(time), open: finite(open), high: finite(high), low: finite(low), close: finite(close),
  })).filter((bar) => bar.time != null && [bar.open, bar.high, bar.low, bar.close].every((value) => value != null));
  candleSeries.setData(bars);
  volumeSeries.setData((data.bars || []).map((bar) => {
    const open = finite(bar.open);
    const close = finite(bar.close);
    return {
      time: chartEpoch(bar.time), value: finite(bar.volume),
      color: open == null || close == null ? 'rgba(131,145,167,.28)' : close >= open ? palette.upVolume : palette.downVolume,
    };
  }).filter((bar) => bar.time != null && bar.value != null));
  vwapSeries.setData((data.vwap || []).map(({time,value}) => ({ time: chartEpoch(time), value: finite(value) })).filter((point) => point.time != null && point.value != null));
  line(candleSeries, data.levels?.openingRangeHigh, 'OR H', '#8aa7ff');
  line(candleSeries, data.levels?.openingRangeLow, 'OR L', '#8aa7ff');
  line(candleSeries, data.levels?.previousDayHigh, 'Previous H', '#77869c', 3);
  line(candleSeries, data.levels?.previousDayLow, 'Previous L', '#77869c', 3);
  line(candleSeries, data.levels?.previousClose, 'Previous C', '#a1aec0', 3);
  line(candleSeries, data.levels?.currentDayHigh, 'DAY H', '#77869c', 3);
  line(candleSeries, data.levels?.currentDayLow, 'DAY L', '#77869c', 3);
  chart.timeScale().fitContent();

  setText('dw-chart-contract', `${data.actualContract || 'TX'} · ${data.timeframe || 'UNAVAILABLE'}`);
  setText('dw-chart-mode', `FROZEN_SNAPSHOT · ${data.tradeDate || 'UNAVAILABLE'} · ${data.session || 'UNAVAILABLE'} · READ ONLY`);
  setText('dw-pulse-price', format(data.lastPrice));
  const vwap = data.levels?.vwap?.availability === 'AVAILABLE' ? finite(data.levels.vwap.value) : null;
  setText('dw-pulse-vwap', vwap == null ? 'UNAVAILABLE' : format(vwap, 2));
  setText('dw-pulse-vwap-mode', data.vwapSession ? `${data.vwapSession} VWAP · FROZEN` : 'UNAVAILABLE');
  const sessionHigh = data.levels?.currentDayHigh?.availability === 'AVAILABLE' ? finite(data.levels.currentDayHigh.value) : null;
  const sessionLow = data.levels?.currentDayLow?.availability === 'AVAILABLE' ? finite(data.levels.currentDayLow.value) : null;
  setText('dw-pulse-session', sessionHigh != null && sessionLow != null ? `${format(sessionHigh)} / ${format(sessionLow)}` : 'UNAVAILABLE');
  const latestVolume = Array.isArray(data.bars) ? finite(data.bars.at(-1)?.volume) : null;
  setText('dw-pulse-volume', latestVolume == null ? 'UNAVAILABLE' : format(latestVolume));
  setText('tt-summary-price', finite(data.lastPrice) == null ? 'UNAVAILABLE' : `${data.actualContract || 'TX'} ${format(data.lastPrice)}`);
  setText('tt-summary-vwap', vwap == null ? 'UNAVAILABLE' : format(vwap, 2));
  setText('tt-health-main', data.qualityStatus || 'UNAVAILABLE');
  const healthTrust = $('tt-health-trust');
  if (healthTrust) healthTrust.textContent = data.qualityStatus || 'UNAVAILABLE';
  renderLevels(data);
}

function renderWorkspace(value) {
  window.TraderTerminalShell?.setPreviewIdentity(document, value.previewIdentity);
  setText('dw-now-price-fact', value.priceStructure?.actualContract
    ? `${value.priceStructure.actualContract} · ${value.priceStructure.tradeDate || 'UNAVAILABLE'} · ${value.priceStructure.status || 'UNAVAILABLE'}`
    : 'UNAVAILABLE');
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
  setText('health-items', (value.dataHealth?.items || []).map((item) => `${item.sourceId}: ${item.freshnessState} · ${item.quality}`).join(' · '));
}

async function selectTimeframe(timeframe) {
  const payload = await publicGet(`/api/public-preview/tx-chart?timeframe=${encodeURIComponent(timeframe)}`);
  renderChart(payload.data);
  document.querySelectorAll('[data-chart-timeframe]').forEach((button) => button.classList.toggle('is-selected', button.dataset.chartTimeframe === timeframe));
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
  renderWorkspace(workspace);
  $('copy-gpt').addEventListener('click', async () => {
    const summary = { preview: true, snapshotMode: 'FROZEN_SNAPSHOT', workspace, chart: activeChart };
    await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
  });
  await selectTimeframe('5m');
}

window.addEventListener('trader-terminal:palette', (event) => {
  paletteName = event.detail?.name || 'red-up';
  if (activeChart) renderChart(activeChart);
});

window.addEventListener('trader-terminal:chart-layout', () => {
  window.setTimeout(() => chart?.timeScale().fitContent(), 0);
});

boot().catch((error) => {
  setText('dw-chart-mode', `Preview failed: ${error.message}`);
});
