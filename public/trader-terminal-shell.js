(function traderTerminalShellBootstrap(global) {
  'use strict';

  const PALETTES = Object.freeze({
    'red-up': Object.freeze({ up: '#ff6b6b', down: '#37d67a', upVolume: 'rgba(255,107,107,.34)', downVolume: 'rgba(55,214,122,.34)' }),
    'green-up': Object.freeze({ up: '#37d67a', down: '#ff6b6b', upVolume: 'rgba(55,214,122,.34)', downVolume: 'rgba(255,107,107,.34)' }),
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
    const line = element('section', 'tt-summary-line');
    line.setAttribute('aria-label', '市場摘要 Market Summary');
    const labels = [
      ['價格結構', 'Price Structure', 'tt-summary-price'],
      ['趨勢強度', 'Strength', 'tt-summary-strength'],
      ['VWAP 控制', 'VWAP', 'tt-summary-vwap'],
      ['市場參與', 'Breadth', 'tt-summary-breadth'],
      ['期貨流向', 'Flow', 'tt-summary-flow'],
      ['風險衝突', 'Risk', 'tt-summary-risk'],
    ];
    labels.forEach(([label, subtitle, id]) => appendMetric(line, label, id, label === '趨勢強度' ? 'RESEARCH_PENDING' : 'UNAVAILABLE', subtitle));
    return line;
  }

  function insertVisual(cardNode, visualNode) {
    const visual = cardNode.querySelector('.tt-primary-viz');
    visual.insertBefore(visualNode, visual.querySelector('.tt-card-values'));
    return visualNode;
  }

  function compactMetric(label, id, value = '—') {
    const metric = element('article', 'tt-compact-metric');
    metric.append(element('span', '', label), Object.assign(element('strong', '', value), { id }));
    return metric;
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

  function buildTrendVisual(cardNode) {
    const overview = element('div', 'tt-compact-metrics tt-trend-overview');
    overview.append(
      compactMetric('方向', 'tt-trend-direction'),
      compactMetric('強度', 'tt-trend-strength'),
      compactMetric('強度變化', 'tt-trend-change'),
    );
    const factors = element('div', 'tt-track-list tt-trend-factors');
    for (const [label, id, state] of [
      ['價格結構', 'tt-trend-price-track', 'RESEARCH_PENDING'],
      ['VWAP 控制', 'tt-trend-vwap-track', 'RESEARCH_PENDING'],
      ['路徑效率', 'tt-trend-path-track', 'RESEARCH_PENDING'],
      ['回檔品質', 'tt-trend-pullback-track', 'RESEARCH_PENDING'],
      ['市場參與度', 'tt-trend-breadth-track', 'UNAVAILABLE'],
      ['指數貢獻', 'tt-trend-leadership-track', 'NOT_REQUESTED'],
      ['期貨流向', 'tt-trend-futures-track', 'UNAVAILABLE'],
    ]) factors.append(trackRow(label, id, state));
    insertVisual(cardNode, overview);
    insertVisual(cardNode, factors);
  }

  function buildFuturesVisual(cardNode) {
    const metrics = element('div', 'tt-compact-metrics');
    metrics.append(compactMetric('基差', 'tt-futures-basis'), compactMetric('未平倉量', 'tt-futures-oi'));
    insertVisual(cardNode, metrics);
    insertVisual(cardNode, miniBars('tt-futures-bars'));
  }

  function buildOptionsVisual(cardNode) {
    const layout = element('div', 'tt-options-layout');
    const ring = element('div', 'tt-ring tt-options-ring');
    const center = element('div', 'tt-ring-center');
    center.append(element('span', '', 'PCR'), Object.assign(element('strong', '', '—'), { id: 'tt-options-pcr' }));
    ring.append(center);
    const metrics = element('div', 'tt-options-metrics');
    for (const [label, id] of [['Call Wall', 'tt-options-call'], ['Put Wall', 'tt-options-put'], ['Max Pain', 'tt-options-max-pain'], ['OI Context', 'tt-options-oi']]) {
      metrics.append(compactMetric(label, id));
    }
    layout.append(ring, metrics);
    insertVisual(cardNode, layout);
  }

  function buildBreadthVisual(cardNode) {
    const metrics = element('div', 'tt-compact-metrics tt-breadth-metrics');
    metrics.append(compactMetric('上漲', 'tt-breadth-up'), compactMetric('平盤', 'tt-breadth-flat'), compactMetric('下跌', 'tt-breadth-down'));
    const participation = element('div', 'tt-participation-bar');
    participation.setAttribute('aria-label', '市場參與度 visual placeholder; unavailable does not mean zero');
    participation.append(element('i', 'is-up'), element('i', 'is-flat'), element('i', 'is-down'));
    const ratio = compactMetric('漲跌比', 'tt-breadth-ratio');
    const series = miniBars('tt-breadth-series');
    series.append(element('span', '', 'MINI SERIES · UNAVAILABLE'));
    insertVisual(cardNode, metrics);
    insertVisual(cardNode, participation);
    insertVisual(cardNode, ratio);
    insertVisual(cardNode, series);
  }

  function buildGlobalVisual(cardNode) {
    const tiles = element('div', 'tt-global-tiles');
    for (let index = 1; index <= 4; index += 1) {
      const tile = element('article');
      tile.append(
        Object.assign(element('span', '', `來源 ${index}`), { id: `tt-global-name-${index}` }),
        Object.assign(element('strong', '', '—'), { id: `tt-global-price-${index}` }),
        Object.assign(element('small', '', 'UNAVAILABLE'), { id: `tt-global-change-${index}` }),
        miniBars('tt-global-mini'),
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
    center.append(Object.assign(element('strong', '', '—'), { id: 'tt-risk-ring-value' }), Object.assign(element('span', '', 'UNAVAILABLE'), { id: 'tt-risk-ring-state' }));
    ring.append(center);
    const states = element('div', 'tt-risk-states');
    states.append(compactMetric('主要衝突', 'tt-risk-primary'), compactMetric('資料信任', 'tt-risk-trust'));
    layout.append(ring, states);
    const axis = node.querySelector('.dw-conflict-axis-grid');
    if (axis) node.insertBefore(layout, axis);
    else node.append(layout);
  }

  function ensureLeadershipArchitecture(node) {
    if (!node || node.querySelector('.tt-contribution-placeholder') || node.querySelector('#dw-leadership-positive')) return;
    const layout = element('div', 'tt-contribution-placeholder');
    for (const [title, tone, prefix] of [['正貢獻 TOP', 'is-positive', 'positive'], ['負貢獻 TOP', 'is-negative', 'negative']]) {
      const group = element('section', `tt-contribution-group ${tone}`);
      group.append(element('h4', '', title));
      for (let index = 1; index <= 3; index += 1) {
        const row = trackRow('—', `tt-contribution-${prefix}-${index}`, '—');
        group.append(row);
      }
      layout.append(group);
    }
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
    if (eyebrowNode && eyebrow) eyebrowNode.textContent = eyebrow;
    if (heading && !heading.querySelector('.tt-card-subtitle')) heading.append(element('small', 'tt-card-subtitle', subtitle));
  }

  function chartControls(root) {
    const toolbar = root.querySelector('.dw-chart-toolbar');
    if (!toolbar || toolbar.querySelector('.tt-chart-actions')) return;
    const actions = element('div', 'tt-chart-actions');
    const palettes = element('div', 'tt-palette-switch');
    palettes.setAttribute('role', 'group');
    palettes.setAttribute('aria-label', 'K 線配色');
    for (const [value, label] of [['red-up', '紅漲綠跌'], ['green-up', '綠漲紅跌']]) {
      const button = element('button', '', label);
      button.type = 'button';
      button.dataset.candlePalette = value;
      palettes.append(button);
    }
    const expand = element('button', 'tt-expand-chart', '⛶ 放大圖表');
    expand.type = 'button';
    expand.id = 'tt-chart-expand';
    actions.append(palettes, expand);
    toolbar.append(actions);
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
  }

  function compactDataHealthCard(root) {
    const node = card('health', 'SOURCE · FRESHNESS · QUALITY', '資料健康度', 'Data Health', 'tt-health-main', 'Missing ≠ 0 · Delayed ≠ Live · Stale ≠ Current');
    const more = node.querySelector('.tt-more');
    more.dataset.terminalDrawerSource = '#dw-data-health-panel';
    node.querySelector('.tt-primary-viz').append(element('span', '', 'LIVE · DELAYED · STALE · MISSING · UNAVAILABLE · NOT_REQUESTED'));
    return node;
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
      shell.hidden = true;
      shell.setAttribute('aria-hidden', 'true');
      root.classList.remove('is-drawer-open');
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
    clone.querySelectorAll('button, input, select, textarea').forEach((node) => {
      node.disabled = true;
      node.removeAttribute('data-terminal-drawer-source');
    });
    clone.hidden = false;
    clone.classList.remove('hidden');
    return clone;
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
      shell.hidden = false;
      shell.setAttribute('aria-hidden', 'false');
      root.classList.add('is-drawer-open');
      shell.querySelector('.tt-drawer-close').focus();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !shell.hidden) shell.closeDrawer();
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
    root.style.setProperty('--candle-up', palette.up);
    root.style.setProperty('--candle-down', palette.down);
    root.querySelectorAll('button[data-candle-palette]').forEach((button) => {
      const active = button.dataset.candlePalette === selected;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
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
    root.querySelectorAll('[data-candle-palette]').forEach((button) => button.addEventListener('click', () => applyPalette(root, button.dataset.candlePalette)));
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
    const focus = root.querySelector('#dw-focus-mode');
    const originalMain = focus?.querySelector('.dw-main-grid');
    const chart = originalMain?.querySelector('.dw-price-region');
    const side = originalMain?.querySelector('.dw-side-stack');
    const pulse = side?.querySelector('.dw-market-pulse');
    const leadership = side?.querySelector('.dw-leadership');
    const against = side?.querySelector('.dw-against-panel');
    const ask = side?.querySelector('.dw-gpt-panel');
    const conflict = focus?.querySelector('.dw-conflict-monitor');
    if (!focus || !chart || !pulse || !leadership || !conflict) return root;

    chartControls(root);
    removePulseDuplicates(root);
    relabelExistingCard(pulse, '即時盤況', 'Market Pulse', 'PRICE NOW · GOVERNED FACTS');
    relabelExistingCard(leadership, '指數貢獻', 'Index Contribution', 'SPOT / INDEX CONTRIBUTION');
    relabelExistingCard(conflict, '風險 / 衝突', 'Risk / Conflict', 'CONFLICT FIRST');
    relabelExistingCard(ask, 'Ask GPT / 快照討論', 'Snapshot Discussion', 'DISCUSSION ONLY');
    ensureLeadershipArchitecture(leadership);
    ensureRiskArchitecture(conflict);
    const summary = summaryLine();
    const primary = element('div', 'tt-primary-grid');
    const tierOne = element('aside', 'tt-tier-one-grid');
    const trend = card('trend', 'UI CONTRACT PLACEHOLDER', '趨勢強度', 'Trend Strength', 'tt-trend-main', '正式研究尚未完成；空軌不代表 0、Neutral 或任何分數。', 'RESEARCH_PENDING');
    trend.querySelector('#tt-trend-main').textContent = '—';
    buildTrendVisual(trend);
    const futures = card('futures', 'TX · VWAP · OI CONTEXT', '期貨流向', 'Futures Flow', 'tt-futures-main', 'OI 與法人部位只作描述背景，不代表多空意圖。');
    buildFuturesVisual(futures);
    tierOne.append(pulse, trend, futures);
    primary.append(chart, tierOne);

    const tierTwo = element('div', 'tt-tier-two-grid');
    leadership.dataset.terminalCard = 'leadership';
    addMoreButton(leadership, '指數貢獻 / Index Contribution', '[data-terminal-card="leadership"]');
    const options = card('options', 'EOD / VERIFIED CONTEXT', '選擇權結構', 'Options Context', 'tt-options-main', '未驗證 IV / Skew / Greeks / GEX / DEX 保持 RESEARCH_PENDING。');
    buildOptionsVisual(options);
    const breadth = card('breadth', 'PARTICIPATION', '市場參與度', 'Breadth', 'tt-breadth-main', '只回答多少市場一起動，不重複價格脈動。');
    buildBreadthVisual(breadth);
    conflict.dataset.terminalCard = 'risk';
    addMoreButton(conflict, '風險 / 衝突', '[data-terminal-card="risk"]');
    tierTwo.append(leadership, options, breadth, conflict);

    const tierThree = element('div', 'tt-tier-three-grid');
    const globalCard = card('global', 'DELAYED / RESEARCH CONTEXT', '全球市場', 'Global Context', 'tt-global-main', '背景參考，不取代台指期即時價格；無序列時不製造 sparkline。');
    buildGlobalVisual(globalCard);
    const healthCard = compactDataHealthCard(root);
    if (ask) {
      ask.dataset.terminalCard = 'gpt';
      addMoreButton(ask, 'Ask GPT / 快照討論', '[data-terminal-card="gpt"]');
    }
    tierThree.append(globalCard, healthCard);
    if (ask) tierThree.append(ask);

    const progressive = element('details', 'tt-progressive');
    const progressiveSummary = element('summary', '', '證據明細 / 市場變化 / 人工決策日誌');
    const progressiveBody = element('div', 'tt-progressive-body');
    for (const node of [focus.querySelector('.dw-decision-bar'), against, focus.querySelector('.dw-family-strip'), focus.querySelector('.dw-change-strip'), focus.querySelector('.dw-data-health'), focus.querySelector('.dw-journal-bar')]) {
      if (node) progressiveBody.append(node);
    }
    progressive.append(progressiveSummary, progressiveBody);

    originalMain.remove();
    const now = focus.querySelector('.dw-now-summary');
    if (now) now.classList.add('tt-market-headline');
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
    setPreviewIdentity,
  });
})(window);
