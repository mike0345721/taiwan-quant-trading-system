const TIMEFRAMES = ['1m','5m','15m','30m','1h','4h','1D'];
let chart;
let candleSeries;
let volumeSeries;
let vwapSeries;
let workspace;
let activeChart;

async function publicGet(url) {
  const response = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(`PREVIEW_REQUEST_FAILED:${response.status}`);
  return response.json();
}

function line(series, level, title, color, style = 2) {
  if (level?.availability !== 'AVAILABLE' || !Number.isFinite(level.value)) return;
  series.createPriceLine({ price: level.value, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
}

function chartEpoch(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function ensureChart() {
  if (chart) chart.remove();
  const host = document.querySelector('#chart');
  chart = LightweightCharts.createChart(host, {
    layout: { background: { color: '#0d1917' }, textColor: '#93aba4', attributionLogo: true },
    grid: { vertLines: { color: '#172824' }, horzLines: { color: '#172824' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#26423b', scaleMargins: { top: .08, bottom: .25 } },
    timeScale: { borderColor: '#26423b', timeVisible: true, secondsVisible: false },
    width: host.clientWidth, height: host.clientHeight,
  });
  candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, { upColor:'#3ec7a5',downColor:'#ee6a70',wickUpColor:'#3ec7a5',wickDownColor:'#ee6a70',borderVisible:false });
  volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, { priceFormat:{type:'volume'},priceScaleId:'volume',color:'#426d64' });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: .78, bottom: 0 } });
  vwapSeries = chart.addSeries(LightweightCharts.LineSeries, { color:'#61d9c4',lineWidth:2,priceLineVisible:false,lastValueVisible:false });
  new ResizeObserver(() => chart.applyOptions({ width:host.clientWidth,height:host.clientHeight })).observe(host);
}

function renderChart(data) {
  activeChart = data;
  ensureChart();
  candleSeries.setData(data.bars.map(({time,open,high,low,close}) => ({time:chartEpoch(time),open,high,low,close})).filter((bar)=>bar.time!=null));
  volumeSeries.setData(data.bars.map((bar) => ({time:chartEpoch(bar.time),value:bar.volume,color:bar.close>=bar.open?'rgba(62,199,165,.45)':'rgba(238,106,112,.45)'})).filter((bar)=>bar.time!=null));
  vwapSeries.setData(data.vwap.map(({time,value}) => ({time:chartEpoch(time),value})).filter((point)=>point.time!=null));
  line(candleSeries, data.levels?.openingRangeHigh, 'OR High', '#ffbc5d');
  line(candleSeries, data.levels?.openingRangeLow, 'OR Low', '#ffbc5d');
  line(candleSeries, data.levels?.previousDayHigh, '前一日盤高', '#65a9ff', 3);
  line(candleSeries, data.levels?.previousDayLow, '前一日盤低', '#65a9ff', 3);
  line(candleSeries, data.levels?.previousClose, '前一日盤收', '#a481e8', 3);
  chart.timeScale().fitContent();
  document.querySelector('#contract').textContent = `${data.actualContract || 'TX'} · ${data.timeframe}`;
  document.querySelector('#chart-meta').textContent = `${data.tradeDate || '—'} · ${data.session || '—'} · ${data.status} · ${data.vwapSession || 'UNAVAILABLE'} VWAP`;
  document.querySelector('#quality').textContent = data.qualityStatus;
  document.querySelector('#quality').className = data.qualityStatus === 'PASS' ? 'is-pass' : 'is-insufficient';
  document.querySelector('#coverage').textContent = `${data.coverageState || data.status} · ${data.contractConsistencyState || '—'}`;
  document.querySelector('#quality-reasons').innerHTML = (data.qualityReasons?.length ? data.qualityReasons : ['無額外品質警告']).map((reason) => `<li>${reason}</li>`).join('');
  document.querySelector('#structure').textContent = `${data.vwapSession || 'UNAVAILABLE'} VWAP · DAY OR ${data.openingRange?.status || 'UNAVAILABLE'} · ${data.bars.length} bars`;
}

async function selectTimeframe(timeframe) {
  const payload = await publicGet(`/api/public-preview/tx-chart?timeframe=${encodeURIComponent(timeframe)}`);
  renderChart(payload.data);
  document.querySelectorAll('[data-timeframe]').forEach((button) => button.classList.toggle('active', button.dataset.timeframe === timeframe));
}

async function boot() {
  const frameHost = document.querySelector('#timeframes');
  for (const timeframe of TIMEFRAMES) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.timeframe = timeframe; button.textContent = timeframe;
    button.addEventListener('click', () => selectTimeframe(timeframe));
    frameHost.append(button);
  }
  workspace = (await publicGet('/api/public-preview/workspace')).data;
  document.querySelector('#direction').textContent = workspace.decisionSummary.direction;
  document.querySelector('#global-alignment').textContent = workspace.decisionSummary.globalAlignment;
  document.querySelector('#risk').textContent = workspace.decisionSummary.risk;
  document.querySelector('#health-items').textContent = workspace.dataHealth.items.map((item) => `${item.sourceId}: ${item.quality}`).join(' · ');
  document.querySelector('#copy-gpt').addEventListener('click', async () => {
    const summary = { preview:true, snapshotMode:'FROZEN_SNAPSHOT', workspace, chart:activeChart };
    await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
  });
  await selectTimeframe('5m');
}

boot().catch((error) => {
  document.querySelector('#chart-meta').textContent = `預覽載入失敗：${error.message}`;
});
