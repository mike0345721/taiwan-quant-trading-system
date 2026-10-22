/* CRU-21 home presentation. No transport, credentials, orders, or model requests. */
(function homeWorkspace(global) {
  'use strict';
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const identityKeys = ['actualContract', 'tradeDate', 'session'];
  const time = value => typeof value === 'string' && value ? Date.parse(value) : NaN;
  const fresh = (value, now) => Number.isFinite(time(value)) && time(value) <= now + 5000 && now - time(value) <= 120000;
  const identity = value => identityKeys.every(key => typeof value?.[key] === 'string' && value[key]);
  const same = (a, b) => identity(a) && identity(b) && identityKeys.every(key => a[key] === b[key]);
  const stamp = value => Number.isFinite(time(value)) ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '來源時間未知';

  // A presentation projection, never a replacement for backend eligibility or R:R rules.
  function derive({ chart = null, flow = null, watch = null, dashboardError = null, chartError = null, focusAllowed = false, rendered = false, now = Date.now() } = {}) {
    const hasChart = Boolean(chart?.bars?.length && rendered);
    const replay = chart?.mode === 'REPLAY';
    const chartFresh = chart?.mode === 'LIVE' && fresh(chart.availableAt, now) && identity(chart);
    const chartCurrent = hasChart && chartFresh && !chartError;
    const chartQualified = chartCurrent && chart.qualityStatus === 'PASS';
    const flowCurrent = Boolean(['LIVE', 'WARMING_UP'].includes(flow?.sourceState) && flow.windows && same(chart, flow.identity) && fresh(flow.source?.availableAt, now)
      && (flow.source.validUntil == null || (Number.isFinite(time(flow.source.validUntil)) && time(flow.source.validUntil) >= now)));
    const flowQualified = flowCurrent && flow.sourceState === 'LIVE' && ['PASS', 'READY'].includes(flow.researchQuality?.status);
    const mismatch = Boolean(chart && flow?.identity && identity(chart) && identity(flow.identity) && !same(chart, flow.identity));
    const watchFresh = Boolean(watch && fresh(watch.sourceAvailableAt, now) && same(chart, watch.identity));
    const blocking = Boolean(dashboardError || !chartQualified || !flowQualified || !watchFresh || mismatch);
    const active = !dashboardError && chartCurrent && watchFresh && focusAllowed && watch?.decisionFocus?.state === 'ACTIVE_REFERENCE'; // Preserve already-qualified price-only references; do not invent a new eligibility gate.
    const noReference = !blocking && watch?.decisionFocus?.state === 'NO_ACTIVE_REFERENCE';
    const failure = Boolean(chartError || dashboardError);
    let status = '資料準備中', message = '尚未取得完整資料，不提供當下判讀。', tone = 'muted';
    if (failure) {
      status = chartCurrent ? '部分資料更新中斷' : '資料更新中斷'; tone = 'blocked';
      message = chartCurrent ? '圖表有獨立更新；完整盤況尚未恢復，暫停合併判讀。' : '未能取得新資料；保留畫面不是即時盤況，暫停當下判讀。';
    } else if (chart && !hasChart) {
      status = '圖表暫不可用'; tone = 'limited'; message = '尚無可顯示的合格圖表；不以空值或舊價位建立當下判讀。';
    } else if (replay) {
      status = '歷史回放'; message = '這是所選歷史資料，不是目前盤勢。';
    } else if (hasChart && !chartFresh) {
      status = '資料已過期或時間不明'; tone = 'blocked'; message = '保留已載入圖表，不能以舊資料判斷當下條件。';
    } else if (mismatch) {
      status = '資料身分不一致'; tone = 'blocked'; message = '圖表與力道的合約、盤別或交易日不同，不進行合併判讀。';
    } else if (chartCurrent && (!chartQualified || !flowQualified)) {
      status = '資料受限'; tone = 'limited'; message = !chartQualified ? '圖表可供觀察，但時間或品質證據不足；不提供當下方向與可執行 R:R。' : '圖表可用，成交力道尚未合格；不提供壓力與價格反應的合併判讀。';
    } else if (chartQualified && flowQualified) {
      status = '觀察資料合格'; tone = 'ready'; message = '資料合格不等於方向已確認；依合法觀察條件閱讀。';
    }
    const flowReason = String(flow?.unavailableReason || '');
    const flowMessage = mismatch ? '資料身分不同，暫停合併判讀。'
      : /PROCESS_MISSING/.test(flowReason) ? '所綁定的力道處理程序未運行；不提供成交壓力判讀。'
        : flow?.sourceState === 'STALE' ? '力道資料已過期；最後資料僅供追溯。'
          : flowQualified ? '研究觀測，非交易訊號。'
            : flowCurrent ? '部分研究證據不足；數值依各欄品質限制呈現。' : '尚無合格力道資料；原因與最後來源時間可在明細查看。';
    return Object.freeze({
      status, message, tone, hasChart, chartCurrent, chartQualified, flowCurrent, flowQualified, mismatch,
      chartLabel: !hasChart ? '圖表尚未就緒' : replay ? '歷史回放' : !chartCurrent ? '已載入快照・非即時' : chartQualified ? '觀察資料合格' : '圖表資料受限',
      chartTime: stamp(chart?.availableAt), flowTime: stamp(flow?.source?.availableAt),
      price: hasChart && number(chart?.lastPrice) !== null ? chart.lastPrice.toLocaleString('zh-TW', { maximumFractionDigits: 2 }) : '—',
      priceLabel: chartCurrent ? '成交價' : hasChart ? '上一筆' : '尚未取得價格',
      focus: active ? 'active' : noReference ? 'none' : 'blocked',
      focusTitle: active ? (blocking ? '價格觀察位置・資料受限' : '有合格觀察位置') : noReference ? '附近沒有合格觀察價位' : '暫停當下判讀',
      focusMessage: active ? (blocking ? '保留原規則合格的價格參考；力道與完整品質仍受限，不代表方向或可執行 R:R。' : '依下列確認與失效條件觀察；不是進場指令。') : noReference ? '資料可用，但附近沒有符合既有規則的參考位置；背景價位不升格為當下焦點。' : '先恢復合格資料，再核對當下位置與條件。不是「已確認沒有交易機會」。',
      flowMessage, flowLabel: flowQualified ? '研究資料可用' : flowCurrent ? '部分受限' : '暫不可用',
      raw: [dashboardError, chartError, ...(chart?.qualityReasons || []), flowReason, watch?.reason, ...(watch?.evidenceGate?.reasonCodes || [])].filter(Boolean).map(String).join('\n'),
    });
  }
  // Preview 02 projects existing contracts only; never invents signals or missing values.
  function flowRows({ chart = null, flow = null, flowDefinitions = [], now = Date.now() } = {}) {
    const expires = flow?.source?.validUntil;
    const transport = ['LIVE', 'WARMING_UP'].includes(flow?.sourceState)
      && identity(flow?.identity) && fresh(flow?.source?.availableAt, now)
      && (expires == null || (Number.isFinite(time(expires)) && time(expires) >= now));
    const comparable = chart?.mode === 'LIVE' && same(chart, flow?.identity);
    const rawState = ['READY', 'PARTIAL', 'QUALITY_INSUFFICIENT'];
    return flowDefinitions.filter(d => d.data === 'GOVERNED').map(d => {
      const w = flow?.windows?.[d.source], p = w?.pressure || {};
      const reason = !transport ? (flow?.unavailableReason || 'FLOW_NOT_CURRENT')
        : !comparable ? 'FLOW_CHART_IDENTITY_OR_MODE_MISMATCH'
          : !w ? 'WINDOW_MISSING'
            : w.truthState === 'WARMING_UP' ? 'WINDOW_WARMING_UP'
              : ![null, undefined, 'LIVE'].includes(w.truthState) || !rawState.includes(w.status) ? (w.unavailableReason || 'WINDOW_UNAVAILABLE') : null;
      const available = !reason;
      const pressureAvailable = available && rawState.includes(p.status);
      const bounded = (v, min, max) => number(v) != null && v >= min && v <= max ? v : null;
      const quantity = v => number(v) != null && v >= 0 ? v : null;
      const ratio = pressureAvailable ? bounded(p.pressureRatio, -1, 1) : null;
      const coverage = available ? bounded(p.classifiedCoverage, 0, 1) : null;
      const response = available && rawState.includes(w.response?.status) ? number(w.response.displacementPoints) : null;
      const efficiency = available && w.pathEfficiency?.status === 'READY' ? bounded(w.pathEfficiency.value, 0, 1) : null;
      const qualified = available && w.status === 'READY' && p.status === 'READY' && coverage === 1
        && ratio != null && response != null && efficiency != null;
      const directional = available && flow.sourceState === 'LIVE' && p.status === 'READY' && coverage === 1 && ratio != null;
      const side = !directional ? '不作方向判定' : ratio > 0 ? '偏買方' : ratio < 0 ? '偏賣方' : '均衡';
      return Object.freeze({ key: d.key, label: d.label, available, qualified,
        state: reason === 'WINDOW_WARMING_UP' ? '暖機中' : reason ? '不可用' : qualified ? '可觀察' : '部分受限',
        reason: reason || p.unavailableReason || w.pathEfficiency?.unavailableReason || (qualified ? null : 'WINDOW_FIELDS_LIMITED'),
        ratio, net: pressureAvailable ? number(p.netAggressiveFlowProxy) : null, response, efficiency, coverage,
        buy: pressureAvailable ? quantity(p.buyProxyVolume) : null,
        sell: pressureAvailable ? quantity(p.sellProxyVolume) : null,
        unknown: pressureAvailable ? quantity(p.unknownVolume) : null,
        total: pressureAvailable ? quantity(p.totalExecutedVolume) : null,
        side,
        sourceTime: flow?.source?.availableAt || null,
      });
    });
  }

  function marketContext({ chart = null, pulse = null, leadership = null, now = Date.now() } = {}) {
    const night = chart?.session === 'NIGHT';
    const pulseCurrent = chart?.mode === 'LIVE' && pulse?.schemaVersion === 'market-pulse-live-v1'
      && same(chart, pulse.identity) && fresh(pulse.generatedAt, now) && fresh(pulse.sourceAvailableAt, now);
    const basis = pulse?.basis || {};
    const basisReady = pulseCurrent && basis.state === (night ? 'SESSION_CLOSED_REFERENCE' : 'LIVE') && number(basis.points) != null;
    const rvol = pulse?.rvol || {};
    const rvolReady = pulseCurrent && rvol.state === 'READY' && number(rvol.ratio) != null && rvol.ratio >= 0;
    const l = leadership || {};
    const dated = typeof l.sourceTradeDate === 'string' && /^\d{4}-\d\d-\d\d$/.test(l.sourceTradeDate)
      && Number.isFinite(time(l.lastAvailableAt)) && time(l.lastAvailableAt) <= now + 5000;
    const dayLive = chart?.mode === 'LIVE' && !night && l.state === 'LIVE' && l.sourceMode === 'LIVE_RAW'
      && dated && l.sourceTradeDate === chart.tradeDate && fresh(l.lastAvailableAt, now);
    const closed = chart?.mode === 'LIVE' && dated && identity(chart) && l.sourceTradeDate <= chart.tradeDate
      && l.state === 'SESSION_CLOSED' && l.sourceMode === 'EOD_CONTEXT';
    const leadershipUsable = l.indexCode === 'IX0001' && l.session === 'DAY' && l.quality === 'PASS' && (dayLive || closed);
    return Object.freeze({ night, basisReady, rvolReady,
      basisLabel: night ? '夜盤對現貨收盤差' : '期現貨差',
      basis: basisReady ? basis.points : null, spot: basisReady ? number(basis.spotPrice) : null,
      spotDate: basisReady ? basis.spotTradeDate || null : null,
      basisReason: basisReady ? null : basis.reason || 'BASIS_NOT_CURRENT_OR_IDENTITY_MISMATCH',
      rvol: rvolReady ? rvol.ratio : null,
      rvolDetail: rvolReady ? '已完成5分K · 樣本 ' + (number(rvol.sampleDays) ?? '未知') + ' 日' : '基準／來源尚未合格',
      sourceTime: pulseCurrent ? pulse.sourceAvailableAt : null,
      leadershipUsable, leadershipMode: dayLive && leadershipUsable ? '日盤即時貢獻' : closed && leadershipUsable ? '已收盤背景・非即時' : '指數貢獻暫不可用',
      leadershipDate: dated ? l.sourceTradeDate : null, leadershipTime: dated ? l.lastAvailableAt : null,
      leadershipReason: leadershipUsable ? null : l.reasonCode || l.reason || 'LEADERSHIP_QUALITY_OR_TIME_UNAVAILABLE',
      leaders: leadershipUsable && Array.isArray(l.indexLeadership?.topAbsolute)
        ? l.indexLeadership.topAbsolute.filter(row => number(row.points) != null).slice(0, 3).map(row => ({
          name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '名稱未提供', points: row.points,
        })) : [],
    });
  }

  const metricText = (value, digits = 0, signed = false) => number(value) == null ? '—'
    : (signed && value > 0 ? '+' : '') + value.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  // The compact view consumes the SAME governed row as the detailed table.
  // It does not calculate a new score, request data, or select a chart timeframe.
  function quickFlowCells(ratio) {
    if (ratio === null || ratio === undefined) return 0;
    const numeric = Number(ratio);
    if (!Number.isFinite(numeric) || numeric < -1 || numeric > 1) return 0;
    const magnitude = Math.abs(numeric);
    if (magnitude < 0.10) return 0;
    if (magnitude < 0.325) return 1;
    if (magnitude < 0.55) return 2;
    if (magnitude < 0.775) return 3;
    return 4;
  }

  function quickFlowView(row, { flow = null, now = Date.now() } = {}) {
    const availableAt = time(flow?.source?.availableAt), validUntil = time(flow?.source?.validUntil);
    const expired = !row.available && (flow?.sourceState === 'STALE'
      || (Number.isFinite(availableAt) && now - availableAt > 120000)
      || (Number.isFinite(validUntil) && validUntil < now));
    const state = expired ? '已過期' : row.state;
    const hasRatio = row.available && number(row.ratio) != null && Math.abs(row.ratio) <= 1;
    const pressure = hasRatio ? metricText(row.ratio, 3, true) : '—';
    const semanticDirection = hasRatio ? ({ '偏買方': 'buy', '偏賣方': 'sell', '均衡': 'balanced' })[row.side] || 'none' : 'none';
    const cells = hasRatio ? quickFlowCells(row.ratio) : 0;
    const colorEligible = Boolean(row.qualified && cells > 0 && ['buy', 'sell'].includes(semanticDirection));
    const direction = colorEligible ? semanticDirection : 'none';
    const width = hasRatio ? Math.abs(row.ratio) * 50 : 0;
    return Object.freeze({ pressure, state, side: row.side, direction, visualDirection: direction, semanticDirection, colorEligible, cells,
      ratio: hasRatio ? row.ratio : null, hasRatio, width,
      left: hasRatio && row.ratio < 0 ? 50 - width : 50,
      title: row.label + ' · 壓力比 ' + pressure + '（非勝率） · 視覺格數 ' + cells + '/4 · ' + state + ' · ' + row.side
        + (colorEligible ? '' : hasRatio ? ' · 方向色停用' : '') + ' · ' + stamp(row.sourceTime) + (row.reason ? ' · ' + row.reason : ''),
    });
  }

  function mountFlowQuick(root) {
    const stage = root.querySelector('.dw-chart-stage');
    if (!stage || root.querySelector('#home-flow-quick')) return;
    const strip = el('section', 'home-flow-quick', null, 'home-flow-quick');
    strip.setAttribute('aria-label', 'K線上方六時窗成交力道摘要');
    const heading = el('div', 'home-flow-quick-heading');
    heading.append(el('strong', '', '成交力道快看'), el('span', '', '近1分–4小時 · 與K線週期獨立'));
    const cells = el('div', 'home-flow-quick-cells');
    for (const original of root.querySelectorAll('.home-flow-table [data-flow-window]')) {
      const key = original.dataset.flowWindow;
      const button = el('button', 'home-flow-quick-button', null, 'home-flow-quick-' + key);
      button.type = 'button'; button.dataset.homeQuickKey = key;
      button.setAttribute('aria-controls', 'home-flow-selection'); button.setAttribute('aria-pressed', 'false');
      const top = el('span', 'home-flow-quick-top');
      top.append(el('span', 'home-flow-quick-label', original.querySelector('strong')?.textContent || original.textContent), el('strong', 'home-flow-quick-value', '—'));
      const segments = el('span', 'dw-flow-mini-bar home-flow-quick-segments'); segments.setAttribute('aria-hidden', 'true');
      segments.append(...Array.from({ length: 9 }, (_, index) => el('i', index === 4 ? 'is-neutral-cell' : '')));
      button.append(top, segments, el('span', 'home-flow-quick-state', '不可用'));
      // Keep the original control and handler. No cloned IDs or second data-flow-window.
      button.addEventListener('click', () => original.click());
      cells.append(button);
    }
    strip.append(heading, cells); stage.before(strip);
  }

  function renderFlowQuick(root, row, input, selected) {
    const button = root.querySelector('#home-flow-quick-' + row.key); if (!button) return;
    const view = quickFlowView(row, input);
    button.setAttribute('aria-pressed', String(row.key === selected));
    button.setAttribute('aria-label', view.title); button.title = view.title;
    button.dataset.state = row.available ? (row.qualified ? 'ready' : 'limited') : 'unavailable';
    button.dataset.direction = view.direction;
    button.querySelector('.home-flow-quick-value').textContent = view.pressure;
    button.querySelector('.home-flow-quick-state').textContent = view.state
      + (row.qualified ? ' · ' + row.side : view.hasRatio ? ' · 方向色停用' : '');
    const segments = button.querySelector('.home-flow-quick-segments');
    if (segments) {
      const classDirection = view.colorEligible ? (view.direction === 'buy' ? 'is-positive' : 'is-negative')
        : view.hasRatio ? 'is-neutral is-limited' : 'is-neutral is-inactive';
      segments.className = 'dw-flow-mini-bar home-flow-quick-segments ' + classDirection;
      segments.dataset.rawRatio = view.hasRatio ? String(view.ratio) : '';
      segments.dataset.displayCells = String(view.cells);
      const segmentCells = [...segments.children];
      for (let index = 0; index < segmentCells.length; index += 1) {
        const cell = segmentCells[index];
        cell.className = index === 4 ? 'is-neutral-cell' : '';
        const level = view.ratio > 0 ? index - 4 : 4 - index;
        const filled = view.hasRatio && index !== 4 && level >= 1 && level <= view.cells
          && ((view.ratio > 0 && index > 4) || (view.ratio < 0 && index < 4));
        if (filled) cell.className = 'is-filled is-level-' + level;
      }
    }
  }

  function mountEvidence(root) {
    if (root.dataset.homeEvidence === '2') return;
    root.dataset.homeEvidence = '2';
    const primary = root.querySelector('.tt-primary-grid'), observations = root.querySelector('.tt-flow-overview');
    if (primary && observations) primary.append(observations);
    const flow = root.querySelector('.dw-observed-flow'), details = root.querySelector('#home-flow-details');
    if (flow && details) {
      const oldSelected = root.querySelector('#dw-flow-selected-detail'); if (oldSelected) details.append(oldSelected);
      const heading = flow.querySelector('.home-flow-heading h3'); if (heading) heading.textContent = '六時窗成交觀測';
      const wrapper = el('div', 'home-comparison', null, 'home-flow-comparison');
      const table = el('table', 'home-flow-table'); table.setAttribute('aria-label', '六時窗成交觀測比較');
      const caption = el('caption', '', '滾動成交觀察窗，與K線聚合週期分開；重疊時窗不是獨立投票。');
      const thead = el('thead'), hr = el('tr');
      for (const [label, cls] of [['時窗',''],['成交壓力',''],['淨差','home-net-col'],['價格反應',''],['路徑效率','home-path-col'],['分類覆蓋','home-coverage-col'],['狀態','']]) {
        const th = el('th', cls, label); th.scope = 'col'; hr.append(th);
      }
      thead.append(hr); const body = el('tbody');
      for (const button of [...root.querySelectorAll('[data-flow-window]')]) {
        const key = button.dataset.flowWindow; if (key === 'tradingDay') continue;
        const row = el('tr'); row.dataset.homeWindow = key;
        const cell = el('th'); cell.scope = 'row';
        button.removeAttribute('role'); button.setAttribute('aria-controls', 'home-flow-selection'); button.tabIndex = 0;
        cell.append(button); row.append(cell);
        for (const [field, cls] of [['pressure',''],['net','home-net-col'],['response',''],['path','home-path-col'],['coverage','home-coverage-col'],['state','']]) {
          const td = el('td', cls, '—'); td.dataset.homeField = field; row.append(td);
        }
        row.addEventListener('click', event => { if (!event.target.closest('button')) button.click(); }); body.append(row);
      }
      table.append(caption, thead, body); wrapper.append(table); details.before(wrapper);
      const selection = el('section', 'home-flow-selection', null, 'home-flow-selection');
      selection.setAttribute('aria-label', '所選成交觀察窗的原始量與限制');
      selection.append(el('strong', '', '近5分・成交觀察窗', 'home-flow-selection-title'));
      const facts = el('dl', 'home-flow-facts');
      for (const [key,label] of [['buy','買方代理量'],['sell','賣方代理量'],['unknown','未知分類量'],['total','已收成交量'],['net','淨差'],['response','價格反應'],['path','路徑效率'],['coverage','分類覆蓋']]) {
        const field = el('div'); field.append(el('dt', '', label), el('dd', '', '—', 'home-flow-' + key)); facts.append(field);
      }
      selection.append(facts, el('p', 'home-flow-selection-note', '等待來源。', 'home-flow-selection-note'));
      details.before(selection); details.querySelector('summary').textContent = '所選時窗方法、來源與完整研究證據';
      const strip = root.querySelector('#dw-flow-window-strip'); if (strip) strip.setAttribute('aria-label', '未開放的觀察範圍');
    }
    mountFlowQuick(root);
    const rail = root.querySelector('.tt-tier-one-grid');
    if (rail) {
      const context = el('section', 'dw-card home-market-context', null, 'home-related-market');
      context.setAttribute('aria-labelledby', 'home-market-title');
      context.append(el('h3', '', '相關市場', 'home-market-title'), el('p', 'home-context-mode', '依各來源時間獨立呈現', 'home-context-mode'));
      const grid = el('dl', 'home-context-values');
      for (const [key,label] of [['spot','現貨參考'],['basis','期現貨差'],['rvol','相對量']]) {
        const row = el('div'); row.append(el('dt', '', label, 'home-context-'+key+'-label'), el('dd', '', '—', 'home-context-'+key)); grid.append(row);
      }
      context.append(grid, el('p', 'home-context-source', '', 'home-context-source'));
      const breadth = root.querySelector('#dw-pulse-breadth')?.closest('article');
      if (breadth) { breadth.hidden = false; breadth.classList.add('home-context-breadth'); context.append(breadth); }
      context.append(el('p', 'home-context-source', '廣度依下列來源日期，非一定與期貨同步。', 'home-breadth-note'));
      context.append(el('strong', 'home-context-heading', '指數貢獻', 'home-leadership-mode'), el('div', 'home-leader-rows', null, 'home-leader-rows'), el('p', 'home-context-source', '', 'home-leadership-source'));
      const link = el('button', 'home-link', '完整來源與相關市場資料'); link.type = 'button';
      link.addEventListener('click', () => { const background = root.querySelector('.tt-context-section'); if (background) { background.open = true; background.scrollIntoView({ block: 'start' }); background.querySelector('summary')?.focus({ preventScroll: true }); } });
      context.append(link); rail.append(context);
    }
  }

  function renderEvidence(root, input) {
    const rows = flowRows(input), selected = input.selectedFlowWindow || '5m';
    for (const value of rows) {
      renderFlowQuick(root, value, input, selected);
      const row = [...root.querySelectorAll('[data-home-window]')].find(n => n.dataset.homeWindow === value.key); if (!row) continue;
      row.classList.toggle('is-selected', value.key === selected); row.dataset.state = value.available ? (value.qualified ? 'ready' : 'limited') : 'unavailable';
      const button = row.querySelector('button'); if (button) { button.tabIndex = 0; button.setAttribute('aria-pressed', String(value.key === selected)); button.removeAttribute('aria-selected'); }
      const values = { pressure: metricText(value.ratio, 3, true), net: metricText(value.net, 0, true), response: value.response == null ? '—' : metricText(value.response, 0, true) + ' 點', path: metricText(value.efficiency, 3), coverage: value.coverage == null ? '—' : metricText(value.coverage * 100, 1) + '%', state: value.state };
      for (const [field, label] of Object.entries(values)) {
        const cell = row.querySelector('[data-home-field="'+field+'"]'); if (!cell) continue;
        cell.textContent = label; cell.title = field === 'pressure' ? value.side : value.reason || '';
      }
      row.title = value.label + ' · ' + value.state + ' · ' + (value.reason || '描述性觀測') + ' · ' + stamp(value.sourceTime);
    }
    const value = rows.find(row => row.key === selected);
    text('home-flow-selection-title', value ? '近' + value.label + '・成交觀察窗' : '觀察範圍尚未開放');
    for (const key of ['buy','sell','unknown','total','net','response','path','coverage']) {
      const v = key === 'path' ? value?.efficiency : value?.[key];
      text('home-flow-'+key, key === 'coverage' ? number(v) == null ? '—' : metricText(v * 100, 1) + '%' : metricText(v, key === 'path' ? 3 : 0, ['net','response'].includes(key)) + (key === 'response' && number(v) != null ? ' 點' : ''));
    }
    text('home-flow-selection-note', (value ? value.state + ' · ' + value.side + ' · ' + stamp(value.sourceTime) : '本交易日語意尚未開放。') + '；分類覆蓋不等於收集完整率。');
    const context = marketContext(input);
    text('home-context-mode', context.night ? '夜盤・現貨收盤背景，非同步即時現貨' : '日盤・每項依來源時間與品質呈現');
    text('home-context-spot-label', context.night ? '現貨收盤參考' : '現貨指數');
    text('home-context-basis-label', context.basisLabel);
    text('home-context-spot', metricText(context.spot, 2));
    text('home-context-basis', context.basis == null ? '—' : metricText(context.basis, 2, true) + ' 點');
    text('home-context-rvol', context.rvol == null ? '—' : metricText(context.rvol, 2) + '×');
    text('home-context-source', (context.sourceTime ? '期貨來源 ' + stamp(context.sourceTime) : '期現／相對量暫無合格資料') + (context.spotDate ? ' · 現貨資料日 ' + context.spotDate : '') + ' · ' + context.rvolDetail);
    const market = root.querySelector('#home-related-market');
    if (market) market.title = [context.basisReason, context.leadershipReason].filter(Boolean).join(' · ');
    const breadth = root.querySelector('.home-context-breadth');
    if (breadth) breadth.hidden = Boolean(input.dashboardError || input.chart?.mode !== 'LIVE');
    text('home-breadth-note', input.dashboardError ? '廣度背景更新中斷，原始狀態見資料詳情。' : '廣度依其來源日期，不保證與期貨同步。');
    text('home-leadership-mode', context.leadershipMode);
    const leaders = root.querySelector('#home-leader-rows');
    if (leaders) {
      const items = context.leaders.map(row => { const item = el('div'); item.append(el('span', '', row.name), el('strong', '', metricText(row.points, 2, true) + ' 點')); return item; });
      leaders.replaceChildren(...(items.length ? items : [el('p', '', '沒有可呈現的合格貢獻資料。')]));
    }
    text('home-leadership-source', context.leadershipDate ? context.leadershipDate + ' · ' + stamp(context.leadershipTime) + ' · 描述性資料，非方向確認' : '來源日期未知，不補造股票或貢獻值。');
  }

  const el = (tag, className, text, id) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; if (id) n.id = id; return n; };
  const text = (id, value) => { const n = document.getElementById(id); if (n && n.textContent !== String(value)) n.textContent = String(value); };
  function disclosure(id, label, className = '') { const n = el('details', className, null, id); n.append(el('summary', '', label)); return n; }
  const layoutEvent = () => global.dispatchEvent(new CustomEvent('trader-terminal:chart-layout', { detail: { homeLayout: true } }));

  function navigation(root) {
    const layout = root.closest('.workspace-layout'), nav = document.getElementById('side-nav');
    const dashboard = document.getElementById('dashboard-view');
    if (!layout || !nav || !dashboard || document.getElementById('home-nav-toggle')) return;
    layout.classList.add('home-layout'); dashboard.classList.add('home-dashboard');
    const toggle = el('button', 'home-menu-toggle', '☰', 'home-nav-toggle'); toggle.type = 'button';
    toggle.setAttribute('aria-controls', nav.id); toggle.setAttribute('aria-label', '展開主選單');
    const bar = dashboard.querySelector('.topbar'); (bar || dashboard).prepend(toggle);
    const scrim = el('button', 'home-nav-scrim', '', 'home-nav-scrim'); scrim.type = 'button'; scrim.tabIndex = -1; scrim.setAttribute('aria-label', '關閉主選單'); dashboard.append(scrim);
    const narrow = global.matchMedia('(max-width: 767px)'), key = 'twchip.home.navigation.v1';
    let desktopOpen = false, open = false, previousInert = false;
    try { if (document.documentElement.dataset.guestReadOnly !== 'true') desktopOpen = global.localStorage.getItem(key) === 'open'; } catch { /* Optional presentation preference. */ }
    const pages = layout.querySelector('.dashboard-pages');
    function apply(value, { persist = false, focus = false } = {}) {
      const wasModal = open && nav.getAttribute('aria-modal') === 'true';
      open = Boolean(value);
      if (persist && !narrow.matches) {
        desktopOpen = open;
        try { if (document.documentElement.dataset.guestReadOnly !== 'true') global.localStorage.setItem(key, open ? 'open' : 'closed'); } catch { /* No credential storage. */ }
      }
      layout.classList.toggle('is-nav-collapsed', !open); nav.hidden = !open;
      layout.dataset.homeNav = open ? 'open' : 'closed';
      toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? '隱藏主選單' : '展開主選單');
      toggle.title = open ? '隱藏主選單' : '展開主選單';
      const modal = narrow.matches && open; scrim.hidden = !modal;
      if (modal) { nav.setAttribute('role', 'dialog'); nav.setAttribute('aria-modal', 'true'); }
      else { nav.removeAttribute('role'); nav.removeAttribute('aria-modal'); }
      if (pages) { if (modal && !wasModal) previousInert = pages.inert; pages.inert = modal ? true : wasModal ? previousInert : pages.inert; }
      const close = document.getElementById('side-nav-toggle');
      if (close) { close.setAttribute('aria-expanded', String(open)); close.title = '隱藏主選單'; const b = close.querySelector('b'); if (b) b.textContent = '隱藏選單'; }
      if (!open && nav.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      if (focus) { if (modal) (nav.querySelector('button:not([disabled])') || nav).focus(); else if (!open) toggle.focus({ preventScroll: true }); }
      layoutEvent();
    }
    toggle.addEventListener('click', () => apply(!open, { persist: true, focus: true }));
    document.getElementById('side-nav-toggle')?.addEventListener('click', () => apply(false, { persist: true, focus: true }));
    scrim.addEventListener('click', () => apply(false, { focus: true }));
    nav.addEventListener('click', event => { if (narrow.matches && event.target.closest('[data-dashboard-page]')) apply(false, { focus: true }); });
    dashboard.addEventListener('keydown', event => {
      if (!open || !narrow.matches) return;
      if (event.key === 'Escape') { event.preventDefault(); apply(false, { focus: true }); return; }
      if (event.key !== 'Tab') return;
      const targets = [...nav.querySelectorAll('button:not([disabled]),a[href],summary')].filter(n => n.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !nav.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !nav.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    narrow.addEventListener('change', () => apply(narrow.matches ? false : desktopOpen));
    apply(narrow.matches ? false : desktopOpen);
  }

  // Research features are deliberately NOT connected to the production decision engine.
  // UI previews the pending evidence stages, never synthesizes Depth/EV/No-Chase signals.
  function mountResearchDrawer(root) {
    const primary = root.querySelector('.tt-primary-grid');
    if (!primary || root.querySelector('#home-research-drawer')) return;
    const panel = disclosure('home-research-drawer', '', 'home-research-drawer');
    panel.dataset.researchOnly = 'true';
    panel.setAttribute('aria-label', '研究預覽，尚未產生交易訊號');
    const summary = panel.querySelector('summary');
    const heading = el('span', 'home-research-heading');
    heading.append(el('span', 'home-research-kicker', 'RESEARCH DESK · 研究工作區'),
      el('strong', 'home-research-title', '從盤中觀察到可驗證決策'));
    summary.append(heading, el('span', 'home-research-summary-state', '4 項研究 · 不作交易訊號'));
    const grid = el('div', 'home-research-grid', null, 'home-research-grid');
    for (const [key, label, stage, detail] of [
      ['depth', '五檔流動性', '待全日資料資格',
        '研究樣本已見五檔欄位；當前深度與全時段連續性尚未取得資格。'],
      ['flow', 'Flow × 價格反應', '方向資格待確認',
        '推進／受阻只是候選研究；必須同窗、同截止與來源品質合格。'],
      ['state', '市場狀態／不追價', '分類規則待校準',
        '趨勢、盤整與流動性風險，須用當下已知資料完成樣本外驗證。'],
      ['outcome', 'Outcome／EV', '待前向結果',
        'MFE／MAE、出場失效及扣成本 EV 未完成；不展示虛構績效。'],
    ]) {
      const article = el('article', 'home-research-card');
      article.dataset.researchModule = key;
      const head = el('div', 'home-research-card-head');
      head.append(el('strong', 'home-research-card-title', label),
        el('span', 'home-research-card-stage', stage, 'home-research-' + key + '-status'));
      article.append(head, el('p', 'home-research-card-note', detail));
      grid.append(article);
    }
    panel.append(grid, el('p', 'home-research-boundary',
      '研究候選／資料稽核 ≠ 已確認方向、正 EV 或下單授權。完整證據請以研究 PR 與驗收紀錄為準。'));
    primary.after(panel);
  }

  function renderResearchDrawer(root, input) {
    const panel = root.querySelector('#home-research-drawer');
    if (!panel) return;
    const selected = (flowRows(input) || []).find(row => row.key === (input.selectedFlowWindow || '5m'));
    const sourceQualified = Boolean(selected?.qualified);
    panel.dataset.flowQuality = sourceQualified ? 'observed-qualified' : 'limited';
    text('home-research-flow-status', sourceQualified
      ? '僅資料合格 · 候選待驗證'
      : '資料受限 · 不推論方向');
  }

  function mount(root) {
    if (!root || root.dataset.homeVersion === '1') return;
    const focus = root.querySelector('#dw-focus-mode'), primary = root.querySelector('.tt-primary-grid');
    if (!focus || !primary) return;
    root.dataset.homeVersion = '1'; navigation(root);
    const appBar = document.querySelector('#dashboard-view > .topbar'), actions = appBar?.querySelector('.top-actions');
    if (actions && !appBar.querySelector('.home-app-actions')) {
      const settings = disclosure('home-app-actions', '設定與操作', 'home-app-actions'); actions.before(settings); settings.append(actions);
    }
    const banner = el('section', 'home-banner', null, 'home-banner'); banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
    banner.append(el('strong', '', '資料準備中', 'home-status'), el('p', '', '尚未取得完整資料，不提供當下判讀。', 'home-impact'));
    const mobileFocus = el('p', 'home-mobile-focus', '暫停當下判讀', 'home-mobile-focus'); primary.before(mobileFocus);
    const inspect = el('button', 'home-link', '資料詳情'); inspect.type = 'button'; banner.append(inspect); primary.before(banner);
    const raw = disclosure('home-data-details', '資料品質與技術詳情', 'home-disclosure');
    raw.append(el('p', '', '原始原因與來源狀態；未知原因不作推測。'), el('pre', 'home-raw', '', 'home-raw-status'));
    const summary = root.querySelector('.tt-summary-line'); if (summary) raw.append(summary);
    const topDetails = root.querySelector('.tt-top-details'); if (topDetails) raw.append(topDetails);
    for (const id of ['dw-event-risk-state']) { const metric = root.querySelector('#'+id)?.closest('article'); if (metric) raw.append(metric); }
    const health = root.querySelector('.dw-data-health'); if (health) raw.append(health);
    focus.append(raw);
    inspect.addEventListener('click', () => { raw.open = true; raw.scrollIntoView({ block: 'start' }); raw.querySelector('summary').focus({ preventScroll: true }); });
    const pulse = root.querySelector('.dw-market-pulse'), context = root.querySelector('.tt-context-section');
    if (pulse && context) context.append(pulse); // Keep original IDs, renderers and data in details.
    const forward = root.querySelector('#dw-forward-status'); if (forward && context) context.append(forward);
    const focusCard = root.querySelector('.tt-focus-card');
    if (focusCard) {
      const conclusion = el('div', 'home-focus-intro');
      conclusion.append(el('strong', '', '暫停當下判讀', 'home-focus-title'), el('p', '', '先核對資料狀態。', 'home-focus-message'));
      focusCard.querySelector('#dw-next-watch').before(conclusion);
      const empty = el('p', 'home-focus-empty', '目前不提供 R:R；缺少合格資料或當下條件。', 'home-focus-empty');
      focusCard.querySelector('#dw-next-watch-detail')?.before(empty);
    }
    const stage = root.querySelector('.dw-chart-stage');
    if (stage) {
      stage.append(el('div', 'home-chart-notice', '尚未確認資料時間', 'home-chart-notice'));
      const legend = stage.querySelector('#dw-chart-crosshair'); if (legend) stage.after(legend);
    }
    const flow = root.querySelector('.dw-observed-flow');
    if (flow) {
      const selected = flow.querySelector('#dw-flow-selected-detail');
      const details = disclosure('home-flow-details', '多週期與研究證據', 'home-disclosure');
      for (const node of [...flow.children]) if (node !== selected) details.append(node);
      const selectedReason = selected?.querySelector('#dw-flow-selected-reason'); if (selectedReason) details.append(selectedReason);
      const strip = root.querySelector('#dw-flow-window-strip'); if (strip) details.insertBefore(strip, details.children[1] || null);
      const heading = el('header', 'home-flow-heading'); heading.append(el('h3', '', '成交力道'), el('span', '', '暫不可用', 'home-flow-state'));
      const note = el('p', 'home-flow-message', '等待合格資料。', 'home-flow-message');
      flow.append(heading, note); if (selected) flow.append(selected); flow.append(details);
    }
    const ask = root.querySelector('.tt-ai-workspace .dw-gpt-panel');
    if (ask) {
      const ai = disclosure('home-ai', 'AI 輔助', 'home-disclosure home-ai-disclosure');
      ai.querySelector('summary').append(el('span', '', '按需展開・不會自動送出', 'home-ai-summary'));
      ask.before(ai); ai.append(ask);
    }
    const links = el('div', 'home-quick-links');
    for (const [label, selector] of [['記錄本次觀察', '.dw-journal-bar'], ['研究背景', '.tt-context-section'], ['資料品質詳情', '#home-data-details']]) {
      const target = root.querySelector(selector); if (!target) continue;
      const button = el('button', 'home-link', label); button.type = 'button';
      button.addEventListener('click', () => {
        for (let node = target; node && node !== root; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
        target.scrollIntoView({ block: 'start' }); const field = target.querySelector('input,summary,button'); field?.focus({ preventScroll: true });
      }); links.append(button);
    }
    root.querySelector('.tt-ai-workspace')?.after(links);
    const topPrice = document.getElementById('tt-top-price'); if (topPrice) topPrice.before(el('small', 'home-price-caption', '成交價', 'home-price-caption'));
    const recency = document.getElementById('tt-top-updated')?.previousElementSibling; if (recency) recency.textContent = '資料時間';
    const chartTitle = root.querySelector('#tt-chart-title') || root.querySelector('.dw-chart-header h2'); if (chartTitle) chartTitle.textContent = '決策圖表';
    mountEvidence(root);
    mountResearchDrawer(root);
    aiSummary();
  }

  function aiSummary() {
    const root = document.getElementById('home-ai-summary'); if (!root) return;
    const $ = id => document.getElementById(id);
    const busy = $('ai-inline')?.getAttribute('aria-busy') === 'true';
    const model = $('ai-model')?.value ? $('ai-model').selectedOptions?.[0]?.textContent : '尚未選擇模型';
    const account = $('ai-account')?.value ? '帳號已連接' : '帳號狀態待確認';
    const phase = $('ai-status')?.dataset.phase;
    root.textContent = busy ? '分析處理中・收合不會取消' : ['FAILED', 'INTERRUPTED', 'TIMED_OUT'].includes(phase) ? '上次操作未完成・展開查看' : account + ' · ' + model;
  }

  function render(root, input) {
    if (!root || root.dataset.homeVersion !== '1') return null;
    const view = derive(input); root.dataset.homeTone = view.tone; root.dataset.homeFocus = view.focus;
    root.dataset.homeChart = view.chartCurrent ? 'current' : 'snapshot'; root.dataset.homeFlow = view.flowCurrent ? 'available' : 'unavailable';
    text('home-status', view.status); text('home-impact', view.message); text('home-raw-status', view.raw || '尚無額外技術原因。');
    text('home-focus-title', view.focusTitle); text('home-focus-message', view.focusMessage);
    text('home-mobile-focus', '當下焦點：' + view.focusTitle + '。條件與限制見圖表下方。');
    for (const side of ['long', 'short']) {
      const row = root.querySelector('#dw-' + side + '-target')?.closest('.dw-scenario-row');
      const target = input.watch?.scenarioWatch?.[side]?.target;
      if (row) row.hidden = view.focus !== 'active' || !target || number(target.price) === null;
    }
    text('home-flow-state', view.flowLabel); text('home-flow-message', view.flowMessage + ' 最後來源：' + view.flowTime);
    text('home-price-caption', view.priceLabel); text('tt-top-price', view.price); text('tt-top-contract', input.chart?.actualContract ? '台指期貨 ' + input.chart.actualContract : '台指期貨');
    text('tt-top-session', [input.chart?.tradeDate, ({ DAY: '日盤', NIGHT: '夜盤' })[input.chart?.session] || input.chart?.session].filter(Boolean).join(' · ') || '盤別尚未確認');
    text('tt-top-trust', view.status); text('tt-top-updated', view.chartTime);
    text('dw-chart-mode', (view.chartCurrent ? '觀察模式' : '非即時') + ' · ' + (input.chart?.timeframe || '—') + ' · 只讀');
    text('dw-chart-status', view.chartLabel); text('home-chart-notice', view.chartCurrent ? '' : view.chartLabel + ' · 截至 ' + view.chartTime);
    const notice = document.getElementById('home-chart-notice'); if (notice) notice.hidden = view.chartCurrent || !view.hasChart;
    const badge = document.getElementById('dw-chart-status');
    if (badge) { badge.dataset.sourceStatus = input.chart?.status || 'UNAVAILABLE'; badge.dataset.homeLabel = view.chartLabel; badge.className = 'dw-status-pill ' + (view.chartQualified ? 'is-ready' : 'is-unavailable'); }
    const price = document.getElementById('tt-top-price'); if (price) { price.classList.toggle('is-unavailable', !view.chartCurrent); price.setAttribute('aria-label', view.priceLabel + ' ' + view.price + '，' + view.chartTime); }
    const trust = document.getElementById('tt-top-trust'); if (trust) trust.className = 'dw-status-pill home-trust';
    for (const id of ['dw-chart-quality', 'dw-chart-available-at']) text(id, id.endsWith('quality') ? (view.chartQualified ? '資料合格' : '資料受限／未確認') : view.chartTime);
    // Original technical values stay available in their existing detail containers.
    renderEvidence(root, input);
    renderResearchDrawer(root, input);
    aiSummary(); return view;
  }
  global.HomeWorkspace = Object.freeze({ derive, flowRows, quickFlowView, quickFlowCells, marketContext, mount, render, aiSummary });
})(window);
