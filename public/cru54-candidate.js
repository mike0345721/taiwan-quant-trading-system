/* global LightweightCharts */
(() => {
  const $ = id => document.getElementById(id);
  const fmt = x => x == null ? '不可用' : Number(x).toLocaleString('zh-TW', { maximumFractionDigits: 3 });
  const time = epochMs => epochMs == null ? '時間未知' : new Date(epochMs).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  let chart, series = [], currentFrame = '1m', serial = 0;
  const reasons = { CLASSIFIED_COVERAGE_INCOMPLETE: '分類覆蓋不足', CAPTURE_COMPLETENESS_UNPROVEN: '捕捉完整性未證明', NO_CLASSIFIED_VOLUME: '尚無可分類成交量', NO_LAWFUL_TRADE: '尚無合法成交', CONTINUITY_OR_LINEAGE_AWAITING_VALID_SEGMENT: '連續性或時間來源中斷，等待有效觀測段', PRICE_TIME_LINEAGE_EXCLUSIONS: '部分價格成交因既有時間檢查排除', SAME_PREFIX_PRICE_CONTEXT_ONLY: '同一原始前綴的價格背景', NO_LAWFUL_PRICE_BARS: '沒有合法價格 K 棒', CVD_PROJECTION_MISSING: '隔離投影尚未建立', CVD_CHART_TIME_LINEAGE_INVALID: '觀測時間無法安全繪圖' };
  const reason = x => reasons[x] || x || '原因未知';
  function clearChart() { if (chart) { chart.remove(); chart = null; } series = []; }
  function error(message) {
    clearChart(); document.body.dataset.error = 'true'; document.body.dataset.endpoint = 'null';
    $('trust').textContent = message; $('value').textContent = '不可用：載入失敗'; $('endpoint').textContent = '端點未驗證';
    for (const id of ['identity', 'origin', 'coverage']) $(id).textContent = '不可用：投影尚未通過載入驗證';
    for (const id of ['summary', 'price-reason', 'cutoff']) $(id).textContent = '';
    $('segments').replaceChildren(); $('empty').hidden = true;
  }
  async function authenticate(token) {
    const response = await fetch('/session', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: token });
    if (!response.ok) throw Error('候選存取碼無效或已過期'); $('login').hidden = true;
  }
  function makeChart() {
    const L = window.LightweightCharts;
    if (!L?.createChart || !L.CandlestickSeries || !L.LineSeries) throw Error('圖表相依套件無法載入');
    const result = L.createChart($('chart'), { autoSize: true, layout: { background: { type: 'solid', color: '#090f18' }, textColor: '#a2b0c4', panes: { separatorColor: '#29394f' } },
      grid: { vertLines: { color: '#142034' }, horzLines: { color: '#142034' } }, timeScale: { timeVisible: true, secondsVisible: true, rightOffset: 2, tickMarkFormatter: t => new Date(t * 1000).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) },
      localization: { timeFormatter: t => time(t * 1000) }, crosshair: { mode: L.CrosshairMode.Normal } });
    return result;
  }
  function render(p) {
    clearChart(); document.body.dataset.error = 'false'; chart = makeChart();
    const L = window.LightweightCharts;
    const candle = chart.addSeries(L.CandlestickSeries, { upColor: '#ff6b6b', downColor: '#37d67a', wickUpColor: '#ff6b6b', wickDownColor: '#37d67a', borderVisible: false }, 0);
    const volume = chart.addSeries(L.HistogramSeries, { color: '#48667d', priceFormat: { type: 'volume' }, title: '成交量', priceLineVisible: false }, 1);
    // Keep only the current identity's price context; never fuse contracts into a candle path.
    const bars = p.bars.filter(b => b.actualContract === p.actualContract && b.tradeDate === p.tradeDate && b.session === p.session);
    candle.setData(bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    volume.setData(bars.map(b => ({ time: b.time, value: b.volume })));
    let lastPlotted = null, plottedPoints = 0;
    for (const segment of p.segments) {
      let chunk = [], previousTime = null;
      const flush = () => {
        if (!chunk.length) return;
        const line = chart.addSeries(L.LineSeries, { color: '#80c9ff', lineWidth: 2, title: `CVD 段${segment.index + 1}`, priceLineVisible: false, lastValueVisible: false, pointMarkersVisible: chunk.length === 1 }, 2);
        line.setData(chunk); series.push(line); plottedPoints += chunk.length;
        if (segment.index === p.segmentIndex) lastPlotted = line.data().at(-1)?.value ?? null;
        chunk = [];
      };
      for (const point of segment.points) {
        if (point.value == null || point.time == null) { flush(); previousTime = null; continue; }
        const datum = { time: point.time, value: point.value };
        if (point.time === previousTime) chunk[chunk.length - 1] = datum;
        else chunk.push(datum);
        previousTime = point.time;
      }
      flush();
    }
    if (!series.length) chart.addSeries(L.LineSeries, { title: 'CVD 不可用', color: '#80c9ff' }, 2);
    const height = $('chart').clientHeight; chart.panes()[0].setHeight(height * .58); chart.panes()[1].setHeight(height * .15); chart.panes()[2].setHeight(height * .27);
    chart.timeScale().fitContent();
    if (p.currentCvd != null && p.display.currentPlotAvailable && lastPlotted !== p.currentCvd) throw Error('圖表端點與 API 不一致');
    document.body.dataset.endpoint = !p.display.currentPlotAvailable || p.currentCvd == null ? 'null' : String(lastPlotted);
    document.body.dataset.generation = p.generationHash; document.body.dataset.timeframe = p.timeframe;
    document.body.dataset.panes = String(chart.panes().length); document.body.dataset.points = String(plottedPoints);
    $('identity').textContent = `${p.actualContract || '契約未知'} / ${p.tradeDate || '交易日未知'} / ${p.session || '時段未知'} · ${p.continuityEpoch || '連續段未知'}`;
    $('origin').textContent = p.origin ? `${time(p.origin.eventTimeMs)} 起算｜${p.sessionStartProven ? '已證明 session 起點' : '觀測片段'}` : '起點不可用：等待有效觀測段';
    $('value').textContent = p.currentCvd == null ? `不可用：${reason(p.reason)}` : fmt(p.currentCvd);
    $('coverage').textContent = `${p.classifiedCoverage == null ? '分類覆蓋未知' : (p.classifiedCoverage * 100).toFixed(2) + '% 已分類'}｜捕捉完整性未證明`;
    $('trust').textContent = `${p.freshness.state === 'STALE' ? 'STALE · 歷史資料，非即時' : p.freshness.state === 'UNAVAILABLE' ? '時間可用性未知' : '固定歷史片段，非即時'} ｜ ${reason(p.reason)} ｜最後成交可用時間 ${time(p.lastTradeAvailableAtMs)}${p.display.boundaryAtCutoff ? ' ｜尾端已中斷，圖上末值僅為歷史' : ''}`;
    $('endpoint').textContent = !p.display.currentPlotAvailable ? '圖表端點不可用：觀測時間或目前身分無法安全繪圖' : p.currentCvd == null ? '目前端點不可用；歷史曲線不代表目前有效值' : `已核對 API／圖表末值 ${fmt(lastPlotted)} 口`;
    $('summary').textContent = p.summary ? `分類成交摘要：買方代理 ${fmt(p.summary.buyProxyVolume)}／賣方代理 ${fmt(p.summary.sellProxyVolume)}／UNKNOWN ${fmt(p.summary.unknownVolume)} 口。曲線顯示 ${p.display.outputPoints}／${p.display.inputPoints} 個物理序位點；同一毫秒只顯示最後物理值。` : '成交摘要不可用：目前身分尚無有效觀測段。';
    $('price-reason').textContent = `價格背景：${reason(p.priceReason)}；時間檢查排除 ${p.priceTimeLineageViolationCount} 筆。價格與 CVD 的可用成交集合可能不同，不互相補值。`;
    $('empty').hidden = bars.length > 0 && plottedPoints > 0; $('empty').textContent = `${bars.length ? '' : 'K／Volume 空白：沒有本身分合法價格 K 棒。 '}${plottedPoints ? '' : 'CVD 空白：' + reason(p.segments.find(s => s.clockInvalid)?.reason || p.reason)}`;
    $('segments').replaceChildren(...p.segments.map(s => { const div = document.createElement('div'); div.className = 'segment'; div.textContent = `段 ${s.index + 1} · ${s.identity.join(' / ')} · ${time(s.origin.eventTimeMs)} 起算｜觀測片段 · ${reason(s.reason)}${s.terminalInvalid ? ' · 尾端已失效' : ''}`; return div; }));
    $('version').textContent = `隔離 PHASE B · HEAD ${p.head}`; $('cutoff').textContent = `cutoff #${p.cutoff.ledgerOrdinal} · generation ${p.generationHash.slice(0, 16)}`;
    for (const button of $('frames').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.frame === p.timeframe));
  }
  async function load(frame) {
    const request = ++serial; $('trust').textContent = '正在載入有界投影…';
    try {
      const response = await fetch(`/api/cvd?timeframe=${encodeURIComponent(frame)}`);
      const data = await response.json(); if (request !== serial) return;
      if (response.status === 401) { $('login').hidden = false; throw Error('需要本次隔離候選存取碼'); }
      if (!response.ok) throw Error(reason(data.reason));
      render(data); currentFrame = frame;
    } catch (e) { if (request === serial) error(e.message); }
  }
  $('frames').addEventListener('click', e => { if (e.target.dataset.frame) load(e.target.dataset.frame); });
  $('fit').addEventListener('click', () => chart?.timeScale().fitContent());
  $('login').addEventListener('submit', async e => { e.preventDefault(); try { await authenticate($('access').value); $('access').value = ''; await load(currentFrame); } catch (e) { error(e.message); } });
  (async () => { const token = location.hash.slice(1); history.replaceState(null, '', location.pathname); try { if (token) await authenticate(token); await load(currentFrame); } catch (e) { error(e.message); $('login').hidden = false; } })();
})();
