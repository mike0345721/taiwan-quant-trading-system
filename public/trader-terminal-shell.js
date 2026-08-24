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

  function appendMetric(parent, label, id, initial = 'UNAVAILABLE') {
    const metric = element('article', 'tt-metric');
    metric.append(element('span', '', label), Object.assign(element('strong', '', initial), { id }));
    parent.append(metric);
    return metric;
  }

  function card(key, eyebrow, title, mainId, interpretation, state = 'UNAVAILABLE') {
    const node = element('section', `dw-card tt-card tt-card-${key}`);
    node.dataset.terminalCard = key;
    const heading = element('header', 'tt-card-heading');
    const copy = element('div');
    copy.append(element('p', 'eyebrow', eyebrow), element('h3', '', title));
    const trust = element('span', 'dw-status-pill is-unavailable', state);
    trust.id = `tt-${key}-trust`;
    heading.append(copy, trust);
    const answer = element('strong', 'tt-main-answer', 'UNAVAILABLE');
    answer.id = mainId;
    const visual = element('div', 'tt-primary-viz');
    visual.id = `tt-${key}-viz`;
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
    line.setAttribute('aria-label', 'Market Summary');
    const labels = [
      ['Price Structure', 'tt-summary-price'],
      ['Strength', 'tt-summary-strength'],
      ['VWAP', 'tt-summary-vwap'],
      ['Breadth', 'tt-summary-breadth'],
      ['Flow', 'tt-summary-flow'],
      ['Risk', 'tt-summary-risk'],
    ];
    labels.forEach(([label, id]) => appendMetric(line, label, id, label === 'Strength' ? 'RESEARCH_PENDING' : 'UNAVAILABLE'));
    return line;
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
    const expand = element('button', 'tt-expand-chart', '⛶ Expand Chart');
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
      appendMetric(grid, 'Volume', 'dw-pulse-volume');
    }
  }

  function compactDataHealthCard(root) {
    const node = card('health', 'SOURCE · FRESHNESS · QUALITY', 'Data Health', 'tt-health-main', 'Missing ≠ 0 · Delayed ≠ Live · Stale ≠ Current');
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
    const close = element('button', 'tt-drawer-close', 'Close');
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
    root.querySelectorAll('[data-candle-palette]').forEach((button) => button.classList.toggle('is-selected', button.dataset.candlePalette === selected));
    if (persist) {
      try { global.localStorage?.setItem(STORAGE_KEY, selected); } catch { /* presentation preference only */ }
    }
    global.dispatchEvent(new CustomEvent('trader-terminal:palette', { detail: { name: selected, ...palette } }));
  }

  function bindChartControls(root) {
    const expand = root.querySelector('#tt-chart-expand');
    expand?.addEventListener('click', () => {
      const expanded = root.classList.toggle('is-chart-expanded');
      expand.textContent = expanded ? '↙ Restore Dashboard' : '⛶ Expand Chart';
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
    const summary = summaryLine();
    const primary = element('div', 'tt-primary-grid');
    const tierOne = element('aside', 'tt-tier-one-grid');
    const trend = card('trend', 'UI CONTRACT PLACEHOLDER', 'Trend Strength', 'tt-trend-main', '正式研究尚未完成；不建立 0–100 分數。', 'RESEARCH_PENDING');
    trend.querySelector('.tt-primary-viz').append(
      Object.assign(element('span', '', 'Direction'), { id: 'tt-trend-direction' }),
      Object.assign(element('span', '', 'Strength'), { id: 'tt-trend-strength' }),
      Object.assign(element('span', '', 'Strength Change'), { id: 'tt-trend-change' }),
    );
    const futures = card('futures', 'TX · VWAP · OI CONTEXT', 'Futures Flow', 'tt-futures-main', 'OI 與法人部位只作描述背景，不代表多空意圖。');
    tierOne.append(pulse, trend, futures);
    primary.append(chart, tierOne);

    const tierTwo = element('div', 'tt-tier-two-grid');
    leadership.dataset.terminalCard = 'leadership';
    addMoreButton(leadership, 'Spot / Index Contribution', '[data-terminal-card="leadership"]');
    const options = card('options', 'EOD / VERIFIED CONTEXT', 'Options Context', 'tt-options-main', '未驗證 Greeks / GEX / DEX 保持 RESEARCH_PENDING。');
    const breadth = card('breadth', 'PARTICIPATION', '市場參與度 / Breadth', 'tt-breadth-main', '只描述參與範圍，不重複價格脈動。');
    conflict.dataset.terminalCard = 'risk';
    addMoreButton(conflict, 'Risk / Conflict', '[data-terminal-card="risk"]');
    tierTwo.append(leadership, options, breadth, conflict);

    const tierThree = element('div', 'tt-tier-three-grid');
    const globalCard = card('global', 'DELAYED / RESEARCH CONTEXT', 'Global Context', 'tt-global-main', '背景參考，不取代台指期即時價格。');
    const healthCard = compactDataHealthCard(root);
    if (ask) {
      ask.dataset.terminalCard = 'gpt';
      addMoreButton(ask, 'Ask GPT', '[data-terminal-card="gpt"]');
    }
    tierThree.append(globalCard, healthCard);
    if (ask) tierThree.append(ask);

    const progressive = element('details', 'tt-progressive');
    const progressiveSummary = element('summary', '', 'Evidence / Change Feed / Manual Decision Journal');
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
