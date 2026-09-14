(function traderTerminalShellBootstrap(global) {
  'use strict';

  const PALETTES = Object.freeze({
    'red-up': Object.freeze({ label: '台股（紅漲綠跌）', up: '#ff6b6b', down: '#37d67a', upSoft: '#ff9aa0', upStrong: '#b92e3b', downSoft: '#87dfb7', downStrong: '#197c55', upVolume: 'rgba(255,107,107,.34)', downVolume: 'rgba(55,214,122,.34)' }),
    'green-up': Object.freeze({ label: '國際（綠漲紅跌）', up: '#37d67a', down: '#ff6b6b', upSoft: '#87dfb7', upStrong: '#197c55', downSoft: '#ff9aa0', downStrong: '#b92e3b', upVolume: 'rgba(55,214,122,.34)', downVolume: 'rgba(255,107,107,.34)' }),
  });
  const STORAGE_KEY = 'trader-terminal-candle-palette';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function appendMetric(parent, label, id, initial = 'UNAVAILABLE', subtitle = '') {
    const metric = element('article', 'tt-metric');
    const labelNode = element('span', '', label);
    metric.append(labelNode);
    if (subtitle) metric.append(element('small', 'tt-metric-subtitle', subtitle));
    metric.append(Object.assign(element('strong', '', initial), { id }));
    parent.append(metric);
    return metric;
  }

  function card(key, eyebrow, title, subtitle, mainId, interpretation, state = 'UNAVAILABLE') {
    const node = element('section', `dw-card tt-card tt-card-${key}`);
    node.dataset.terminalCard = key;
    const heading = element('header', 'tt-card-heading');
    const copy = element('div');
    copy.append(element('p', 'eyebrow', eyebrow), element('h3', '', title), element('small', 'tt-card-subtitle', subtitle));
    const trust = element('span', 'dw-status-pill is-unavailable', state);
    trust.id = `tt-${key}-trust`;
    heading.append(copy, trust);
    const answer = element('strong', 'tt-main-answer', 'UNAVAILABLE');
    answer.id = mainId;
    const visual = element('div', 'tt-primary-viz');
    visual.id = `tt-${key}-viz`;
    const values = element('div', 'tt-card-values');
    values.id = `tt-${key}-values`;
    visual.append(values);
    const note = element('p', 'tt-interpretation', interpretation);
    note.id = `tt-${key}-interpretation`;
    const more = element('button', 'tt-more', '更多 >');
    more.type = 'button';
    more.dataset.terminalDrawerSource = `[data-terminal-card="${key}"]`;
    more.dataset.terminalDrawerTitle = title;
    node.append(heading, answer, visual, note, more);
    return node;
  }

  function summaryLine() {
    const line = element('details', 'tt-summary-line');
    line.setAttribute('aria-label', '市場摘要 Market Summary');
    const toggle = element('summary', 'tt-summary-toggle');
    toggle.append(
      element('strong', '', '資料狀態'),
      Object.assign(element('span', '', '正常項目已收合'), { id: 'tt-summary-exception' }),
    );
    const metrics = element('div', 'tt-summary-metrics');
    const labels = [
      ['價格', 'Price', 'tt-summary-price'],
      ['趨勢強度', 'Strength', 'tt-summary-strength'],
      ['VWAP', 'VWAP', 'tt-summary-vwap'],
      ['市場參與', 'Breadth', 'tt-summary-breadth'],
      ['期貨流向', 'Flow', 'tt-summary-flow'],
      ['風險衝突', 'Risk', 'tt-summary-risk'],
    ];
    labels.forEach(([label, subtitle, id], index) => {
      const metric = appendMetric(metrics, label, id, label === '趨勢強度' ? 'RESEARCH_PENDING' : 'UNAVAILABLE', subtitle);
      metric.classList.add('tt-ribbon-item');
      metric.dataset.ribbonIndex = String(index);
    });
    line.append(toggle, metrics);
    return line;
  }

  function terminalTopbar(root) {
    const heading = root.querySelector('.dw-page-heading');
    if (!heading || heading.classList.contains('tt-terminal-topbar')) return heading;
    const modeSwitch = heading.querySelector('.dw-mode-switch');
    heading.className = 'tt-terminal-topbar';
    const identity = element('div', 'tt-market-identity');
    identity.append(
      Object.assign(element('strong', '', '台指期貨'), { id: 'tt-top-contract' }),
      Object.assign(element('b', '', 'LOADING'), { id: 'tt-top-price' }),
      Object.assign(element('span', 'tt-top-session-main', 'Session UNAVAILABLE'), { id: 'tt-top-session' }),
      Object.assign(element('span', 'dw-status-pill is-unavailable', 'UNAVAILABLE'), { id: 'tt-top-trust' }),
    );
    const facts = element('div', 'tt-top-facts');
    for (const [label, id] of [
      ['漲跌', 'tt-top-change'], ['成交量', 'tt-top-volume'], ['OI', 'tt-top-oi'], ['基差', 'tt-top-basis'],
    ]) facts.append(compactMetric(label, id));
    const details = element('details', 'tt-top-details');
    details.append(element('summary', '', '次要資料 / Detail'));
    const status = element('div', 'tt-top-detail-body');
    status.append(facts,
      Object.assign(element('small', '', '更新 LOADING'), { id: 'tt-top-updated' }),
      element('span', 'tt-descriptive-only', 'DESCRIPTIVE ONLY'),
      element('span', 'tt-no-signal', 'NOT A TRADING SIGNAL'),
    );
    if (modeSwitch) status.append(modeSwitch);
    details.append(status);
    heading.replaceChildren(identity, details);
    return heading;
  }

  function terminalNavigation(root) {
    const formalLayout = root.closest('.workspace-layout');
    const formal = formalLayout?.querySelector('.side-nav');
    if (formal) {
      formalLayout.classList.add('tt-terminal-layout');
      formal.classList.add('tt-terminal-nav');
      formal.querySelectorAll('.side-nav-button').forEach((button, index) => {
        const icon = button.querySelector('.side-nav-index');
        if (icon) icon.textContent = ['▥', '⌁', '↕', '◉', '⌁', '◎', '▤'][index] || '•';
      });
      return formal;
    }
    if (root.parentElement?.classList.contains('tt-terminal-frame')) return root.parentElement.querySelector('.tt-terminal-nav');
    const frame = element('div', 'tt-terminal-frame');
    const nav = element('nav', 'tt-terminal-nav tt-terminal-nav-fallback');
    nav.setAttribute('aria-label', 'Trader Terminal 導覽');
    const items = [
      ['▥', '總覽'], ['⌁', '行情'], ['↕', '期貨'], ['◉', '選擇權'],
      ['⌁', '策略'], ['◎', '觀察'], ['▤', '報表'], ['⚙', '設定'],
    ];
    items.forEach(([icon, label], index) => {
      const button = element('button', `tt-terminal-nav-item${index === 0 ? ' is-selected' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-disabled', index === 0 ? 'false' : 'true');
      button.disabled = index !== 0;
      button.append(element('span', '', icon), element('b', '', label));
      nav.append(button);
    });
    root.parentNode.insertBefore(frame, root);
    frame.append(nav, root);
    return nav;
  }

  function insertVisual(cardNode, visualNode) {
    const visual = cardNode.querySelector('.tt-primary-viz');
    visual.insertBefore(visualNode, visual.querySelector('.tt-card-values'));
    return visualNode;
  }

  function compactMetric(label, id, value = 'LOADING', subtitle = '') {
    const metric = element('article', 'tt-compact-metric');
    metric.append(element('span', '', label), Object.assign(element('strong', '', value), { id }));
    if (subtitle) metric.append(element('small', '', subtitle));
    return metric;
  }

  function metricGroup(title, className = '') {
    const group = element('section', `tt-metric-group ${className}`.trim());
    group.append(element('h4', '', title));
    const body = element('div', 'tt-metric-group-body');
    group.append(body);
    return { group, body };
  }

  function trackRow(label, id, state = 'UNAVAILABLE') {
    const row = element('article', 'tt-track-row');
    row.id = id;
    const heading = element('header');
    heading.append(element('span', '', label), element('strong', '', state));
    const track = element('div', 'tt-empty-track');
    track.setAttribute('aria-label', `${label} visual track; no score implied`);
    track.append(element('i'));
    row.append(heading, track);
    return row;
  }

  function miniBars(className = '') {
    const chart = element('div', `tt-mini-bars ${className}`.trim());
    chart.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 14; index += 1) chart.append(element('i'));
    return chart;
  }

  function miniSeries(id, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = id;
    svg.classList.add('tt-mini-series');
    if (className) className.split(/\s+/).filter(Boolean).forEach((name) => svg.classList.add(name));
    svg.setAttribute('viewBox', '0 0 100 34');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    baseline.setAttribute('class', 'tt-series-baseline');
    baseline.setAttribute('x1', '0'); baseline.setAttribute('x2', '100');
    baseline.setAttribute('y1', '27'); baseline.setAttribute('y2', '27');
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    area.setAttribute('class', 'tt-series-area');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('class', 'tt-series-line');
    svg.append(baseline, area, line);
    return svg;
  }

  function buildTrendVisual(cardNode) {
    const overview = element('div', 'tt-compact-metrics tt-trend-overview');
    overview.append(
      compactMetric('方向', 'tt-trend-direction'),
      compactMetric('強度', 'tt-trend-strength', 'RESEARCH_PENDING'),
      compactMetric('強度變化', 'tt-trend-change'),
    );
    const factors = element('div', 'tt-track-list tt-trend-factors');
    for (const [label, id, state] of [
      ['價格結構', 'tt-trend-price-track', 'RESEARCH_PENDING'],
      ['VWAP 控制', 'tt-trend-vwap-track', 'RESEARCH_PENDING'],
      ['路徑效率', 'tt-trend-path-track', 'RESEARCH_PENDING'],
      ['市場廣度', 'tt-trend-breadth-track', 'UNAVAILABLE'],
      ['領導強度', 'tt-trend-leadership-track', 'NOT_REQUESTED'],
      ['期貨流向', 'tt-trend-futures-track', 'UNAVAILABLE'],
    ]) factors.append(trackRow(label, id, state));
    const detail = cardNode.querySelector('.tt-card-values');
    detail.append(element('span', 'tt-detail-only', '回檔品質 Pullback Quality · RESEARCH_PENDING'));
    insertVisual(cardNode, overview);
    insertVisual(cardNode, factors);
  }

  function buildFuturesVisual(cardNode) {
    const price = metricGroup('PRICE', 'tt-futures-price-group');
    price.body.append(
      compactMetric('TX', 'tt-futures-tx'),
      compactMetric('VWAP 關係', 'tt-futures-vwap'),
      compactMetric('基差', 'tt-futures-basis'),
    );
    const positions = metricGroup('POSITION / CONTEXT', 'tt-futures-position-group');
    positions.body.append(
      compactMetric('外資', 'tt-futures-foreign'),
      compactMetric('自營商', 'tt-futures-dealer'),
      compactMetric('投信', 'tt-futures-trust-position'),
    );
    const oi = metricGroup('OI', 'tt-futures-oi-group');
    oi.body.append(compactMetric('未平倉量', 'tt-futures-oi'), compactMetric('OI 變化', 'tt-futures-oi-change'));
    insertVisual(cardNode, price.group);
    insertVisual(cardNode, positions.group);
    insertVisual(cardNode, oi.group);
    const fixtureBars = miniBars('tt-futures-bars tt-fixture-only');
    fixtureBars.setAttribute('aria-label', 'Fixture-only futures visual; no production series contract');
    insertVisual(cardNode, fixtureBars);
  }

  function buildOptionsVisual(cardNode) {
    const layout = element('div', 'tt-options-layout');
    const ring = element('div', 'tt-ring tt-options-ring');
    const center = element('div', 'tt-ring-center');
    center.append(element('span', '', 'OI 結構'), Object.assign(element('strong', '', 'LOADING'), { id: 'tt-options-ring-value' }));
    ring.append(center);
    const metrics = element('div', 'tt-options-metrics');
    for (const [label, id] of [['Call Wall', 'tt-options-call'], ['Put Wall', 'tt-options-put'], ['Max Pain', 'tt-options-max-pain'], ['OI Context', 'tt-options-oi']]) {
      metrics.append(compactMetric(label, id));
    }
    layout.append(metrics, ring);
    insertVisual(cardNode, layout);
  }

  function buildBreadthVisual(cardNode) {
    const metrics = element('div', 'tt-compact-metrics tt-breadth-metrics');
    metrics.append(compactMetric('上漲', 'tt-breadth-up'), compactMetric('平盤', 'tt-breadth-flat'), compactMetric('下跌', 'tt-breadth-down'));
    const participation = element('div', 'tt-participation-bar');
    participation.setAttribute('aria-label', '市場參與度 visual placeholder; unavailable does not mean zero');
    participation.append(element('i', 'is-up'), element('i', 'is-flat'), element('i', 'is-down'));
    const context = element('div', 'tt-compact-metrics tt-breadth-context');
    const strength = compactMetric('參與強度', 'tt-breadth-strength', 'RESEARCH_PENDING');
    strength.classList.add('tt-detail-only');
    context.append(compactMetric('漲跌比', 'tt-breadth-ratio'), strength);
    const seriesWrap = element('div', 'tt-series-block tt-breadth-series-block tt-detail-only');
    seriesWrap.append(element('span', '', '盤中參與趨勢'), miniSeries('tt-breadth-series', 'is-unavailable'));
    insertVisual(cardNode, metrics);
    insertVisual(cardNode, participation);
    insertVisual(cardNode, context);
    insertVisual(cardNode, seriesWrap);
  }

  function buildGlobalVisual(cardNode) {
    const tiles = element('div', 'tt-global-tiles');
    for (let index = 1; index <= 6; index += 1) {
      const tile = element('article', 'tt-global-tile');
      const change = element('div', 'tt-global-change-row');
      change.append(
        Object.assign(element('small', '', 'UNAVAILABLE'), { id: `tt-global-change-${index}` }),
        element('em', 'tt-global-data-kind', 'LATEST VALUE ONLY'),
      );
      tile.append(
        Object.assign(element('span', '', `來源 ${index}`), { id: `tt-global-name-${index}` }),
        Object.assign(element('strong', '', 'LOADING'), { id: `tt-global-price-${index}` }),
        change,
        miniSeries(`tt-global-series-${index}`, 'tt-global-mini is-unavailable tt-fixture-only'),
      );
      tiles.append(tile);
    }
    insertVisual(cardNode, tiles);
  }

  function ensureRiskArchitecture(node) {
    if (!node || node.querySelector('.tt-risk-layout')) return;
    const layout = element('div', 'tt-risk-layout');
    const ring = element('div', 'tt-ring tt-risk-ring');
    const center = element('div', 'tt-ring-center');
    center.append(Object.assign(element('strong', '', 'LOADING'), { id: 'tt-risk-ring-value' }), Object.assign(element('span', '', 'UNAVAILABLE'), { id: 'tt-risk-ring-state' }));
    ring.append(center);
    const states = element('div', 'tt-risk-states tt-detail-only');
    for (const [label, id] of [
      ['波動風險', 'tt-risk-volatility'], ['流動性風險', 'tt-risk-liquidity'],
      ['事件風險', 'tt-risk-event'], ['市場廣度壓力', 'tt-risk-breadth'],
    ]) {
      const metric = compactMetric(label, id);
      metric.classList.add('tt-risk-metric');
      metric.append(element('i', 'tt-risk-indicator'));
      states.append(metric);
    }
    const trend = element('div', 'tt-series-block tt-risk-series-block tt-detail-only');
    trend.append(element('span', '', 'Risk Trend'), miniSeries('tt-risk-series', 'tt-risk-trend is-unavailable'));
    layout.append(ring, states, trend);
    const axis = node.querySelector('.dw-conflict-axis-grid');
    if (axis) node.insertBefore(layout, axis);
    else node.append(layout);
  }

  function ensureLeadershipArchitecture(node) {
    if (!node || node.querySelector('.tt-contribution-placeholder') || node.querySelector('#dw-leadership-positive')) return;
    const layout = element('div', 'tt-contribution-placeholder');
    for (const [title, tone, prefix] of [['正貢獻 TOP 5', 'is-positive', 'positive'], ['負貢獻 TOP 5', 'is-negative', 'negative']]) {
      const group = element('section', `tt-contribution-group ${tone}`);
      group.append(element('h4', '', title));
      for (let index = 1; index <= 5; index += 1) {
        const row = trackRow('資料不可用', `tt-contribution-${prefix}-${index}`, 'UNAVAILABLE · LEADERSHIP_DOM_MISSING');
        group.append(row);
      }
      layout.append(group);
    }
    const net = element('div', 'tt-contribution-net');
    net.append(element('span', '', '淨貢獻'), Object.assign(element('strong', '', 'UNAVAILABLE · LEADERSHIP_DOM_MISSING'), { id: 'tt-contribution-net' }));
    layout.append(net);
    const bars = node.querySelector('.dw-leadership-bars');
    if (bars) bars.replaceWith(layout);
    else node.append(layout);
  }

  function relabelExistingCard(node, title, subtitle, eyebrow) {
    if (!node) return;
    const heading = node.querySelector('header > div') || node.querySelector('.dw-section-heading > div');
    const titleNode = heading?.querySelector('h2, h3');
    const eyebrowNode = heading?.querySelector('.eyebrow');
    if (titleNode) titleNode.textContent = title;
    if (eyebrowNode) {
      eyebrowNode.textContent = eyebrow || '';
      eyebrowNode.hidden = !eyebrow;
    }
    if (heading && !heading.querySelector('.tt-card-subtitle')) heading.append(element('small', 'tt-card-subtitle', subtitle));
  }

  function chartControls(root) {
    const toolbar = root.querySelector('.dw-chart-toolbar');
    if (!toolbar || toolbar.querySelector('.tt-chart-actions')) return;
    const actions = element('div', 'tt-chart-actions');
    const expand = element('button', 'tt-expand-chart', '⛶ 放大圖表');
    expand.type = 'button';
    expand.id = 'tt-chart-expand';
    const levels = element('button', 'tt-level-toggle', '顯示參考線');
    levels.type = 'button';
    levels.id = 'tt-level-toggle';
    levels.setAttribute('aria-pressed', 'false');
    actions.append(levels, expand);
    toolbar.append(actions);
    for (const id of ['dw-prior-levels', 'dw-or-state']) {
      root.querySelector(`#${id}`)?.closest('article')?.classList.add('tt-optional-level');
    }
    const stage = root.querySelector('.dw-chart-stage');
    if (stage && !root.querySelector('#dw-chart-crosshair')) {
      const crosshair = element('div', 'dw-chart-crosshair tt-chart-legend', '移到 K 棒查看目前／收盤、漲跌、最高、最低、振幅與成交量');
      crosshair.id = 'dw-chart-crosshair';
      crosshair.setAttribute('aria-live', 'polite');
      stage.append(crosshair);
    }
  }

  function removePulseDuplicates(root) {
    for (const id of ['dw-pulse-breadth', 'dw-pulse-futures', 'dw-pulse-options', 'dw-pulse-global']) {
      const metric = root.querySelector(`#${id}`)?.closest('article');
      if (metric) metric.hidden = true;
    }
    const grid = root.querySelector('.dw-pulse-grid');
    if (grid && !root.querySelector('#dw-pulse-volume')) {
      appendMetric(grid, '成交量', 'dw-pulse-volume', 'UNAVAILABLE', 'Volume');
    }
    const session = root.querySelector('#dw-pulse-session')?.closest('article');
    if (session) session.hidden = true;
    const vwapLabel = root.querySelector('#dw-pulse-vwap')?.closest('article')?.querySelector('span');
    if (vwapLabel) vwapLabel.textContent = 'VWAP / 距離';
    if (grid && !root.querySelector('#tt-pulse-rvol')) {
      appendMetric(grid, '相對量', 'tt-pulse-rvol', 'UNAVAILABLE', 'RVOL');
      appendMetric(grid, '基差', 'tt-pulse-basis', 'UNAVAILABLE', 'Basis');
    }
    const pulse = root.querySelector('.dw-market-pulse');
    const change = pulse?.querySelector('#dw-pulse-change');
    const changeMetric = change?.closest('article') ?? change;
    if (changeMetric?.parentElement && pulse.contains(changeMetric) && !pulse.querySelector('.tt-pulse-trend')) {
      const trend = miniBars('tt-pulse-trend tt-fixture-only');
      trend.setAttribute('aria-label', 'Fixture-only pulse visual; no production series contract');
      changeMetric.parentElement.insertBefore(trend, changeMetric);
    }
  }

  function compactDataHealthCard(root) {
    const node = card('health', 'SOURCE · FRESHNESS · QUALITY', '資料健康度', 'Data Health', 'tt-health-main', 'Missing ≠ 0 · Delayed ≠ Live · Stale ≠ Current');
    const more = node.querySelector('.tt-more');
    more.dataset.terminalDrawerSource = '#dw-data-health-panel';
    const layout = element('div', 'tt-health-layout');
    const ring = element('div', 'tt-ring tt-health-ring');
    const center = element('div', 'tt-ring-center');
    center.append(Object.assign(element('strong', '', 'LOADING'), { id: 'tt-health-ring-value' }), element('span', '', '健康度'));
    ring.append(center);
    const sources = element('div', 'tt-health-sources');
    for (const [label, id] of [
      ['行情資料', 'tt-health-market'], ['法人籌碼', 'tt-health-institutional'],
      ['期貨數據', 'tt-health-futures'], ['選擇權資料', 'tt-health-options'], ['國際數據', 'tt-health-global'],
    ]) sources.append(compactMetric(label, id, 'UNAVAILABLE'));
    layout.append(ring, sources);
    insertVisual(node, layout);
    return node;
  }

  function ensureAskArchitecture(node) {
    if (!node || node.querySelector('.tt-gpt-visual')) return;
    const visual = element('div', 'tt-gpt-visual');
    const disabledState = element('strong', 'tt-gpt-disabled-state', 'COPY SNAPSHOT · LOADING');
    disabledState.id = 'tt-gpt-disabled-state';
    visual.append(disabledState, element('span', 'tt-gpt-copy-note', 'Manual copy only · no direct GPT API · not a trading signal'));
    const copy = node.querySelector('#dw-copy-gpt-prompt');
    const copyBody = copy?.closest('.dw-gpt-body');
    if (copyBody?.parentElement === node) node.insertBefore(visual, copyBody);
    else node.append(visual);
  }

  function drawer(root) {
    let shell = root.querySelector('.tt-drawer');
    if (shell) return shell;
    shell = element('aside', 'tt-drawer');
    shell.hidden = true;
    shell.setAttribute('aria-hidden', 'true');
    shell.setAttribute('aria-label', '詳細資料');
    const scrim = element('button', 'tt-drawer-scrim');
    scrim.type = 'button';
    scrim.setAttribute('aria-label', '關閉詳細資料');
    const panel = element('section', 'tt-drawer-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'tt-drawer-title');
    const heading = element('header', 'tt-drawer-heading');
    const title = element('h2', '', 'Detail');
    title.id = 'tt-drawer-title';
    const close = element('button', 'tt-drawer-close', '關閉');
    close.type = 'button';
    const body = element('div', 'tt-drawer-body');
    heading.append(title, close);
    panel.append(heading, body);
    shell.append(scrim, panel);
    root.append(shell);

    const closeDrawer = () => {
      const returnFocus = shell.returnFocus;
      shell.returnFocus = null;
      shell.sourceSelector = null;
      shell.hidden = true;
      shell.setAttribute('aria-hidden', 'true');
      root.classList.remove('is-drawer-open');
      body.replaceChildren();
      if (returnFocus?.isConnected) {
        const sourceCard = returnFocus.closest('.dw-card');
        returnFocus.focus({ preventScroll: true });
        if (sourceCard) sourceCard.scrollTop = 0;
      }
    };
    close.addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);
    shell.closeDrawer = closeDrawer;
    return shell;
  }

  function sanitizedClone(source) {
    const clone = source.cloneNode(true);
    if (clone.id) clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    clone.querySelectorAll('[data-terminal-drawer-source]').forEach((node) => node.remove());
    clone.querySelectorAll('button, input, select, textarea').forEach((node) => {
      node.disabled = true;
      node.removeAttribute('data-terminal-drawer-source');
    });
    clone.querySelectorAll('[hidden]').forEach((node) => { node.hidden = false; });
    clone.hidden = false;
    clone.classList.remove('hidden');
    return clone;
  }

  function refreshDrawer(root, expectedSourceSelector) {
    const shell = root?.querySelector('.tt-drawer');
    if (!shell || shell.hidden || !shell.sourceSelector) return;
    if (expectedSourceSelector && shell.sourceSelector !== expectedSourceSelector) return;
    const source = root.querySelector(shell.sourceSelector);
    if (!source) return;
    shell.querySelector('.tt-drawer-body').replaceChildren(sanitizedClone(source));
  }

  function bindDrawer(root) {
    const shell = drawer(root);
    root.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-terminal-drawer-source]');
      if (!trigger || !root.contains(trigger)) return;
      const source = root.querySelector(trigger.dataset.terminalDrawerSource);
      if (!source) return;
      shell.querySelector('#tt-drawer-title').textContent = trigger.dataset.terminalDrawerTitle || 'Detail';
      shell.querySelector('.tt-drawer-body').replaceChildren(sanitizedClone(source));
      shell.sourceSelector = trigger.dataset.terminalDrawerSource;
      shell.returnFocus = trigger;
      shell.hidden = false;
      shell.setAttribute('aria-hidden', 'false');
      root.classList.add('is-drawer-open');
      shell.querySelector('.tt-drawer-close').focus();
    });
    root.addEventListener('keydown', (event) => {
      if (shell.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        shell.closeDrawer();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(shell.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((node) => !node.closest('[hidden]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function readPalette() {
    try {
      const value = global.localStorage?.getItem(STORAGE_KEY);
      return PALETTES[value] ? value : 'red-up';
    } catch {
      return 'red-up';
    }
  }

  function applyPalette(root, name, persist = true) {
    const selected = PALETTES[name] ? name : 'red-up';
    const palette = PALETTES[selected];
    root.dataset.candlePalette = selected;
    document.documentElement.dataset.marketPalette = selected;
    root.style.setProperty('--candle-up', palette.up);
    root.style.setProperty('--candle-down', palette.down);
    const globalStyle = document.documentElement.style;
    globalStyle.setProperty('--positive', palette.up);
    globalStyle.setProperty('--negative', palette.down);
    globalStyle.setProperty('--market-up', palette.up);
    globalStyle.setProperty('--market-down', palette.down);
    globalStyle.setProperty('--market-up-soft', palette.upSoft);
    globalStyle.setProperty('--market-up-strong', palette.upStrong);
    globalStyle.setProperty('--market-down-soft', palette.downSoft);
    globalStyle.setProperty('--market-down-strong', palette.downStrong);
    const control = document.getElementById('market-palette-select');
    if (control) {
      control.value = selected;
      control.setAttribute('aria-label', `漲跌配色：${palette.label}`);
    }
    if (persist) {
      try { global.localStorage?.setItem(STORAGE_KEY, selected); } catch { /* presentation preference only */ }
    }
    global.dispatchEvent(new CustomEvent('trader-terminal:palette', { detail: { name: selected, ...palette } }));
  }

  function bindChartControls(root) {
    const expand = root.querySelector('#tt-chart-expand');
    expand?.addEventListener('click', () => {
      const expanded = root.classList.toggle('is-chart-expanded');
      expand.textContent = expanded ? '↙ 還原工作台' : '⛶ 放大圖表';
      expand.setAttribute('aria-pressed', String(expanded));
      global.dispatchEvent(new CustomEvent('trader-terminal:chart-layout', { detail: { expanded } }));
    });
    const paletteControl = document.getElementById('market-palette-select');
    paletteControl?.addEventListener('change', () => applyPalette(root, paletteControl.value));
    const levels = root.querySelector('#tt-level-toggle');
    levels?.addEventListener('click', () => {
      const visible = root.classList.toggle('show-optional-levels');
      levels.textContent = visible ? '隱藏參考線' : '顯示參考線';
      levels.setAttribute('aria-pressed', String(visible));
      global.dispatchEvent(new CustomEvent('trader-terminal:levels', { detail: { optional: visible } }));
    });
    applyPalette(root, readPalette(), false);
  }

  function addMoreButton(node, title, sourceSelector) {
    if (!node || node.querySelector(':scope > .tt-more')) return;
    const button = element('button', 'tt-more', '更多 >');
    button.type = 'button';
    button.dataset.terminalDrawerSource = sourceSelector;
    button.dataset.terminalDrawerTitle = title;
    node.append(button);
  }

  function mountFormal(root) {
    if (root.dataset.terminalMounted === 'true') return root;
    root.dataset.terminalMounted = 'true';
    root.dataset.traderTerminal = 'formal';
    root.classList.add('trader-terminal');
    terminalNavigation(root);
    terminalTopbar(root);
    const focus = root.querySelector('#dw-focus-mode');
    const originalMain = focus?.querySelector('.dw-main-grid');
    const chart = originalMain?.querySelector('.dw-price-region');
    const side = originalMain?.querySelector('.dw-side-stack');
    const pulse = side?.querySelector('.dw-market-pulse');
    const observedFlow = side?.querySelector('.dw-observed-flow');
    const leadership = side?.querySelector('.dw-leadership');
    const against = side?.querySelector('.dw-against-panel');
    const ask = side?.querySelector('.dw-gpt-panel');
    const conflict = focus?.querySelector('.dw-conflict-monitor');
    if (!focus || !chart || !pulse || !observedFlow || !leadership || !conflict) return root;

    chartControls(root);
    removePulseDuplicates(root);
    relabelExistingCard(pulse, '即時盤況', 'Market Pulse', '');
    relabelExistingCard(observedFlow, '台指期盤中力道', '成交觀測', '研究觀測 · 非交易訊號');
    relabelExistingCard(leadership, '現貨 / 指數貢獻', 'Spot Contribution', '');
    relabelExistingCard(conflict, '風險監控', 'Risk / Conflict', '');
    relabelExistingCard(ask, 'Ask GPT', 'Snapshot Discussion', '');
    const chartTitle = chart.querySelector('.dw-section-heading h2');
    const chartEyebrow = chart.querySelector('.dw-section-heading .eyebrow');
    if (chartTitle) {
      chartTitle.id = 'tt-chart-title';
      chartTitle.textContent = '台指期貨';
      chartTitle.append(element('small', 'tt-chart-title-subtitle', 'Price Structure · Primary'));
    }
    if (chartEyebrow) chartEyebrow.hidden = true;
    ensureLeadershipArchitecture(leadership);
    ensureRiskArchitecture(conflict);
    const summary = summaryLine();
    const primary = element('div', 'tt-primary-grid');
    const tierOne = element('aside', 'tt-tier-one-grid');
    const trend = card('trend', '', '趨勢強度', 'Trend Strength', 'tt-trend-main', '正式研究尚未完成；空軌不代表 0、Neutral 或任何分數。', 'RESEARCH_PENDING');
    trend.querySelector('#tt-trend-main').textContent = 'RESEARCH_PENDING';
    buildTrendVisual(trend);
    const futures = card('futures', '', '期貨流向', 'Futures Flow', 'tt-futures-main', 'OI 與法人部位只作描述背景，不代表多空意圖。');
    buildFuturesVisual(futures);
    tierOne.append(pulse, observedFlow);
    chart.classList.add('tt-primary-market-surface');
    primary.append(chart, tierOne);

    const tierTwo = element('div', 'tt-tier-two-grid');
    leadership.dataset.terminalCard = 'leadership';
    addMoreButton(leadership, '指數貢獻 / Index Contribution', '[data-terminal-card="leadership"]');
    const options = card('options', '', '選擇權情緒', 'Options Context', 'tt-options-main', '未驗證 IV / Skew / Greeks / GEX / DEX 保持 RESEARCH_PENDING。');
    buildOptionsVisual(options);
    const breadth = card('breadth', '', '市場參與度', 'Breadth', 'tt-breadth-main', '只回答多少市場一起動，不重複價格脈動。');
    buildBreadthVisual(breadth);
    conflict.dataset.terminalCard = 'risk';
    addMoreButton(conflict, '風險 / 衝突', '[data-terminal-card="risk"]');
    tierTwo.append(leadership, futures, options, breadth, conflict);

    const tierThree = element('div', 'tt-tier-three-grid');
    const globalCard = card('global', '', '全球市場總覽', 'Global Context', 'tt-global-main', '背景參考，不取代台指期即時價格；無序列時不製造 sparkline。');
    buildGlobalVisual(globalCard);
    const healthCard = compactDataHealthCard(root);
    if (ask) {
      ask.dataset.terminalCard = 'gpt';
      ensureAskArchitecture(ask);
      addMoreButton(ask, 'Ask GPT / 快照討論', '[data-terminal-card="gpt"]');
    }
    tierThree.append(globalCard, healthCard);
    if (ask) tierThree.append(ask);

    const progressive = element('details', 'tt-progressive');
    const progressiveSummary = element('summary', '', '證據明細 / 市場變化 / 人工決策日誌');
    const progressiveBody = element('div', 'tt-progressive-body');
    for (const node of [focus.querySelector('.dw-now-summary'), focus.querySelector('.dw-decision-bar'), trend, against, focus.querySelector('.dw-family-strip'), focus.querySelector('.dw-change-strip'), focus.querySelector('.dw-data-health'), focus.querySelector('.dw-journal-bar')]) {
      if (node) progressiveBody.append(node);
    }
    progressive.append(progressiveSummary, progressiveBody);

    originalMain.remove();
    focus.append(summary, primary, tierTwo, tierThree, progressive);
    bindDrawer(root);
    bindChartControls(root);
    return root;
  }

  function setPreviewIdentity(root, identity = {}) {
    const mapping = {
      'tt-preview-branch': identity.branch,
      'tt-preview-commit': identity.commit,
      'tt-preview-mode': identity.dataMode,
      'tt-preview-generated': identity.generatedAt,
    };
    for (const [id, value] of Object.entries(mapping)) {
      const target = root.querySelector(`#${id}`) || document.getElementById(id);
      if (target) target.textContent = value || 'UNAVAILABLE';
    }
  }

  global.TraderTerminalShell = Object.freeze({
    PALETTES,
    applyPalette,
    mount: mountFormal,
    refreshDrawer,
    setPreviewIdentity,
  });
})(window);
