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
    const flowCurrent = Boolean(flow?.sourceState === 'LIVE' && flow.windows && same(chart, flow.identity) && fresh(flow.source?.availableAt, now));
    const flowQualified = flowCurrent && ['PASS', 'READY'].includes(flow.researchQuality?.status);
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
    aiSummary(); return view;
  }
  global.HomeWorkspace = Object.freeze({ derive, mount, render, aiSummary });
})(window);
