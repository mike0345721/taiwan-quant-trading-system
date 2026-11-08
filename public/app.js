'use strict';

const state = {
  guestReadOnly: false, guestExpiresAt: null, guestExpiryMono: null, csrfToken: '', snapshot: null, history: [], historyDays: 20,
  v2: null, v2Backtests: null, v2Days: 60, v2Delta: 1, v2Contract: '', prelive: null,
  replayCursor: 1, replayTotalBars: 0, replayDate: '',
  decisionWorkspace: null, lockedDecisionSnapshot: null, decisionCapturePair: null, decisionCaptureActionId: 0, dashboardRequestId: 0, journalIntent: 'NO_TRADE',
  gptQuestion: '現在市場發生什麼？',
  txChartTimeframe: '5m', txChartPayload: null, txChartApi: null, txChartSeries: null,
  txChartLevelLines: [], txChartMarkers: null, txChartIdentity: null, txChartBarCount: 0, txChartVolumeCount: 0,
  txChartLoading: false, txChartRequestId: 0, txChartPendingFit: false,
  txChartRequestTimeframe: null, txChartAbortController: null,
  txChartPalette: 'red-up',
  marketChangeFeed: null,
  indexLeadership: null, indexLeadershipLoading: false,
  marketPulse: null, marketPulseLoading: false,
  levelWatch: null, levelWatchLoading: false,
};
const $ = (id) => document.getElementById(id);
const flowChannel = window.Cru49Flow.createFlowChannel({
  request: signal => api('/api/v1/observed-flow', { signal, cache: 'no-store' }),
  authenticated: () => Boolean(state.csrfToken || state.guestReadOnly),
  chartIdentity: () => state.txChartPayload,
  visible: () => !document.hidden && !$('dashboard-view').classList.contains('hidden'),
  render: value => {
    if (state.decisionWorkspace) state.decisionWorkspace = { ...state.decisionWorkspace, observedFlow: value };
    renderObservedFlow(value);
  },
  onUnauthorized: () => show('login-view'),
});
let researchPageRequest = null;
let dataOperationsPageActive = false;
const dataOperationsChannel = window.DataOperations.createChannel({
  request: signal => api('/api/v1/data-operations', { signal, cache: 'no-store' }),
  display: value => { $('data-operations-content').innerHTML = window.DataOperations.render(value); },
  status: value => { $('data-operations-read-status').textContent = value; },
  unauthorized: () => show('login-view'),
});
$('data-operations-refresh').addEventListener('click', () => { if (state.csrfToken) void dataOperationsChannel.refresh(); });
setInterval(() => {
  if (dataOperationsPageActive && state.csrfToken && !document.hidden && !$('dashboard-view').classList.contains('hidden')) void dataOperationsChannel.refresh();
}, 60000);

function normalizeDashboardPageFragments() {
  const host = document.querySelector('.dashboard-pages');
  if (!host || host.dataset.pagesNormalized === 'true') return;
  host.dataset.pagesNormalized = 'true';
  for (const page of ['today', 'market', 'options', 'intraday', 'research', 'quality']) {
    const fragments = Array.from(host.children).filter((node) => node.dataset?.page === page);
    if (!fragments.length) continue;
    const group = document.createElement('div');
    group.id = `dashboard-page-${page}`;
    group.className = 'dashboard-page-group';
    group.dataset.page = page;
    const nav = document.querySelector(`[data-dashboard-page="${page}"]`);
    group.setAttribute('aria-label', nav?.title || page);
    fragments[0].before(group);
    fragments.forEach((node) => {
      node.classList.remove('is-active-page');
      node.removeAttribute('data-page');
      group.append(node);
    });
    group.querySelectorAll(`[data-page="${page}"]`).forEach((node) => {
      node.classList.remove('is-active-page');
      node.removeAttribute('data-page');
    });
  }
}

function setDashboardPage(page, { scroll = true } = {}) {
  const valid = new Set(['workspace', 'today', 'market', 'options', 'intraday', 'research', 'quality']);
  const selected = state.guestReadOnly ? 'workspace' : valid.has(page) ? page : 'workspace';
  document.querySelectorAll('[data-page]').forEach((element) => element.classList.toggle('is-active-page', element.dataset.page === selected));
  document.querySelectorAll('[data-dashboard-page]').forEach((button) => button.classList.toggle('is-selected', button.dataset.dashboardPage === selected));
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  if (state.csrfToken && ['options', 'research'].includes(selected)) void loadResearchPage();
  dataOperationsPageActive = selected === 'quality';
  if (state.csrfToken && dataOperationsPageActive) void dataOperationsChannel.refresh();
}

normalizeDashboardPageFragments();
setDashboardPage('workspace', { scroll: false });

const traderTerminalRoot = $('decision-workspace');
if (traderTerminalRoot && window.TraderTerminalShell) {
  window.TraderTerminalShell.mount(traderTerminalRoot);
  state.txChartPalette = traderTerminalRoot.dataset.candlePalette || 'red-up';
}

const FIELD_HELP = {
  '加權指數': '臺灣證券交易所發行量加權股價指數。用來代表上市市場整體表現，但大型權值股影響較大。',
  '櫃買指數': '上櫃股票市場指數，可補充觀察中小型股風險偏好，不能直接代替台指期方向。',
  '上市漲跌家數': '上市股票上漲與下跌家數。上漲家數明顯較多代表行情擴散較廣；仍須搭配成交量與權值股。',
  '上櫃漲跌家數': '上櫃股票上漲與下跌家數，用來觀察中小型股市場寬度。',
  '美元／台幣': '美元兌新台幣匯率背景值。短期升值或貶值不應單獨解讀為外資進出訊號。',
  'VIX': '美國市場預期波動指標，只作全球風險背景；不是臺指選擇權的本地波動率。',
  '外資': '外資及陸資在上市現貨市場的買賣超金額，單位為億元。正值為買超，負值為賣超。',
  '投信': '投信在上市現貨市場的買賣超金額，單位為億元。需搭配連續天數與持續性觀察。',
  '自營商自行': '券商自營部門自行買賣的現貨淨額，與避險部位分開呈現。',
  '自營商避險': '券商因權證、選擇權或其他商品進行避險的現貨淨額，不宜直接當作方向交易。',
  '融資餘額': '上市市場融資餘額，反映信用資金規模；單日絕對值的方向意義有限，應觀察變化。',
  '融券餘額': '上市市場融券餘額，單位為張。需搭配借券、券資比與價格變化判讀。',
  '台指期近月': '臺股期貨目前近月日盤合約收盤價；接近結算時需特別注意轉倉。',
  '外資淨部位': '外資臺股期貨未沖銷多單減空單。包含避險與套利，不等同外資單純看多或看空。',
  '外資空單': '外資臺股期貨未沖銷空方口數。應與多單、現貨、基差及日變化一起觀察。',
  '自營商淨部位': '自營商臺股期貨未沖銷多單減空單，可能包含造市及避險需求。',
  'Top 5 L/S': '前五大交易人多方部位除以空方部位。大於 1 代表前五大多方較集中，但無法得知交易目的。',
  '市場未平倉': '期交所大額交易人資料口徑下的全市場未沖銷部位。結算與轉倉期間需謹慎比較。',
  '主力契約': '目前面板選出的近端活躍選擇權契約。週選與月選必須分開，不能跨到期日混加。',
  'OI P/C Ratio': 'Put 未平倉量除以 Call 未平倉量。只代表公開部位分布，不能直接推定買方或賣方方向。',
  'Call OI 牆': '該契約 Call 未平倉量最大的履約價。這是集中履約價，不保證一定形成壓力。',
  'Put OI 牆': '該契約 Put 未平倉量最大的履約價。這是集中履約價，不保證一定形成支撐。',
  'Max Pain': '依該到期契約公開未平倉量估算的選擇權總履約損失最小價位，僅供結構觀察。',
  '夜盤漲跌': '臺指期夜盤相對期交所參考基準的漲跌幅。請同時查看夜盤合約與資料日期。',
  '台指夜盤': '臺指期夜盤最近官方收盤值與漲跌幅。夜盤反映盤後國際市場變化，但不能直接代替隔日日盤方向。',
  '上市漲停／跌停': '上市股票漲停與跌停家數。差距可觀察極端強弱分布，但少數題材股可能造成偏差。',
  '上櫃漲停／跌停': '上櫃股票漲停與跌停家數，用來觀察中小型股極端強弱分布。',
  '期現貨基差': '近月臺指期收盤價減加權指數收盤值。兩者收盤時間不同，因此屬收盤近似基差。',
  '距離結算日': '以目前近月契約的預定到期日計算日曆天數；遇交易所調整時應以官方公告為準。',
  '臺指波動率指數': '期交所以臺指選擇權價格計算、衡量市場對未來30天波動預期的本地指標。數值越高代表預期波動越劇烈，不代表方向。',
  '美國 VIX': '美國市場預期波動指標，只作全球風險背景，不是臺指選擇權波動率。',
  '資料更新時間': '後端完成本次資料檢查的時間，不等於每一來源的資料日期。',
  '資料異常': '官方來源失敗、資料過期或格式異常的數量。詳細原因列在資料品質區。',
  '三大法人合計': '外資、投信與自營商現貨買賣超合計，單位億元。',
  '外資近5日': '最近5個有效交易日外資現貨買賣超累積；樣本不足時不計算。',
  '外資近20日': '最近20個有效交易日外資現貨買賣超累積；樣本不足時不計算。',
  '外資歷史百分位': '當日外資買賣超在近252交易日樣本中的相對位置；至少累積20日才顯示。',
  '法人與指數背離': '比較法人資金方向與指數報酬方向。需要連續歷史資料，不能用單日判定。',
  '上漲成交量占比': '上漲股票成交量占全市場成交量比例，需逐股成交資料才能正確計算。',
  '電子／金融／傳產強弱': '比較主要類股指數報酬與相對強弱，資料源尚未接入。',
  '前十大權值股貢獻': '依成分權重與個股漲跌估算對加權指數的點數貢獻，需要授權或可靠權重資料。',
  '投信淨部位': '投信臺股期貨未沖銷多單減空單，需注意可能包含避險。',
  '外資單日增減': '本交易日外資臺股期貨淨部位減前一有效交易日淨部位。',
  '外資5日增減': '目前淨部位與5個交易日前淨部位之差，至少需要6日樣本。',
  '近月成交量': '近月臺指期日盤成交口數，不含其他月份與價差契約。',
  '夜盤未平倉量': '公開夜盤行情常回傳0或不提供獨立未平倉量；面板不把0當成真實數據。',
  'Top 10 L/S': '前十大交易人多方部位除以空方部位；無法辨識每位交易人的策略目的。',
  'Top 5 多方集中度': '前五大交易人多方部位占期交所該口徑全市場未平倉量比例。',
  'Top 5 空方集中度': '前五大交易人空方部位占期交所該口徑全市場未平倉量比例。',
  '未平倉單日增減': '全市場未平倉量與前一有效交易日的差異。結算與轉倉期間需謹慎比較。',
  '近月／次月價差': '次月臺指期收盤價減近月臺指期收盤價；已排除跨月價差商品本身。',
  '價格 × OI 判讀': '用價格漲跌搭配未平倉量變化提供可能解釋，不代表能確認新多、新空或避險目的。',
  'Call 成交量': '所選到期契約全部履約價 Call 的日盤成交量合計。',
  'Put 成交量': '所選到期契約全部履約價 Put 的日盤成交量合計。',
  '成交量 P/C Ratio': 'Put 成交量除以 Call 成交量，與未平倉量 P/C 是不同指標。',
  'Call 未平倉量': '所選到期契約全部履約價 Call 未平倉量合計。',
  'Put 未平倉量': '所選到期契約全部履約價 Put 未平倉量合計。',
  '最大 Call OI 履約價': 'Call 未平倉量最大的履約價，只代表集中位置，不保證形成壓力。',
  '最大 Put OI 履約價': 'Put 未平倉量最大的履約價，只代表集中位置，不保證形成支撐。',
  'Call OI 單日增減': '同一到期契約 Call OI 與前一交易日的差；換約時不可直接比較。',
  'Put OI 單日增減': '同一到期契約 Put OI 與前一交易日的差；換約時不可直接比較。',
  '隱含波動率': '由選擇權價格反推的預期波動率。顯示時必須附資料日；沒有可靠值時會明確標示尚無可用資料。',
};

function show(view) {
  for (const id of ['loading-view', 'login-view', 'dashboard-view']) $(id).classList.add('hidden');
  $(view).classList.remove('hidden');
  $('app')?.classList.toggle('is-dashboard-shell', view === 'dashboard-view');
  if (view === 'dashboard-view') flowChannel.start();
  else {
    flowChannel.stop(); flowChannel.reset(); dataOperationsChannel.reset();
    clearDecisionCapture();
    $('data-operations-content').textContent = '登入後重新讀取資料營運紀錄。';
    $('data-operations-read-status').textContent = '尚未讀取';
  }
}

function expireGuestView() {
  state.guestReadOnly = false; state.guestExpiryMono = null; state.csrfToken = '';
  flowChannel.stop(); flowChannel.reset(); dataOperationsChannel.reset();
  show('loading-view');
  const host = $('loading-view'); if (host) host.textContent = '唯讀訪客驗收已到期或關閉，請關閉此頁。';
}
function enableGuestView(session) {
  state.guestReadOnly = true; state.guestExpiresAt = session.expiresAt;
  const banner = document.createElement('p'); banner.id = 'guest-read-only-banner'; banner.setAttribute('role','status');
  banner.textContent = '臨時唯讀訪客 · 真實資料（不保證新鮮） · 至 ' + session.expiresAt + ' · 本機其他程式亦可能讀取 · AI／帳號／寫入停用';
  $('dashboard-view').prepend(banner);
  for (const selector of ['#ai-inline','#dw-journal-form','#dw-lock-snapshot','#dw-copy-chatgpt','#refresh-button','#logout-button','[data-dashboard-page]']) {
    document.querySelectorAll(selector).forEach(node => { if (node.dataset.dashboardPage === 'workspace') return; node.hidden = true;
      if ('disabled' in node) node.disabled = true; node.querySelectorAll('button,input,select,textarea').forEach(control => { control.disabled = true; }); });
  }
  const wait = Date.parse(session.expiresAt) - Date.now();
  if (!Number.isFinite(wait) || wait <= 0 || wait > 900000) { expireGuestView(); return false; }
  state.guestExpiryMono = performance.now() + wait;
  setTimeout(expireGuestView, wait); return true;
}
async function api(path, options = {}) {
  if (state.guestReadOnly && (Date.now() >= Date.parse(state.guestExpiresAt) || performance.now() >= state.guestExpiryMono)) { expireGuestView(); throw Error('GUEST_EXPIRED'); }
  if (state.guestReadOnly && options.method && options.method !== 'GET') throw Error('GUEST_READ_ONLY');
  const requestSession = state.csrfToken;
  const headers = { 'Accept': 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', ...options, headers }); }
  catch (error) {
    const chartCancelled = path.startsWith('/api/v1/tx-chart?') && options.signal?.aborted
      && ['CHART_REQUEST_SUPERSEDED', 'CHART_REQUEST_TIMEOUT'].includes(options.signal.reason)
      && (error === options.signal.reason || error?.name === 'AbortError');
    if (state.guestReadOnly && !chartCancelled) expireGuestView();
    throw error;
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = { ok: false, error: 'INVALID_RESPONSE' }; }
  if (state.guestReadOnly && response.status === 410) expireGuestView();
  if (response.status === 401 && requestSession === state.csrfToken) {
    state.csrfToken = '';
    show('login-view');
  }
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function text(id, value) {
  $(id).textContent = value == null || value === '' ? '—' : String(value);
}

function tone(id, direction = 0, caution = false) {
  const node = $(id);
  node.classList.remove('positive', 'negative', 'warning-text');
  if (caution) node.classList.add('warning-text');
  else if (direction > 0) node.classList.add('positive');
  else if (direction < 0) node.classList.add('negative');
}

function sectionSummary(id, score, available = true) {
  const node = $(id);
  node.className = 'sentiment neutral';
  if (!available) { node.className = 'sentiment pending'; node.textContent = '資料不足'; return; }
  const value = Number(score || 0);
  const label = value >= 25 ? '偏多' : value >= 10 ? '中性偏多' : value <= -25 ? '偏空' : value <= -10 ? '中性偏空' : '中性';
  if (value >= 10) node.className = 'sentiment bullish';
  if (value <= -10) node.className = 'sentiment bearish';
  node.textContent = `${label} ${signed(value)}`;
}

function fmt(value, digits = 0) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function finiteNumber(value) {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signed(value, suffix = '', digits = 0) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${fmt(number, digits)}${suffix}`;
}

function pct(value) { return signed(value, '%', 2); }
function timeLabel(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
}

function metric(label, value, note = '', direction = 0) {
  const card = document.createElement('article');
  card.className = 'metric-card';
  card.dataset.label = label;
  const heading = document.createElement('div');
  heading.className = 'metric-heading';
  const p = document.createElement('p');
  p.textContent = label;
  heading.append(p);
  const strong = document.createElement('strong');
  strong.textContent = value;
  if (direction > 0) strong.classList.add('positive');
  if (direction < 0) strong.classList.add('negative');
  const small = document.createElement('small');
  small.textContent = note;
  const unavailable = /資料累積中|尚未接入|下一階段|研究中|待確認|^—/.test(String(value));
  const reading = document.createElement('div');
  reading.className = 'metric-reading';
  const judgment = document.createElement('span');
  const riskMetric = ['資料異常', 'VIX', '美國 VIX', '今日波動率', '臺指波動率指數'].includes(label);
  if (unavailable) {
    judgment.className = 'sentiment pending'; judgment.textContent = '待資料';
  } else if (riskMetric && direction < 0) {
    judgment.className = 'sentiment caution'; judgment.textContent = '風險注意';
  } else if (riskMetric && direction > 0) {
    judgment.className = 'sentiment neutral'; judgment.textContent = '正常';
  } else if (direction > 0) {
    judgment.className = 'sentiment bullish'; judgment.textContent = '偏多';
  } else if (direction < 0) {
    judgment.className = 'sentiment bearish'; judgment.textContent = '偏空';
  } else {
    judgment.className = 'sentiment neutral'; judgment.textContent = '觀察';
  }
  reading.append(judgment, small);
  const helpText = FIELD_HELP[label] || `${label}的詳細定義、資料限制與更新狀態。數值為「—」或「資料累積中」時，不應解讀為 0。`;
  if (helpText) {
    const helpId = `help-${crypto.randomUUID()}`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'info-toggle';
    toggle.textContent = '?';
    toggle.setAttribute('aria-label', `查看${label}說明`);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', helpId);
    heading.append(toggle);
    const help = document.createElement('div');
    help.id = helpId;
    help.className = 'metric-help hidden';
    help.textContent = `${helpText}｜目前數值：${value}｜目前判斷：${judgment.textContent}｜本次判斷依據：${note || '僅供結構觀察，尚無方向判斷。'}`;
    card.append(heading, strong, reading, help);
  } else {
    card.append(heading, strong, reading);
  }
  return card;
}

function replaceCards(id, cards, priorityLabels = []) {
  const target = $(id);
  for (const card of cards) appendMetricSources(card, id, state.snapshot);
  const byLabel = new Map(cards.map((card) => [card.dataset.label, card]));
  const prioritized = priorityLabels.map((label) => byLabel.get(label)).filter(Boolean);
  const prioritySet = new Set(priorityLabels);
  const remaining = cards.filter((card) => !prioritySet.has(card.dataset.label));
  const primary = priorityLabels.length ? prioritized : cards;
  target.className = 'metric-stack';
  const primaryGrid = document.createElement('div');
  primaryGrid.className = 'metric-grid metric-grid-primary';
  primaryGrid.append(...primary);
  if (!priorityLabels.length || !remaining.length) { target.replaceChildren(primaryGrid); return; }
  const more = document.createElement('details');
  more.className = 'metric-more';
  const summary = document.createElement('summary');
  summary.textContent = `展開進階指標（${remaining.length}）`;
  const secondaryGrid = document.createElement('div');
  secondaryGrid.className = 'metric-grid metric-grid-secondary';
  secondaryGrid.append(...remaining);
  more.append(summary, secondaryGrid);
  target.replaceChildren(primaryGrid, more);
}

$('app').addEventListener('click', (event) => {
  const toggle = event.target.closest('.info-toggle');
  if (!toggle) return;
  const help = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!help) return;
  const opening = help.classList.contains('hidden');
  help.classList.toggle('hidden', !opening);
  toggle.setAttribute('aria-expanded', String(opening));
  toggle.textContent = opening ? '×' : '?';
});

function metricSourceKeys(group, label, snapshot) {
  const oi=snapshot?.derived?.futures?.openInterestSources?.current
    ??(snapshot?.largeTraders?.data?.marketOi!=null?'largeTraders':'futuresMarket');
  if (label === '期現貨基差') return ['futuresMarket', 'marketOverview'];
  if (['台指期近月','台指夜盤','近月成交量','夜盤未平倉量','近月／次月價差'].includes(label)) return ['futuresMarket'];
  if (label === '市場未平倉') return [oi];
  if (['未平倉單日增減','價格 × OI 判讀'].includes(label)) return [oi,'previousOpenInterest'];
  if (label.startsWith('Top ')) return ['largeTraders'];
  if (label === '距離結算日') return ['futuresMarket','options'];
  if (label === '臺指波動率指數') return ['taiwanVix'];
  if (['上市漲跌家數','上櫃漲跌家數','上市上漲／下跌','上櫃上漲／下跌'].includes(label)) return ['marketBreadth'];
  if (label === '資料異常') return Object.keys(snapshot?.sources || {});
  if (['上漲成交量占比','電子／金融／傳產強弱','前十大權值股貢獻','法人與指數背離'].includes(label)) return ['notConnected'];
  if (label === '選擇權波動資料') return ['optionVolatilityDerived'];
  return [{ 'market-cards':'marketOverview','spot-cards':'spotInstitutional','futures-cards':'futuresInstitutional','options-cards':'options' }[group] || 'unknown'];
}

function appendMetricSources(card, group, snapshot) {
  const keys=metricSourceKeys(group,card.dataset.label,snapshot);
  for(const key of keys.length?keys:['unknown']) {
    const badge=document.createElement('div');badge.dataset.sourceKey=key;
    const item={...snapshot?.[key],...snapshot?.sources?.[key]};
    if(key==='previousOpenInterest'){
      const prior=snapshot?.derived?.futures?.openInterestSources?.previous;
      const validTime=Number.isFinite(Date.parse(prior?.lastSuccessfulAt))&&Date.parse(prior.lastSuccessfulAt)<=Date.now();
      const comparisonReason=snapshot?.derived?.futures?.openInterestComparisonReason;
      const complete=prior?.ok&&prior.dataDate&&validTime&&!comparisonReason;
      item.update={...prior,status:complete?'AVAILABLE':'STALE',
        reason:comparisonReason??prior?.reason??(complete?null:'HISTORICAL_SOURCE_EVIDENCE_INCOMPLETE')};
    }
    if(key==='notConnected')item.update={status:'STALE',reason:'DATA_NOT_CONNECTED'};
    if(key==='optionVolatilityDerived')item.update={status:'STALE',dataDate:snapshot?.researchDecision?.v362Risk?.options?.tradeDate??null,
      reason:'DERIVED_PUBLICATION_TIME_NOT_PROVIDED',sourceTime:null,lastSuccessfulAt:null,lastAttemptAt:null};
    paintSourceBadge(badge,item);
    if(key==='previousOpenInterest')badge.prepend(document.createTextNode('前一比較來源 · '));
    card.append(badge);
  }
}

function sourceBadge(id, item) { paintSourceBadge($(id),item); }
function paintSourceBadge(badge, item) {
  if (!badge) return;
  const update=item?.update;
  const labels={NOT_DUE:'未到發布時段',SOURCE_NOT_PUBLISHED:'來源尚未公布',JOB_NOT_RUN:'尚無本次更新紀錄',
    JOB_FAILED:'本次更新失敗',STALE:'資料已過期或品質待確認',AVAILABLE:'資料可用'};
  const status=update?.status??'STALE';
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'未知';
  badge.textContent = `來源資料日 ${update?.dataDate||item?.dataDate||'未知'} · ${labels[status]||status} (${status})`;
  badge.className = `source-badge source-detail ${status==='AVAILABLE'?'good':status==='JOB_FAILED'?'bad':'warn'}`;
  const detail=document.createElement('small');detail.className='source-error';
  detail.textContent=`來源時間 ${stamp(update?.sourceTime)} · 最後成功取得 ${stamp(update?.lastSuccessfulAt)} · 最後嘗試 ${stamp(update?.lastAttemptAt)}`;
  badge.append(detail);
  if(update?.reason||!update){const reason=document.createElement('small');reason.className='source-error';
    reason.textContent=`原因：${update?.reason||'更新時間證據不足'}${item?.error&&item.error!==update?.reason?' · '+item.error:''}`;badge.append(reason);}
}

function regimeLabel(value) {
  return ({ bull_trend: '多頭趨勢', bear_trend: '空頭趨勢', high_volatility: '高波動', bullish_day: '單日偏多', bearish_day: '單日偏空', high_volatility_background: '全球高波動', range: '多空混合／震盪' })[value] || '待判斷';
}
function biasLabel(value) { return ({ long: '偏多', short: '偏空', lean_long: '中性偏多', lean_short: '中性偏空', neutral: '中性' })[value] || '待判斷'; }
function tradeLabel(value) { return ({ wait: '等待', observe_setup: '觀察觸發' })[value] || '等待'; }

function renderV3Decision(snapshot) {
  const decision = snapshot.researchDecision?.v3;
  const price = snapshot.priceConfirmation || {};
  if (!decision?.available) {
    text('v3-data-date', '研究資料尚未就緒');
    text('v3-headline', 'V3風險模型需要至少80個完整交易日');
    return;
  }
  const risk = decision.risk || {};
  const direction = decision.direction || {};
  const action = decision.action || {};
  const scoreValue = Math.max(0, Math.min(100, Number(risk.score || 0)));
  const ring = $('v3-risk-ring');
  ring.style.setProperty('--risk-value', scoreValue);
  ring.classList.toggle('risk-high', scoreValue >= 60);
  ring.classList.toggle('risk-medium', scoreValue >= 40 && scoreValue < 60);
  text('v3-risk-score', fmt(scoreValue));
  text('v3-risk-level', `${risk.level || '—'}風險`);
  text('v3-risk-headline', `${fmt(risk.activeGroups)}/${fmt(risk.totalGroups)} 個風險群組進入歷史極端區`);
  text('v3-risk-note', risk.note);
  text('v3-data-date', `資料日 ${decision.dataDate}｜${fmt(decision.sampleDays)}日校準`);
  const resolved = (decision.forward?.outcomeRecords || 0) + (decision.v34Forward?.resolvedOutcomes || 0);
  const pending = (decision.forward?.pending?.length || 0) + (decision.v34Forward?.status === 'waiting_for_post_freeze_data' ? 2 : 0);
  text('v3-mode', `V3.4前推 已結算 ${resolved}｜等待 ${pending}`);
  const groupValue = (item) => {
    if (item.key === 'price' || item.key === 'global') return signed(item.value, '%', 2);
    if (item.key === 'options') return fmt(item.value, 2);
    if (item.key === 'foreignRisk') return `${fmt(item.value)}/3`;
    return signed(item.value, '口');
  };
  $('v3-risk-groups').replaceChildren(...(risk.groups || []).map((item) => {
    const card = document.createElement('div');
    card.className = `risk-group${item.active ? ' is-active' : ''}`;
    const label = document.createElement('span'); label.textContent = item.label;
    const value = document.createElement('b'); value.textContent = groupValue(item);
    const stateLabel = document.createElement('small'); stateLabel.textContent = !item.available ? (item.unavailableReason || '本日不計分') : item.active ? '進入歷史前30%風險區' : '未達極端門檻';
    card.title = `${item.explanation}；目前 ${groupValue(item)}`;
    card.append(label, value, stateLabel);
    return card;
  }));
  const priceReady = Boolean(price.ready && ['long_confirmed', 'short_confirmed'].includes(price.state));
  const evidence = snapshot.researchDecision?.v362Risk?.evidence || {};
  const evidenceLevel = Number.isFinite(Number(evidence.level)) ? Number(evidence.level) : 0;
  const evidenceReady = evidence.liveEligible === true;
  const paperSetupReady = Boolean(priceReady && scoreValue < 60 && direction.votes?.length);
  const executableStatus = paperSetupReady
    ? (evidenceReady ? '紙上劇本成立，面板仍不下單' : '紙上條件成立，禁止實單')
    : (action.status || '防守等待');
  text('v3-action', executableStatus || '防守等待');
  text('v3-headline', action.headline);
  const gateReasons = evidenceReady
    ? [...(action.reasons || [])]
    : ['研究證據尚未達實單門檻，只限紙上觀察。', ...(action.reasons || [])];
  $('v3-reasons').replaceChildren(...gateReasons.map((reason) => {
    const item = document.createElement('div'); item.className = 'reason-item'; item.textContent = reason; return item;
  }));
  const riskGate = $('v3-gate-risk');
  riskGate.className = `gate ${scoreValue >= 60 ? 'is-blocked' : 'is-ready'}`;
  riskGate.querySelector('small').textContent = scoreValue >= 60 ? `${risk.level}，禁止追價` : `${risk.level}，可繼續觀察`;
  const directionGate = $('v3-gate-direction');
  directionGate.className = `gate ${direction.votes?.length ? 'is-ready' : 'is-blocked'}`;
  directionGate.querySelector('small').textContent = direction.bias || '沒有共識';
  const priceGate = $('v3-gate-price');
  priceGate.className = `gate ${priceReady ? 'is-ready' : 'is-blocked'}`;
  priceGate.querySelector('small').textContent = priceReady ? '價格與量能已確認' : (price.reasons?.[0] || '等待5分鐘K與VWAP');
  const evidenceGate = $('v3-gate-evidence');
  evidenceGate.className = `gate ${evidenceReady ? 'is-ready' : 'is-blocked'}`;
  evidenceGate.querySelector('small').textContent = evidenceReady
    ? `L${fmt(evidenceLevel)}/2 已達標；面板仍唯讀`
    : `L${fmt(evidenceLevel)}/2；只限紙上觀察`;
  text('v3-large-move', `${risk.largeMove?.level || '—'}｜${fmt(risk.largeMove?.score)}/100`);
  text('v3-large-evidence', `樣本外 AUC ${fmt(risk.largeMove?.holdoutAuc, 2)}｜高風險組 ${fmt(risk.largeMove?.topBucketLift, 2)}×`);
  text('v3-gap-risk', `${risk.overnightGap?.level || '—'}｜${fmt(risk.overnightGap?.score)}/100`);
  text('v3-gap-evidence', `樣本外 AUC ${fmt(risk.overnightGap?.holdoutAuc, 2)}｜高風險組 ${fmt(risk.overnightGap?.topBucketLift, 2)}×`);
  text('v3-direction', direction.bias || '—');
  tone('v3-direction', Math.sign(direction.score || 0));
  text('v3-direction-note', direction.votes?.length ? `${direction.votes.length}組候選：${direction.votes.map((item) => item.label).join('、')}；不是勝率` : '沒有候選條件；不勉強猜方向');
  text('v3-price-state', priceReady ? '已確認' : '未確認');
  tone('v3-price-state', price.state === 'long_confirmed' ? 1 : price.state === 'short_confirmed' ? -1 : 0, !priceReady);
  text('v3-price-note', price.ready ? `TX ${fmt(price.lastClose)}｜VWAP ${fmt(price.vwap)}｜量比 ${fmt(price.volumeRatio, 2)}` : (price.reasons?.[0] || '等待5分鐘K與VWAP'));
  text('advice-action', executableStatus || '防守等待');
  text('decision-conclusion', action.headline);
  text('decision-reason', [...(!evidenceReady ? ['研究證據未達實單門檻'] : []), ...(action.reasons || []), ...(decision.vetoes || [])].join('；'));
  text('decision-trigger', `偏多：${action.longTrigger}；偏空：${action.shortTrigger}`);
  text('decision-invalidation', action.invalidation);
  text('advice-stocks', scoreValue >= 60 ? '風險因子同步升高，不追價；觀察外資現貨與台幣是否止穩。' : '先用外資5日現貨流量與台幣方向確認資金環境，不用單日買賣超追價。');
  text('advice-futures', `${direction.bias}只列為候選；${priceReady ? '價格條件已確認，仍須依停損控制風險。' : '價格尚未確認，維持等待，不把籌碼直接當進場點。'}`);
  text('advice-options', 'Call／Put牆、OI與Max Pain用來標示攻防區和波動風險，不參與方向加分；未接即時Greeks前不推估造市商真實Gamma。');
  text('advice-risk', decision.vetoes?.length ? decision.vetoes.join('；') : '目前沒有硬性禁止條件，但方向研究仍未達自動交易標準。');
}

function renderV362Briefing(snapshot) {
  const risk = snapshot.researchDecision?.v362Risk;
  if (!risk?.available) {
    text('v362-data-date', '資料尚未建立');
    text('v362-cache', '等待更新');
    text('v362-pending', 'V3.6.2 研究資料尚未載入');
    return;
  }

  const levelLabels = { high: '高', medium: '中', low: '低', unknown: '待確認' };
  const foreignLabels = { bearish_watch: '偏空觀察', bullish_watch: '偏多觀察', neutral: '中性', unknown: '待確認' };
  const shortLabels = { high_add: '明顯加空', small_add: '小幅加空', reduced: '空單減少', flat: '無變化', unknown: '待確認' };
  const price = snapshot.priceConfirmation || {};
  const staleSources = Object.values(snapshot.sources || {}).filter((item) => item?.stale || item?.fallbackFromCache);
  const databaseBehind = Boolean(snapshot.asOfDate && risk.dataDate && snapshot.asOfDate > risk.dataDate);
  const pending = [...(risk.dataQuality?.pending || []).map((item) => item.label)];
  if (databaseBehind) pending.unshift(`V3 資料庫待補 ${snapshot.asOfDate}`);

  text('v362-data-date', `資料日期 ${risk.dataDate || '--'}`);
  const dataBadge = $('v362-data-date');
  dataBadge.className = `source-badge ${pending.length ? 'warn' : 'good'}`;
  text('v362-evidence-badge', `研究證據 L${fmt(risk.evidence?.level)}／2`);
  $('v362-evidence-badge').className = 'source-badge warn';
  text('v362-direction', risk.direction || '中性');
  text('v362-volatility', levelLabels[risk.volatilityRisk] || '待確認');
  text('v362-recommendation', risk.recommendation || '等待資料更新');
  text('v362-evidence-note', `研究證據：${risk.evidence?.interpretation || '風險候選，非下單訊號'}；${risk.riskDirection || '無明顯方向風險'}`);
  const posture = $('v362-posture');
  posture.className = `v362-posture risk-${risk.volatilityRisk || 'unknown'}`;

  const vixChange = risk.vix?.change5dPct;
  text('v362-vix-change', vixChange == null ? '--' : signed(vixChange, '%', 1));
  const vixInterpretation = risk.vix?.level === 'high' ? 'VIX 上升或進入高檔，波動風險升高'
    : risk.vix?.level === 'medium' ? 'VIX 五日上升，風險正在增溫'
      : risk.vix?.level === 'low' ? 'VIX 五日未升高，不代表方向偏多' : 'VIX 資料待更新';
  text('v362-vix-note', `${vixInterpretation}／${risk.vix?.dataDate || '--'}／VIX ${fmt(risk.vix?.value, 2)}`);
  $('v362-vix-change').parentElement.className = `v362-metric is-${risk.vix?.level || 'unknown'}`;

  const optionAlerts = [risk.options?.atmAlert ? 'ATM IV 高檔' : '', risk.options?.skewAlert ? 'Skew 高檔' : ''].filter(Boolean);
  text('v362-option-vol', risk.options?.atmIv == null ? '--' : `IV ${fmt(risk.options.atmIv * 100, 1)}%／Skew ${fmt((risk.options.skew25d || 0) * 100, 1)}%`);
  text('v362-option-note', `${optionAlerts.join('、') || '未達研究高檔門檻'}／${risk.options?.contract || '--'}／${risk.options?.tradeDate || '--'}`);
  $('v362-option-vol').parentElement.className = `v362-metric is-${risk.options?.level === 'high' ? 'high' : risk.options?.level === 'normal' ? 'low' : 'unknown'}`;

  const foreignDirection = foreignLabels[risk.foreignFutures?.direction] || '待確認';
  text('v362-foreign-5d', risk.foreignFutures?.delta5d == null ? '--' : signed(risk.foreignFutures.delta5d, ' 口'));
  text('v362-foreign-note', `${foreignDirection}；研究極端門檻 ±${fmt(risk.foreignFutures?.absoluteThreshold)} 口`);
  $('v362-foreign-5d').parentElement.className = `v362-metric ${risk.foreignFutures?.direction === 'neutral' ? 'is-low' : 'is-medium'}`;

  const shortState = shortLabels[risk.foreignFutures?.shortAlert] || '待確認';
  text('v362-short-add', risk.foreignFutures?.shortAdd1d == null ? '--' : signed(risk.foreignFutures.shortAdd1d, ' 口'));
  text('v362-short-note', `${shortState}；警示門檻 +${fmt(risk.foreignFutures?.shortAddThreshold)} 口`);
  $('v362-short-add').parentElement.className = `v362-metric ${risk.foreignFutures?.shortAlert === 'high_add' ? 'is-high' : 'is-low'}`;

  const priceReady = Boolean(price.ready && ['long_confirmed', 'short_confirmed'].includes(price.state));
  text('v362-price', priceReady ? (price.state === 'long_confirmed' ? '多方已確認' : '空方已確認') : '未確認');
  text('v362-price-note', priceReady ? `TX ${fmt(price.lastClose)}／VWAP ${fmt(price.vwap, 1)}／量比 ${fmt(price.volumeRatio, 2)}` : (price.reasons?.[0] || '5 分 K／VWAP 尚未完成確認'));
  $('v362-price').parentElement.className = `v362-metric ${priceReady ? 'is-low' : 'is-medium'}`;

  text('v362-cache', staleSources.length ? `舊快取 ${staleSources.length} 項` : '未使用舊快取');
  text('v362-pending', pending.length ? `尚待：${pending.slice(0, 4).join('、')}${pending.length > 4 ? `等 ${pending.length} 項` : ''}` : '已追蹤資料皆更新至核心資料日');
  $('v362-cache').parentElement.className = `v362-metric ${staleSources.length || pending.length ? 'is-medium' : 'is-low'}`;
  text('v362-quality', `時間稽核 ${risk.dataQuality?.timingAuditPassed ? '通過' : '未通過'}／研究品質閘門 ${risk.dataQuality?.researchReady ? '通過' : '未通過'}`);
}

function renderPrelive(prelive) {
  state.prelive = prelive || null;
  let brokerStatus = $('broker-feed-status');
  if (!brokerStatus) {
    brokerStatus = document.createElement('div');
    brokerStatus.id = 'broker-feed-status';
    brokerStatus.className = 'broker-feed-status';
    brokerStatus.setAttribute('aria-live', 'polite');
    $('prelive-status').closest('.section-heading')?.insertAdjacentElement('afterend', brokerStatus);
  }
  const live = prelive?.marketFeed?.liveProvider;
  const liveWarnings = [
    live?.duplicateEvents ? `重複 ${fmt(live.duplicateEvents)}` : '',
    live?.sequenceGaps ? `序號缺口 ${fmt(live.sequenceGaps)}` : '',
    live?.clockSkewEvents ? `時間偏差 ${fmt(live.clockSkewEvents)}` : '',
  ].filter(Boolean);
  brokerStatus.textContent = live?.connected
    ? `● Shioaji 已連線｜唯讀行情｜${fmt(live.symbolsReceived || 0)} 個商品｜事件 ${fmt(live.eventsWritten || 0)} 筆｜${live.lowDisk ? '磁碟空間不足' : live.eventStorage === 'append_only_hash_chain' ? '雜湊鏈保存正常' : '事件保存待確認'}${liveWarnings.length ? `｜警示：${liveWarnings.join('、')}` : ''}｜下單功能關閉`
    : `○ Shioaji 未連線｜${live?.error === 'bridge_timeout' ? '本機服務逾時' : '請啟動 15_START_SHIOAJI_READONLY.bat'}`;
  brokerStatus.classList.toggle('connected', Boolean(live?.connected));
  const scenarios = prelive?.costScenarios || [];
  $('prelive-cost-grid').replaceChildren(...scenarios.map((item) => {
    const card = document.createElement('article'); card.className = 'prelive-cost-card';
    const label = document.createElement('span'); label.textContent = item.label;
    const points = document.createElement('strong'); points.textContent = `${fmt(item.totalPoints, 2)} 點`;
    const cash = document.createElement('b'); cash.textContent = `來回約 ${fmt(item.totalCash)} 元`;
    const note = document.createElement('small'); note.textContent = `手續費 ${fmt(item.commissionPerSide)}元/邊｜稅 ${fmt(item.taxCash)}元｜滑價 ${fmt(item.slippagePoints)}點`;
    card.append(label, points, cash, note); return card;
  }));
  if (!scenarios.length) $('prelive-cost-grid').textContent = '尚無可用台指參考價，等待盤面資料。';
  const statusLabel = { ready: '已就緒', interface_ready: '介面已就緒', awaiting_data: '等待資料', planned: '待建立' };
  $('prelive-phases').replaceChildren(...(prelive?.phases || []).map((phase) => {
    const item = document.createElement('div'); item.className = `prelive-phase ${phase.status}`;
    const name = document.createElement('b'); name.textContent = phase.label;
    const status = document.createElement('span'); status.textContent = statusLabel[phase.status] || phase.status;
    item.append(name, status); return item;
  }));
  text('prelive-status', prelive?.executionAuthorized ? '執行開啟' : '只讀研究・不下單');
  const feed = prelive?.marketFeed;
  const replayDates = feed?.replayDates || [];
  const availableDates = new Set(replayDates.map((item) => item.tradeDate));
  state.replayDate = availableDates.has(state.replayDate) ? state.replayDate : (feed?.defaultReplayDate || replayDates.at(-1)?.tradeDate || '');
  const dateSelect = $('replay-date-select');
  dateSelect.replaceChildren(...replayDates.map((item) => {
    const option = document.createElement('option'); option.value = item.tradeDate;
    option.textContent = `${item.tradeDate}｜${item.contract || '—'}｜${item.auditPassed ? '已稽核' : '待稽核'}`;
    return option;
  }));
  dateSelect.value = state.replayDate;
  dateSelect.disabled = !replayDates.length;
  text('replay-status', feed?.replayImported
    ? `已有 ${fmt(feed.replayDays || replayDates.length)} 個完整交易日；目前日期可逐根或完整日回放。`
    : '尚未匯入歷史5分鐘K棒；介面與安全限制已就緒。');
  $('replay-reset').disabled = !feed?.replayImported;
  $('replay-next').disabled = !feed?.replayImported;
  $('replay-all').disabled = !feed?.replayImported;
}

function replayClock(timestamp) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
}

function replayVwapSeries(bars) {
  let volume = 0; let value = 0;
  return bars.map((bar) => {
    const barVolume = Number(bar.volume) || 0;
    volume += barVolume;
    value += ((Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3) * barVolume;
    return volume ? value / volume : null;
  });
}

function renderReplayMetrics(replay) {
  const context = replay.context || {};
  const cards = [
    ['交易日／合約', `${replay.selectedTradeDate || '—'}／${context.contract || '—'}`, `${context.auditPassed ? 'OHLC 稽核通過' : '尚未通過完整稽核'}｜覆蓋 ${fmt(context.coveragePct)}%`],
    ['最新價／近似 VWAP', `${fmt(replay.lastClose)}／${fmt(replay.vwap, 1)}`, replay.lastClose > replay.vwap ? '價格在 VWAP 上方' : replay.lastClose < replay.vwap ? '價格在 VWAP 下方' : '等待更多 K 棒'],
    ['開盤 15 分鐘', `${fmt(replay.openingRangeLow)}～${fmt(replay.openingRangeHigh)}`, '突破後仍須量能與回測證據確認'],
    ['夜盤高低', `${fmt(context.nightLow)}～${fmt(context.nightHigh)}`, context.nightContractMatches ? `同合約 ${context.nightContract || '—'}` : '換月合約不同，不作突破依據'],
    ['前日高低收', `${fmt(context.previousDayLow)}～${fmt(context.previousDayHigh)}`, `前收 ${fmt(context.previousDayClose)}`],
    ['20日同時段 RVOL', context.relativeVolume20d == null ? '樣本不足' : `${fmt(context.relativeVolume20d, 2)}×`, `目前樣本 ${fmt(context.relativeVolumeSampleDays)}/20 日`],
  ];
  $('replay-metrics').replaceChildren(...cards.map(([label, value, note]) => {
    const article = document.createElement('article');
    const span = document.createElement('span'); span.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    const small = document.createElement('small'); small.textContent = note;
    article.append(span, strong, small); return article;
  }));
  const issues = [];
  if (!context.auditPassed) issues.push(`稽核 ${context.auditState || '未完成'}`);
  if ((context.coveragePct || 0) < 95) issues.push(`K棒覆蓋僅 ${fmt(context.coveragePct)}%`);
  if (context.nightHigh != null && !context.nightContractMatches) issues.push('日夜盤合約不一致');
  if ((context.relativeVolumeSampleDays || 0) < 20) issues.push(`RVOL 尚缺 ${20 - (context.relativeVolumeSampleDays || 0)} 日樣本`);
  text('replay-quality', issues.length ? `資料品質提醒：${issues.join('；')}。此日僅供研究。` : '資料品質：OHLC 已稽核、日夜盤合約一致、20日同時段量能基準完整。');
  $('replay-quality').className = `section-note ${issues.length ? 'warning-text' : 'positive'}`;
}

function renderReplayChart(replay) {
  const target = $('replay-chart');
  const bars = replay.bars || [];
  if (!bars.length) { target.textContent = replay.reasons?.[0] || '沒有可顯示的5分鐘K棒。'; $('replay-metrics').replaceChildren(); return; }
  const width = 1020; const height = 430; const left = 66; const right = 86; const priceTop = 24; const priceBottom = 300; const volumeTop = 328; const volumeBottom = 392;
  const plotWidth = width - left - right; const step = plotWidth / Math.max(1, bars.length); const x = (index) => left + index * step + step / 2;
  const context = replay.context || {};
  const references = [
    ['開盤區上緣', replay.openingRangeHigh, 'opening'], ['開盤區下緣', replay.openingRangeLow, 'opening'],
    ['前日高', context.previousDayHigh, 'previous'], ['前日低', context.previousDayLow, 'previous'],
    ['夜盤高', context.nightContractMatches ? context.nightHigh : null, 'night'], ['夜盤低', context.nightContractMatches ? context.nightLow : null, 'night'],
  ].filter(([, value]) => Number.isFinite(Number(value)));
  const vwap = replayVwapSeries(bars);
  const prices = bars.flatMap((bar) => [bar.high, bar.low]).concat(vwap, references.map(([, value]) => value));
  let [rawMin, rawMax] = extent(prices); const padding = Math.max(5, (rawMax - rawMin) * .05); const min = rawMin - padding; const max = rawMax + padding;
  const y = (value) => priceTop + (max - Number(value)) / (max - min) * (priceBottom - priceTop);
  const volumeMax = Math.max(1, ...bars.map((bar) => Number(bar.volume) || 0));
  const volumeY = (value) => volumeBottom - (Number(value) || 0) / volumeMax * (volumeBottom - volumeTop);
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${replay.selectedTradeDate || ''} 台指期5分鐘K棒、VWAP與關鍵價位` });

  for (let index = 0; index <= 4; index += 1) {
    const value = min + (max - min) * index / 4; const tickY = y(value);
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: tickY, y2: tickY, class: 'replay-grid' }));
    const label = svgNode('text', { x: left - 9, y: tickY + 4, class: 'axis-label', 'text-anchor': 'end' }); label.textContent = fmt(value); svg.append(label);
  }
  references.forEach(([label, value, cls], index) => {
    const lineY = y(value); svg.append(svgNode('line', { x1: left, x2: width - right, y1: lineY, y2: lineY, class: `replay-reference ${cls}` }));
    const textNode = svgNode('text', { x: width - right + 6, y: lineY + (index % 2 ? 10 : -3), class: `replay-reference-label ${cls}` }); textNode.textContent = `${label} ${fmt(value)}`; svg.append(textNode);
  });

  const bodyWidth = Math.max(2, Math.min(9, step * .62));
  const rvolByTimestamp = new Map((replay.relativeVolumeSeries || []).map((item) => [item.timestamp, item]));
  bars.forEach((bar, index) => {
    const open = Number(bar.open); const high = Number(bar.high); const low = Number(bar.low); const close = Number(bar.close); const rising = close >= open;
    svg.append(svgNode('line', { x1: x(index), x2: x(index), y1: y(high), y2: y(low), class: `candle-wick ${rising ? 'up' : 'down'}` }));
    svg.append(svgNode('rect', { x: x(index) - bodyWidth / 2, y: y(Math.max(open, close)), width: bodyWidth, height: Math.max(1.5, y(Math.min(open, close)) - y(Math.max(open, close))), class: `candle-body ${rising ? 'up' : 'down'}` }));
    svg.append(svgNode('rect', { x: x(index) - bodyWidth / 2, y: volumeY(bar.volume), width: bodyWidth, height: Math.max(1, volumeBottom - volumeY(bar.volume)), class: `replay-volume ${rising ? 'up' : 'down'}` }));
    if (index % Math.max(1, Math.ceil(bars.length / 8)) === 0 || index === bars.length - 1) {
      const time = svgNode('text', { x: x(index), y: 417, class: 'axis-label', 'text-anchor': 'middle' }); time.textContent = replayClock(bar.timestamp); svg.append(time);
    }
    const hit = svgNode('rect', { x: left + index * step, y: priceTop, width: Math.max(2, step), height: volumeBottom - priceTop, class: 'chart-hit', tabindex: 0 });
    const show = () => {
      const rvol = rvolByTimestamp.get(bar.timestamp);
      $('replay-hover').textContent = `${replay.selectedTradeDate} ${replayClock(bar.timestamp)}｜開 ${fmt(open)} 高 ${fmt(high)} 低 ${fmt(low)} 收 ${fmt(close)}｜量 ${fmt(bar.volume)}｜近似VWAP ${fmt(vwap[index], 1)}｜20日同時段量比 ${rvol?.ratio == null ? '樣本不足' : `${fmt(rvol.ratio, 2)}×（${fmt(rvol.sampleDays)}/20日）`}`;
    };
    hit.addEventListener('mouseenter', show); hit.addEventListener('focus', show); hit.setAttribute('aria-label', `${replayClock(bar.timestamp)} OHLCV`); svg.append(hit);
  });
  const vwapPoints = vwap.map((value, index) => Number.isFinite(value) ? `${x(index)},${y(value)}` : null).filter(Boolean).join(' ');
  if (vwapPoints) svg.append(svgNode('polyline', { points: vwapPoints, class: 'replay-vwap' }));
  const volumeLabel = svgNode('text', { x: left, y: volumeTop - 8, class: 'axis-label' }); volumeLabel.textContent = `成交量（最大 ${fmt(volumeMax)}）`; svg.append(volumeLabel);
  target.replaceChildren(svg);
  renderReplayMetrics(replay);
}

async function loadReplay(cursor, tradeDate = state.replayDate) {
  const params = new URLSearchParams({ cursor: String(Math.max(1, Number(cursor) || 1)) });
  if (tradeDate) params.set('tradeDate', tradeDate);
  const payload = await api(`/api/v1/intraday/replay?${params}`);
  const replay = payload.data || {};
  state.replayCursor = replay.cursor || 1;
  state.replayTotalBars = replay.totalBars || 0;
  state.replayDate = replay.selectedTradeDate || state.replayDate;
  if ($('replay-date-select').value !== state.replayDate) $('replay-date-select').value = state.replayDate;
  text('replay-status', replay.totalBars
    ? `${replay.selectedTradeDate}｜回放 ${fmt(replay.cursor)}/${fmt(replay.totalBars)}｜TX ${fmt(replay.lastClose)}｜近似VWAP ${fmt(replay.vwap, 2)}｜${replay.ready ? '價格條件已計算' : (replay.reasons?.[0] || '累積K棒中')}`
    : (replay.reasons?.[0] || '尚未匯入歷史5分鐘K棒'));
  $('replay-reset').disabled = !replay.totalBars || !replay.hasPrevious;
  $('replay-next').disabled = !replay.totalBars || !replay.hasNext;
  $('replay-all').disabled = !replay.totalBars || !replay.hasNext;
  renderReplayChart(replay);
}

function setCockpitAxis(id, value, note, status = 'neutral') {
  const target = $(id); if (!target) return;
  target.className = `axis-card is-${status}`;
  const strong = target.querySelector('strong'); const small = target.querySelector('small');
  if (strong) strong.textContent = value; if (small) small.textContent = note;
}

function renderEvidenceItems(id, countId, items) {
  const target = $(id); if (!target) return;
  text(countId, String(items.length));
  const nodes = items.map((item) => {
    const row = document.createElement('div'); row.className = 'evidence-item';
    const body = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = item.title;
    const detail = document.createElement('small'); detail.textContent = item.detail;
    const value = document.createElement('b'); value.textContent = item.value;
    body.append(title, detail); row.append(body, value); return row;
  });
  target.replaceChildren(...(nodes.length ? nodes : [Object.assign(document.createElement('p'), { textContent: '本日沒有達到門檻的項目。' })]));
}

function renderDecisionCockpit(snapshot) {
  const signal = snapshot.signal || {};
  const risk = snapshot.researchDecision?.v362Risk || {};
  const price = snapshot.priceConfirmation || {};
  const spot = snapshot.spotInstitutional?.data || {};
  const derivedSpot = snapshot.derived?.spot || {};
  const futures = snapshot.futuresInstitutional?.data || {};
  const derivedFutures = snapshot.derived?.futures || {};
  const listed = snapshot.marketBreadth?.data?.listed || {};
  const otc = snapshot.marketBreadth?.data?.otc || {};
  const options = snapshot.options?.data || {};
  const officialDirection = risk.direction || '中性';
  const volLevel = risk.volatilityRisk || (signal.volatilityRisk >= 70 ? 'high' : signal.volatilityRisk >= 40 ? 'medium' : 'low');
  const volLabel = ({ high: '高波動', medium: '中波動', low: '低波動' })[volLevel] || '待確認';
  const researchBias = `${biasLabel(signal.bias)} ${signed(signal.totalScore || 0)}`;
  const priceReady = Boolean(price.ready);
  const posture = !priceReady ? `${officialDirection}・${volLabel}，等待價格` : `${officialDirection}・${volLabel}`;
  text('cockpit-data-date', `資料日 ${risk.dataDate || snapshot.asOfDate || '—'}`);
  const researchReady = Boolean(risk.dataQuality?.researchReady);
  text('cockpit-quality', researchReady ? '時間稽核通過' : '資料待稽核');
  $('cockpit-quality').className = `source-badge ${researchReady ? 'ok' : 'warn'}`;
  text('cockpit-action', posture);
  text('cockpit-recommendation', risk.recommendation || signal.advice?.action || '等待條件形成');
  text('cockpit-direction', officialDirection);
  text('cockpit-research-bias', researchBias);
  text('cockpit-prohibition', volLevel === 'high' ? '禁止追價' : !priceReady ? '禁止預判進場' : '依風控執行');
  const postureNode = $('cockpit-posture');
  postureNode.className = `cockpit-posture ${volLevel === 'high' ? 'is-danger' : !priceReady ? 'is-wait' : 'is-ready'}`;

  setCockpitAxis('axis-direction', officialDirection, `研究觀察 ${researchBias}`,
    officialDirection.includes('多') ? 'bull' : officialDirection.includes('空') ? 'bear' : 'neutral');
  setCockpitAxis('axis-volatility', `${volLabel} ${fmt(signal.volatilityRisk)}`, '0～100風險尺', volLevel === 'high' ? 'danger' : volLevel === 'medium' ? 'observe' : 'safe');
  const optionRisk = risk.options || {};
  setCockpitAxis('axis-options', optionRisk.level === 'high' ? 'IV／Skew升溫' : optionRisk.atmIv == null ? '等待雷達' : '波動一般',
    optionRisk.contract ? `${optionRisk.contract}・盤後` : '等待契約資料', optionRisk.level === 'high' ? 'danger' : optionRisk.atmIv == null ? 'unknown' : 'observe');
  setCockpitAxis('axis-price', priceReady ? (price.state === 'long_confirmed' ? '多方確認' : price.state === 'short_confirmed' ? '空方確認' : '條件已計算') : '未確認',
    priceReady ? `VWAP ${fmt(price.vwap)}・量比 ${fmt(price.volumeRatio, 2)}` : (price.reasons?.[0] || '等待5分鐘行情'), priceReady ? 'safe' : 'blocked');
  const tradability = Number(signal.tradabilityScore);
  setCockpitAxis('axis-tradability', Number.isFinite(tradability) ? `${fmt(tradability)}/100` : '—',
    signal.tradeState === 'wait' ? '目前不交易' : '仍需風控', tradability >= 70 ? 'safe' : tradability >= 40 ? 'observe' : 'blocked');
  const evidenceLevel = risk.evidence?.level;
  setCockpitAxis('axis-evidence', evidenceLevel == null ? '待評估' : `L${evidenceLevel}`,
    risk.evidence?.liveEligible ? '可進前向驗證' : '風險候選，非下單訊號', risk.evidence?.liveEligible ? 'safe' : 'observe');

  const bull = []; const bear = []; const conflict = [];
  const institutionalTotal = finiteNumber(derivedSpot.institutionalTotalE);
  if (institutionalTotal != null) (institutionalTotal >= 0 ? bull : bear).push({ title: '三大法人現貨', value: signed(institutionalTotal, '億', 1), detail: '單日合計，只代表當日資金流' });
  const foreign5d = finiteNumber(derivedSpot.foreign5dE);
  if (foreign5d != null) (foreign5d >= 0 ? bull : bear).push({ title: '外資現貨5日', value: signed(foreign5d, '億', 1), detail: '短線累積資金方向' });
  const foreign20d = finiteNumber(derivedSpot.foreign20dE);
  if (foreign20d != null) (foreign20d >= 0 ? bull : bear).push({ title: '外資現貨20日', value: signed(foreign20d, '億', 1), detail: '波段累積資金方向' });
  const breadthItem = (name, row) => {
    const total = Number(row.advance || 0) + Number(row.decline || 0); if (!total) return;
    const breadth = ((Number(row.advance || 0) - Number(row.decline || 0)) / total) * 100;
    (breadth >= 0 ? bull : bear).push({ title: `${name}市場廣度`, value: signed(breadth, '%', 1), detail: `上漲／下跌 ${fmt(row.advance)}/${fmt(row.decline)}・漲停／跌停 ${fmt(row.limitUp)}/${fmt(row.limitDown)}` });
  };
  breadthItem('上市', listed); breadthItem('上櫃', otc);
  const futures5d = finiteNumber(derivedFutures.foreignNet5dDelta);
  if (futures5d != null) (futures5d >= 0 ? bull : bear).push({ title: '外資期貨5日增減', value: signed(futures5d, '口'), detail: futures5d >= 0 ? '淨部位改善觀察，不等於新多單' : '淨部位轉弱觀察，不等於必跌' });
  const shortDelta = finiteNumber(derivedFutures.foreignShortDelta);
  if (shortDelta != null) (shortDelta <= 0 ? bull : bear).push({ title: '外資空單單日', value: signed(shortDelta, '口'), detail: shortDelta <= 0 ? '空單減少／回補觀察' : '空單增加風險觀察' });
  if (finiteNumber(futures.foreignNet) != null) conflict.push({ title: '外資期貨存量', value: signed(futures.foreignNet, '口'), detail: '可能包含避險與套利，不直接判多空' });
  if (finiteNumber(options.oiPcRatio) != null) conflict.push({ title: '選擇權OI P/C', value: fmt(options.oiPcRatio, 2), detail: '存量結構需搭配履約價、權利金與價格' });
  if (volLevel === 'high') conflict.push({ title: '高波動否決', value: `${fmt(signal.volatilityRisk)}/100`, detail: '方向即使正確，追價與停損風險仍偏高' });
  if (!priceReady) conflict.push({ title: '價格尚未確認', value: 'WAIT', detail: price.reasons?.[0] || '等待VWAP、CVD與成交量' });
  const staleCount = Object.values(snapshot.sources || {}).filter((source) => source.stale || !source.ok).length;
  if (staleCount) conflict.push({ title: '資料時點', value: `${staleCount}項待更新`, detail: '盤後資料尚未公布時沿用前一完整交易日' });
  renderEvidenceItems('bull-evidence-list', 'bull-evidence-count', bull);
  renderEvidenceItems('conflict-evidence-list', 'conflict-evidence-count', conflict);
  renderEvidenceItems('bear-evidence-list', 'bear-evidence-count', bear);

  const componentNames = { spot: '現貨法人', futures: '期貨籌碼', options: '選擇權', breadth: '市場廣度' };
  const componentNodes = Object.entries(signal.components || {}).map(([key, raw]) => {
    const score = Number(raw) || 0; const row = document.createElement('article'); row.className = `component-row ${score > 10 ? 'positive' : score < -10 ? 'negative' : 'neutral'}`;
    const label = document.createElement('span'); label.textContent = componentNames[key] || key;
    const track = document.createElement('div'); track.className = 'component-track';
    const progress = document.createElement('progress'); progress.max = 200; progress.value = Math.max(0, Math.min(200, score + 100)); track.append(progress);
    const value = document.createElement('strong'); value.textContent = signed(score);
    row.append(label, track, value); return row;
  });
  $('cockpit-component-bars').replaceChildren(...componentNodes);

  const shadow = snapshot.sixAxisShadow || {};
  const shadowAxes = Array.isArray(shadow.axes) ? shadow.axes : [];
  text('shadow-score-summary', shadow.shadowObservation == null
    ? `可用 ${shadow.availableAxes || 0}/${shadow.totalAxes || 6} 軸`
    : `影子觀察 ${fmt(shadow.shadowObservation)}/100｜正式權重 0`);
  text('shadow-score-note', shadow.note || '影子分數不影響正式方向，正式權重固定為 0。');
  text('shadow-score-audit', shadow.inputHash
    ? `資料日 ${shadow.dataDate || '—'}｜構成雜湊 ${shadow.inputHash.slice(0, 12)}…｜${timeLabel(shadow.recordedAt)}`
    : '尚未產生構成雜湊');
  const shadowNodes = shadowAxes.map((item) => {
    const row = document.createElement('article');
    row.className = `shadow-axis-row is-${item.state || 'unknown'}`;
    const heading = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = item.label || item.key;
    const meaning = document.createElement('small'); meaning.textContent = item.meaning || '資料不足';
    heading.append(title, meaning);
    const value = document.createElement('b');
    const signedValue = Number(item.signedValue);
    value.textContent = item.available
      ? (Number.isFinite(signedValue) ? `${signed(signedValue)}｜強度 ${fmt(item.value)}` : `${fmt(item.value)}/100`)
      : '資料不足';
    const formula = document.createElement('p');
    formula.textContent = `${item.formula || '—'}｜正式權重 ${fmt(item.formalWeight)}`;
    row.append(heading, value, formula);
    return row;
  });
  const shadowTarget = $('shadow-six-axis-list');
  if (shadowTarget) shadowTarget.replaceChildren(...(shadowNodes.length
    ? shadowNodes
    : [Object.assign(document.createElement('p'), { textContent: '等待六軸影子紀錄' })]));
}

function renderSnapshotUnavailable(reason = 'EOD_SNAPSHOT_UNAVAILABLE') {
  state.snapshot = null;
  const message = `UNAVAILABLE · ${reason} · 每日資料不可用，資料日期未知`;
  // Remove previously rendered current-day values; historical views remain separate.
  // Do not render an empty snapshot: legacy renderers default some missing scores to 0.
  const values = ['as-of','regime','bias','score','risk-scores','risk-score-note','confidence','completeness',
    'trade-state','tradability','price-confirmation','price-confirmation-note','score-explanation','regime-note',
    'advice-action','decision-conclusion','decision-reason','decision-trigger','decision-invalidation',
    'advice-stocks','advice-futures','advice-options','advice-risk','cockpit-data-date','cockpit-quality',
    'cockpit-action','cockpit-recommendation','cockpit-direction','cockpit-research-bias','cockpit-prohibition',
    'shadow-score-summary','shadow-score-note','shadow-score-audit','v362-data-date','v362-cache','v362-pending',
    'v362-evidence-badge','v362-direction','v362-volatility','v362-recommendation','v362-evidence-note',
    'v362-vix-change','v362-vix-note','v362-option-vol','v362-option-note','v362-foreign-5d','v362-foreign-note',
    'v362-short-add','v362-short-note','v362-price','v362-price-note','v362-quality','v3-data-date','v3-headline',
    'v3-risk-score','v3-risk-level','v3-risk-headline','v3-risk-note','v3-mode','v3-action','v3-large-move',
    'v3-large-evidence','v3-gap-risk','v3-gap-evidence','v3-direction','v3-direction-note','v3-price-state',
    'v3-price-note',
    'overview-date','spot-date','margin-date','futures-date','options-date','quality-summary',
    'spot-summary','futures-summary','options-summary','bull-evidence-count','bear-evidence-count','conflict-evidence-count'];
  for (const id of values) {
    const target = $(id); if (!target) continue;
    target.textContent = message; target.classList.remove('positive','negative','good','bad','ok');
  }
  for (const target of document.querySelectorAll('.cockpit-axis-grid strong, .cockpit-axis-grid small')) target.textContent = '— UNAVAILABLE';
  for (const target of document.querySelectorAll('.cockpit-axis-grid .axis-card')) target.className = 'axis-card is-unknown';
  for (const id of ['v3-gate-risk','v3-gate-direction','v3-gate-price','v3-gate-evidence']) {
    const gate = $(id); if (!gate) continue;
    gate.className = 'gate is-blocked'; const label = gate.querySelector('small');
    if (label) label.textContent = message;
  }
  if ($('cockpit-posture')) $('cockpit-posture').className = 'cockpit-posture is-wait';
  if ($('v362-posture')) $('v362-posture').className = 'v362-posture risk-unknown';
  $('v3-risk-ring')?.style.removeProperty('--risk-value');
  $('v3-risk-ring')?.classList.remove('risk-high','risk-medium');
  for (const id of ['market-cards','spot-cards','futures-cards','options-cards','breadth-trend-panel','spot-trend-panel',
    'margin-trend-panel','futures-trend-panel','options-trend-panel','score-bars','cockpit-component-bars',
    'shadow-six-axis-list','v3-risk-groups','v3-reasons','bull-evidence-list','bear-evidence-list','conflict-evidence-list','alert-area']) {
    const note = document.createElement('p'); note.textContent = message;
    $(id)?.replaceChildren(note);
  }
  for (const id of ['options-contract-table','source-table']) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = 10; cell.textContent = message; row.append(cell); $(id)?.replaceChildren(row);
  }
  $('option-contract-select')?.replaceChildren();
  renderDealerMap(null); renderOptionOiChart(null);
}

function render(snapshot) {
  state.snapshot = snapshot;
  renderDecisionCockpit(snapshot);
  const signal = snapshot.signal || {};
  text('as-of', `面板產生時間：${timeLabel(snapshot.generatedAt)}｜研究資料日：${snapshot.asOfDate || '—'}`);
  const combinedRegime = signal.regime === 'high_volatility_background' ? `全球高波動・${biasLabel(signal.bias)}` : regimeLabel(signal.regime);
  text('regime', combinedRegime);
  tone('regime', ['bullish_day', 'bull_trend'].includes(signal.regime) ? 1 : ['bearish_day', 'bear_trend'].includes(signal.regime) ? -1 : 0, ['high_volatility_background', 'high_volatility'].includes(signal.regime));
  text('bias', biasLabel(signal.bias));
  tone('bias', ['long', 'lean_long'].includes(signal.bias) ? 1 : ['short', 'lean_short'].includes(signal.bias) ? -1 : 0);
  text('score', `研究方向分數 ${signed(signal.totalScore || 0)}`);
  text('risk-scores', `${fmt(signal.volatilityRisk)}/${fmt(signal.gapRisk)}`);
  text('risk-score-note', `波動 ${fmt(signal.volatilityRisk)}/100｜跳空 ${fmt(signal.gapRisk)}/100（研究尺）`);
  text('confidence', `${fmt(signal.directionStrength ?? Math.abs(signal.totalScore || 0))}/100`);
  tone('confidence', 0, false);
  text('completeness', `一致度 ${fmt(signal.agreementPct)}%（${fmt(signal.directionalCount)}項）｜模型覆蓋 ${fmt(signal.modelCoveragePct)}%｜來源 ${fmt(signal.completenessPct)}%`);
  text('trade-state', tradeLabel(signal.tradeState));
  text('tradability', `交易就緒度 ${fmt(signal.tradabilityScore)}/100`);
  tone('trade-state', 0, signal.tradeState === 'wait');
  const priceConfirmation = snapshot.priceConfirmation || {};
  const priceStateLabel = ({ long_confirmed: '多方價格確認', short_confirmed: '空方價格確認', above_vwap_wait: 'VWAP上方等待', below_vwap_wait: 'VWAP下方等待',
    neutral_wait: '價格等待', insufficient_bars: 'K棒不足', stale: '盤中資料過期', not_connected: '尚未連接' })[priceConfirmation.state] || '未確認';
  text('price-confirmation', priceStateLabel);
  text('price-confirmation-note', priceConfirmation.ready
    ? `TX ${fmt(priceConfirmation.lastClose)}｜VWAP ${fmt(priceConfirmation.vwap)}｜量比 ${fmt(priceConfirmation.volumeRatio, 2)}`
    : (priceConfirmation.reasons?.[0] || '分鐘行情尚未接入'));
  const includedKeys = new Set((signal.calculation?.included || []).map((item) => item.key));
  sectionSummary('spot-summary', signal.components?.spot, includedKeys.has('spot'));
  sectionSummary('futures-summary', signal.components?.futures, includedKeys.has('futures'));
  sectionSummary('options-summary', signal.components?.options, includedKeys.has('options'));
  const componentNames = { spot: '現貨', futures: '期貨', options: '選擇權', breadth: '市場寬度' };
  const included = signal.calculation?.included || [];
  text('score-explanation', included.length
    ? `本次計算：(${included.map((item) => `${componentNames[item.key] || item.key} ${signed(item.score)}×${item.weightPct}%`).join(' ＋ ')}) ÷ 有效權重 ${fmt(signal.modelCoveragePct)}% ＝ ${signed(signal.totalScore)}。${signal.calculation?.note || ''}`
    : '目前沒有足夠分項可計算。');

  const alert = $('alert-area');
  alert.replaceChildren();
  if (signal.conflicts?.length) {
    const box = document.createElement('div');
    box.className = 'alert warning';
    box.textContent = `目前保持等待：${signal.conflicts.join('；')}`;
    alert.append(box);
  }
  const highVolStudy = snapshot.researchDecision?.noTrade?.highVolatility;
  if (highVolStudy) {
    const box = document.createElement('div'); box.className = 'alert warning';
    box.textContent = `研究追蹤：排除高波動後保留期 PF ${fmt(highVolStudy.keptProfitFactor, 2)}，但被排除樣本只有 ${fmt(highVolStudy.vetoedTrades)} 筆，尚未達上線門檻。`;
    alert.append(box);
  }
  const incrementalStudy = snapshot.researchDecision?.incremental;
  if (incrementalStudy) {
    const box = document.createElement('div'); box.className = 'alert warning';
    box.textContent = incrementalStudy.holdoutSupportedComparisons
      ? `研究追蹤：共同日期配對留出檢驗有 ${fmt(incrementalStudy.holdoutSupportedComparisons)}/${fmt(incrementalStudy.holdoutTotalComparisons)} 項通過，仍須新資料前推。`
      : `研究限制：共同日期配對留出檢驗 0/${fmt(incrementalStudy.holdoutTotalComparisons)} 項通過，方向分數不可視為已證明優勢。`;
    alert.append(box);
  }

  const overview = snapshot.marketOverview?.data || {};
  const listed = snapshot.marketBreadth?.data?.listed || {};
  const otcBreadth = snapshot.marketBreadth?.data?.otc || {};
  const listedBreadthPct = (listed.advance || listed.decline) ? ((listed.advance - listed.decline) / (listed.advance + listed.decline)) * 100 : null;
  const otcBreadthPct = (otcBreadth.advance || otcBreadth.decline) ? ((otcBreadth.advance - otcBreadth.decline) / (otcBreadth.advance + otcBreadth.decline)) * 100 : null;
  const breadthDirection = (value) => value >= 10 ? 1 : value <= -10 ? -1 : 0;
  text('regime-note', `${signal.regimeMethod || '暫行模型'}｜指數 ${pct(overview.twii?.changePct)}｜廣度 ${signed(listedBreadthPct, '%', 1)}｜風險 ${fmt(signal.volatilityRisk)}/100`);
  const advice = signal.advice || {};
  text('advice-action', advice.action || '等待價格確認');
  text('decision-conclusion', advice.conclusion || '等待資料');
  text('decision-reason', advice.reason || '等待資料');
  text('decision-trigger', advice.trigger || '尚未建立');
  text('decision-invalidation', advice.invalidation || '尚未建立');
  text('advice-stocks', advice.stocks || '等待資料');
  text('advice-futures', advice.futures || '等待資料');
  text('advice-options', advice.options || '等待資料');
  text('advice-risk', advice.risk || '等待資料');
  const futuresMarket = snapshot.futuresMarket?.data || {};
  const taiwanVix = snapshot.taiwanVix?.data?.close;
  const derived = snapshot.derived || {};
  const monthlyExpiry = snapshot.options?.data?.contracts?.find((item) => item.contract === futuresMarket.txDay?.contract && item.type === 'monthly');
  const failedSources = Object.values(snapshot.sources || {}).filter((item) => !item.ok).length;
  sourceBadge('overview-date', {...snapshot.marketOverview,...snapshot.sources?.marketOverview});
  replaceCards('market-cards', [
    metric('加權指數', fmt(overview.twii?.price, 2), pct(overview.twii?.changePct), Math.sign(overview.twii?.change || 0)),
    metric('台指期近月', fmt(futuresMarket.txDay?.close), `${futuresMarket.txDay?.contract || '—'}・${pct(futuresMarket.txDay?.changePct)}`, Math.sign(futuresMarket.txDay?.change || 0)),
    metric('台指夜盤', fmt(futuresMarket.txNight?.close), futuresMarket.txNight ? `${futuresMarket.txNight.contract || '—'}・${pct(futuresMarket.txNight.changePct)}` : '官方資料尚未取得', Math.sign(futuresMarket.txNight?.change || 0)),
    metric('期現貨基差', signed(derived.market?.basis, ' 點', 2), derived.market?.basisPct == null ? '等待同日資料' : `${signed(derived.market.basisPct, '%', 3)}・期貨減現貨`, Math.sign(derived.market?.basis || 0)),
    metric('距離結算日', monthlyExpiry ? `${fmt(monthlyExpiry.daysToExpiry)} 天` : '待確認', monthlyExpiry?.expiryDate || '等待契約日曆'),
    metric('臺指波動率指數', fmt(taiwanVix, 2), taiwanVix >= 30 ? '≥30，本地預期波動偏高' : taiwanVix >= 18 ? '≥18，本地波動需注意' : '本地波動相對溫和', taiwanVix >= 18 ? -1 : 1),
    metric('美國 VIX', fmt(overview.vix, 2), overview.vix >= 18 ? '高於18，全球風險需注意' : '未達18警戒線', overview.vix >= 18 ? -1 : 1),
    metric('櫃買指數', fmt(overview.otc?.price, 2), pct(overview.otc?.changePct), Math.sign(overview.otc?.change || 0)),
    metric('上市漲跌家數', `${fmt(listed.advance)} / ${fmt(listed.decline)}`, `${listed.decline > listed.advance ? `下跌多 ${fmt(listed.decline - listed.advance)} 家` : `上漲多 ${fmt(listed.advance - listed.decline)} 家`}・廣度 ${signed(listedBreadthPct, '%', 1)}・漲停/跌停 ${fmt(listed.limitUp)}/${fmt(listed.limitDown)}`, breadthDirection(listedBreadthPct)),
    metric('上櫃漲跌家數', `${fmt(otcBreadth.advance)} / ${fmt(otcBreadth.decline)}`, `${otcBreadth.decline > otcBreadth.advance ? `下跌多 ${fmt(otcBreadth.decline - otcBreadth.advance)} 家` : `上漲多 ${fmt(otcBreadth.advance - otcBreadth.decline)} 家`}・廣度 ${signed(otcBreadthPct, '%', 1)}・漲停/跌停 ${fmt(otcBreadth.limitUp)}/${fmt(otcBreadth.limitDown)}`, breadthDirection(otcBreadthPct)),
    metric('美元／台幣', fmt(overview.usdtwd, 3), '匯率背景'),
    metric('資料更新時間', timeLabel(snapshot.generatedAt), `資料日 ${snapshot.asOfDate || '—'}`),
    metric('資料異常', failedSources ? `${failedSources} 個來源` : '無', failedSources ? '請查看資料品質區' : '來源檢查正常', failedSources ? -1 : 1),
  ], ['加權指數', '台指期近月', '台指夜盤', '臺指波動率指數', '上市漲跌家數', '上櫃漲跌家數']);

  const spot = snapshot.spotInstitutional?.data || {};
  sourceBadge('spot-date', {...snapshot.spotInstitutional,...snapshot.sources?.spotInstitutional});
  replaceCards('spot-cards', [
    metric('外資', signed(spot.foreignNetE, ' 億', 1), '當日現貨買賣超', Math.sign(spot.foreignNetE || 0)),
    metric('投信', signed(spot.trustNetE, ' 億', 1), '當日現貨買賣超', Math.sign(spot.trustNetE || 0)),
    metric('自營商自行', signed(spot.dealerProprietaryNetE, ' 億', 1), '方向交易', Math.sign(spot.dealerProprietaryNetE || 0)),
    metric('自營商避險', signed(spot.dealerHedgeNetE, ' 億', 1), '與自行買賣分開', Math.sign(spot.dealerHedgeNetE || 0)),
    metric('三大法人合計', signed(derived.spot?.institutionalTotalE, ' 億', 1), '外資＋投信＋自營商', Math.sign(derived.spot?.institutionalTotalE || 0)),
    metric('外資近5日', derived.spot?.foreign5dE == null ? '資料累積中' : signed(derived.spot.foreign5dE, ' 億', 1), `目前 ${fmt(derived.sampleDays)} 個交易日樣本`, Math.sign(derived.spot?.foreign5dE || 0)),
    metric('外資近20日', derived.spot?.foreign20dE == null ? '資料累積中' : signed(derived.spot.foreign20dE, ' 億', 1), `需要20個交易日・目前 ${fmt(derived.sampleDays)}`, Math.sign(derived.spot?.foreign20dE || 0)),
    metric('外資歷史百分位', derived.spot?.foreignPercentile252 == null ? '資料累積中' : `${fmt(derived.spot.foreignPercentile252)}%`, '至少20日後開始顯示'),
    metric('法人與指數背離', '資料累積中', '需要連續歷史報酬'),
    metric('上市上漲／下跌', `${fmt(listed.advance)} / ${fmt(listed.decline)}`, `廣度 ${signed(listedBreadthPct, '%', 1)}・只描述當日擴散`, breadthDirection(listedBreadthPct)),
    metric('上櫃上漲／下跌', `${fmt(otcBreadth.advance)} / ${fmt(otcBreadth.decline)}`, `廣度 ${signed(otcBreadthPct, '%', 1)}・只描述當日擴散`, breadthDirection(otcBreadthPct)),
    metric('上漲成交量占比', '尚未接入', '需要個股成交量資料'),
    metric('電子／金融／傳產強弱', '尚未接入', '需要類股指數資料'),
    metric('前十大權值股貢獻', '尚未接入', '需要權重與個股即時資料'),
  ], ['外資', '外資近5日', '外資近20日', '三大法人合計', '外資歷史百分位']);

  const margin = snapshot.margin?.data || {};
  sourceBadge('margin-date', {...snapshot.margin,...snapshot.sources?.margin});

  const inst = snapshot.futuresInstitutional?.data || {};
  const large = snapshot.largeTraders?.data || {};
  sourceBadge('futures-date', {...snapshot.futuresInstitutional,...snapshot.sources?.futuresInstitutional});
  replaceCards('futures-cards', [
    metric('台指期近月', fmt(futuresMarket.txDay?.close, 0), `${futuresMarket.txDay?.contract || '—'}・${pct(futuresMarket.txDay?.changePct)}`, Math.sign(futuresMarket.txDay?.change || 0)),
    metric('外資淨部位', signed(inst.foreignNet, ' 口'), inst.deltaAvailable ? `日變化 ${signed(inst.foreignNetDelta, ' 口')}` : '等待可比較交易日', Math.sign(inst.foreignNetDelta || 0)),
    metric('外資空單', `${fmt(inst.foreignShort)} 口`, inst.deltaAvailable ? `日變化 ${signed(inst.foreignShortDelta, ' 口')}` : '絕對值不直接等於看空', -(Math.sign(inst.foreignShortDelta || 0))),
    metric('自營商淨部位', signed(inst.dealerNet, ' 口'), '期貨', Math.sign(inst.dealerNet || 0)),
    metric('投信淨部位', signed(inst.trustNet, ' 口'), '臺股期貨', Math.sign(inst.trustNet || 0)),
    metric('外資單日增減', derived.futures?.foreignNetDelta == null ? '資料累積中' : signed(derived.futures.foreignNetDelta, ' 口'), `前一資料日 ${derived.previousDataDate || '尚無'}`, Math.sign(derived.futures?.foreignNetDelta || 0)),
    metric('外資5日增減', derived.futures?.foreignNet5dDelta == null ? '資料累積中' : signed(derived.futures.foreignNet5dDelta, ' 口'), '需要6個交易日部位資料', Math.sign(derived.futures?.foreignNet5dDelta || 0)),
    metric('近月成交量', `${fmt(futuresMarket.txDay?.volume)} 口`, futuresMarket.txDay?.contract || '—'),
    metric('夜盤未平倉量', futuresMarket.txNight?.openInterest > 0 ? `${fmt(futuresMarket.txNight.openInterest)} 口` : '官方未提供', '0 不視為真實未平倉量'),
    metric('Top 5 L/S', large.top5Short ? fmt(large.top5Long / large.top5Short, 2) : '—', `${fmt(large.top5Long)} / ${fmt(large.top5Short)}・僅看集中方向`, large.top5Short ? (large.top5Long / large.top5Short > 1.05 ? 1 : large.top5Long / large.top5Short < 0.95 ? -1 : 0) : 0),
    metric('Top 10 L/S', large.top10Short ? fmt(large.top10Long / large.top10Short, 2) : '—', `${fmt(large.top10Long)} / ${fmt(large.top10Short)}・僅看集中方向`, large.top10Short ? (large.top10Long / large.top10Short > 1.05 ? 1 : large.top10Long / large.top10Short < 0.95 ? -1 : 0) : 0),
    metric('Top 5 多方集中度', derived.futures?.top5LongConcentration == null ? '—' : `${fmt(derived.futures.top5LongConcentration, 1)}%`, '前五大多方／市場 OI'),
    metric('Top 5 空方集中度', derived.futures?.top5ShortConcentration == null ? '—' : `${fmt(derived.futures.top5ShortConcentration, 1)}%`, '前五大空方／市場 OI'),
    metric('市場未平倉', `${fmt(large.marketOi ?? futuresMarket.txDay?.openInterest)} 口`, large.marketOi!=null?'大額交易人資料口徑':'期貨行情 OI 口徑'),
    metric('未平倉單日增減', derived.futures?.openInterestDelta == null ? '資料不足或不可比較' : signed(derived.futures.openInterestDelta, ' 口'), `比較資料日 ${derived.previousDataDate||'未知'}・${derived.futures?.openInterestComparisonReason||'相同來源口徑'}`, Math.sign(derived.futures?.openInterestDelta || 0)),
    metric('期現貨基差', signed(derived.market?.basis, ' 點', 2), '近月期貨－加權指數', Math.sign(derived.market?.basis || 0)),
    metric('近月／次月價差', derived.market?.calendarSpread == null ? '尚無次月資料' : signed(derived.market.calendarSpread, ' 點', 2), '次月－近月', Math.sign(derived.market?.calendarSpread || 0)),
    metric('價格 × OI 判讀', derived.futures?.openInterestDelta == null ? '資料累積中' : '已取得比較資料', '僅列可能解釋，不是確定方向'),
  ], ['外資淨部位', '外資單日增減', '外資5日增減', '市場未平倉', '期現貨基差', '台指期近月']);
  renderCompactTrendPanels(snapshot);

  const options = snapshot.options?.data || {};
  const optionRisk = snapshot.researchDecision?.v362Risk?.options || {};
  const activeOption = (options.contracts || []).find((item) => item.contract === options.contract);
  const strikeCount = Array.isArray(activeOption?.strikes) ? activeOption.strikes.length : 0;
  const optionVolatilityValue = optionRisk.atmIv == null
    ? '尚無可用資料'
    : `ATM IV ${fmt(optionRisk.atmIv * 100, 1)}%`;
  const optionVolatilityNote = optionRisk.atmIv == null
    ? '官方資料尚未形成可靠 IV；不以 0 代替'
    : `${optionRisk.tradeDate || '日期待確認'}・${optionRisk.contract || '契約待確認'}・Skew ${optionRisk.skew25d == null ? '尚無可用資料' : `${fmt(optionRisk.skew25d * 100, 1)}%`}`;
  sourceBadge('options-date', {...snapshot.options,...snapshot.sources?.options});
  renderDealerMap(snapshot.dealerMap);
  replaceCards('options-cards', [
    metric('主力契約', options.contract || '—', `${options.contractType === 'weekly' ? '週選' : '月選'}・到期 ${options.expiryDate || '—'}・剩 ${fmt(options.daysToExpiry)} 天`),
    metric('Call 成交量', `${fmt(options.totalCallVolume)} 口`, options.contract || '—'),
    metric('Put 成交量', `${fmt(options.totalPutVolume)} 口`, options.contract || '—'),
    metric('成交量 P/C Ratio', fmt(options.volumePcRatio, 2), 'Put成交量／Call成交量'),
    metric('Call 未平倉量', `${fmt(options.totalCallOi)} 口`, options.contract || '—'),
    metric('Put 未平倉量', `${fmt(options.totalPutOi)} 口`, options.contract || '—'),
    metric('OI P/C Ratio', fmt(options.oiPcRatio, 2), `Put ${fmt(options.totalPutOi)} / Call ${fmt(options.totalCallOi)}・極端值才偏向`, options.oiPcRatio >= 1.25 ? 1 : options.oiPcRatio <= 0.8 && options.oiPcRatio > 0 ? -1 : 0),
    metric('最大 Call OI 履約價', fmt(options.callWall?.strike), `${fmt(options.callWall?.openInterest)} 口・不保證形成壓力`),
    metric('最大 Put OI 履約價', fmt(options.putWall?.strike), `${fmt(options.putWall?.openInterest)} 口・不保證形成支撐`),
    metric('Max Pain', fmt(options.maxPain), '依該契約 OI 推算'),
    metric('Call OI 單日增減', derived.options?.callOiDelta == null ? '資料累積中' : signed(derived.options.callOiDelta, ' 口'), '需同一契約前一交易日資料'),
    metric('Put OI 單日增減', derived.options?.putOiDelta == null ? '資料累積中' : signed(derived.options.putOiDelta, ' 口'), '需同一契約前一交易日資料'),
    metric('選擇權波動資料', optionVolatilityValue, optionVolatilityNote),
    metric('履約價分布狀態', strikeCount ? `${fmt(strikeCount)} 個履約價` : '尚無可用資料', strikeCount ? '下方 OI 圖已載入主力契約資料' : '主力契約沒有可驗證的履約價資料；不顯示推估值'),
  ], ['主力契約', 'OI P/C Ratio', '成交量 P/C Ratio', '最大 Call OI 履約價', '最大 Put OI 履約價']);

  const contractRows = (options.contracts || []).filter((item) => item.daysToExpiry == null || item.daysToExpiry >= 0).slice(0, 6).map((item) => {
    const tr = document.createElement('tr');
    const cells = [
      item.contract, item.type === 'weekly' ? '週選' : '月選', item.expiryDate, item.daysToExpiry,
      fmt(item.callVolume), fmt(item.putVolume), fmt(item.volumePcRatio, 2),
      fmt(item.callOi), fmt(item.putOi), fmt(item.oiPcRatio, 2),
    ];
    for (const cell of cells) { const td = document.createElement('td'); td.textContent = cell == null ? '—' : String(cell); tr.append(td); }
    return tr;
  });
  $('options-contract-table').replaceChildren(...contractRows);
  const contractSelect = $('option-contract-select');
  const previousSelection = contractSelect.value;
  contractSelect.replaceChildren(...(options.contracts || []).filter((item) => item.daysToExpiry == null || item.daysToExpiry >= 0).map((item) => {
    const option = document.createElement('option');
    option.value = item.contract;
    option.textContent = `${item.contract}｜${item.type === 'weekly' ? '週選' : '月選'}｜${item.expiryDate || '—'}`;
    return option;
  }));
  contractSelect.value = (options.contracts || []).some((item) => item.contract === previousSelection) ? previousSelection : options.contract;
  renderOptionOiChart(contractSelect.value);

  renderV362Briefing(snapshot);
  renderV3Decision(snapshot);
  renderScoreBars(signal);
  renderSources(snapshot.sources || {});
}

function dealerWallNote(wall) {
  if (!wall?.available) return '資料不足';
  const movement = wall.movement == null
    ? '尚無同契約前日比較'
    : wall.movement === 0 ? '牆位未移動'
      : `牆位${wall.movement > 0 ? '上移' : '下移'} ${fmt(Math.abs(wall.movement))} 點`;
  const oiDelta = wall.oiDeltaAtStrike == null ? '' : `，該履約價 OI ${signed(wall.oiDeltaAtStrike, ' 口')}`;
  return `${movement}${oiDelta}，連續 ${fmt(wall.stabilityDays)} 日`;
}

function renderDealerMap(map) {
  const status = $('dealer-map-status');
  const note = $('dealer-map-note');
  const summary = $('dealer-map-summary');
  const zonesTarget = $('dealer-map-zones');
  const historyTarget = $('dealer-map-history');
  const safeguard = $('dealer-map-safeguard');

  if (!map?.available) {
    status.textContent = '資料不足';
    status.className = 'source-badge warn';
    note.textContent = map?.reason || '目前沒有可驗證的逐履約價 OI。';
    summary.replaceChildren();
    zonesTarget.replaceChildren();
    historyTarget.replaceChildren();
    safeguard.textContent = '不以缺失資料推估莊家成本、部位或勝率。';
    return;
  }

  status.textContent = map.state === 'available' ? 'OI 盤後版' : 'OI 盤後版・注意';
  status.className = `source-badge${map.state === 'available' ? '' : ' warn'}`;
  note.textContent = `${map.tradeDate || '日期未明'}・${map.contract || '契約未明'}・同契約 ${fmt(map.sameContractDays)} 日。公開 OI 結構，不代表真實莊家部位、成本或勝率。`;

  const card = (kind, label, value, detail) => {
    const article = document.createElement('article');
    article.className = `dealer-map-metric ${kind || ''}`.trim();
    const title = document.createElement('span');
    title.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = value;
    const small = document.createElement('small');
    small.textContent = detail;
    article.append(title, strong, small);
    return article;
  };

  const balance = map.balanceZone || {};
  const centers = map.oiCenters || {};
  const callWall = map.walls?.call;
  const putWall = map.walls?.put;
  const maxPain = map.maxPain || {};
  const zoneValue = balance.available ? `${fmt(balance.low)}–${fmt(balance.high)}` : '資料不足';
  const centerValue = centers.combined?.weightedMedian == null ? '資料不足' : fmt(centers.combined.weightedMedian);
  const maxPainDistance = maxPain.distanceFromReference == null
    ? '缺少參考價'
    : `期貨相對 Max Pain ${signed(maxPain.distanceFromReference, ' 點')}`;

  summary.replaceChildren(
    card('', 'Balance Zone v0', zoneValue, 'Call / Put OI 中央區；不是莊家成本'),
    card('', '綜合 OI 重心', centerValue, `加權平均 ${fmt(centers.combined?.weightedMean)}`),
    card('call', 'Call OI 重心', fmt(centers.call?.weightedMedian), `加權平均 ${fmt(centers.call?.weightedMean)}`),
    card('put', 'Put OI 重心', fmt(centers.put?.weightedMedian), `加權平均 ${fmt(centers.put?.weightedMean)}`),
    card('call', 'Call Wall', callWall?.available ? fmt(callWall.strike) : '資料不足', dealerWallNote(callWall)),
    card('put', 'Put Wall', putWall?.available ? fmt(putWall.strike) : '資料不足', dealerWallNote(putWall)),
    card('pain', 'Max Pain', maxPain.value == null ? '資料不足' : fmt(maxPain.value), maxPainDistance),
    card('', '資料與限制', `${fmt(map.strikeCount)} 履約價`, `盤後更新・正式六軸權重 0・${map.warnings?.length || 0} 項提醒`),
  );

  const structureZones = map.structureZones || [];
  const minStrike = structureZones.length ? Math.min(...structureZones.map((zone) => zone.low)) : 0;
  const maxStrike = structureZones.length ? Math.max(...structureZones.map((zone) => zone.high)) : 0;
  const span = Math.max(1, maxStrike - minStrike);
  const zoneRows = structureZones.map((zone) => {
    const row = document.createElement('div');
    row.className = 'dealer-zone-row';
    const label = document.createElement('span');
    label.className = 'dealer-zone-label';
    label.textContent = `中央 ${zone.coveragePct}%`;
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    track.setAttribute('class', 'dealer-zone-track');
    track.setAttribute('viewBox', '0 0 100 9');
    track.setAttribute('preserveAspectRatio', 'none');
    track.setAttribute('aria-hidden', 'true');
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('class', 'dealer-zone-background');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', '100');
    background.setAttribute('height', '9');
    const range = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    range.setAttribute('class', 'dealer-zone-range');
    range.setAttribute('x', String((zone.low - minStrike) / span * 100));
    range.setAttribute('y', '0');
    range.setAttribute('width', String(Math.max(1, (zone.high - zone.low) / span * 100)));
    range.setAttribute('height', '9');
    track.append(background, range);
    const value = document.createElement('span');
    value.className = 'dealer-zone-value';
    value.textContent = `${fmt(zone.low)}–${fmt(zone.high)}・實際涵蓋 ${fmt(zone.actualCoveragePct, 1)}%`;
    row.append(label, track, value);
    return row;
  });
  zonesTarget.replaceChildren(...zoneRows);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['日期', '台指期', 'Call Wall', 'Put Wall', 'Max Pain', 'Call OI', 'Put OI'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  });
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  for (const point of map.history || []) {
    const row = document.createElement('tr');
    [
      point.tradeDate,
      fmt(point.referencePrice),
      `${fmt(point.callWallStrike)} / ${fmt(point.callWallOi)}`,
      `${fmt(point.putWallStrike)} / ${fmt(point.putWallOi)}`,
      fmt(point.maxPain),
      fmt(point.callOi),
      fmt(point.putOi),
    ].forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value == null ? '--' : String(value);
      row.append(td);
    });
    tbody.append(row);
  }
  table.append(thead, tbody);
  historyTarget.replaceChildren(table);

  const warningText = map.warnings?.length ? `提醒：${map.warnings.join('；')}。` : '';
  safeguard.textContent = `計算方法：OI 加權平均、中位數、中央涵蓋區與同契約牆位歷史。Delta Neutral、Gamma Center 與真實 Dealer 部位尚未接入；V3.9.7 正式評分權重維持 0。${warningText}`;
}

function calculateOptionMaxPain(strikes) {
  let bestStrike = 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (const candidate of strikes) {
    let pain = 0;
    for (const item of strikes) {
      pain += Math.max(0, candidate.strike - item.strike) * Number(item.callOi || 0);
      pain += Math.max(0, item.strike - candidate.strike) * Number(item.putOi || 0);
    }
    if (pain < minimum) { minimum = pain; bestStrike = candidate.strike; }
  }
  return bestStrike;
}

function renderOptionDefenseSummary(contract, reference, all) {
  const target = $('option-defense-summary');
  const topCalls = contract.topCallWalls?.length
    ? contract.topCallWalls
    : [...all].sort((a, b) => b.callOi - a.callOi).slice(0, 5).map((item) => ({ strike: item.strike, openInterest: item.callOi }));
  const topPuts = contract.topPutWalls?.length
    ? contract.topPutWalls
    : [...all].sort((a, b) => b.putOi - a.putOi).slice(0, 5).map((item) => ({ strike: item.strike, openInterest: item.putOi }));
  const callWall = contract.callWall || topCalls[0];
  const putWall = contract.putWall || topPuts[0];
  const maxPain = Number(contract.maxPain || calculateOptionMaxPain(all));
  const summaryItem = (kind, label, value, note) => {
    const article = document.createElement('article'); article.className = `option-defense-item ${kind}`;
    const name = document.createElement('span'); name.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    const small = document.createElement('small'); small.textContent = note;
    article.append(name, strong, small); return article;
  };
  const ranking = document.createElement('div'); ranking.className = 'option-wall-ranking';
  const lane = (kind, label, rows) => {
    const box = document.createElement('div'); box.className = `option-wall-lane ${kind}`;
    const title = document.createElement('b'); title.textContent = label;
    const values = document.createElement('span');
    values.textContent = rows.slice(0, 3).map((item, index) => `${index + 1}. ${fmt(item.strike)}（${fmt(item.openInterest)}口）`).join('　');
    box.append(title, values); return box;
  };
  ranking.append(lane('call', 'Call 壓力牆前3大', topCalls), lane('put', 'Put 支撐牆前3大', topPuts));
  target.replaceChildren(
    summaryItem('market', '台指期參考價', reference > 0 ? fmt(reference, 2) : '—', '用來比較攻防位置，不是選擇權結算價'),
    summaryItem('call', '最大 Call 牆', fmt(callWall?.strike), `${fmt(callWall?.openInterest)} 口・上方壓力觀察`),
    summaryItem('put', '最大 Put 牆', fmt(putWall?.strike), `${fmt(putWall?.openInterest)} 口・下方支撐觀察`),
    summaryItem('pain', 'Max Pain', fmt(maxPain), '結算結構參考，不等於預測目標價'),
    ranking,
  );
  return { topCalls, topPuts, callWall, putWall, maxPain };
}

function renderOptionOiChart(contractCode) {
  const options = state.snapshot?.options?.data || {};
  const contract = (options.contracts || []).find((item) => item.contract === contractCode);
  const target = $('option-oi-chart');
  const hoverValue = $('option-oi-hover');
  const all = (contract?.strikes || []).filter((item) => item.callOi > 0 || item.putOi > 0);
  if (!all.length) {
    target.textContent = '此契約尚無履約價 OI 明細。請按右上角「重新整理資料」取得新版資料。';
    $('option-defense-summary').replaceChildren();
    hoverValue.textContent = '目前沒有可顯示的履約價數值。';
    return;
  }
  const reference = Number(state.snapshot?.futuresMarket?.data?.txDay?.close || 0);
  const structure = renderOptionDefenseSummary(contract, reference, all);
  const mustShow = new Set([
    ...structure.topCalls.slice(0, 3).map((item) => item.strike),
    ...structure.topPuts.slice(0, 3).map((item) => item.strike),
    structure.maxPain,
  ]);
  const nearest = [...all].sort((a, b) => Math.abs(a.strike - reference) - Math.abs(b.strike - reference)).slice(0, 41);
  const selected = [...new Map([...nearest, ...all.filter((item) => mustShow.has(item.strike))].map((item) => [item.strike, item])).values()]
    .sort((a, b) => a.strike - b.strike);
  const maxOi = Math.max(1, ...selected.flatMap((item) => [item.callOi, item.putOi]));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 900 270');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${contractCode} 履約價攻防圖；紅色為 Call OI，綠色為 Put OI`);
  const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `${contractCode} Call 與 Put 未平倉量攻防分布`;
  const desc = document.createElementNS(svg.namespaceURI, 'desc'); desc.textContent = `最大 Call 牆 ${structure.callWall?.strike}，最大 Put 牆 ${structure.putWall?.strike}，Max Pain ${structure.maxPain}`;
  svg.append(title, desc);
  const baseline = 128; const chartHeight = 92; const left = 48; const width = 810;
  const groupWidth = width / selected.length; const barWidth = Math.max(2, groupWidth * .34);
  const axis = document.createElementNS(svg.namespaceURI, 'line');
  axis.setAttribute('x1', String(left)); axis.setAttribute('x2', String(left + width)); axis.setAttribute('y1', String(baseline)); axis.setAttribute('y2', String(baseline)); axis.setAttribute('class', 'axis'); svg.append(axis);
  const nearestIndex = (value) => selected.reduce((best, item, index) => Math.abs(item.strike - value) < Math.abs(selected[best].strike - value) ? index : best, 0);
  const marker = (value, cssClass, label) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const index = nearestIndex(value); const x = left + groupWidth * index + groupWidth / 2;
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x)); line.setAttribute('y1', '22'); line.setAttribute('y2', '232'); line.setAttribute('class', cssClass); svg.append(line);
    const textNode = document.createElementNS(svg.namespaceURI, 'text'); textNode.setAttribute('x', String(x + 4)); textNode.setAttribute('y', cssClass === 'pain-line' ? '34' : '47'); textNode.setAttribute('class', 'wall-label'); textNode.textContent = `${label} ${fmt(value)}`; svg.append(textNode);
  };
  marker(structure.maxPain, 'pain-line', 'Max Pain');
  marker(reference, 'reference-line', '期貨');
  selected.forEach((item, index) => {
    const center = left + groupWidth * index + groupWidth / 2;
    const callHeight = item.callOi / maxOi * chartHeight;
    const putHeight = item.putOi / maxOi * chartHeight;
    const group = document.createElementNS(svg.namespaceURI, 'g');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', `${fmt(item.strike)}，Call OI ${fmt(item.callOi)}口，Put OI ${fmt(item.putOi)}口`);
    const call = document.createElementNS(svg.namespaceURI, 'rect');
    call.setAttribute('x', String(center - barWidth - 1)); call.setAttribute('y', String(baseline - callHeight)); call.setAttribute('width', String(barWidth)); call.setAttribute('height', String(Math.max(callHeight, 1))); call.setAttribute('class', 'call-bar');
    const put = document.createElementNS(svg.namespaceURI, 'rect');
    put.setAttribute('x', String(center + 1)); put.setAttribute('y', String(baseline)); put.setAttribute('width', String(barWidth)); put.setAttribute('height', String(Math.max(putHeight, 1))); put.setAttribute('class', 'put-bar');
    group.append(call, put); svg.append(group);
    const showValue = () => {
      const pc = item.callOi > 0 ? item.putOi / item.callOi : null;
      const tags = [];
      if (item.strike === structure.callWall?.strike) tags.push('最大 Call 牆');
      if (item.strike === structure.putWall?.strike) tags.push('最大 Put 牆');
      if (item.strike === structure.maxPain) tags.push('Max Pain');
      const distance = reference > 0 ? item.strike - reference : null;
      hoverValue.textContent = `履約價 ${fmt(item.strike)}｜Call OI ${fmt(item.callOi)} 口｜Put OI ${fmt(item.putOi)} 口｜該價 P/C ${pc == null ? '—' : fmt(pc, 2)}${distance == null ? '' : `｜距期貨 ${signed(distance, ' 點', 0)}`}${tags.length ? `｜${tags.join('、')}` : ''}`;
    };
    group.addEventListener('mouseenter', showValue); group.addEventListener('focus', showValue);
    if (index % Math.max(1, Math.ceil(selected.length / 10)) === 0 || index === selected.length - 1 || mustShow.has(item.strike)) {
      const label = document.createElementNS(svg.namespaceURI, 'text'); label.setAttribute('x', String(center)); label.setAttribute('y', '254'); label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'axis-label'); label.textContent = item.strike; svg.append(label);
    }
  });
  const callLabel = document.createElementNS(svg.namespaceURI, 'text'); callLabel.setAttribute('x', '48'); callLabel.setAttribute('y', '15'); callLabel.setAttribute('class', 'axis-label'); callLabel.textContent = `上方：Call OI 壓力（紅）・最大刻度 ${fmt(maxOi)} 口`; svg.append(callLabel);
  const putLabel = document.createElementNS(svg.namespaceURI, 'text'); putLabel.setAttribute('x', '48'); putLabel.setAttribute('y', '269'); putLabel.setAttribute('class', 'axis-label'); putLabel.textContent = '下方：Put OI 支撐（綠）'; svg.append(putLabel);
  target.replaceChildren(svg);
  hoverValue.textContent = `目前契約 ${contractCode}｜滑鼠移到柱狀圖查看數值；OI 牆是可能的攻防區，不保證一定支撐、壓力或成為期貨目標價。`;
}

function renderScoreBars(signal) {
  const components = signal.components || {};
  const labels = { spot: '現貨法人', futures: '期貨籌碼', options: '選擇權', breadth: '市場寬度' };
  const included = new Set((signal.calculation?.included || []).map((item) => item.key));
  const details = {
    spot: `外資現貨 ${signed(state.snapshot?.spotInstitutional?.data?.foreignNetE, ' 億', 1)}`,
    futures: included.has('futures') ? '依外資淨部位及空單日變化' : '缺少前一有效交易日，不能計算部位變化',
    options: `OI P/C ${fmt(state.snapshot?.options?.data?.oiPcRatio, 2)}；0分代表位於0.8～1.25中性區`,
    breadth: `上市＋上櫃漲跌家數計算，分數 ${signed(components.breadth)}`,
  };
  const target = $('score-bars');
  const rows = [];
  for (const [key, label] of Object.entries(labels)) {
    const value = Number(components[key] || 0);
    const row = document.createElement('div');
    row.className = 'score-row';
    const name = document.createElement('div');
    const nameText = document.createElement('span'); nameText.textContent = label;
    const reason = document.createElement('small'); reason.className = 'score-reason'; reason.textContent = details[key];
    name.append(nameText, reason);
    const meter = document.createElement('meter');
    meter.className = value >= 0 ? 'score-positive' : 'score-negative';
    meter.min = -100; meter.max = 100; meter.low = -25; meter.high = 25; meter.optimum = value >= 0 ? 100 : -100; meter.value = value;
    meter.setAttribute('aria-label', `${label} ${signed(value)}`);
    const val = document.createElement('strong');
    const view = !included.has(key) ? '資料不足' : value >= 25 ? '偏多' : value >= 10 ? '中性偏多' : value <= -25 ? '偏空' : value <= -10 ? '中性偏空' : '中性';
    val.textContent = `${signed(value)} ${view}`;
    if (value >= 25) val.classList.add('positive');
    if (value <= -25) val.classList.add('negative');
    row.append(name, meter, val); rows.push(row);
  }
  target.replaceChildren(...rows);
}

function renderSources(sources) {
  const names = {
    marketOverview: '指數／匯率／美國VIX', taiwanVix: '臺指波動率指數', marketBreadth: '市場寬度', spotInstitutional: '三大法人現貨',
    margin: '融資融券', futuresMarket: '期貨行情', futuresInstitutional: '法人期貨', options: '選擇權', largeTraders: '大額交易人',
  };
  const rows = [];
  const counts = { current: 0, pending_publication: 0, cached: 0, stale: 0, failed: 0 };
  for (const [key, source] of Object.entries(sources)) {
    const tr = document.createElement('tr');
    const nameCell = document.createElement('td'); nameCell.textContent = names[key] || key;
    if (source.scope) { const scope = document.createElement('small'); scope.className = 'source-error'; scope.textContent = source.scope; nameCell.append(scope); }
    tr.append(nameCell);
    const sourceCell = document.createElement('td'); sourceCell.textContent = source.source;
    if (source.release) { const release = document.createElement('small'); release.className = 'source-error'; release.textContent = source.release; sourceCell.append(release); }
    tr.append(sourceCell);
    for (const value of [source.dataDate || '—', timeLabel(source.fetchedAt)]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    const status = document.createElement('td');
    const pill = document.createElement('span');
    const freshness = source.update?({AVAILABLE:'current',NOT_DUE:'pending_publication',SOURCE_NOT_PUBLISHED:'pending_publication',
      JOB_NOT_RUN:'stale',JOB_FAILED:'failed',STALE:'stale'}[source.update.status]||'stale')
      :source.freshness || (source.ok ? (source.stale ? 'stale' : 'current') : 'failed');
    counts[freshness] = (counts[freshness] || 0) + 1;
    const statusViews = {
      current: ['good', '最新可用'], pending_publication: ['warn', '等待官方公布'],
      cached: ['warn', '使用舊快取'], stale: ['warn', '資料落後'], failed: ['bad', '抓取失敗'],
    };
    const [tone, label] = statusViews[freshness] || statusViews.failed;
    pill.className = `status ${tone}`;
    pill.textContent = source.update?`${label} · ${source.update.status}`:label;
    status.append(pill);
    if(source.update){const timing=document.createElement('small');timing.className='source-error';
      timing.textContent=`來源時間 ${timeLabel(source.update.sourceTime)} · 最後成功取得 ${timeLabel(source.update.lastSuccessfulAt)}${source.update.reason?' · '+source.update.reason:''}`;status.append(timing);}
    if (source.error) { const err = document.createElement('small'); err.className = 'source-error'; err.textContent = source.error; status.append(err); }
    tr.append(status); rows.push(tr);
  }
  $('source-table').replaceChildren(...rows);
  const issues = counts.cached + counts.stale + counts.failed;
  text('quality-summary', `最新 ${counts.current}｜待公布 ${counts.pending_publication}｜異常 ${issues}`);
  $('quality-summary').className = `source-badge ${issues ? 'warn' : 'good'}`;
}

function historyDate(snapshot) {
  return snapshot?.spotInstitutional?.dataDate || snapshot?.futuresInstitutional?.dataDate || snapshot?.asOfDate || null;
}

function historySeries(path) {
  const unique = new Map();
  for (const snapshot of state.history) {
    if (snapshot?.dataMode !== 'live') continue;
    const date = historyDate(snapshot);
    if (date) unique.set(date, snapshot);
  }
  return [...unique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-state.historyDays)
    .map(([date, snapshot]) => ({
      date,
      value: path.split('.').reduce((item, key) => item?.[key], snapshot),
    }))
    .filter((item) => Number.isFinite(Number(item.value)));
}

function rollingHistorySeries(path, windowSize) {
  const base = historySeries(path);
  return base.map((item, index) => {
    if (index + 1 < windowSize) return null;
    return { date: item.date, value: base.slice(index + 1 - windowSize, index + 1).reduce((sum, row) => sum + Number(row.value), 0) };
  }).filter(Boolean);
}

function deltaHistorySeries(path) {
  const base = historySeries(path);
  return base.slice(1).map((item, index) => ({ date: item.date, value: Number(item.value) - Number(base[index].value) }));
}

function compactSourceHistory(sourceKey, limit = 14) {
  const unique = new Map();
  for (const snapshot of [...state.history, state.snapshot].filter(Boolean)) {
    if (snapshot?.dataMode !== 'live') continue;
    const source = snapshot?.[sourceKey];
    const date = source?.dataDate || source?.data?.tradeDate;
    if (date && source?.data) unique.set(date, snapshot);
  }
  return [...unique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([date, snapshot]) => ({ date, snapshot }));
}

function compactValue(row, resolver) {
  const value = typeof resolver === 'function'
    ? resolver(row?.snapshot)
    : String(resolver || '').split('.').reduce((item, key) => item?.[key], row?.snapshot);
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactDelta(rows, index, resolver) {
  if (index < 1) return null;
  const current = compactValue(rows[index], resolver);
  const previous = compactValue(rows[index - 1], resolver);
  return current == null || previous == null ? null : current - previous;
}

function compactFormat(value, { digits = 0, suffix = '', signedValue = false } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return signedValue ? signed(value, suffix, digits) : `${fmt(value, digits)}${suffix}`;
}

function compactDirectionClass(direction) {
  if (direction > 0) return 'positive';
  if (direction < 0) return 'negative';
  return '';
}

function compactSummaryItem(definition, rows) {
  const latestIndex = rows.length - 1;
  const current = compactValue(rows[latestIndex], definition.value);
  const previous = latestIndex > 0 ? compactValue(rows[latestIndex - 1], definition.value) : null;
  const delta = current != null && previous != null ? current - previous : null;
  const article = document.createElement('article');
  article.className = 'flow-summary-item';
  const label = document.createElement('span'); label.textContent = definition.label;
  const strong = document.createElement('strong');
  strong.textContent = compactFormat(current, definition.format);
  const currentDirection = definition.currentDirection ? definition.currentDirection(current) : 0;
  strong.className = compactDirectionClass(currentDirection);
  const detail = document.createElement('small');
  const deltaDirection = definition.deltaDirection ? definition.deltaDirection(delta) : 0;
  const deltaText = compactFormat(delta, { ...definition.format, signedValue: true });
  detail.textContent = previous == null ? '等待前一有效交易日' : `前日 ${compactFormat(previous, definition.format)}｜變化 ${deltaText}`;
  detail.className = compactDirectionClass(deltaDirection);
  article.append(label, strong, detail);
  return article;
}

function compactBarSeries(rows, definition) {
  if (definition.delta) {
    return rows.slice(1).map((row, index) => ({
      date: row.date,
      value: compactDelta(rows, index + 1, definition.value),
    })).filter((row) => row.value != null);
  }
  return rows.map((row) => ({ date: row.date, value: compactValue(row, definition.value) }))
    .filter((row) => row.value != null);
}

function compactBarChart(definition, rows) {
  const shell = document.createElement('article');
  shell.className = 'flow-chart-shell';
  const heading = document.createElement('div'); heading.className = 'flow-chart-heading';
  const title = document.createElement('strong'); title.textContent = definition.label;
  const latestText = document.createElement('span');
  const series = compactBarSeries(rows, definition).slice(-12);
  latestText.textContent = series.length ? `近 ${series.length} 個有效交易日` : '尚無歷史樣本';
  heading.append(title, latestText);
  shell.append(heading);
  if (!series.length) {
    const empty = document.createElement('div'); empty.className = 'flow-empty'; empty.textContent = '資料會在每日官方更新後開始累積。';
    shell.append(empty); return shell;
  }
  const hover = document.createElement('div'); hover.className = 'flow-hover'; hover.textContent = '滑鼠移到柱狀圖可查看日期與數值';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'flow-mini-chart');
  svg.setAttribute('viewBox', '0 0 560 105');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${definition.label}近${series.length}日柱狀趨勢`);
  const values = series.map((row) => Number(row.value));
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) { min -= 1; max += 1; }
  const plotTop = 7; const plotBottom = 82; const plotHeight = plotBottom - plotTop;
  const y = (value) => plotTop + (max - value) / (max - min) * plotHeight;
  const zeroY = y(0);
  const baseline = document.createElementNS(svg.namespaceURI, 'line');
  baseline.setAttribute('x1', '12'); baseline.setAttribute('x2', '548'); baseline.setAttribute('y1', String(zeroY)); baseline.setAttribute('y2', String(zeroY)); baseline.setAttribute('class', 'baseline');
  svg.append(baseline);
  const slot = 536 / series.length;
  const barWidth = Math.max(5, Math.min(28, slot * 0.58));
  series.forEach((row, index) => {
    const rawDirection = definition.direction ? definition.direction(row.value) : Math.sign(row.value);
    const bar = document.createElementNS(svg.namespaceURI, 'rect');
    const barY = Math.min(y(row.value), zeroY);
    bar.setAttribute('x', String(12 + index * slot + (slot - barWidth) / 2));
    bar.setAttribute('y', String(barY));
    bar.setAttribute('width', String(barWidth));
    bar.setAttribute('height', String(Math.max(1.5, Math.abs(y(row.value) - zeroY))));
    bar.setAttribute('class', `bar ${rawDirection > 0 ? 'positive' : rawDirection < 0 ? 'negative' : 'neutral'}`);
    bar.setAttribute('tabindex', '0');
    const formatted = compactFormat(row.value, { ...definition.format, signedValue: true });
    bar.setAttribute('aria-label', `${row.date} ${formatted}`);
    const show = () => { hover.textContent = `${row.date}｜${definition.label} ${formatted}`; };
    bar.addEventListener('mouseenter', show); bar.addEventListener('focus', show);
    const tooltip = document.createElementNS(svg.namespaceURI, 'title'); tooltip.textContent = `${row.date}：${formatted}`; bar.append(tooltip);
    svg.append(bar);
  });
  [0, Math.floor((series.length - 1) / 2), series.length - 1].filter((value, index, list) => list.indexOf(value) === index).forEach((index) => {
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', String(12 + index * slot + slot / 2));
    label.setAttribute('y', '100'); label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'date-label');
    label.textContent = series[index].date.slice(5); svg.append(label);
  });
  shell.append(svg, hover);
  return shell;
}

function compactHistoryTable(columns, rows) {
  const details = document.createElement('details'); details.className = 'flow-history-details';
  const summary = document.createElement('summary'); summary.textContent = `展開近 ${rows.length} 日歷史明細`;
  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const table = document.createElement('table');
  const thead = document.createElement('thead'); const headerRow = document.createElement('tr');
  const dateHeader = document.createElement('th'); dateHeader.textContent = '日期'; headerRow.append(dateHeader);
  columns.forEach((column) => { const th = document.createElement('th'); th.textContent = column.label; headerRow.append(th); });
  thead.append(headerRow);
  const tbody = document.createElement('tbody');
  [...rows].reverse().forEach((row) => {
    const originalIndex = rows.indexOf(row);
    const tr = document.createElement('tr'); const date = document.createElement('td'); date.textContent = row.date.slice(5); tr.append(date);
    columns.forEach((column) => {
      const value = column.delta ? compactDelta(rows, originalIndex, column.value) : compactValue(row, column.value);
      const td = document.createElement('td');
      td.textContent = compactFormat(value, { ...column.format, signedValue: Boolean(column.signedValue || column.delta) });
      const direction = column.direction ? column.direction(value) : 0;
      td.className = compactDirectionClass(direction);
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(thead, tbody); wrap.append(table); details.append(summary, wrap);
  return details;
}

function renderCompactPanel(targetId, config) {
  const target = $(targetId);
  if (!target) return;
  const rows = compactSourceHistory(config.sourceKey, 14);
  renderCompactRows(target, {
    ...config,
    meta: compactSourceMeta(config.sourceKey, rows),
  }, rows);
}

function renderCompactRows(target, config, rows) {
  if (!rows.length) {
    const empty = document.createElement('p'); empty.className = 'flow-empty'; empty.textContent = '尚無可比較的有效交易日資料。';
    target.replaceChildren(empty); return;
  }
  const summary = document.createElement('div'); summary.className = 'flow-summary-grid';
  summary.append(...config.summary.map((definition) => compactSummaryItem(definition, rows)));
  const charts = config.charts.map((definition) => compactBarChart(definition, rows));
  const interpretation = document.createElement('p'); interpretation.className = 'flow-interpretation'; interpretation.textContent = config.interpretation(rows);
  const meta = document.createElement('p');
  meta.className = `flow-data-meta ${config.meta?.tone || 'ok'}`;
  meta.textContent = config.meta?.text || `資料至 ${rows.at(-1)?.date || '—'}｜有效 ${rows.length} 日`;
  target.replaceChildren(meta, summary, ...charts, interpretation, compactHistoryTable(config.columns, rows));
}

function compactSourceMeta(sourceKey, rows) {
  const source = state.snapshot?.[sourceKey] || {};
  const currentDate = rows.at(-1)?.date || source.dataDate || source.data?.tradeDate || '—';
  const allDates = new Set([...state.history, state.snapshot]
    .filter((snapshot) => snapshot?.dataMode === 'live')
    .map((snapshot) => historyDate(snapshot))
    .filter(Boolean));
  const rowDates = new Set(rows.map((row) => row.date));
  const missing = [...allDates].filter((date) => !rowDates.has(date)).length;
  const cached = Boolean(source.stale || source.fallbackFromCache);
  const failed = source.ok === false;
  const contracts = new Set(rows.map((row) => row.snapshot?.futuresMarket?.data?.txDay?.contract).filter(Boolean));
  const rollover = sourceKey === 'futuresInstitutional' && contracts.size > 1;
  const notes = [
    `資料至 ${currentDate}`,
    `有效 ${rows.length} 日`,
    missing ? `另有 ${missing} 個快照日缺少此來源` : '快照日無缺漏',
    failed ? '本次抓取失敗' : cached ? '目前使用舊快取' : '最新來源正常',
    rollover ? `期間含 ${contracts.size} 個期貨契約，價格跨換月需分段解讀` : '',
  ].filter(Boolean);
  return { text: notes.join('｜'), tone: failed ? 'bad' : cached || missing || rollover ? 'warn' : 'ok' };
}

function renderOptionsTrendPanel(options) {
  const target = $('options-trend-panel');
  if (!target) return;
  const selected = options?.selected;
  const history = (options?.history || [])
    .filter((row) => row?.tradeDate)
    .map((row) => ({
      date: row.tradeDate,
      snapshot: { optionTrend: row },
    }));
  if (!selected || !history.length) {
    const empty = document.createElement('p');
    empty.className = 'flow-empty';
    empty.textContent = '同契約歷史資料尚未建立；不會把不同到期契約接成同一條趨勢。';
    target.replaceChildren(empty);
    return;
  }
  renderCompactRows(target, {
    meta: {
      text: `資料至 ${options.latestDate || selected.tradeDate || '—'}｜${selected.contract}｜到期 ${selected.expiryDate || '—'}｜同契約有效 ${history.length} 日｜換約後重新累積`,
      tone: history.length < 2 ? 'warn' : 'ok',
    },
    summary: [
      { label: 'Call OI 牆', value: 'optionTrend.callWallStrike', format: { suffix: ' 點' } },
      { label: 'Put OI 牆', value: 'optionTrend.putWallStrike', format: { suffix: ' 點' } },
      { label: 'Max Pain', value: 'optionTrend.maxPain', format: { suffix: ' 點' } },
      { label: '台指期參考', value: 'optionTrend.txClose', format: { suffix: ' 點' } },
      { label: 'Call 未平倉量', value: 'optionTrend.callOi', format: { suffix: ' 口' } },
      { label: 'Put 未平倉量', value: 'optionTrend.putOi', format: { suffix: ' 口' } },
    ],
    charts: [
      { label: 'Call OI 每日增減', value: 'optionTrend.callOi', delta: true, format: { suffix: ' 口' }, direction: () => 0 },
      { label: 'Put OI 每日增減', value: 'optionTrend.putOi', delta: true, format: { suffix: ' 口' }, direction: () => 0 },
    ],
    columns: [
      { label: '台指', value: 'optionTrend.txClose', format: { suffix: '' } },
      { label: 'Call牆', value: 'optionTrend.callWallStrike', format: { suffix: '' } },
      { label: 'Call牆移動', value: 'optionTrend.callWallStrike', delta: true, format: { suffix: ' 點' }, signedValue: true },
      { label: 'Put牆', value: 'optionTrend.putWallStrike', format: { suffix: '' } },
      { label: 'Put牆移動', value: 'optionTrend.putWallStrike', delta: true, format: { suffix: ' 點' }, signedValue: true },
      { label: 'Max Pain', value: 'optionTrend.maxPain', format: { suffix: '' } },
      { label: 'Call OI增減', value: 'optionTrend.callOi', delta: true, format: { suffix: ' 口' }, signedValue: true },
      { label: 'Put OI增減', value: 'optionTrend.putOi', delta: true, format: { suffix: ' 口' }, signedValue: true },
    ],
    interpretation: (rows) => {
      const last = rows.length - 1;
      const callMove = compactDelta(rows, last, 'optionTrend.callWallStrike');
      const putMove = compactDelta(rows, last, 'optionTrend.putWallStrike');
      const painMove = compactDelta(rows, last, 'optionTrend.maxPain');
      const movement = callMove == null || putMove == null
        ? '目前不足兩個同契約交易日，暫不判斷牆位移動。'
        : callMove > 0 && putMove > 0
          ? 'Call／Put牆同步上移，攻防區間向上搬移；仍須等待期貨價格確認。'
          : callMove < 0 && putMove < 0
            ? 'Call／Put牆同步下移，攻防區間向下搬移；仍須等待期貨價格確認。'
            : 'Call／Put牆未同步移動，較像區間調整或訊號衝突。';
      return `${selected.contract}｜到期 ${selected.expiryDate || '待確認'}｜剩 ${fmt(selected.daysToExpiry)} 天。${movement} Max Pain較前日 ${compactFormat(painMove, { suffix: ' 點', signedValue: true })}。本區只比較同一契約；換約後重新累積，不跨到期日串接。`;
    },
  }, history);
}

function spotInstitutionTotal(snapshot) {
  const spot = snapshot?.spotInstitutional?.data || {};
  const values = [spot.foreignNetE, spot.trustNetE, spot.dealerTotalNetE].map((value) => value == null ? null : Number(value));
  return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function marketOiValue(snapshot) {
  return snapshot?.largeTraders?.data?.marketOi ?? snapshot?.futuresMarket?.data?.txDay?.openInterest ?? null;
}

function breadthPctValue(snapshot, market) {
  const row = snapshot?.marketBreadth?.data?.[market] || {};
  const advance = Number(row.advance);
  const decline = Number(row.decline);
  return Number.isFinite(advance) && Number.isFinite(decline) && advance + decline > 0
    ? ((advance - decline) / (advance + decline)) * 100
    : null;
}

function breadthDifference(snapshot, market) {
  const row = snapshot?.marketBreadth?.data?.[market] || {};
  const advance = Number(row.advance);
  const decline = Number(row.decline);
  return Number.isFinite(advance) && Number.isFinite(decline) ? advance - decline : null;
}

function limitDifference(snapshot, market) {
  const row = snapshot?.marketBreadth?.data?.[market] || {};
  const limitUp = Number(row.limitUp);
  const limitDown = Number(row.limitDown);
  return Number.isFinite(limitUp) && Number.isFinite(limitDown) ? limitUp - limitDown : null;
}

function renderCompactTrendPanels(snapshot = state.snapshot) {
  if (!snapshot) return;
  renderCompactPanel('breadth-trend-panel', {
    sourceKey: 'marketBreadth',
    summary: [
      { label: '上市漲跌差', value: (row) => breadthDifference(row, 'listed'), format: { suffix: ' 家', signedValue: true }, currentDirection: Math.sign, deltaDirection: Math.sign },
      { label: '上櫃漲跌差', value: (row) => breadthDifference(row, 'otc'), format: { suffix: ' 家', signedValue: true }, currentDirection: Math.sign, deltaDirection: Math.sign },
      { label: '上市漲停跌停差', value: (row) => limitDifference(row, 'listed'), format: { suffix: ' 家', signedValue: true }, currentDirection: Math.sign, deltaDirection: Math.sign },
      { label: '上櫃漲停跌停差', value: (row) => limitDifference(row, 'otc'), format: { suffix: ' 家', signedValue: true }, currentDirection: Math.sign, deltaDirection: Math.sign },
    ],
    charts: [
      { label: '上市市場廣度', value: (row) => breadthPctValue(row, 'listed'), format: { digits: 1, suffix: '%' }, direction: Math.sign },
      { label: '上櫃市場廣度', value: (row) => breadthPctValue(row, 'otc'), format: { digits: 1, suffix: '%' }, direction: Math.sign },
      { label: '加權指數每日漲跌', value: 'marketOverview.data.twii.changePct', format: { digits: 2, suffix: '%' }, direction: Math.sign },
    ],
    columns: [
      { label: '加權漲跌', value: 'marketOverview.data.twii.changePct', format: { digits: 2, suffix: '%' }, signedValue: true, direction: Math.sign },
      { label: '上市廣度', value: (row) => breadthPctValue(row, 'listed'), format: { digits: 1, suffix: '%' }, signedValue: true, direction: Math.sign },
      { label: '上市漲跌差', value: (row) => breadthDifference(row, 'listed'), format: { suffix: ' 家' }, signedValue: true, direction: Math.sign },
      { label: '上市漲停跌停差', value: (row) => limitDifference(row, 'listed'), format: { suffix: ' 家' }, signedValue: true, direction: Math.sign },
      { label: '上櫃廣度', value: (row) => breadthPctValue(row, 'otc'), format: { digits: 1, suffix: '%' }, signedValue: true, direction: Math.sign },
      { label: '上櫃漲跌差', value: (row) => breadthDifference(row, 'otc'), format: { suffix: ' 家' }, signedValue: true, direction: Math.sign },
      { label: '上櫃漲停跌停差', value: (row) => limitDifference(row, 'otc'), format: { suffix: ' 家' }, signedValue: true, direction: Math.sign },
    ],
    interpretation: (rows) => {
      const latest = rows.at(-1)?.snapshot;
      const twii = compactValue(rows.at(-1), 'marketOverview.data.twii.changePct');
      const listed = breadthPctValue(latest, 'listed');
      const otc = breadthPctValue(latest, 'otc');
      const divergence = twii != null && listed != null && Math.sign(twii) !== Math.sign(listed) && Math.abs(listed) >= 10;
      return divergence
        ? `加權指數 ${compactFormat(twii, { digits: 2, suffix: '%', signedValue: true })}，但上市廣度 ${compactFormat(listed, { digits: 1, suffix: '%', signedValue: true })}，出現權值與多數股票背離；避免只看指數判斷全市場。`
        : `上市廣度 ${compactFormat(listed, { digits: 1, suffix: '%', signedValue: true })}、上櫃廣度 ${compactFormat(otc, { digits: 1, suffix: '%', signedValue: true })}。廣度與加權同步時趨勢擴散較完整，背離時降低追價信心。`;
    },
  });
  const spotConfig = { digits: 1, suffix: ' 億' };
  renderCompactPanel('spot-trend-panel', {
    sourceKey: 'spotInstitutional',
    summary: [
      { label: '外資買賣超', value: 'spotInstitutional.data.foreignNetE', format: spotConfig, currentDirection: Math.sign, deltaDirection: Math.sign },
      { label: '投信買賣超', value: 'spotInstitutional.data.trustNetE', format: spotConfig, currentDirection: Math.sign, deltaDirection: Math.sign },
      { label: '自營商自行', value: 'spotInstitutional.data.dealerProprietaryNetE', format: spotConfig, currentDirection: Math.sign, deltaDirection: Math.sign },
      { label: '三大法人合計', value: spotInstitutionTotal, format: spotConfig, currentDirection: Math.sign, deltaDirection: Math.sign },
    ],
    charts: [
      { label: '每日三大法人買賣超', value: spotInstitutionTotal, format: spotConfig, direction: Math.sign },
    ],
    columns: [
      { label: '外資', value: 'spotInstitutional.data.foreignNetE', format: spotConfig, signedValue: true, direction: Math.sign },
      { label: '投信', value: 'spotInstitutional.data.trustNetE', format: spotConfig, signedValue: true, direction: Math.sign },
      { label: '自行', value: 'spotInstitutional.data.dealerProprietaryNetE', format: spotConfig, signedValue: true, direction: Math.sign },
      { label: '避險', value: 'spotInstitutional.data.dealerHedgeNetE', format: spotConfig, signedValue: true, direction: Math.sign },
      { label: '合計', value: spotInstitutionTotal, format: spotConfig, signedValue: true, direction: Math.sign },
    ],
    interpretation: (rows) => {
      const foreign = compactBarSeries(rows, { value: 'spotInstitutional.data.foreignNetE' }).slice(-5);
      const fiveDay = foreign.length === 5 ? foreign.reduce((sum, row) => sum + row.value, 0) : null;
      return fiveDay == null
        ? '目前資料不足5日，先看單日方向，不把缺少的日期補成0。'
        : `外資近5日累積 ${compactFormat(fiveDay, { ...spotConfig, signedValue: true })}。連續性比單日數字重要；仍須搭配指數、期貨與匯率確認。`;
    },
  });

  renderCompactPanel('margin-trend-panel', {
    sourceKey: 'margin',
    summary: [
      { label: '融資餘額', value: 'margin.data.marginBalanceE', format: { digits: 1, suffix: ' 億' } },
      { label: '融券餘額', value: 'margin.data.shortBalanceLots', format: { suffix: ' 張' } },
    ],
    charts: [
      { label: '每日融資餘額增減', value: 'margin.data.marginBalanceE', delta: true, format: { digits: 1, suffix: ' 億' }, direction: Math.sign },
      { label: '每日融券餘額增減', value: 'margin.data.shortBalanceLots', delta: true, format: { suffix: ' 張' }, direction: Math.sign },
    ],
    columns: [
      { label: '融資餘額', value: 'margin.data.marginBalanceE', format: { digits: 1, suffix: ' 億' } },
      { label: '融資增減', value: 'margin.data.marginBalanceE', delta: true, format: { digits: 1, suffix: ' 億' } },
      { label: '融券餘額', value: 'margin.data.shortBalanceLots', format: { suffix: ' 張' } },
      { label: '融券增減', value: 'margin.data.shortBalanceLots', delta: true, format: { suffix: ' 張' } },
    ],
    interpretation: (rows) => {
      const last = rows.length - 1;
      const marginDelta = compactDelta(rows, last, 'margin.data.marginBalanceE');
      return marginDelta == null
        ? '資券資料尚無前一有效交易日可比較。融資、融券增加都不能單獨當成多空訊號。'
        : `最新融資變化 ${compactFormat(marginDelta, { digits: 1, suffix: ' 億', signedValue: true })}。若指數下跌、外資賣超而融資持續增加，才提高籌碼風險警戒。`;
    },
  });

  renderCompactPanel('futures-trend-panel', {
    sourceKey: 'futuresInstitutional',
    summary: [
      { label: '外資淨部位', value: 'futuresInstitutional.data.foreignNet', format: { suffix: ' 口', signedValue: true }, currentDirection: Math.sign, deltaDirection: Math.sign },
      { label: '外資空單', value: 'futuresInstitutional.data.foreignShort', format: { suffix: ' 口' }, deltaDirection: (value) => -Math.sign(value || 0) },
      { label: '市場 OI', value: marketOiValue, format: { suffix: ' 口' } },
      { label: '台指近月', value: 'futuresMarket.data.txDay.close', format: { suffix: ' 點' } },
    ],
    charts: [
      { label: '外資淨部位每日變化', value: 'futuresInstitutional.data.foreignNet', delta: true, format: { suffix: ' 口' }, direction: Math.sign },
      { label: '市場 OI 每日變化', value: marketOiValue, delta: true, format: { suffix: ' 口' }, direction: Math.sign },
    ],
    columns: [
      { label: '台指', value: 'futuresMarket.data.txDay.close', format: { suffix: '' } },
      { label: '外資淨部位', value: 'futuresInstitutional.data.foreignNet', format: { suffix: ' 口' }, signedValue: true, direction: Math.sign },
      { label: '淨部位增減', value: 'futuresInstitutional.data.foreignNet', delta: true, format: { suffix: ' 口' }, direction: Math.sign },
      { label: '外資空單', value: 'futuresInstitutional.data.foreignShort', format: { suffix: ' 口' } },
      { label: '空單增減', value: 'futuresInstitutional.data.foreignShort', delta: true, format: { suffix: ' 口' }, direction: (value) => -Math.sign(value || 0) },
      { label: '市場 OI', value: marketOiValue, format: { suffix: ' 口' } },
      { label: 'OI增減', value: marketOiValue, delta: true, format: { suffix: ' 口' } },
    ],
    interpretation: (rows) => {
      const last = rows.length - 1;
      const foreignDelta = compactDelta(rows, last, 'futuresInstitutional.data.foreignNet');
      const oiDelta = compactDelta(rows, last, marketOiValue);
      return `最新外資淨部位變化 ${compactFormat(foreignDelta, { suffix: ' 口', signedValue: true })}，市場OI變化 ${compactFormat(oiDelta, { suffix: ' 口', signedValue: true })}。淨部位可能包含避險與套利，必須搭配價格及現貨法人，不直接等同明日漲跌。`;
    },
  });
}

function trendChart(title, series, { digits = 0, suffix = '', directional = true } = {}) {
  const article = document.createElement('article');
  article.className = 'trend-chart';
  const heading = document.createElement('h3'); heading.textContent = title;
  const latest = document.createElement('div'); latest.className = 'chart-latest';
  if (!series.length) {
    latest.textContent = '尚無歷史樣本'; article.append(heading, latest); return article;
  }
  const latestValue = Number(series.at(-1).value);
  latest.textContent = `最新 ${signed(latestValue, suffix, digits)}｜${series.length} 個交易日`;
  const hoverValue = document.createElement('div');
  hoverValue.className = 'chart-hover-value';
  hoverValue.textContent = '滑鼠移到節點查看日期與數值';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 520 150');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title}近${series.length}日趨勢，最新${signed(latestValue, suffix, digits)}`);
  const values = series.map((item) => Number(item.value));
  let min = Math.min(...values, directional ? 0 : Infinity);
  let max = Math.max(...values, directional ? 0 : -Infinity);
  if (min === max) { min -= 1; max += 1; }
  const x = (index) => 42 + index * (452 / Math.max(1, series.length - 1));
  const y = (value) => 12 + (max - value) / (max - min) * 108;
  const axis = document.createElementNS(svg.namespaceURI, 'line');
  axis.setAttribute('x1', '42'); axis.setAttribute('x2', '494'); axis.setAttribute('y1', '120'); axis.setAttribute('y2', '120'); axis.setAttribute('class', 'axis'); svg.append(axis);
  if (min <= 0 && max >= 0) {
    const zero = document.createElementNS(svg.namespaceURI, 'line');
    zero.setAttribute('x1', '42'); zero.setAttribute('x2', '494'); zero.setAttribute('y1', String(y(0))); zero.setAttribute('y2', String(y(0))); zero.setAttribute('class', 'zero'); svg.append(zero);
  }
  const polyline = document.createElementNS(svg.namespaceURI, 'polyline');
  polyline.setAttribute('points', series.map((item, index) => `${x(index)},${y(Number(item.value))}`).join(' '));
  polyline.setAttribute('class', `line ${directional ? (latestValue > 0 ? 'bullish' : latestValue < 0 ? 'bearish' : '') : ''}`); svg.append(polyline);
  series.forEach((item, index) => {
    const point = document.createElementNS(svg.namespaceURI, 'circle');
    point.setAttribute('cx', String(x(index))); point.setAttribute('cy', String(y(Number(item.value)))); point.setAttribute('r', index === series.length - 1 ? '5' : '4'); point.setAttribute('class', 'point');
    point.setAttribute('tabindex', '0');
    point.setAttribute('aria-label', `${item.date} ${signed(item.value, suffix, digits)}`);
    const showValue = () => { hoverValue.textContent = `${item.date}｜${signed(item.value, suffix, digits)}`; };
    point.addEventListener('mouseenter', showValue);
    point.addEventListener('focus', showValue);
    const titleNode = document.createElementNS(svg.namespaceURI, 'title'); titleNode.textContent = `${item.date}：${signed(item.value, suffix, digits)}`; point.append(titleNode); svg.append(point);
  });
  const firstLabel = document.createElementNS(svg.namespaceURI, 'text'); firstLabel.setAttribute('x', '42'); firstLabel.setAttribute('y', '142'); firstLabel.setAttribute('class', 'label'); firstLabel.textContent = series[0].date.slice(5); svg.append(firstLabel);
  const lastLabel = document.createElementNS(svg.namespaceURI, 'text'); lastLabel.setAttribute('x', '494'); lastLabel.setAttribute('y', '142'); lastLabel.setAttribute('text-anchor', 'end'); lastLabel.setAttribute('class', 'label'); lastLabel.textContent = series.at(-1).date.slice(5); svg.append(lastLabel);
  article.append(heading, latest, svg, hoverValue);
  return article;
}

function renderHistory() {
  const charts = [
    trendChart('加權指數', historySeries('marketOverview.data.twii.price'), { digits: 2, suffix: ' 點', directional: false }),
    trendChart('外資現貨當日買賣超', historySeries('spotInstitutional.data.foreignNetE'), { digits: 1, suffix: ' 億' }),
    trendChart('外資現貨近5日累積', rollingHistorySeries('spotInstitutional.data.foreignNetE', 5), { digits: 1, suffix: ' 億' }),
    trendChart('外資臺股期貨淨部位', historySeries('futuresInstitutional.data.foreignNet'), { suffix: ' 口' }),
    trendChart('外資臺股期貨淨部位日變化', deltaHistorySeries('futuresInstitutional.data.foreignNet'), { suffix: ' 口' }),
    trendChart('選擇權 OI P/C Ratio', historySeries('options.data.oiPcRatio'), { digits: 2, directional: false }),
    trendChart('近端 Call OI', historySeries('options.data.totalCallOi'), { suffix: ' 口', directional: false }),
    trendChart('近端 Put OI', historySeries('options.data.totalPutOi'), { suffix: ' 口', directional: false }),
    trendChart('綜合籌碼分數', historySeries('signal.totalScore'), { directional: true }),
  ];
  $('history-charts').replaceChildren(...charts);
  const dates = new Set(state.history.map(historyDate).filter(Boolean));
  $('history-status').textContent = dates.size < 2
    ? `目前只有 ${dates.size} 個有效交易日，趨勢會從每次官方資料更新後持續累積。`
    : `顯示最近 ${Math.min(state.historyDays, dates.size)} 個有效交易日；滑鼠移到節點可看日期與數值。`;
}

async function loadHistory() {
  const payload = await api('/api/v1/history?limit=90');
  state.history = payload.data || [];
  renderHistory();
  if (state.snapshot) renderCompactTrendPanels(state.snapshot);
}

function renderBacktest(data) {
  text('backtest-period', data?.firstDate && data?.lastDate ? `${data.firstDate}～${data.lastDate}` : '樣本不足');
  const rows = (data?.results || []).map((item) => {
    const tr = document.createElement('tr');
    const status = item.status === 'research_only' ? '初步研究' : '樣本不足';
    const cells = [
      item.name, status, fmt(item.sampleSize),
      item.hitRatePct == null ? '—' : `${fmt(item.hitRatePct, 1)}%`,
      item.avgNextReturnLongPct == null ? '—' : signed(item.avgNextReturnLongPct, '%', 3),
      item.avgNextReturnShortPct == null ? '—' : signed(item.avgNextReturnShortPct, '%', 3),
    ];
    cells.forEach((cell) => { const td = document.createElement('td'); td.textContent = cell; tr.append(td); });
    return tr;
  });
  $('backtest-table').replaceChildren(...rows);
  text('backtest-note', data?.disclaimer || '尚無檢驗結果。');
}

async function loadBacktest() {
  const payload = await api('/api/v1/backtest');
  renderBacktest(payload.data || {});
}

function svgNode(name, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function extent(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let min = Math.min(...finite); let max = Math.max(...finite);
  if (min === max) { min -= 1; max += 1; }
  return [min, max];
}

function renderV2Status(data) {
  const s = data.status || {};
  const cards = [
    ['共同研究期間', `${s.firstDate || '—'}～${s.lastDate || '—'}`, `${fmt(s.alignedDays)} 個對齊交易日`],
    ['官方歷史規模', `${fmt(s.futuresDays)} 期貨日`, `${fmt(s.optionDays)} 選擇權日｜${fmt(s.strikeRows)} 履約價列`],
    ['品質檢查', `${fmt(s.issues?.error)} 錯誤／${fmt(s.issues?.warning)} 警告`, `${fmt(s.issues?.info)} 筆資訊提示`],
  ].map(([label, value, note]) => {
    const card = document.createElement('article');
    const p = document.createElement('p'); p.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    const small = document.createElement('small'); small.textContent = note;
    card.append(p, strong, small); return card;
  });
  $('v2-status-cards').replaceChildren(...cards);
  text('v2-data-status', `${s.lastDate || '—'}｜V2 只讀`);
  $('v2-data-status').className = `source-badge ${s.issues?.error ? 'bad' : s.issues?.warning ? 'warn' : 'good'}`;
}

function globalCard(label, row) {
  const article = document.createElement('article'); article.className = 'global-context-card';
  const title = document.createElement('span'); title.textContent = label;
  const value = document.createElement('strong'); value.textContent = fmt(row?.close, row?.symbol === 'USDTWD' ? 3 : 2);
  value.className = Number(row?.returnPct) > 0 ? 'positive' : Number(row?.returnPct) < 0 ? 'negative' : '';
  const note = document.createElement('small'); note.textContent = `${row?.tradeDate || '—'}｜${signed(row?.returnPct, '%', 2)}`;
  article.append(title, value, note); return article;
}

function renderV2GlobalContext(data = state.v2) {
  const context = data?.globalContext; const target = $('v2-global-latest');
  if (!target) return;
  const labels = { SOX: '費城半導體指數', NDX: 'Nasdaq-100', USDTWD: '美元／新台幣' };
  if (!context?.available) {
    target.textContent = '海外背景資料尚未建立，請執行 6_V2_UPDATE_HISTORY.bat。';
    text('v2-global-status', '資料未完成'); $('v2-global-status').className = 'source-badge warn'; return;
  }
  target.replaceChildren(...context.latest.map((row) => globalCard(labels[row.symbol] || row.symbol, row)));
  const lastDate = context.latest.map((row) => row.tradeDate).sort().at(-1);
  text('v2-global-status', `${lastDate || '—'}｜背景層`); $('v2-global-status').className = 'source-badge good';
}

function renderV2TermStructure(data = state.v2) {
  const structure = data?.termStructure; const target = $('v2-term-summary');
  if (!target) return;
  if (!structure?.available || !structure.latest) {
    target.textContent = '期限結構研究尚未建立，請執行 V2 歷史更新。';
    text('v2-term-status', '尚未建立'); $('v2-term-status').className = 'source-badge warn'; return;
  }
  const row = structure.latest;
  const cards = [
    ['近月／次月', `${row.nearContract}／${row.nextContract}`, `近月 ${fmt(row.nearClose)}・次月 ${fmt(row.nextClose)}`],
    ['近遠月價差', signed(row.termSpreadPoints, ' 點', 1), `1日 ${signed(row.termChange1dBps, ' bps', 1)}・5日 ${signed(row.termChange5dBps, ' bps', 1)}`],
    ['收盤基差代理', signed(row.closeBasisPoints, ' 點', 1), `1日 ${signed(row.basisChange1dBps, ' bps', 1)}・5日 ${signed(row.basisChange5dBps, ' bps', 1)}`],
  ].map(([label, value, note]) => {
    const article = document.createElement('article'); article.className = 'global-context-card';
    const title = document.createElement('span'); title.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    const small = document.createElement('small'); small.textContent = note;
    article.append(title, strong, small); return article;
  });
  target.replaceChildren(...cards);
  text('v2-term-status', `${row.tradeDate}｜評分權重 ${fmt(structure.productionScoreWeight)}%`);
  $('v2-term-status').className = `source-badge ${row.rolloverRisk ? 'warn' : 'good'}`;
  text('v2-term-decision', `${row.daysToNearExpiry} 天到期${row.rolloverRisk ? '，換月失真風險高' : ''}。${structure.decision}`);
}

function renderGlobalResearch() {
  const target = $('v2-global-research'); if (!target) return;
  const diagnostics = state.v2Backtests?.globalContextDiagnostics;
  if (!diagnostics) { target.textContent = '正式相關性結果尚未建立。'; return; }
  const strategyByKey = Object.fromEntries((state.v2Backtests?.strategies || []).map((row) => [row.key, row]));
  const definitions = [
    ['SOX', diagnostics.sox, strategyByKey.sox_overnight],
    ['Nasdaq-100', diagnostics.ndx, strategyByKey.ndx_overnight],
    ['USD/TWD（反向假設）', diagnostics.usdtwd, strategyByKey.usdtwd_previous],
  ];
  const cards = definitions.map(([label, row, strategy]) => {
    const article = document.createElement('article'); const passed = strategy?.gate === 'passed_first_gate';
    article.className = `global-research-card ${passed ? 'passed' : 'failed'}`;
    const title = document.createElement('span'); title.textContent = label;
    const value = document.createElement('strong'); value.textContent = `相關 ${signed(row?.pearson, '', 3)}`;
    const note = document.createElement('small'); note.textContent = `樣本 ${fmt(row?.samples)}｜方向一致 ${fmt(row?.directionHitPct, 1)}%｜${passed ? '通過第一關' : '未通過正式門檻'}`;
    article.append(title, value, note); return article;
  });
  const conclusion = document.createElement('article'); conclusion.className = 'global-research-card failed';
  const title = document.createElement('span'); title.textContent = '目前結論';
  const value = document.createElement('strong'); value.textContent = '隔夜風向未能預測日盤續走';
  const note = document.createElement('small'); note.textContent = '海外行情主要反映在台指開盤跳空；扣除跳空後，三項單因子與組合策略都未通過。';
  conclusion.append(title, value, note); cards.push(conclusion);
  target.replaceChildren(...cards);
}

function renderV2Futures(rows = []) {
  const target = $('v2-futures-chart');
  if (!rows.length) { target.textContent = '沒有可顯示的期貨歷史資料。'; return; }
  const width = 980; const height = 390; const left = 58; const right = 20;
  const plotWidth = width - left - right;
  const step = plotWidth / Math.max(1, rows.length); const x = (index) => left + index * step + step / 2;
  const priceValues = rows.flatMap((r) => [r.txLow, r.txHigh, r.txClose]).map(Number).filter(Number.isFinite);
  const [priceMin, priceMax] = extent(priceValues);
  const [foreignMin, foreignMax] = extent([...rows.map((r) => r.foreignNet), 0]);
  const [oiMin, oiMax] = extent(rows.map((r) => r.marketOi));
  const priceY = (value) => 22 + (priceMax - value) / (priceMax - priceMin) * 178;
  const foreignY = (value) => 235 + (foreignMax - value) / (foreignMax - foreignMin) * 55;
  const oiY = (value) => 315 + (oiMax - value) / (oiMax - oiMin) * 45;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '台指期日K、外資淨部位與市場未平倉歷史圖' });
  [216, 302].forEach((yValue) => svg.append(svgNode('line', { x1: left, x2: width - right, y1: yValue, y2: yValue, class: 'chart-divider' })));
  const bodyWidth = Math.max(2, Math.min(9, step * .62));
  rows.forEach((row, index) => {
    const open = Number(row.txOpen); const high = Number(row.txHigh); const low = Number(row.txLow); const close = Number(row.txClose);
    const candleReady = [open, high, low, close].every(Number.isFinite); const rising = candleReady && close >= open;
    if (candleReady) {
      svg.append(svgNode('line', { x1: x(index), x2: x(index), y1: priceY(high), y2: priceY(low), class: `candle-wick ${rising ? 'up' : 'down'}` }));
      const top = priceY(Math.max(open, close)); const bottom = priceY(Math.min(open, close));
      svg.append(svgNode('rect', { x: x(index) - bodyWidth / 2, y: top, width: bodyWidth, height: Math.max(1.5, bottom - top), class: `candle-body ${rising ? 'up' : 'down'}` }));
    }
    const foreign = Number(row.foreignNet); const marketOi = Number(row.marketOi);
    if (Number.isFinite(foreign)) svg.append(svgNode('rect', { x: x(index) - bodyWidth / 2, y: Math.min(foreignY(foreign), foreignY(0)), width: bodyWidth, height: Math.max(1, Math.abs(foreignY(foreign) - foreignY(0))), class: `position-bar ${foreign >= 0 ? 'up' : 'down'}` }));
    if (Number.isFinite(marketOi)) svg.append(svgNode('rect', { x: x(index) - bodyWidth / 2, y: oiY(marketOi), width: bodyWidth, height: Math.max(1, 360 - oiY(marketOi)), class: 'oi-bar' }));
    const hit = svgNode('rect', { x: left + index * step, y: 15, width: Math.max(2, step), height: 350, class: 'chart-hit', tabindex: 0 });
    const show = () => { $('v2-futures-hover').textContent = `${row.tradeDate}｜台指 開 ${fmt(row.txOpen)}／高 ${fmt(row.txHigh)}／低 ${fmt(row.txLow)}／收 ${fmt(row.txClose)}｜基差 ${signed(row.basis)}｜外資淨部位 ${signed(row.foreignNet)} 口｜市場 OI ${fmt(row.marketOi)} 口`; };
    hit.addEventListener('mouseenter', show); hit.addEventListener('focus', show); hit.setAttribute('aria-label', `${row.tradeDate} 台指期開高低收與籌碼數值`); svg.append(hit);
  });
  [['台指日K', 'tx'], ['外資淨部位', 'foreign'], ['市場 OI', 'market-oi']].forEach(([label, cls], index) => { const t = svgNode('text', { x: left + index * 145, y: 383, class: `legend ${cls}` }); t.textContent = label; svg.append(t); });
  target.replaceChildren(svg);
  const latest = rows.at(-1); text('v2-futures-latest', `${latest.tradeDate}｜台指 ${fmt(latest.txClose)}`);
}

function selectedStrikes(strikes, selected, txClose) {
  if (strikes.length <= 31) return strikes;
  const key = (row) => Math.max(Math.abs(Number(row.callDelta) || 0), Math.abs(Number(row.putDelta) || 0));
  const important = [...strikes].sort((a, b) => key(b) - key(a)).slice(0, 12);
  const center = [...strikes].sort((a, b) => Math.abs(a.strike - txClose) - Math.abs(b.strike - txClose)).slice(0, 21);
  const walls = strikes.filter((row) => [selected.callWallStrike, selected.putWallStrike, selected.maxPain].includes(row.strike));
  return [...new Map([...important, ...center, ...walls].map((row) => [row.strike, row])).values()].sort((a, b) => a.strike - b.strike).slice(0, 35);
}

function defenseItem(label, value, note, cls) {
  const article = document.createElement('article'); article.className = `option-defense-item ${cls}`;
  const span = document.createElement('span'); span.textContent = label;
  const strong = document.createElement('strong'); strong.textContent = value;
  const small = document.createElement('small'); small.textContent = note;
  article.append(span, strong, small); return article;
}

function maxPainConvergence(history = [], selected = {}) {
  const valid = history.filter((row) => Number.isFinite(Number(row.txClose)) && Number.isFinite(Number(row.maxPain)));
  if (!valid.length) return null;
  const latest = valid.at(-1); const previous = valid.at(-2);
  const signedDistance = Number(latest.txClose) - Number(latest.maxPain);
  const distance = Math.abs(signedDistance);
  const previousDistance = previous ? Math.abs(Number(previous.txClose) - Number(previous.maxPain)) : null;
  const distanceChange = previousDistance == null ? null : distance - previousDistance;
  let streak = 0;
  for (let index = valid.length - 1; index > 0; index -= 1) {
    const currentDistance = Math.abs(Number(valid[index].txClose) - Number(valid[index].maxPain));
    const priorDistance = Math.abs(Number(valid[index - 1].txClose) - Number(valid[index - 1].maxPain));
    if (currentDistance < priorDistance) streak += 1; else break;
  }
  const status = distance <= 100 ? '貼近 Max Pain' : distanceChange != null && distanceChange < 0 ? '向 Max Pain 靠攏' : distanceChange != null && distanceChange > 0 ? '遠離 Max Pain' : '距離持平';
  return { ...latest, signedDistance, distance, previousDistance, distanceChange, streak, status, daysToExpiry: selected.daysToExpiry };
}

function applyMaxPainAdvice(convergence) {
  if (!convergence) { text('v2-maxpain-advice', 'Max Pain 靠攏監測資料不足。'); return; }
  const position = convergence.signedDistance >= 0 ? '上方' : '下方';
  const movement = convergence.distanceChange == null ? '缺少前一日比較' : convergence.distanceChange < 0 ? `距離較前日縮小 ${fmt(Math.abs(convergence.distanceChange))} 點` : convergence.distanceChange > 0 ? `距離較前日擴大 ${fmt(convergence.distanceChange)} 點` : '距離與前日相同';
  const streak = convergence.streak > 0 ? `，連續靠攏 ${convergence.streak} 個交易日` : '';
  const expiry = Number.isFinite(Number(convergence.daysToExpiry)) ? `，距結算 ${fmt(convergence.daysToExpiry)} 天` : '';
  text('v2-maxpain-advice', `Max Pain監測：台指位於 ${fmt(convergence.maxPain)} 的${position} ${fmt(convergence.distance)} 點；${movement}${streak}${expiry}。接近結算且牆位穩定時可提高區間收斂的觀察權重，但不能單獨作為進場訊號。`);
}

function wallStability(history, field) {
  const valid = history.filter((row) => Number.isFinite(Number(row[field])));
  if (!valid.length) return 0;
  const latest = Number(valid.at(-1)[field]);
  let count = 0;
  for (let index = valid.length - 1; index >= 0 && Number(valid[index][field]) === latest; index -= 1) count += 1;
  return count;
}

function optionDefenseState(options, futures) {
  const selected = options?.selected; const history = options?.history || [];
  if (!selected) return null;
  const latest = history.at(-1) || selected; const previous = history.at(-2);
  const txClose = Number(latest.txClose ?? futures?.at(-1)?.txClose);
  const call = Number(selected.callWallStrike); const put = Number(selected.putWallStrike); const pain = Number(selected.maxPain);
  const callMove = previous && Number.isFinite(Number(previous.callWallStrike)) ? call - Number(previous.callWallStrike) : null;
  const putMove = previous && Number.isFinite(Number(previous.putWallStrike)) ? put - Number(previous.putWallStrike) : null;
  const callOiDelta = previous && Number.isFinite(Number(previous.callWallOi)) ? Number(selected.callWallOi) - Number(previous.callWallOi) : null;
  const putOiDelta = previous && Number.isFinite(Number(previous.putWallOi)) ? Number(selected.putWallOi) - Number(previous.putWallOi) : null;
  const callStable = wallStability(history, 'callWallStrike'); const putStable = wallStability(history, 'putWallStrike');
  const aboveCall = Number.isFinite(txClose) && Number.isFinite(call) && txClose > call;
  const belowPut = Number.isFinite(txClose) && Number.isFinite(put) && txClose < put;
  const previousAboveCall = previous && Number(previous.txClose) > Number(previous.callWallStrike);
  const previousBelowPut = previous && Number(previous.txClose) < Number(previous.putWallStrike);
  const callBreakout = aboveCall && !previousAboveCall;
  const putBreakdown = belowPut && !previousBelowPut;
  let tone = 'neutral'; let headline; let detail;
  if (callBreakout) {
    const confirmed = (callOiDelta != null && callOiDelta < 0) || (callMove != null && callMove > 0);
    tone = confirmed ? 'bullish' : 'warning';
    headline = confirmed ? '台指突破 Call 牆，牆位結構形成偏多候選' : '台指剛突破 Call 牆，但仍需觀察是否站穩';
    detail = confirmed ? 'Call牆上移或該牆OI減少，原壓力弱化的可能性提高；目前正式策略仍未通過完整門檻，只能觀察回測Call牆是否守住。' : '若價格重新跌回Call牆內，視為突破失敗；公開OI仍無法確認是買方或賣方。';
  } else if (putBreakdown) {
    const confirmed = (putOiDelta != null && putOiDelta < 0) || (putMove != null && putMove < 0);
    tone = confirmed ? 'bearish' : 'warning';
    headline = confirmed ? '台指跌破 Put 牆，牆位結構形成偏空候選' : '台指剛跌破 Put 牆，但仍需觀察是否收復';
    detail = confirmed ? 'Put牆下移或該牆OI減少，原防守可能弱化；三年研究尚未支持此組合能穩定續跌，只能觀察反彈能否收復Put牆。' : '若價格很快站回Put牆上方，視為跌破失敗；公開OI仍無法確認是買方或賣方。';
  } else if (aboveCall) {
    tone = 'bullish'; headline = '台指位於 Call 牆上方，結構偏強但不是追多訊號';
    detail = 'Call牆可改作回測觀察位；若牆位持續上移，比單日站上更有參考價值。';
  } else if (belowPut) {
    tone = 'bearish'; headline = '台指位於 Put 牆下方，結構偏弱但不是追空訊號';
    detail = 'Put牆可改作反彈壓力觀察位；若牆位持續下移，比單日跌破更有參考價值。';
  } else if (callMove > 0 && putMove > 0) {
    tone = 'bullish'; headline = 'Call／Put牆同步上移，選擇權攻防區間向上搬移';
    detail = '屬偏多結構訊號；仍要等價格守住Put牆或突破Call牆，不能只憑牆位移動進場。';
  } else if (callMove < 0 && putMove < 0) {
    tone = 'bearish'; headline = 'Call／Put牆同步下移，選擇權攻防區間向下搬移';
    detail = '屬偏空結構訊號；仍要等價格跌破Put牆或反彈受阻，不能只憑牆位移動進場。';
  } else {
    headline = '台指仍在 Put／Call 牆之間，現階段以區間攻防解讀';
    detail = Number(selected.daysToExpiry) <= 3 && Number.isFinite(pain)
      ? `距結算僅 ${fmt(selected.daysToExpiry)} 天，Max Pain ${fmt(pain)} 可提高收斂觀察權重，但不是保證目標價。`
      : '牆位方向不一致時不強行判多空；等待價格突破、牆位同步移動或OI弱化確認。';
  }
  return { tone, headline, detail, txClose, call, put, pain, callMove, putMove, callOiDelta, putOiDelta, callStable, putStable };
}

function renderOptionDefenseConclusion(options, futures) {
  const target = $('v2-option-conclusion'); const result = optionDefenseState(options, futures);
  if (!target || !result) return;
  target.className = `option-defense-conclusion ${result.tone}`;
  const title = document.createElement('span'); title.textContent = '選擇權攻防結論（研究用）';
  const strong = document.createElement('strong'); strong.textContent = result.headline;
  const detail = document.createElement('p'); detail.textContent = result.detail;
  const facts = document.createElement('div'); facts.className = 'option-defense-facts';
  const position = result.txClose > result.call ? `Call牆上方 ${fmt(result.txClose - result.call)} 點` : result.txClose < result.put ? `Put牆下方 ${fmt(result.put - result.txClose)} 點` : `牆內｜距Call ${fmt(result.call - result.txClose)}／距Put ${fmt(result.txClose - result.put)} 點`;
  [`價位：${position}`, `牆位：Call ${signed(result.callMove, '點')}｜Put ${signed(result.putMove, '點')}`, `穩定：Call ${result.callStable}日｜Put ${result.putStable}日`, `牆上OI：Call ${signed(result.callOiDelta, '口')}｜Put ${signed(result.putOiDelta, '口')}`]
    .forEach((value) => { const item = document.createElement('small'); item.textContent = value; facts.append(item); });
  target.replaceChildren(title, strong, detail, facts);
}

function renderOptionWallResearch() {
  const target = $('v2-wall-research'); if (!target) return;
  const diagnostics = state.v2Backtests?.optionWallDiagnostics;
  if (!diagnostics) { target.textContent = '尚無牆位正式研究結果，請執行 V2 回測更新。'; return; }
  const card = (title, row, directionLabel = '') => {
    const article = document.createElement('article'); article.className = 'wall-research-card';
    const heading = document.createElement('b'); heading.textContent = title;
    const content = document.createElement('span');
    const hit = row?.directionHitPct == null ? '' : `｜${directionLabel} ${fmt(row.directionHitPct, 1)}%`;
    content.textContent = `樣本 ${fmt(row?.samples)}｜隔日平均 ${signed(row?.averageNextPoints, '點', 1)}${hit}｜平均波動 ${fmt(row?.averageAbsoluteMove, 1)}點`;
    article.append(heading, content); return article;
  };
  const note = document.createElement('p'); note.className = 'wall-research-note';
  note.textContent = '描述統計不是交易策略；樣本少於30筆只列為線索。公開OI無法辨認買賣方，兩項牆位策略目前均未通過完整回測門檻。';
  target.replaceChildren(
    card('雙牆同步上移', diagnostics.migration?.bothUp, '隔日上漲'),
    card('雙牆同步下移', diagnostics.migration?.bothDown, '隔日下跌'),
    card('Call牆突破＋OI減少', diagnostics.breakout?.aboveCallWithOiWeakening, '隔日續漲'),
    card('Put牆跌破＋OI減少', diagnostics.breakout?.belowPutWithOiWeakening, '隔日續跌'),
    card('雙牆穩定至少3日', diagnostics.stability?.bothStable3Days),
    card('牆位仍在移動', diagnostics.stability?.moving),
    note,
  );
}

function renderV2Options(options, futures) {
  const selected = options?.selected;
  if (!selected) { $('v2-option-delta-chart').textContent = '沒有可顯示的選擇權資料。'; return; }
  text('v2-option-date', `${options.latestDate}｜${selected.contract}`);
  $('v2-option-summary').replaceChildren(
    defenseItem('Call OI 牆', fmt(selected.callWallStrike), `${fmt(selected.callWallOi)} 口`, 'call'),
    defenseItem('Put OI 牆', fmt(selected.putWallStrike), `${fmt(selected.putWallOi)} 口`, 'put'),
    defenseItem('Max Pain', fmt(selected.maxPain), '估算結算敏感位置', 'pain'),
    defenseItem('OI P/C', fmt(selected.oiPcRatio, 2), `Call ${fmt(selected.callOi)}｜Put ${fmt(selected.putOi)}`, 'market'),
  );
  const convergence = maxPainConvergence(options.history || [], selected);
  if (convergence) $('v2-option-summary').append(defenseItem('Max Pain 距離', `${fmt(convergence.distance)} 點`, `${convergence.status}｜較前日 ${signed(convergence.distanceChange)} 點`, 'convergence'));
  applyMaxPainAdvice(convergence);
  renderOptionDefenseConclusion(options, futures);
  renderOptionWallResearch();
  const txClose = Number(futures?.at(-1)?.txClose || selected.maxPain || 0);
  const rows = selectedStrikes(options.strikes || [], selected, txClose);
  const maxAbs = Math.max(1, ...rows.flatMap((r) => [Math.abs(Number(r.callDelta) || 0), Math.abs(Number(r.putDelta) || 0)]));
  const width = 980; const height = 300; const left = 48; const baseY = 140; const plotWidth = 910;
  const step = plotWidth / Math.max(1, rows.length); const barWidth = Math.max(4, step * .34);
  const scale = (value) => Math.abs(Number(value) || 0) / maxAbs * 105;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${selected.contract} 選擇權 ${options.deltaDays} 日 OI 變化圖` });
  svg.append(svgNode('line', { x1: left, x2: width - 20, y1: baseY, y2: baseY, class: 'zero-line' }));
  rows.forEach((row, index) => {
    const center = left + index * step + step / 2;
    const call = Number(row.callDelta) || 0; const put = Number(row.putDelta) || 0;
    const callH = scale(call); const putH = scale(put);
    const callBar = svgNode('rect', { x: center - barWidth - 1, y: call >= 0 ? baseY - callH : baseY, width: barWidth, height: callH, class: `delta-bar call ${call < 0 ? 'decrease' : ''}`, tabindex: 0 });
    const putBar = svgNode('rect', { x: center + 1, y: put >= 0 ? baseY : baseY - putH, width: barWidth, height: putH, class: `delta-bar put ${put < 0 ? 'decrease' : ''}`, tabindex: 0 });
    const show = () => { $('v2-option-hover').textContent = `履約價 ${fmt(row.strike)}｜${options.deltaDays}日 Call OI ${signed(call)}（現有 ${fmt(row.callOi)}）｜Put OI ${signed(put)}（現有 ${fmt(row.putOi)}）`; };
    [callBar, putBar].forEach((bar) => { bar.addEventListener('mouseenter', show); bar.addEventListener('focus', show); bar.setAttribute('aria-label', `${row.strike} ${options.deltaDays}日 OI 變化`); svg.append(bar); });
    if (index % Math.max(1, Math.ceil(rows.length / 10)) === 0) { const t = svgNode('text', { x: center, y: 284, class: 'axis-label', 'text-anchor': 'middle' }); t.textContent = fmt(row.strike); svg.append(t); }
  });
  $('v2-option-delta-chart').replaceChildren(svg);
  const top = (field) => [...(options.strikes || [])].filter((r) => Number.isFinite(Number(r[field]))).sort((a, b) => Number(b[field]) - Number(a[field])).slice(0, 5);
  const ranking = (title, rows2, field, cls) => {
    const article = document.createElement('article'); article.className = `ranking-card ${cls}`;
    const h = document.createElement('h4'); h.textContent = title; article.append(h);
    rows2.forEach((r) => { const p = document.createElement('p'); p.textContent = `${fmt(r.strike)}　${signed(r[field])} 口`; article.append(p); }); return article;
  };
  $('v2-option-rankings').replaceChildren(ranking('Call OI 增加前五', top('callDelta'), 'callDelta', 'call'), ranking('Put OI 增加前五', top('putDelta'), 'putDelta', 'put'));
  renderV2WallHistory(options.history || []);
}

function renderV2WallHistory(rows) {
  const target = $('v2-wall-chart');
  if (!rows.length) { target.textContent = '所選契約尚無歷史牆位。'; return; }
  const visible = rows.slice(-12);
  const width = 980; const height = 330; const left = 72; const right = 28; const top = 38; const bottom = 52;
  const validPrice = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const values = visible.flatMap((r) => [r.callWallStrike, r.putWallStrike, r.maxPain, r.txClose]).map(validPrice).filter((value) => value != null);
  if (!values.length) { target.textContent = '目前沒有可繪製的有效牆位與台指價位。'; return; }
  const [rawMin, rawMax] = extent(values);
  let min = Math.floor(rawMin / 500) * 500; let max = Math.ceil(rawMax / 500) * 500;
  if (min === max) { min -= 500; max += 500; }
  const step = visible.length > 1 ? (width - left - right) / (visible.length - 1) : 0;
  // A newly listed contract may initially have only one observation.  Centre
  // that day instead of pinning it to the far-left edge like a broken chart.
  const x = (index) => visible.length > 1 ? left + index * step : (left + width - right) / 2;
  const y = (value) => top + (max - Number(value)) / (max - min) * (height - top - bottom);
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '日期為橫軸、價位為縱軸的Put牆、Max Pain、台指期與Call牆攻防圖' });
  const legend = [['Put牆', 'put'], ['Max Pain', 'pain'], ['台指', 'tx'], ['Call牆', 'call']];
  legend.forEach(([label, cls], index) => { const marker = svgNode('circle', { cx: left + index * 125, cy: 13, r: 4, class: `wall-marker ${cls}` }); const t = svgNode('text', { x: left + 10 + index * 125, y: 17, class: 'legend' }); t.textContent = label; svg.append(marker, t); });
  for (let value = max; value >= min; value -= 500) {
    const tickY = y(value);
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: tickY, y2: tickY, class: 'wall-grid-line' }));
    const label = svgNode('text', { x: left - 8, y: tickY + 4, class: 'axis-label wall-axis-value', 'text-anchor': 'end' }); label.textContent = fmt(value); svg.append(label);
  }
  visible.forEach((row, index) => {
    const date = svgNode('text', { x: x(index), y: height - 18, class: 'axis-label', 'text-anchor': 'middle' }); date.textContent = row.tradeDate.slice(5); svg.append(date);
    const putValue = validPrice(row.putWallStrike); const callValue = validPrice(row.callWallStrike);
    if (putValue != null && callValue != null) svg.append(svgNode('line', { x1: x(index), x2: x(index), y1: y(callValue), y2: y(putValue), class: 'wall-range' }));
    const points = [['putWallStrike', 'put', 'Put牆'], ['maxPain', 'pain', 'Max Pain'], ['txClose', 'tx', '台指'], ['callWallStrike', 'call', 'Call牆']];
    points.forEach(([field, cls, label]) => {
      const value = validPrice(row[field]); if (value == null) return;
      const point = svgNode('circle', { cx: x(index), cy: y(value), r: cls === 'tx' ? 5 : 4, class: `wall-marker ${cls}` });
      point.setAttribute('aria-label', `${row.tradeDate} ${label} ${fmt(value)}`); svg.append(point);
    });
    const previous = visible[index - 1];
    const change = (field) => previous && Number.isFinite(Number(row[field])) && Number.isFinite(Number(previous[field])) ? Number(row[field]) - Number(previous[field]) : null;
    const show = () => { $('v2-wall-hover').textContent = `${row.tradeDate}｜Put牆 ${fmt(row.putWallStrike)}（${signed(change('putWallStrike'))}）｜Max Pain ${fmt(row.maxPain)}（${signed(change('maxPain'))}）｜台指 ${fmt(row.txClose)}（${signed(change('txClose'))}）｜Call牆 ${fmt(row.callWallStrike)}（${signed(change('callWallStrike'))}）｜括號為較前一交易日變化`; };
    const hitWidth = visible.length > 1 ? Math.max(16, step) : Math.min(180, width - left - right);
    const hit = svgNode('rect', { x: x(index) - hitWidth / 2, y: top, width: hitWidth, height: height - top - bottom, class: 'wall-hit' });
    hit.addEventListener('mouseenter', show); hit.setAttribute('aria-label', `${row.tradeDate}攻防價位與前日變化`); svg.append(hit);
  });
  target.replaceChildren(svg);
  if (visible.length === 1) $('v2-wall-hover').textContent = `目前契約僅有 ${visible[0].tradeDate} 1日資料；已置中顯示，累積第2個交易日後才會形成時間軸趨勢。`;
}

function renderV2(data) {
  state.v2 = data; state.v2Contract = data.query?.contract || '';
  renderV2Status(data); renderV2Futures(data.futures || []); renderV2GlobalContext(data); renderV2TermStructure(data);
  const select = $('v2-contract-select');
  const options = (data.options?.contracts || []).map((row) => { const option = document.createElement('option'); option.value = row.contract; option.textContent = `${row.contract}｜${row.contractType || '契約'}${row.isActive ? '｜主力' : ''}`; return option; });
  select.replaceChildren(...options); select.value = state.v2Contract;
  renderOptionsTrendPanel(data.options);
  renderV2Options(data.options, data.futures);
  renderOptionsSmartRadar(data.options?.smartRadar);
}

function renderOptionsSmartRadar(radar) {
  if (!$('smart-radar-focus')) return;
  const available = Boolean(radar?.available);
  if ($('axis-options') && available) {
    const anomaly = Math.max(Number(radar.callHeat) || 0, Number(radar.putHeat) || 0);
    setCockpitAxis('axis-options', `${fmt(anomaly)}/100`, `${radar.focus}・${radar.liveConnected ? '即時' : '盤後'}`,
      anomaly >= 75 ? 'danger' : anomaly >= 45 ? 'observe' : 'safe');
  }
  text('smart-radar-date', available ? `${radar.tradeDate || '—'}・${radar.contract || '—'}` : '資料不足');
  text('smart-radar-mode', radar?.liveConnected ? `即時 ${fmt(radar.refreshSeconds)}秒` : '官方盤後雷達');
  $('smart-radar-mode').className = `source-badge ${radar?.liveConnected ? 'ok' : 'warn'}`;
  text('smart-radar-call-heat', Number.isFinite(Number(radar?.callHeat)) ? `${fmt(radar.callHeat)} / 100` : '--');
  text('smart-radar-put-heat', Number.isFinite(Number(radar?.putHeat)) ? `${fmt(radar.putHeat)} / 100` : '--');
  text('smart-radar-focus', available ? radar.focus : '等待可用契約');
  text('smart-radar-decision', available ? `${radar.directionLabel}。${radar.recommendation}` : (radar?.reason || '雷達資料尚未建立。'));
  const renderList = (targetId, rows, side) => {
    const target = $(targetId);
    if (!target) return;
    if (!rows?.length) { target.replaceChildren(Object.assign(document.createElement('p'), { textContent: '沒有可比較資料。' })); return; }
    const items = rows.map((row, index) => {
      const article = document.createElement('article');
      const score = Number.isFinite(Number(row.score)) ? Number(row.score) : 0;
      article.className = `radar-row ${score >= 80 ? 'extreme' : score >= 65 ? 'high' : score >= 45 ? 'watch' : 'normal'}`;
      const rank = document.createElement('span'); rank.className = 'radar-rank'; rank.textContent = String(index + 1).padStart(2, '0');
      const body = document.createElement('div'); body.className = 'radar-row-body';
      const heading = document.createElement('div'); heading.className = 'radar-row-heading';
      const strike = document.createElement('strong'); strike.textContent = `${fmt(row.strike)} ${side}`;
      const badge = document.createElement('span'); badge.textContent = `${fmt(row.score)}分・${row.activity}`;
      heading.append(strike, badge);
      const meter = document.createElement('progress'); meter.className = 'radar-meter'; meter.max = 100; meter.value = Math.max(0, Math.min(100, score));
      const facts = document.createElement('p');
      const tags = row.tags?.length ? row.tags.join('／') : '未達多項異常門檻';
      facts.textContent = `${tags}｜量比 ${row.volumeRatio == null ? '—' : `${fmt(row.volumeRatio, 2)}x`}｜OI ${row.oiDelta == null ? '—' : signed(row.oiDelta, '口')}｜資料 ${fmt(row.dataCoveragePct)}%`;
      const note = document.createElement('small'); note.textContent = row.interpretation;
      body.append(heading, meter, facts, note); article.append(rank, body); return article;
    });
    target.replaceChildren(...items);
  };
  renderList('smart-radar-call-list', radar?.topCalls, 'Call');
  renderList('smart-radar-put-list', radar?.topPuts, 'Put');
  text('smart-radar-pending-inputs', radar?.pendingInputs?.length
    ? `${radar.pendingInputs.join('、')}。開戶後先接唯讀行情，通過時間戳與資料品質驗證才啟用。`
    : '即時資料已接入，但仍須通過價格與風控確認。');
}

async function loadV2Research() {
  const params = new URLSearchParams({ days: state.v2Days, delta: state.v2Delta });
  if (state.v2Contract) params.set('contract', state.v2Contract);
  const payload = await api(`/api/v2/research?${params}`);
  renderV2(payload.data);
}

function renderV2Backtests(data) {
  state.v2Backtests = data;
  renderOptionWallResearch();
  renderGlobalResearch();
  if (state.v2) renderOptionDefenseConclusion(state.v2.options, state.v2.futures);
  const strategies = data?.strategies || [];
  renderChipIncrementalStudy(strategies);
  renderForeignDelayStudy(strategies);
  renderInstitutionalAlignmentStudy(strategies);
  text('v2-backtest-period', data?.generatedAt ? `更新 ${timeLabel(data.generatedAt)}` : '尚未執行');
  const rows = strategies.filter((strategy) => !strategy.researchFamily?.startsWith('chip_incremental') || strategy.researchRole === 'full_candidate').map((strategy) => {
    const metrics = strategy.metrics || {};
    const holdout = strategy.holdout?.metrics || {};
    const stability = strategy.foldStability || {};
    const gateLabels = { passed_first_gate: '通過第一關', failed_holdout: '留出測試未通過', failed_walk_forward: '滾動測試未通過', insufficient_sample: '樣本不足', failed_fold_stability: '跨區間不穩定', failed_robustness: '敏感度未通過' };
    const passed = strategy.gate === 'passed_first_gate';
    const tr = document.createElement('tr');
    const values = [
      strategy.label || strategy.key,
      gateLabels[strategy.gate] || '待驗證',
      fmt(metrics.trades),
      fmt(metrics.profitFactor, 2),
      signed(metrics.totalNetPoints, ' 點'),
      `${fmt(stability.positiveFolds)}／${fmt(stability.totalFolds)}`,
      fmt(holdout.trades),
      fmt(holdout.profitFactor, 2),
      signed(holdout.totalNetPoints, ' 點'),
      fmt(holdout.maxDrawdownPoints) === '—' ? '—' : `-${fmt(holdout.maxDrawdownPoints)} 點`,
    ];
    values.forEach((value, index) => {
      const td = document.createElement('td'); td.textContent = value;
      if (index === 1) td.className = passed ? 'backtest-preliminary' : 'backtest-rejected';
      if (index === 4 && Number(metrics.totalNetPoints) !== 0) td.classList.add(Number(metrics.totalNetPoints) > 0 ? 'positive' : 'negative');
      if (index === 8 && Number(holdout.totalNetPoints) !== 0) td.classList.add(Number(holdout.totalNetPoints) > 0 ? 'positive' : 'negative');
      tr.append(td);
    });
    return tr;
  });
  $('v2-backtest-table').replaceChildren(...rows);
  const assumptions = data?.assumptions || {};
  text('v2-backtest-note', strategies.length
    ? `Walk-forward：至少 ${fmt(assumptions.minTrainDays)} 日訓練、每段 ${fmt(assumptions.testWindowDays)} 日驗證，最後 ${fmt((assumptions.holdoutPct || 0.2) * 100)}% 完全保留測試；每次進出先扣 ${fmt(assumptions.costPoints)} 點成本。盤後籌碼一律從下一個日盤開盤進場，海外背景才測當日日盤開盤至收盤。通過第一關只代表研究候選，不等於未來可獲利。`
    : '尚無正式回測結果，請執行 7_V2_RUN_BACKTEST.bat。');
  const stressTarget = $('v2-candidate-stress');
  if (stressTarget) {
    const candidates = strategies.filter((strategy) => strategy.gate === 'passed_first_gate' && !strategy.key?.startsWith('foreign_futures_price_oi_h'));
    const cards = candidates.map((strategy) => {
      const stress = strategy.stressDiagnostics || {}; const concentration = stress.profitConcentration || {};
      const article = document.createElement('article'); article.className = 'candidate-stress-card';
      const title = document.createElement('span'); title.textContent = '第一關候選';
      const strong = document.createElement('strong'); strong.textContent = strategy.label || strategy.key;
      const summary = document.createElement('p'); summary.textContent = `滾動 ${fmt(strategy.metrics?.trades)}筆／PF ${fmt(strategy.metrics?.profitFactor, 2)}；留出 ${fmt(strategy.holdout?.metrics?.trades)}筆／PF ${fmt(strategy.holdout?.metrics?.profitFactor, 2)}。`;
      const pressure = document.createElement('p'); pressure.textContent = concentration.withoutBest5
        ? `移除全期間最大5筆獲利後：PF ${fmt(concentration.withoutBest5.profitFactor, 2)}、淨 ${signed(concentration.withoutBest5.totalNetPoints, ' 點')}。`
        : '獲利集中度尚未計算。';
      const warning = document.createElement('small'); warning.textContent = '僅通過第一關；壓力測試屬事後診斷，需等待新資料前推驗證。';
      article.append(title, strong, summary, pressure, warning); return article;
    });
    stressTarget.replaceChildren(...cards);
    stressTarget.hidden = cards.length === 0;
  }
}

function renderChipIncrementalStudy(strategies) {
  const table = $('v2-chip-incremental-table'); const conclusion = $('v2-chip-incremental-conclusion');
  if (!table || !conclusion) return;
  const wanted = strategies.filter((strategy) => /^chip_incremental_h[23]$/.test(strategy.researchFamily || ''));
  const roleOrder = { benchmark: 0, ablation: 1, full_candidate: 2, risk_filter: 3 };
  const roleLabel = { benchmark: '基準', ablation: '消融', full_candidate: '完整候選', risk_filter: '風險過濾' };
  const layerLabel = (strategy) => strategy.key.startsWith('price_only') ? '只有價格延續'
    : strategy.key.startsWith('price_oi') ? '價格＋市場OI'
      : strategy.key.startsWith('foreign_price_ablation') ? '外資＋價格（拿掉OI）'
        : strategy.researchRole === 'risk_filter' ? '完整條件，排除高波動' : '外資＋價格＋市場OI';
  const holdingDays = (strategy) => strategy.researchFamily.endsWith('h3') ? 3 : 2;
  wanted.sort((a, b) => holdingDays(a) - holdingDays(b) || (roleOrder[a.researchRole] ?? 9) - (roleOrder[b.researchRole] ?? 9) || a.key.localeCompare(b.key));
  const rows = wanted.map((strategy) => {
    const development = strategy.metrics || {}; const holdout = strategy.holdout?.metrics || {};
    const interpretation = strategy.researchRole === 'full_candidate' ? '檢查是否優於基準'
      : strategy.researchRole === 'risk_filter' ? (Number(holdout.trades) < 15 ? '回撤改善，但樣本不足' : '風險過濾待前推')
        : Number(development.profitFactor) > 1 && Number(holdout.profitFactor) > 1 ? '單純層已有優勢' : '未形成穩定優勢';
    const values = [`${holdingDays(strategy)}日｜${layerLabel(strategy)}`, roleLabel[strategy.researchRole] || '比較',
      fmt(development.trades), fmt(development.profitFactor, 2), signed(development.totalNetPoints, ' 點'),
      fmt(holdout.trades), fmt(holdout.profitFactor, 2), signed(holdout.totalNetPoints, ' 點'),
      fmt(holdout.maxDrawdownPoints) === '—' ? '—' : `-${fmt(holdout.maxDrawdownPoints)} 點`, interpretation];
    const tr = document.createElement('tr');
    values.forEach((value, index) => {
      const td = document.createElement('td'); td.textContent = value;
      if (index === 4) td.className = Number(development.totalNetPoints) > 0 ? 'positive' : Number(development.totalNetPoints) < 0 ? 'negative' : '';
      if (index === 7) td.className = Number(holdout.totalNetPoints) > 0 ? 'positive' : Number(holdout.totalNetPoints) < 0 ? 'negative' : '';
      if (index === 9) td.className = strategy.researchRole === 'full_candidate' ? 'backtest-preliminary' : 'backtest-rejected';
      tr.append(td);
    });
    return tr;
  });
  table.replaceChildren(...rows);
  if (!wanted.length) {
    conclusion.textContent = '尚無籌碼增量研究結果，請重新執行V2回測。'; conclusion.className = 'delay-conclusion neutral'; return;
  }
  const find = (key) => wanted.find((item) => item.key === key);
  const pf = (key, split = 'metrics') => Number(split === 'holdout' ? find(key)?.holdout?.metrics?.profitFactor : find(key)?.metrics?.profitFactor);
  const h2Lift = pf('foreign_futures_price_oi_h2') - pf('price_oi_benchmark_h2');
  const h3Lift = pf('foreign_futures_price_oi_h3') - pf('price_oi_benchmark_h3');
  conclusion.textContent = `目前結論：價格延續與價格＋OI基準在2／3日滾動測試均虧損；加入外資但拿掉OI也未形成穩定優勢。三者完整組合的滾動PF相對價格＋OI提高${fmt(h2Lift, 2)}／${fmt(h3Lift, 2)}，顯示籌碼可能具有條件式增量價值。排除高波動後留出回撤下降，但只剩10～11筆，暫列風險過濾候選。`;
  conclusion.className = 'delay-conclusion caution';
}

function renderForeignDelayStudy(strategies) {
  const table = $('v2-delay-table'); const conclusion = $('v2-delay-conclusion');
  if (!table || !conclusion) return;
  const wanted = strategies.filter((strategy) =>
    /^foreign_futures_price_oi(?:_h[235])?$/.test(strategy.key || '') ||
    /^foreign_short_add_1d_h[135]$/.test(strategy.key || '') ||
    /^foreign_short_no_drop_h[35]$/.test(strategy.key || '')
  );
  const gateLabels = {
    passed_first_gate: '研究候選', failed_holdout: '留出失效', failed_walk_forward: '滾動失效',
    insufficient_sample: '樣本不足', failed_fold_stability: '跨區間不穩', failed_robustness: '敏感度失效',
  };
  const conditionLabel = (key) => key.startsWith('foreign_futures_price_oi')
    ? '價格＋外資淨部位＋市場 OI 同步'
    : key.startsWith('foreign_short_no_drop') ? '加空但價格尚未下跌' : '外資單日大幅加空';
  const holdingDays = (strategy) => {
    const match = (strategy.key || '').match(/_h([1-5])$/); return Number(match?.[1] || strategy.holdingDays || 1);
  };
  const regimeLabel = { bull: '多頭', bear: '空頭', range: '震盪', high_vol: '高波動' };
  const bestRegime = (strategy) => {
    const regimes = Object.entries(strategy.holdout?.byRegime || {})
      .filter(([key, metrics]) => regimeLabel[key] && Number(metrics?.trades) >= 3 && Number.isFinite(Number(metrics?.profitFactor)))
      .sort((a, b) => Number(b[1].profitFactor) - Number(a[1].profitFactor));
    return regimes.length ? `${regimeLabel[regimes[0][0]]} ${fmt(regimes[0][1].profitFactor, 2)}` : '樣本不足';
  };
  wanted.sort((a, b) => conditionLabel(a.key).localeCompare(conditionLabel(b.key), 'zh-Hant') || holdingDays(a) - holdingDays(b));
  const rows = wanted.map((strategy) => {
    const holdout = strategy.holdout?.metrics || {}; const folds = strategy.foldStability || {};
    const direction = strategy.stressDiagnostics?.direction || {};
    const longPf = Number(direction.holdoutLong?.trades) ? fmt(direction.holdoutLong?.profitFactor, 2) : '—';
    const shortPf = Number(direction.holdoutShort?.trades) ? fmt(direction.holdoutShort?.profitFactor, 2) : '—';
    const tr = document.createElement('tr');
    const passed = strategy.gate === 'passed_first_gate';
    const values = [
      conditionLabel(strategy.key), `${holdingDays(strategy)} 日`, fmt(holdout.trades), fmt(holdout.profitFactor, 2),
      longPf, shortPf, bestRegime(strategy), signed(holdout.totalNetPoints, ' 點'),
      `${fmt(folds.positiveFolds)}／${fmt(folds.totalFolds)}`, gateLabels[strategy.gate] || '待驗證',
    ];
    values.forEach((value, index) => {
      const td = document.createElement('td'); td.textContent = value;
      if (index === 7) td.className = Number(holdout.totalNetPoints) > 0 ? 'positive' : Number(holdout.totalNetPoints) < 0 ? 'negative' : '';
      if (index === 9) td.className = passed ? 'backtest-preliminary' : 'backtest-rejected';
      tr.append(td);
    });
    return tr;
  });
  table.replaceChildren(...rows);
  if (!wanted.length) {
    conclusion.textContent = '尚無延後反應研究結果，請重新執行 V2 回測。';
    conclusion.className = 'delay-conclusion neutral'; return;
  }
  conclusion.textContent = '非重疊重測：外資「單日大幅加空」只在隔日呈現偏弱候選，持有3～5日失效，不能解讀成必然連跌。價格、外資淨部位與市場OI同步的2／3日仍通過第一關；2日優勢集中在多頭盤，高波動盤失效，3日較均衡。5日雖為正，但留出僅14筆且空方虧損，判定樣本不足。';
  conclusion.className = 'delay-conclusion caution';
}

function renderInstitutionalAlignmentStudy(strategies) {
  const table = $('v2-institutional-table'); const conclusion = $('v2-institutional-conclusion');
  if (!table || !conclusion) return;
  const wanted = strategies.filter((strategy) => /^(?:institutional_(?:net_alignment|delta_alignment|delta_confirmed)_h[123]|foreign_(?:trust_delta|dealer_delta|led_confirmed)_h[12])$/.test(strategy.key || ''));
  const gateLabels = {
    passed_first_gate: '研究候選', failed_holdout: '留出失效', failed_walk_forward: '滾動失效',
    insufficient_sample: '樣本不足', failed_fold_stability: '跨區間不穩', failed_robustness: '敏感度失效',
  };
  const conditionLabel = (key) => key.includes('net_alignment') ? '三者目前淨部位同向'
    : key.includes('delta_confirmed') ? '三者單日增減＋價格＋OI'
      : key.includes('trust_delta') ? '外資＋投信單日增減同向'
        : key.includes('dealer_delta') ? '外資＋自營商單日增減同向'
          : key.includes('led_confirmed') ? '外資極端＋投信不反向＋價格OI' : '三者單日增減同向';
  const holdingDays = (key) => Number((key.match(/_h([123])$/) || [])[1] || 1);
  wanted.sort((a, b) => conditionLabel(a.key).localeCompare(conditionLabel(b.key), 'zh-Hant') || holdingDays(a.key) - holdingDays(b.key));
  const rows = wanted.map((strategy) => {
    const development = strategy.metrics || {}; const holdout = strategy.holdout?.metrics || {}; const passed = strategy.gate === 'passed_first_gate';
    const values = [conditionLabel(strategy.key), `${holdingDays(strategy.key)} 日`, fmt(development.trades), fmt(development.profitFactor, 2),
      fmt(holdout.trades), fmt(holdout.profitFactor, 2), signed(holdout.totalNetPoints, ' 點'), gateLabels[strategy.gate] || '待驗證'];
    const tr = document.createElement('tr');
    values.forEach((value, index) => {
      const td = document.createElement('td'); td.textContent = value;
      if (index === 6) td.className = Number(holdout.totalNetPoints) > 0 ? 'positive' : Number(holdout.totalNetPoints) < 0 ? 'negative' : '';
      if (index === 7) td.className = passed ? 'backtest-preliminary' : 'backtest-rejected';
      tr.append(td);
    });
    return tr;
  });
  table.replaceChildren(...rows);
  const netStrategy = wanted.find((item) => item.key === 'institutional_net_alignment_h1');
  const netSamples = Number(netStrategy?.metrics?.trades || 0) + Number(netStrategy?.holdout?.metrics?.trades || 0);
  if (!wanted.length) {
    conclusion.textContent = '尚無三大法人同向研究結果，請重新執行V2回測。'; conclusion.className = 'delay-conclusion neutral'; return;
  }
  conclusion.textContent = `目前結論：三者期貨淨部位完全同向為${fmt(netSamples)}筆，三者單日增減同向亦未通過。外資＋投信隔日留出失效；外資＋自營商2日開發與留出PF略高於1，但跨區間不穩。外資極端確認2日只在近期留出漂亮、開發區為負。全部不加入首頁分數或操作建議。`;
  conclusion.className = 'delay-conclusion caution';
}

async function loadV2Backtests() {
  const payload = await api('/api/v2/backtests');
  renderV2Backtests(payload.data);
}

// Page-owned research remains available, but never gates the live workspace.
function loadResearchPage() {
  if (researchPageRequest) return researchPageRequest;
  researchPageRequest = Promise.allSettled([
    loadV2Research().catch(error => {
      text('v2-data-status', `V2 無法讀取：${error.message}`);
      $('v2-data-status').className = 'source-badge bad';
      console.error('[V2_RESEARCH]', error.message);
    }),
    loadV2Backtests().catch(error => {
      text('v2-backtest-period', '尚未完成');
      text('v2-backtest-note', `V2.3 回測尚未就緒：${error.message}`);
      console.error('[V2_BACKTESTS]', error.message);
    }),
  ]).finally(() => { researchPageRequest = null; });
  return researchPageRequest;
}

function dwText(id, value, fallback = 'UNAVAILABLE') {
  const node = $(id);
  if (node) node.textContent = value == null || value === '' ? fallback : String(value);
}

const DW_REASON_LABELS = Object.freeze({
  DERIVATION_NOT_IMPLEMENTED: '尚未實作',
  CONTRARY_EVIDENCE_DERIVATION_NOT_IMPLEMENTED: '反向證據目前無法計算',
  MOCK_NOT_DECISION_ELIGIBLE: '測試資料，不可進入決策狀態',
  RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD: 'Runtime 狀態目前無法取得',
  RUNTIME_UNAVAILABLE: 'Runtime 狀態目前無法取得',
  DATA_INSUFFICIENT: '資料不足',
  ENTRY_QUALITY_NOT_IMPLEMENTED: '進場條件尚未實作',
  INVALIDATION_CONTRACT_NOT_IMPLEMENTED: '失效條件尚未實作',
  CHANGE_DERIVATION_NOT_IMPLEMENTED: '近期變化目前無法計算',
  CONTRACT_NOT_FROZEN: '契約語意尚未凍結',
  NOT_IMPLEMENTED: '尚未實作',
  UNAVAILABLE: '目前無法取得',
  BAR_SEMANTICS_OWNER_DECISION_REQUIRED: '1D 語意等待 Product Owner 決策',
  TX_TICK_SOURCE_UNAVAILABLE: '目前沒有合法 TX Tick 可顯示',
  NIGHT_OPENING_RANGE_NOT_FROZEN: '夜盤 Opening Range 尚未凍結，不適用',
  OPENING_RANGE_NOT_COMPLETE: '08:45–09:00 Opening Range 尚未完成',
  OPENING_RANGE_TICKS_UNAVAILABLE: 'Opening Range 逐筆資料不足',
  ACTUAL_CONTRACT_MISMATCH: '真實契約不一致，禁止混用',
  DERIVATION_FAILURE: '衍生計算失敗',
  QUALITY_INSUFFICIENT: '資料品質不足',
  SESSION_TERMINATED: '行情連線已中斷',
  MARKET_CLOSED_EXPECTED: '交易所休市，未收到新行情屬正常（不代表行情連線已驗證正常）',
  EXCHANGE_EMERGENCY_CLOSURE: '交易所公告臨時休市',
  SCHEDULED_MARKET_HOLIDAY: '交易所例定休市',
  BRIDGE_NOT_RUNNING: '即時行情服務未執行',
  BRIDGE_HEALTH_UNAVAILABLE: '即時行情健康狀態無法取得',
  SUBSCRIPTION_RESTORE_FAILED: '必要行情訂閱尚未完整恢復',
  WRITER_UNAVAILABLE: '行情寫入器目前不可用',
  PORT_OCCUPIED_UNHEALTHY: '行情連接埠已被不健康程序占用',
  RECOVERY_BUDGET_EXHAUSTED: '自動恢復次數已用完，進入冷卻',
  TIMESTAMP_LINEAGE_INSUFFICIENT: '時間來源品質仍不足',
  KNOWN_CAPTURE_INTERRUPTION: '行情曾中斷；此區間資料不完整，不能作為已確認的目標依據',
  ARTIFACT_MISSING: '尚未設定或找不到已驗證的 CRU-34 歷史快照',
  ARTIFACT_CORRUPT_JSON: 'CRU-34 歷史快照內容損毀',
  ARTIFACT_SCHEMA_UNSUPPORTED: 'CRU-34 歷史快照版本不支援',
  SEMANTIC_CONTENT_HASH_INVALID: 'CRU-34 快照語意雜湊驗證失敗',
  ARTIFACT_HASH_INVALID: 'CRU-34 快照完整性驗證失敗',
  ARTIFACT_IDENTITY_INVALID: 'CRU-34 快照身分驗證失敗',
  ARTIFACT_IDENTITY_MISMATCH: 'CRU-34 快照身分與選擇條件不一致',
  SOURCE_IDENTITY_INVALID: 'CRU-34 來源帳本身分驗證失敗',
  SOURCE_MODE_NOT_AUTHORIZED: '此來源模式未獲准用於 Observed Flow',
  FRESHNESS_CUTOFF_INVALID: 'Observed Flow freshness cutoff 無效',
  PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE: '分類成交量覆蓋尚未達 100%，正式方向不晉升',
  QUALITY_INSUFFICIENT_LONG_GAP: '路徑存在過長間隔',
});

function dwHumanize(value, fallback = '目前無法取得') {
  if (value == null || value === '') return fallback;
  return DW_REASON_LABELS[value] || value;
}

function availabilityLabel(field) {
  return field?.availability === 'AVAILABLE' ? (field.value ?? 'AVAILABLE') : dwHumanize(field?.reason || 'UNAVAILABLE');
}

function renderPlainList(id, items, fallback) {
  const target = $(id);
  if (!target) return;
  const values = Array.isArray(items) ? items : [];
  const nodes = (values.length ? values : [fallback]).map((item) => {
    const li = document.createElement('li');
    const rawValue = typeof item === 'string'
      ? item
      : item?.title || item?.sourceId || item?.reason || item?.availability || fallback;
    li.textContent = dwHumanize(rawValue, dwHumanize(fallback));
    return li;
  });
  target.replaceChildren(...nodes);
}

function healthTone(value) {
  if (value === 'LIVE' || value === 'FRESH' || value === 'AVAILABLE' || value === 'PASS' || value === 'READY_FOR_REVIEW') return 'is-ready';
  if (value === 'DELAYED' || value === 'DEGRADED' || value === 'QUALITY_INSUFFICIENT' || value === 'PARTIAL') return 'is-quality';
  return 'is-unavailable';
}

const DW4_FAMILY_LABELS = Object.freeze({
  PRICE_STRUCTURE: '價格結構',
  PARTICIPATION_BREADTH: '參與度／市場廣度',
  FUTURES_INSTITUTIONAL: '期貨／法人',
  OPTIONS_CONTEXT: '選擇權背景',
  GLOBAL_FX: '全球／匯率',
});

const DW4_STATE_LABELS = Object.freeze({
  AVAILABLE: '可取得',
  UNAVAILABLE: '目前無法取得',
  STALE: '資料已過期',
  PASS: '品質通過',
  QUALITY_INSUFFICIENT: '品質不足',
  UNKNOWN: '品質未知',
  ELIGIBLE: '可納入方向彙總',
  RAW_ONLY: '僅原始資料',
  RESEARCH_ONLY: '僅供研究',
  NOT_PROMOTED: '尚未升級為方向證據',
  NOT_ELIGIBLE: '不納入方向彙總',
});

const DW4_SUMMARY_LABELS = Object.freeze({
  ALIGNED_UP: '可用證據方向一致向上',
  ALIGNED_DOWN: '可用證據方向一致向下',
  MIXED: '可用證據方向互有衝突',
  NO_DIRECTIONAL_EVIDENCE: '目前沒有可用方向證據',
  COMPLETE: '證據家族完整',
  PARTIAL: '證據家族部分可用',
  INSUFFICIENT: '證據覆蓋不足',
  PASS: '資料信任通過',
  DEGRADED: '資料信任降級',
  QUALITY_INSUFFICIENT: '資料品質不足',
  BLOCKED: '目前無法形成完整證據判讀',
});

const SOURCE_MODE_LABELS = Object.freeze({
  LIVE: '即時',
  LIVE_OR_REPLAY: '即時／重播',
  EOD: 'EOD',
  EOD_OR_DELAYED: 'EOD／延遲',
  BATCH: '批次',
  SESSION_ONLY: '本時段',
  PROXY_ONLY: '代理資料',
  LIVE_RAW: '即時原始資料',
  EOD_CONTEXT: 'EOD 背景',
  EOD_RESEARCH: 'EOD／延遲／研究背景',
  SOURCE_GAP: '來源缺口',
  DAY_0845_0900: '日盤 08:45–09:00',
});

function dw4StateLabel(value) {
  return DW4_STATE_LABELS[value] || dwHumanize(value, value || '目前無法取得');
}

function dw4SummaryLabel(value) {
  return DW4_SUMMARY_LABELS[value] || dw4StateLabel(value);
}

function sourceModeLabel(value) {
  return SOURCE_MODE_LABELS[value] || null;
}

function dw4DescriptiveValue(entry) {
  if (!entry || entry.value == null || entry.value === '') return terminalUnavailable(entry?.reason || 'DESCRIPTIVE_VALUE_UNAVAILABLE');
  const raw = typeof entry.value === 'number' ? fmt(entry.value, Number.isInteger(entry.value) ? 0 : 2) : entry.value;
  return `${raw}${entry.unit || ''}`;
}

function dw4FamilyLabel(value) {
  return DW4_FAMILY_LABELS[value] || value || '未知證據家族';
}

function dw4FamilyEvidence(contract, family) {
  return (contract?.evidence || []).find((item) => item.family === family) || null;
}

function dw4PulseValues(contract, family, limit = 2) {
  const item = dw4FamilyEvidence(contract, family);
  const descriptive = Array.isArray(item?.detail?.descriptiveValues) ? item.detail.descriptiveValues : [];
  return descriptive.slice(0, limit);
}

function renderMarketPulse(workspace, chart = state.txChartPayload) {
  const contract = workspace?.evidenceConflict;
  const levels = chart?.levels || {};
  const high = levelValue(levels.currentDayHigh) ?? levelValue(levels.nightHigh);
  const low = levelValue(levels.currentDayLow) ?? levelValue(levels.nightLow);
  const vwap = levelValue(levels.vwap);
  terminalWrite('dw-pulse-price', finiteNumber(chart?.lastPrice) == null ? null : fmt(chart.lastPrice), { reason: chart?.reason || 'LAST_PRICE_UNAVAILABLE' });
  terminalWrite('dw-pulse-vwap', vwap == null ? null : fmt(vwap, 2) + captureCoverageWarning(levels.vwap, true), { reason: levels.vwap?.reason || 'VWAP_UNAVAILABLE' });
  dwText('dw-pulse-vwap-mode', chart?.vwapSession === 'DAY' ? 'DAY VWAP · 本時段' : chart?.vwapSession === 'NIGHT' ? 'NIGHT VWAP · 本時段' : 'Session VWAP');
  const rangeWarning = captureCoverageWarning(levelValue(levels.currentDayHigh) != null ? levels.currentDayHigh : levels.nightHigh)
    || captureCoverageWarning(levelValue(levels.currentDayLow) != null ? levels.currentDayLow : levels.nightLow)
    || captureCoverageWarning(null, true);
  terminalWrite('dw-pulse-session', high != null && low != null ? `${fmt(high)} / ${fmt(low)}${rangeWarning}` : null, { reason: 'SESSION_HIGH_LOW_UNAVAILABLE' });

  const mappings = [
    ['PARTICIPATION_BREADTH', 'dw-pulse-breadth', 'dw-pulse-breadth-mode'],
    ['FUTURES_INSTITUTIONAL', 'dw-pulse-futures', 'dw-pulse-futures-mode'],
    ['OPTIONS_CONTEXT', 'dw-pulse-options', 'dw-pulse-options-mode'],
    ['GLOBAL_FX', 'dw-pulse-global', 'dw-pulse-global-mode'],
  ];
  mappings.forEach(([family, valueId, modeId]) => {
    const evidence = dw4FamilyEvidence(contract, family);
    const values = dw4PulseValues(contract, family, family === 'PARTICIPATION_BREADTH' ? 5 : 2);
    terminalWrite(valueId, values.length ? values.map((entry) => `${entry.label} ${dw4DescriptiveValue(entry)}`).join(' · ') : null, {
      reason: evidence?.reason || `${family}_UNAVAILABLE`,
    });
    const modes = [...new Set(values.map((entry) => sourceModeLabel(entry.sourceMode)).filter(Boolean))];
    const truth = family === 'PARTICIPATION_BREADTH'
      ? [evidence?.detail?.displaySourceLabel, evidence?.detail?.sourceTradeDate,
        dw4StateLabel(evidence?.qualityState), evidence?.promotionState].filter(Boolean)
      : family === 'GLOBAL_FX'
        ? [evidence?.detail?.displaySourceLabel, evidence?.detail?.sourceTradeDate].filter(Boolean)
        : modes;
    dwText(modeId, truth.join(' · ') || dw4StateLabel(evidence?.availabilityState));
  });
  dwText('dw-pulse-change', workspace?.currentMarketFactSummary?.priceStructureFact || '目前沒有合法事件');
  const latestVolume = Array.isArray(chart?.bars) ? finiteNumber(chart.bars.at(-1)?.volume) : null;
  terminalWrite('dw-pulse-volume', latestVolume == null ? null : fmt(latestVolume), { reason: 'LATEST_BAR_VOLUME_UNAVAILABLE' });
}

function renderLiveMarketPulse(pulse) {
  // Full workspace and live polls may complete in either order. Never roll back a newer live payload.
  const incomingAt = Date.parse(pulse?.generatedAt);
  const acceptedAt = Date.parse(state.marketPulse?.generatedAt);
  if (pulse?.schemaVersion === 'market-pulse-live-v1' && Number.isFinite(incomingAt) && incomingAt <= Date.now() + 5_000
      && (!Number.isFinite(acceptedAt) || incomingAt >= acceptedAt)) {
    state.marketPulse = pulse;
  }
  if (state.decisionWorkspace) state.decisionWorkspace = { ...state.decisionWorkspace, marketPulse: state.marketPulse };
  pulse = state.marketPulse;
  const now = Date.now();
  const generatedAt = Date.parse(pulse?.generatedAt);
  const sourceAt = Date.parse(pulse?.sourceAvailableAt);
  const chart = state.txChartPayload;
  const identity = pulse?.identity;
  const identityKeys = ['actualContract', 'tradeDate', 'session'];
  const reason = !pulse ? 'MARKET_PULSE_NOT_LOADED'
    : !Number.isFinite(generatedAt) || generatedAt > now + 5_000 ? 'MARKET_PULSE_TIME_INVALID'
      : now - generatedAt > 120_000 ? 'MARKET_PULSE_STALE'
        : identityKeys.some(key => !identity?.[key]) ? 'MARKET_PULSE_IDENTITY_MISSING'
          : chart && (chart.mode !== 'LIVE' || identityKeys.some(key => chart[key] !== identity[key])) ? 'MARKET_PULSE_CHART_IDENTITY_MISMATCH'
            : (pulse.rvol?.state === 'READY' || ['LIVE', 'SESSION_CLOSED_REFERENCE'].includes(pulse.basis?.state))
              && (!Number.isFinite(sourceAt) || sourceAt > now + 5_000 || now - sourceAt > 120_000) ? 'MARKET_PULSE_SOURCE_STALE' : null;
  if (reason) pulse = { rvol: { state: 'UNAVAILABLE', reason }, basis: { state: 'UNAVAILABLE', reason } };
  const rvol = pulse?.rvol || {};
  const ratio = finiteNumber(rvol.ratio);
  const percentile = finiteNumber(rvol.percentile);
  const cumulativeRatio = finiteNumber(rvol.cumulativeRatio);
  const rvolReady = rvol.state === 'READY' && ratio != null;
  const rvolValue = rvolReady
    ? [
      `${fmt(ratio, 2)}×`,
      percentile == null ? null : `P${fmt(percentile, 0)}`,
      cumulativeRatio == null ? null : `累積 ${fmt(cumulativeRatio, 2)}×`,
    ].filter(Boolean).join(' · ')
    : null;
  const rvolTitle = [rvolReady
    ? `完成5分K · n=${rvol.sampleDays} · baseline ${rvol.baselineStartDate || '—'}～${rvol.baselineEndDate || '—'} · median ${fmt(rvol.baselineMedian, 0)}`
    : (rvol.reason || 'RVOL_UNAVAILABLE'),
    rvol.completedBarTime ? `樣本 ${rvol.completedBarTime} · 可用 ${rvol.completedBarAvailableAt || '未知'}` : null,
    rvol.sourceQualityStatus ? `來源品質 ${rvol.sourceQualityStatus}` : null,
    ...(rvol.sourceQualityReasons || []),
    rvolReady && cumulativeRatio == null ? '累積 RVOL 未提供：完整盤初收集範圍未驗證' : null,
  ].filter(Boolean).join(' · ');
  terminalWrite('tt-pulse-rvol', rvolValue, { reason: rvol.reason || 'RVOL_UNAVAILABLE', title: rvolTitle });
  terminalWrite('dw-rvol-state', rvolValue, { reason: rvol.reason || 'RVOL_UNAVAILABLE', title: rvolTitle });

  const basis = pulse?.basis || {};
  const points = finiteNumber(basis.points);
  const pct = finiteNumber(basis.pct);
  const basisReady = ['LIVE', 'SESSION_CLOSED_REFERENCE'].includes(basis.state) && points != null;
  const mode = basis.state === 'LIVE' ? 'LIVE'
    : basis.state === 'SESSION_CLOSED_REFERENCE' ? '現貨收盤參考' : null;
  const basisValue = basisReady
    ? `${signed(points, ' 點', 2)}${pct == null ? '' : ` · ${signed(pct, '%', 3)}`} · ${mode}`
    : null;
  const basisTitle = basisReady
    ? `${basis.label || '基差'} · TX ${fmt(basis.futuresPrice, 2)} - IX0001 ${fmt(basis.spotPrice, 2)} · cash=${basis.spotTradeDate || '—'}`
    : (basis.reason || 'BASIS_UNAVAILABLE');
  for (const id of ['tt-top-basis', 'tt-pulse-basis', 'tt-futures-basis']) {
    terminalWrite(id, basisValue, { reason: basis.reason || 'BASIS_UNAVAILABLE', title: basisTitle });
    tone(id, basisReady ? points : 0);
  }
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
}

async function loadLiveMarketPulse() {
  if (state.marketPulseLoading || !(state.csrfToken || state.guestReadOnly)) return;
  state.marketPulseLoading = true;
  renderLiveMarketPulse(state.marketPulse);
  try {
    const payload = await api('/api/v1/market-pulse', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (payload?.data?.schemaVersion !== 'market-pulse-live-v1' || !Number.isFinite(Date.parse(payload.data.generatedAt))
        || Date.parse(payload.data.generatedAt) > Date.now() + 5_000) throw new Error('MARKET_PULSE_RESPONSE_INVALID');
    renderLiveMarketPulse(payload.data);
  } catch {
    renderLiveMarketPulse({ schemaVersion: 'market-pulse-live-v1', generatedAt: new Date().toISOString(),
      identity: state.marketPulse?.identity,
      rvol: { state: 'UNAVAILABLE', reason: 'MARKET_PULSE_REFRESH_FAILED' },
      basis: { state: 'UNAVAILABLE', reason: 'MARKET_PULSE_REFRESH_FAILED' } });
  } finally {
    state.marketPulseLoading = false;
  }
}

function observedFlowMetric(value, { signedValue = false, suffix = '', digits = 3 } = {}) {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  return signedValue ? signed(parsed, suffix, digits) : `${fmt(parsed, digits)}${suffix}`;
}

function observedFlowCoverage(value) {
  const parsed = finiteNumber(value);
  return parsed == null ? null : `${fmt(parsed * 100, 1)}%`;
}

function observedFlowDetailValue(value, reason = 'FIELD_NOT_REPORTED') {
  if (value == null || value === '') return terminalUnavailable(reason);
  if (typeof value === 'number') return Number.isInteger(value) ? fmt(value) : fmt(value, 4);
  return String(value);
}

function observedFlowDetailSection(title, rows) {
  const section = document.createElement('section');
  const heading = document.createElement('h3'); heading.textContent = title;
  const list = document.createElement('dl');
  for (const [label, value, reason] of rows) {
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = observedFlowDetailValue(value, reason);
    list.append(term, detail);
  }
  section.append(heading, list);
  return section;
}

function observedFlowWindowDetail(window) {
  const pressure = window?.pressure || {};
  const quote = pressure.bestQuoteCrossCheck || {};
  const conflict = pressure.conflict || {};
  const response = window?.response || {};
  const path = window?.pathEfficiency || {};
  return observedFlowDetailSection(`${window?.label || '時窗'}｜成交與價格證據`, [
    ['主動買方代理量', pressure.buyProxyVolume, pressure.unavailableReason],
    ['主動賣方代理量', pressure.sellProxyVolume, pressure.unavailableReason],
    ['不可分類量', pressure.unknownVolume, pressure.unavailableReason],
    ['可分類成交量', pressure.classifiedVolume, pressure.unavailableReason],
    ['主動成交淨差代理', pressure.netAggressiveFlowProxy, pressure.unavailableReason],
    ['成交力道原始比值', pressure.pressureRatio, pressure.unavailableReason],
    ['可判定成交占比', observedFlowCoverage(pressure.classifiedCoverage), pressure.unavailableReason],
    ['最佳報價符合占比', observedFlowCoverage(quote.matchedCoverage), 'BEST_QUOTE_MATCHED_COVERAGE_UNAVAILABLE'],
    ['最佳報價不可用量', quote.unavailableVolume, 'BEST_QUOTE_UNAVAILABLE_VOLUME_NOT_REPORTED'],
    ['分類衝突筆數', conflict.count, 'CLASSIFICATION_CONFLICT_COUNT_NOT_REPORTED'],
    ['分類衝突率', observedFlowCoverage(conflict.rate), 'CLASSIFICATION_CONFLICT_RATE_NOT_REPORTED'],
    ['起始價格', response.startPrice, 'RESPONSE_START_PRICE_UNAVAILABLE'],
    ['結束價格', response.endPrice, 'RESPONSE_END_PRICE_UNAVAILABLE'],
    ['價格位移（點）', response.displacementPoints, 'RESPONSE_DISPLACEMENT_UNAVAILABLE'],
    ['價格位移（ticks）', response.displacementTicks, 'RESPONSE_DISPLACEMENT_UNAVAILABLE'],
    ['價格反應關係', response.directionRelation, 'RESPONSE_DIRECTION_RELATION_UNAVAILABLE'],
    ['路徑效率原始值', path.value, path.unavailableReason],
    ['路徑不可用原因', path.unavailableReason || '無', path.status],
  ]);
}

function renderObservedFlowDetail(flow) {
  const target = $('dw-observed-flow-detail');
  if (!target) return;
  if (!flow || flow.sourceState === 'UNAVAILABLE' || !flow.windows) {
    target.replaceChildren(observedFlowDetailSection('證據不可用', [
      ['原因代碼', flow?.unavailableReason || 'ARTIFACT_MISSING'],
      ['中文說明', dwHumanize(flow?.unavailableReason || 'ARTIFACT_MISSING')],
      ['正式方向', '尚未通過正式驗證'],
    ]));
    return;
  }
  const identity = flow.identity || {};
  const source = flow.source || {};
  const lineage = flow.lineage || {};
  const artifact = flow.artifact || {};
  const nodes = [
    observedFlowDetailSection('資料身分與來源', [
      ['資料狀態', flow.sourceState],
      ['來源模式', source.sourceMode],
      ['實際契約', identity.actualContract],
      ['交易日', identity.tradeDate],
      ['盤別', identity.session],
      ['連續性區段', identity.continuityEpoch],
      ['資料可用時間', source.availableAt],
      ['產製時間', source.materializedAt],
    ]),
    observedFlowWindowDetail(flow.windows.primary60s),
    observedFlowWindowDetail(flow.windows.context300s),
    observedFlowWindowDetail(flow.windows.window900s),
    observedFlowWindowDetail(flow.windows.window1800s),
    observedFlowDetailSection('資料品質與正式驗證', [
      ['研究資料品質', flow.researchQuality?.status],
      ['品質原因', (flow.researchQuality?.reasons || []).join(', ') || '無'],
      ['正式方向', flow.formalDirection || 'NOT_PROMOTED'],
      ['驗證狀態', JSON.stringify(flow.promotionState || {})],
    ]),
    observedFlowDetailSection('技術 lineage', [
      ['cutoffLedgerOrdinal', lineage.cutoffLedgerOrdinal],
      ['cutoffRecordHash', lineage.cutoffRecordHash],
      ['maxUsedLedgerOrdinal', lineage.maxUsedLedgerOrdinal],
      ['maxUsedRecordHash', lineage.maxUsedRecordHash],
      ['sourceLedgerIdentity', lineage.sourceLedgerIdentity],
      ['artifactIdentity', artifact.artifactIdentity],
      ['semanticContentHash', artifact.semanticContentHash],
      ['artifactHash', artifact.artifactHash],
    ]),
  ];
  const methodology = observedFlowDetailSection('研究契約', Object.entries(flow.methodology || {})
    .map(([key, value]) => [key, value]));
  const limitations = document.createElement('section');
  const limitationsHeading = document.createElement('h3'); limitationsHeading.textContent = '限制';
  const limitationsList = document.createElement('ul');
  for (const value of flow.limitations || []) {
    const item = document.createElement('li'); item.textContent = value; limitationsList.append(item);
  }
  if (!limitationsList.children.length) {
    const item = document.createElement('li'); item.textContent = terminalUnavailable('LIMITATIONS_NOT_REPORTED'); limitationsList.append(item);
  }
  limitations.append(limitationsHeading, limitationsList);
  target.replaceChildren(...nodes, methodology, limitations);
}

function renderObservedFlowLegacy(flow) {
  const value = flow || { sourceState: 'UNAVAILABLE', unavailableReason: 'ARTIFACT_MISSING', windows: null };
  const available = ['HISTORICAL', 'STALE'].includes(value.sourceState) && value.windows;
  const reason = value.unavailableReason || 'OBSERVED_FLOW_UNAVAILABLE';
  const state = $('dw-observed-flow-state');
  if (state) {
    state.textContent = available ? value.sourceState : terminalUnavailable(reason);
    state.className = `dw-status-pill ${available ? 'is-quality' : 'is-unavailable'}`;
  }
  const primary = value.windows?.primary60s;
  const context = value.windows?.context300s;
  const truth = $('dw-observed-flow-truth');
  if (truth) {
    const title = truth.querySelector('strong');
    const note = truth.querySelector('span');
    const tradeDate = value.identity?.tradeDate || value.source?.tradeDate || 'DATE_NOT_REPORTED';
    const contract = value.identity?.actualContract || 'CONTRACT_NOT_REPORTED';
    const session = value.identity?.session || 'SESSION_NOT_REPORTED';
    if (available) {
      title.textContent = `${value.sourceState} · ${tradeDate}`;
      note.textContent = value.sourceState === 'STALE'
        ? `非目前盤勢 · stale snapshot · ${contract} · ${session}`
        : `非目前盤勢 · historical snapshot · ${contract} · ${session}`;
      truth.className = `dw-observed-flow-truth ${value.sourceState === 'STALE' ? 'is-stale' : 'is-historical'}`;
    } else {
      title.textContent = terminalUnavailable(reason);
      note.textContent = '目前沒有可合法顯示的 Observed Flow snapshot';
      truth.className = 'dw-observed-flow-truth is-unavailable';
    }
  }
  for (const [id, metric, metricReason] of [
    ['dw-observed-flow-pressure-60', observedFlowMetric(primary?.pressure?.pressureRatio, { signedValue: true, digits: 3 }), primary?.pressure?.unavailableReason],
    ['dw-observed-flow-response-60', observedFlowMetric(primary?.response?.displacementPoints, { signedValue: true, suffix: ' pts', digits: 0 }), 'RESPONSE_DISPLACEMENT_UNAVAILABLE'],
    ['dw-observed-flow-path-60', observedFlowMetric(primary?.pathEfficiency?.value, { digits: 3 }), primary?.pathEfficiency?.unavailableReason],
    ['dw-observed-flow-pressure-300', observedFlowMetric(context?.pressure?.pressureRatio, { signedValue: true, digits: 3 }), context?.pressure?.unavailableReason],
    ['dw-observed-flow-response-300', observedFlowMetric(context?.response?.displacementPoints, { signedValue: true, suffix: ' pts', digits: 0 }), 'RESPONSE_DISPLACEMENT_UNAVAILABLE'],
    ['dw-observed-flow-path-300', observedFlowMetric(context?.pathEfficiency?.value, { digits: 3 }), context?.pathEfficiency?.unavailableReason],
  ]) terminalWrite(id, available ? metric : null, { reason: available ? (metricReason || 'FIELD_UNAVAILABLE') : reason });
  terminalWrite('dw-observed-flow-coverage', available
    ? `60s ${observedFlowCoverage(primary?.pressure?.classifiedCoverage) || terminalUnavailable(primary?.pressure?.unavailableReason)} · 300s ${observedFlowCoverage(context?.pressure?.classifiedCoverage) || terminalUnavailable(context?.pressure?.unavailableReason)}`
    : null, { reason });
  terminalWrite('dw-observed-flow-quality', available ? value.researchQuality?.status : null, { reason });
  const quality = $('dw-observed-flow-quality');
  quality?.classList.toggle('is-quality', value.researchQuality?.status === 'QUALITY_INSUFFICIENT');
  terminalWrite('dw-observed-flow-source', available
    ? `${value.sourceState} · ${value.identity?.actualContract || 'CONTRACT_NOT_REPORTED'} · ${value.source?.tradeDate || 'DATE_NOT_REPORTED'} · ${timeLabel(value.source?.availableAt)}`
    : null, { reason });
  terminalWrite('dw-observed-flow-promotion', 'NOT PROMOTED', { reason: 'FORMAL_DIRECTION_NOT_PROMOTED' });
  renderObservedFlowDetail(value);
}

function observedFlowStateLabel(state) {
  return ({ LIVE: '即時', WARMING_UP: '暖機中', STALE: '資料過舊',
    UNAVAILABLE: '資料不可用', HISTORICAL: '歷史資料｜非目前盤勢' })[state] || '資料不可用';
}

const OBSERVED_FLOW_WINDOW_REGISTRY = Object.freeze([
  Object.freeze({ key: '1m', label: '1分', group: 'NEAR', source: 'primary60s', data: 'GOVERNED' }),
  Object.freeze({ key: '5m', label: '5分', group: 'NEAR', source: 'context300s', data: 'GOVERNED' }),
  Object.freeze({ key: '15m', label: '15分', group: 'NEAR', source: 'window900s', data: 'GOVERNED' }),
  Object.freeze({ key: '30m', label: '30分', group: 'MID', source: 'window1800s', data: 'GOVERNED' }),
  Object.freeze({ key: '1h', label: '1小時', group: 'MID', source: 'window3600s', data: 'GOVERNED' }),
  Object.freeze({ key: '4h', label: '4小時', group: 'FAR', source: 'window14400s', data: 'GOVERNED' }),
  Object.freeze({ key: 'tradingDay', label: '本交易日', group: 'FAR', source: null, data: 'PENDING_CRU44' }),
]);
const CHART_TO_FLOW_WINDOW = Object.freeze({
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1D': 'tradingDay',
});
const FLOW_TO_CHART_TIMEFRAME = Object.freeze(Object.fromEntries(
  Object.entries(CHART_TO_FLOW_WINDOW).map(([chart, flow]) => [flow, chart]),
));
let observedFlowSelectedWindow = '5m';
let lastObservedFlowValue = null;

function observedFlowRatio(pressure) {
  if (pressure?.pressureRatio === null || pressure?.pressureRatio === undefined) return null;
  const ratio = Number(pressure.pressureRatio);
  return Number.isFinite(ratio) && ratio >= -1 && ratio <= 1 ? ratio : null;
}

function observedFlowDisplayCells(ratio) {
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

function renderObservedFlowSegments(host, ratio, options = {}) {
  if (!host) return;
  const numeric = Number(ratio);
  const valid = ratio !== null && ratio !== undefined
    && Number.isFinite(numeric) && numeric >= -1 && numeric <= 1;
  const cells = observedFlowDisplayCells(ratio);
  const direction = cells === 0 ? 'neutral' : numeric > 0 ? 'positive' : 'negative';
  const nodes = [];
  for (let index = 0; index < 9; index += 1) {
    const cell = document.createElement('i');
    if (index === 4) cell.className = 'is-neutral-cell';
    const level = direction === 'positive' ? index - 4 : 4 - index;
    if (index !== 4 && level >= 1 && level <= cells
      && ((direction === 'positive' && index > 4) || (direction === 'negative' && index < 4))) {
      cell.className = `is-filled is-level-${level}`;
    }
    nodes.push(cell);
  }
  host.replaceChildren(...nodes);
  host.className = `${options.mini ? 'dw-flow-mini-bar' : 'dw-pressure-segments'} is-${direction}`;
  host.dataset.rawRatio = valid ? String(numeric) : '';
  host.dataset.displayCells = String(cells);
  host.classList.toggle('is-limited', Boolean(options.limited));
  host.classList.toggle('is-inactive', Boolean(options.inactive) || !valid);
}

function renderObservedFlowEnergy(host, value, options = {}) {
  if (!host) return;
  const numeric = Number(value);
  const available = value !== null && value !== undefined && Number.isFinite(numeric);
  const range = Math.max(Number(options.range) || 1, Number.EPSILON);
  const strength = available ? Math.min(1, Math.abs(numeric) / range) : 0;
  const tone = options.tone === 'neutral' ? 'neutral' : numeric > 0 ? 'positive' : numeric < 0 ? 'negative' : 'neutral';
  host.style.setProperty('--flow-energy', `${Math.round(strength * 100)}%`);
  host.className = `dw-flow-metric-energy is-${tone}`;
  host.classList.toggle('is-limited', Boolean(options.limited));
  host.classList.toggle('is-inactive', !available || Boolean(options.inactive));
}

function observedFlowWindowByKey(value, key) {
  const definition = OBSERVED_FLOW_WINDOW_REGISTRY.find((item) => item.key === key);
  return { definition, window: definition?.source ? value?.windows?.[definition.source] : null };
}

function observedFlowPressureSide(pressure, sourceState = 'LIVE') {
  if (['WARMING_UP', 'STALE', 'UNAVAILABLE'].includes(sourceState)) return '方向判定受限';
  if (pressure?.status !== 'READY' || pressure?.classifiedCoverage !== 1) return '方向判定受限';
  return ({ BUY_SIDE: '偏買方', SELL_SIDE: '偏賣方', BALANCED: '均衡' })[pressure.direction]
    || '方向判定受限';
}

function observedFlowRelation(response, sourceState = 'LIVE') {
  const label = ({ SAME_DIRECTION: '同方向反應', OPPOSITE_DIRECTION: '反方向反應',
    FLAT_PRICE: '價格持平', PRESSURE_UNAVAILABLE: '成交力道不可判定' })[response?.directionRelation]
    || '成交力道不可判定';
  return sourceState !== 'LIVE' && label !== '成交力道不可判定'
    ? `快照：${label}（非目前盤勢）` : label;
}

function observedFlowSelectedSummary(value, definition, window, available, reason) {
  if (definition.data !== 'GOVERNED') {
    const state = definition.key === 'tradingDay' ? '待定義' : '待驗證';
    return `成交壓力${state}；價格反應${state}；路徑效率${state}；可判定成交占比與 Data Trust ${state}。`;
  }
  if (window?.truthState === 'WARMING_UP') {
    return `成交壓力暖機中；價格反應暖機中；路徑效率暖機中；完整 ${definition.label} 歷史尚未累積完成。`;
  }
  if (!available || window?.truthState === 'UNAVAILABLE' || window?.status === 'UNAVAILABLE') {
    const unavailable = dwHumanize(window?.unavailableReason || reason);
    return `成交壓力不可用；價格反應不可用；路徑效率不可用；可判定成交占比與 Data Trust 不可用（${unavailable}）。`;
  }
  const pressure = window?.pressure || {};
  const ratio = observedFlowRatio(pressure);
  const side = observedFlowPressureSide(pressure, value.sourceState);
  const pressureText = ratio == null
    ? '成交壓力不可判定'
    : `成交壓力 ${observedFlowMetric(ratio, { signedValue: true, digits: 3 })}（${side}）`;
  const displacement = window?.response?.displacementPoints;
  const responseText = displacement !== null && displacement !== undefined && Number.isFinite(Number(displacement))
    ? `價格反應 ${observedFlowMetric(displacement, { signedValue: true, suffix: ' 點', digits: 0 })}（${observedFlowRelation(window?.response, value.sourceState)}）`
    : '價格反應不可用';
  const path = window?.pathEfficiency?.value;
  const pathText = path !== null && path !== undefined && Number.isFinite(Number(path))
    ? `路徑效率 ${observedFlowMetric(path, { digits: 3 })}`
    : `路徑效率不可用（${dwHumanize(window?.pathEfficiency?.unavailableReason || 'PATH_EFFICIENCY_UNAVAILABLE')}）`;
  const coverage = observedFlowCoverage(pressure.classifiedCoverage)
    || `不可用（${dwHumanize(pressure.unavailableReason || 'CLASSIFIED_COVERAGE_UNAVAILABLE')}）`;
  return `${pressureText} → ${responseText} → ${pathText} → 可判定成交占比 ${coverage} / Data Trust ${observedFlowStateLabel(value.sourceState)}。`;
}

function renderObservedFlowPressure(window, suffix, available, reason, sourceState = 'LIVE') {
  const pressure = window?.pressure || {};
  const ratio = observedFlowRatio(pressure);
  const legal = available && ratio != null;
  terminalWrite(`dw-observed-flow-pressure-${suffix}`, legal
    ? observedFlowMetric(ratio, { signedValue: true, digits: 3 }) : null,
  { reason: legal ? (pressure.unavailableReason || 'FIELD_UNAVAILABLE') : reason });
  dwText(`dw-observed-flow-pressure-side-${suffix}`, legal ? observedFlowPressureSide(pressure, sourceState) : '不可判定');
  dwText(`dw-observed-flow-relation-${suffix}`, available ? observedFlowRelation(window?.response, sourceState) : '不可判定');
}

function renderObservedFlowStrip(value, available) {
  for (const definition of OBSERVED_FLOW_WINDOW_REGISTRY) {
    const button = document.querySelector(`[data-flow-window="${definition.key}"]`);
    if (!button) continue;
    const selected = definition.key === observedFlowSelectedWindow;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && button.id) $('dw-flow-selected-detail')?.setAttribute('aria-labelledby', button.id);
    button.dataset.truthState = value?.sourceState || 'UNAVAILABLE';
    const note = button.querySelector('small');
    const bar = button.querySelector('.dw-flow-mini-bar');
    if (definition.data !== 'GOVERNED') {
      note.textContent = definition.key === 'tradingDay' ? '待定義' : '待驗證';
      renderObservedFlowSegments(bar, null, { mini: true, inactive: true });
      continue;
    }
    const window = value?.windows?.[definition.source];
    const windowAvailable = available && ['LIVE', 'STALE', null, undefined].includes(window?.truthState);
    const ratio = windowAvailable ? observedFlowRatio(window?.pressure) : null;
    const coverage = window?.pressure?.classifiedCoverage;
    const limited = coverage !== 1 || window?.pressure?.status !== 'READY';
    note.textContent = window?.truthState === 'WARMING_UP' ? '暖機中'
      : ratio == null ? '不可判定' : observedFlowMetric(ratio, { signedValue: true, digits: 2 });
    renderObservedFlowSegments(bar, ratio, {
      mini: true, limited, inactive: value?.sourceState !== 'LIVE',
    });
  }
}

function renderObservedFlowSummary(value, available) {
  const primaryRatio = available ? observedFlowRatio(value?.windows?.primary60s?.pressure) : null;
  const contextRatio = available ? observedFlowRatio(value?.windows?.context300s?.pressure) : null;
  let relation = 'raw 比值不可比較';
  if (primaryRatio != null && contextRatio != null) {
    if (primaryRatio === 0 || contextRatio === 0) relation = 'raw 比值含 0';
    else relation = Math.sign(primaryRatio) === Math.sign(contextRatio) ? 'raw 比值同側' : 'raw 比值方向不同';
  }
  const fifteen = value?.windows?.window900s;
  const thirty = value?.windows?.window1800s;
  const oneHour = value?.windows?.window3600s;
  const fourHour = value?.windows?.window14400s;
  const fifteenGoverned = fifteen?.status !== 'UNAVAILABLE' || fifteen?.truthState === 'WARMING_UP';
  const thirtyGoverned = thirty?.status !== 'UNAVAILABLE' || thirty?.truthState === 'WARMING_UP';
  const oneHourGoverned = oneHour?.status !== 'UNAVAILABLE' || oneHour?.truthState === 'WARMING_UP';
  const fourHourGoverned = fourHour?.status !== 'UNAVAILABLE' || fourHour?.truthState === 'WARMING_UP';
  const windowState = (window, label, governed) => window?.truthState === 'WARMING_UP' ? `${label}暖機中`
    : governed ? `${label}已治理` : `${label}不可用`;
  const fifteenState = fifteen?.truthState === 'WARMING_UP' ? '15分暖機中'
    : fifteenGoverned ? '15分已治理' : '15分不可用';
  const thirtyState = thirty?.truthState === 'WARMING_UP' ? '30分暖機中'
    : thirtyGoverned ? '30分已治理' : '30分不可用';
  dwText('dw-flow-summary-near', available ? `已治理 ${fifteenGoverned ? '3/3' : '2/3'} · ${relation}` : '資料不可用');
  dwText('dw-flow-summary-near-note', `1分、5分已驗證；${fifteenState}`);
  dwText('dw-flow-summary-mid', `${thirtyState}；${windowState(oneHour, '1小時', oneHourGoverned)}`);
  dwText('dw-flow-summary-far', `${windowState(fourHour, '4小時', fourHourGoverned)}；本交易日待定義`);
}

function renderObservedFlowSelected(value, available, reason) {
  const { definition, window } = observedFlowWindowByKey(value, observedFlowSelectedWindow);
  const panel = $('dw-flow-selected-detail');
  if (!panel || !definition) return;
  dwText('dw-flow-selected-title', definition.label);
  const pending = definition.data !== 'GOVERNED';
  panel.classList.toggle('is-pending', pending);
  $('dw-flow-selected-pending')?.classList.toggle('hidden', !pending);
  dwText('dw-flow-selected-summary', observedFlowSelectedSummary(value, definition, window, available, reason));
  if (pending) {
    const pendingReason = definition.key === 'tradingDay' ? '語意尚待定義' : '尚待治理驗證';
    dwText('dw-flow-selected-reason', `待驗證｜${pendingReason}`);
    dwText('dw-flow-selected-reason-code', definition.key === 'tradingDay' ? 'TRADING_DAY_SEMANTICS_PENDING' : 'WINDOW_NOT_PROMOTED');
    renderObservedFlowSegments($('dw-flow-selected-bar'), null, { inactive: true });
    renderObservedFlowEnergy($('dw-flow-response-energy'), null, { inactive: true });
    renderObservedFlowEnergy($('dw-flow-path-energy'), null, { inactive: true });
    renderObservedFlowEnergy($('dw-flow-coverage-energy'), null, { inactive: true });
    return;
  }
  const windowAvailable = available && window?.truthState !== 'WARMING_UP'
    && window?.truthState !== 'UNAVAILABLE' && window?.status !== 'UNAVAILABLE';
  const pressure = window?.pressure || {};
  const ratio = windowAvailable ? observedFlowRatio(pressure) : null;
  const coverage = pressure.classifiedCoverage;
  const limited = coverage !== 1 || pressure.status !== 'READY' || value.sourceState !== 'LIVE';
  renderObservedFlowSegments($('dw-flow-selected-bar'), ratio, {
    limited, inactive: value.sourceState !== 'LIVE',
  });
  dwText('dw-flow-selected-ratio', ratio == null ? '不可判定' : observedFlowMetric(ratio, { signedValue: true, digits: 3 }));
  dwText('dw-flow-selected-side', ratio == null ? '成交力道不可判定' : observedFlowPressureSide(pressure, value.sourceState));
  const rawResponsePoints = window?.response?.displacementPoints;
  const responsePoints = Number(rawResponsePoints);
  const responseReady = windowAvailable && rawResponsePoints !== null && rawResponsePoints !== undefined
    && Number.isFinite(responsePoints);
  dwText('dw-flow-selected-response', responseReady
    ? observedFlowMetric(responsePoints, { signedValue: true, suffix: ' 點', digits: 0 }) : '不可用');
  dwText('dw-flow-selected-relation', windowAvailable ? observedFlowRelation(window?.response, value.sourceState) : '成交力道不可判定');
  renderObservedFlowEnergy($('dw-flow-response-energy'), responseReady ? responsePoints : null, {
    range: 50, limited, inactive: value.sourceState !== 'LIVE',
  });
  const rawPathValue = window?.pathEfficiency?.value;
  const pathValue = Number(rawPathValue);
  const pathReady = windowAvailable && rawPathValue !== null && rawPathValue !== undefined
    && Number.isFinite(pathValue);
  dwText('dw-flow-selected-path', pathReady ? observedFlowMetric(pathValue, { digits: 3 }) : '不可用');
  renderObservedFlowEnergy($('dw-flow-path-energy'), pathReady ? pathValue : null, {
    range: 1, tone: 'neutral', limited, inactive: value.sourceState !== 'LIVE',
  });
  dwText('dw-flow-selected-coverage', windowAvailable
    ? (observedFlowCoverage(coverage) || `不可用 · ${dwHumanize(pressure.unavailableReason || 'CLASSIFIED_COVERAGE_UNAVAILABLE')}`)
    : `不可用 · ${dwHumanize(reason)}`);
  renderObservedFlowEnergy($('dw-flow-coverage-energy'), windowAvailable ? coverage : null, {
    range: 1, tone: 'neutral', limited, inactive: value.sourceState !== 'LIVE',
  });
  const selectedReasonCode = !windowAvailable
    ? (window?.unavailableReason || reason)
    : ratio == null
      ? (pressure.unavailableReason || 'PRESSURE_UNAVAILABLE')
      : !responseReady
        ? (window?.response?.unavailableReason || 'RESPONSE_DISPLACEMENT_UNAVAILABLE')
        : !pathReady
          ? (window?.pathEfficiency?.unavailableReason || 'PATH_EFFICIENCY_UNAVAILABLE')
          : null;
  // Freshness and classification are separate limits. Never invent incomplete
  // coverage merely because an otherwise complete snapshot is no longer live.
  const limitationCode = value.sourceState !== 'LIVE' ? (value.sourceState || 'UNAVAILABLE')
    : coverage !== 1 ? 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE'
      : pressure.status !== 'READY' ? (pressure.unavailableReason || 'PRESSURE_UNAVAILABLE') : null;
  const limitationLabel = ({ STALE: '資料過舊，僅供快照參考',
    HISTORICAL: '歷史資料，非目前盤勢', WARMING_UP: '資料暖機中',
    PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE: '分類覆蓋尚未完整',
  })[limitationCode] || dwHumanize(limitationCode);
  dwText('dw-flow-selected-reason', selectedReasonCode
    ? `不可用｜${dwHumanize(selectedReasonCode)}`
    : limitationCode ? `有限制｜${limitationLabel}` : '資料可用');
  dwText('dw-flow-selected-reason-code', selectedReasonCode || limitationCode || 'READY');
  dwText('dw-flow-selected-lineage', value?.lineage?.cutoffLedgerOrdinal != null
    ? `ordinal ${value.lineage.cutoffLedgerOrdinal}` : '請由完整證據查看');
  const qualityLabel = ({ READY: '正常', PARTIAL: '有限制', QUALITY_INSUFFICIENT: '有限制', UNAVAILABLE: '不可用' })[window?.status || value.researchQuality?.status] || '不可用';
  dwText('dw-flow-selected-quality', window?.truthState === 'WARMING_UP' ? '暖機中'
    : windowAvailable ? qualityLabel : `不可用 · ${dwHumanize(window?.unavailableReason || reason)}`);
  dwText('dw-flow-selected-updated', windowAvailable ? timeLabel(value.source?.availableAt) : '不可用');
}

function updateTerminalSummaryDisclosure() {
  const line = document.querySelector('.tt-summary-line');
  const label = $('tt-summary-exception');
  if (!line || !label) return;
  const exceptions = [...line.querySelectorAll('.tt-summary-metrics strong')].filter((node) =>
    /^(UNAVAILABLE|STALE|DEGRADED|QUALITY_INSUFFICIENT|BLOCKED)/.test(node.textContent.trim()));
  line.classList.toggle('has-exception', exceptions.length > 0);
  label.textContent = exceptions.length ? `${exceptions.length} 項需注意` : '正常項目已收合';
}

function renderObservedFlow(flow) {
  const value = flow || { sourceState: 'UNAVAILABLE', unavailableReason: 'ARTIFACT_MISSING', windows: null };
  const available = ['LIVE', 'WARMING_UP', 'STALE', 'HISTORICAL'].includes(value.sourceState) && value.windows;
  const reason = value.unavailableReason || 'OBSERVED_FLOW_UNAVAILABLE';
  const state = $('dw-observed-flow-state');
  if (state) {
    state.textContent = available ? observedFlowStateLabel(value.sourceState) : `資料不可用 · UNAVAILABLE · ${reason}`;
    state.className = `dw-status-pill is-${available ? value.sourceState.toLowerCase() : 'unavailable'}`;
  }
  const primary = value.windows?.primary60s;
  const context = value.windows?.context300s;
  lastObservedFlowValue = value;
  const truth = $('dw-observed-flow-truth');
  if (truth) {
    const title = truth.querySelector('strong');
    const note = truth.querySelector('span');
    const tradeDate = value.identity?.tradeDate || value.source?.tradeDate || 'DATE_NOT_REPORTED';
    const contract = value.identity?.actualContract || 'CONTRACT_NOT_REPORTED';
    const session = value.identity?.session || 'SESSION_NOT_REPORTED';
    if (available) {
      title.textContent = `${observedFlowStateLabel(value.sourceState)} · ${value.sourceState} · ${tradeDate}`;
      const updated = timeLabel(value.source?.availableAt);
      note.textContent = value.sourceState === 'HISTORICAL'
        ? `${contract} · ${session} · 非目前盤勢`
        : value.sourceState === 'STALE'
          ? `${contract} · ${session} · 最後合法更新 ${updated}`
          : `${contract} · ${session} · 更新 ${updated}`;
      truth.className = `dw-observed-flow-truth is-${value.sourceState.toLowerCase()}`;
    } else {
      title.textContent = '資料不可用 · UNAVAILABLE';
      note.textContent = ` · 原因 · ${dwHumanize(reason)}`;
      truth.className = 'dw-observed-flow-truth is-unavailable';
    }
  }
  for (const [id, metric, metricReason] of [
    ['dw-observed-flow-response-60', observedFlowMetric(primary?.response?.displacementPoints, { signedValue: true, suffix: ' 點', digits: 0 }), 'RESPONSE_DISPLACEMENT_UNAVAILABLE'],
    ['dw-observed-flow-path-60', observedFlowMetric(primary?.pathEfficiency?.value, { digits: 3 }), primary?.pathEfficiency?.unavailableReason],
    ['dw-observed-flow-response-300', observedFlowMetric(context?.response?.displacementPoints, { signedValue: true, suffix: ' 點', digits: 0 }), 'RESPONSE_DISPLACEMENT_UNAVAILABLE'],
    ['dw-observed-flow-path-300', observedFlowMetric(context?.pathEfficiency?.value, { digits: 3 }), context?.pathEfficiency?.unavailableReason],
  ]) terminalWrite(id, available ? metric : null, { reason: available ? (metricReason || 'FIELD_UNAVAILABLE') : reason });
  renderObservedFlowPressure(primary, '60', available, reason, value.sourceState);
  renderObservedFlowPressure(context, '300', available, reason, value.sourceState);
  renderObservedFlowStrip(value, available);
  renderObservedFlowSummary(value, available);
  renderObservedFlowSelected(value, available, reason);
  terminalWrite('dw-observed-flow-coverage', available
    ? `1分 ${observedFlowCoverage(primary?.pressure?.classifiedCoverage) || terminalUnavailable(primary?.pressure?.unavailableReason)} · 5分 ${observedFlowCoverage(context?.pressure?.classifiedCoverage) || terminalUnavailable(context?.pressure?.unavailableReason)}`
    : null, { reason });
  const qualityLabel = ({ READY: '正常', PARTIAL: '有限制', QUALITY_INSUFFICIENT: '有限制', UNAVAILABLE: '不可用' })[value.researchQuality?.status];
  terminalWrite('dw-observed-flow-quality', available ? qualityLabel : null, { reason });
  $('dw-observed-flow-quality')?.classList.toggle('is-quality', value.researchQuality?.status === 'QUALITY_INSUFFICIENT');
  terminalWrite('dw-observed-flow-source', available
    ? `${observedFlowStateLabel(value.sourceState)} · ${value.identity?.actualContract || 'CONTRACT_NOT_REPORTED'} · ${value.source?.tradeDate || 'DATE_NOT_REPORTED'} · ${timeLabel(value.source?.availableAt)}`
    : null, { reason });
  terminalWrite('dw-observed-flow-promotion', '尚未通過正式方向驗證', { reason: 'FORMAL_DIRECTION_NOT_PROMOTED' });
  renderObservedFlowDetail(value);
  window.TraderTerminalShell?.refreshDrawer(traderTerminalRoot, '[data-terminal-card="observed-flow"]');
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
}

function terminalSetTrust(cardKey, evidence) {
  const availability = evidence?.availabilityState || 'UNAVAILABLE';
  const quality = evidence?.qualityState || 'UNKNOWN';
  const promotion = evidence?.promotionState || 'NOT_PROMOTED';
  const target = $(`tt-${cardKey}-trust`);
  if (target) {
    target.textContent = availability === 'UNAVAILABLE'
      ? terminalUnavailable(evidence?.reason || `${cardKey.toUpperCase()}_FAMILY_UNAVAILABLE`)
      : `${cardKey === 'global' ? 'FAMILY ' : ''}${availability} · ${quality}`;
    target.className = `dw-status-pill ${healthTone(availability === 'AVAILABLE' ? quality : availability)}`;
    target.title = `${cardKey === 'global' ? 'cardLayer=GLOBAL_FX_FAMILY; ' : ''}promotionState=${promotion}`;
  }
  return { availability, quality, promotion };
}

function terminalEvidenceValues(contract, family, limit = 3) {
  const evidence = dw4FamilyEvidence(contract, family);
  const values = Array.isArray(evidence?.detail?.descriptiveValues) ? evidence.detail.descriptiveValues.slice(0, limit) : [];
  return { evidence, values };
}

function terminalUnavailable(reason = 'SOURCE_UNAVAILABLE') {
  return `UNAVAILABLE · ${reason || 'SOURCE_UNAVAILABLE'}`;
}

function terminalHealthItem(workspace, sourceId) {
  return (workspace?.snapshot?.dataHealth?.items || []).find((item) => item.sourceId === sourceId) || null;
}

function terminalHealthUsable(item) {
  return Boolean(item && item.sourceAvailability !== 'SOURCE_MISSING' && item.freshnessState !== 'UNAVAILABLE');
}

function terminalEodHealthUsable(item) {
  return terminalHealthUsable(item) && item.readinessState === 'READY' && item.quality === 'PASS';
}

function terminalTxLiveContractMonth(actualContract, tradeDate) {
  const normalized = String(actualContract || '').trim().toUpperCase();
  if (/^\d{6}$/.test(normalized)) return normalized;
  const match = normalized.match(/^TXF([A-L])(\d)$/);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(String(tradeDate || ''))) return null;
  const tradeYear = Number(String(tradeDate).slice(0, 4));
  let year = Math.floor(tradeYear / 10) * 10 + Number(match[2]);
  if (year < tradeYear - 5) year += 10;
  if (year > tradeYear + 5) year -= 10;
  return `${year}${String(match[1].charCodeAt(0) - 64).padStart(2, '0')}`;
}

function terminalSourceMode(item, baseMode = null) {
  const freshness = item?.freshnessState;
  return [baseMode, freshness && !['FRESH', 'SESSION_CLOSED'].includes(freshness) ? freshness : null].filter(Boolean).join(' · ');
}

function terminalSourceContext(item, { tradeDate = null, contract = null, sourceId = null } = {}) {
  return [sourceId || item?.sourceId, tradeDate, contract, item?.freshnessState, item?.availableAt].filter(Boolean).join(' · ');
}

function terminalWrite(id, value, { reason = 'SOURCE_UNAVAILABLE', title = null } = {}) {
  const node = $(id);
  if (!node) return;
  const available = value != null && value !== '' && value !== '—' && value !== 'UNAVAILABLE';
  const homeMetric = $('decision-workspace')?.dataset?.homeVersion === '1' && ['tt-top-price', 'tt-top-volume', 'tt-top-change', 'dw-rvol-state', 'dw-vwap-state', 'dw-session-levels'].includes(id);
  node.textContent = available ? String(value) : homeMetric ? '—' : terminalUnavailable(reason);
  node.classList.toggle('is-unavailable', !available);
  const context = title || (available ? String(value) : reason);
  node.title = context;
  node.setAttribute('aria-label', context);
}

function terminalHealthSummary(workspace, sourceIds) {
  const rank = { UNAVAILABLE: 6, STALE: 5, DELAYED: 4, SESSION_CLOSED: 3, FRESH: 2, LIVE: 1 };
  const resolved = sourceIds.map((sourceId) => ({ sourceId, item: terminalHealthItem(workspace, sourceId) }));
  const missing = resolved.filter(({ item }) => !item).map(({ sourceId }) => sourceId);
  const items = resolved.map(({ item }) => item).filter(Boolean);
  if (missing.length) {
    const present = items.map((item) => terminalSourceContext(item)).join(' | ');
    return { value: null, reason: 'SOURCE_NOT_REPORTED', title: [`missing=${missing.join(',')}`, present].filter(Boolean).join(' | ') };
  }
  const worst = [...items].sort((left, right) => (rank[right.freshnessState] || 7) - (rank[left.freshnessState] || 7))[0];
  const title = items.map((item) => terminalSourceContext(item)).join(' | ');
  if (!terminalHealthUsable(worst)) {
    return { value: null, reason: worst.reason || worst.readinessState || worst.freshnessState || 'SOURCE_UNAVAILABLE', title };
  }
  return { value: worst.freshnessState, reason: null, title };
}

function terminalBreadthCounts(data) {
  const direct = {
    up: finiteNumber(data?.raise_count ?? data?.raiseCount),
    flat: finiteNumber(data?.flat_count ?? data?.flatCount),
    down: finiteNumber(data?.fall_count ?? data?.fallCount),
  };
  if (Object.values(direct).every((value) => value != null)) return direct;
  const listed = data?.listed || {};
  const otc = data?.otc || {};
  const rows = [listed, otc].map((row) => ({
    up: finiteNumber(row.advance), flat: finiteNumber(row.unchanged), down: finiteNumber(row.decline),
  }));
  if (!rows.every((row) => Object.values(row).every((value) => value != null))) return null;
  return rows.reduce((total, row) => ({ up: total.up + row.up, flat: total.flat + row.flat, down: total.down + row.down }), { up: 0, flat: 0, down: 0 });
}

function renderTerminalEvidenceCard(cardKey, contract, family, emptyInterpretation) {
  const { evidence, values } = terminalEvidenceValues(contract, family);
  const trust = terminalSetTrust(cardKey, evidence);
  const unavailable = terminalUnavailable(evidence?.reason || `${family}_UNAVAILABLE`);
  const main = values.length ? `${values[0].label} ${dw4DescriptiveValue(values[0])}` : unavailable;
  dwText(`tt-${cardKey}-main`, main);
  const visual = $(`tt-${cardKey}-values`);
  if (visual) {
    if (cardKey === 'global') {
      visual.replaceChildren();
    } else {
      const rows = values.slice(1).map((entry) => {
        const row = document.createElement('span');
        row.textContent = `${entry.label} ${dw4DescriptiveValue(entry)} · ${sourceModeLabel(entry.sourceMode)}`;
        return row;
      });
      visual.replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement('span'), { textContent: unavailable })]));
    }
  }
  const sourceLabel = evidence?.detail?.displaySourceLabel;
  dwText(`tt-${cardKey}-interpretation`, sourceLabel
    ? `${sourceLabel} · descriptive evidence only`
    : emptyInterpretation);
}

function renderGlobalTiles(evidence) {
  const values = Array.isArray(evidence?.detail?.descriptiveValues) ? evidence.detail.descriptiveValues.slice(0, 6) : [];
  for (let index = 1; index <= 6; index += 1) {
    const entry = values[index - 1] || null;
    const available = Boolean(entry && entry.value != null && entry.value !== '' && entry.value !== 'UNAVAILABLE');
    const tile = $(`tt-global-name-${index}`)?.closest('.tt-global-tile');
    if (tile) tile.hidden = !entry;
    dwText(`tt-global-name-${index}`, entry?.label || `來源 ${index}`);
    const unavailableReason = entry?.reason || evidence?.reason || 'GLOBAL_VALUE_UNAVAILABLE';
    terminalWrite(`tt-global-price-${index}`, available ? dw4DescriptiveValue(entry) : null, { reason: unavailableReason });
    terminalWrite(`tt-global-change-${index}`, available ? 'AVAILABLE' : null, { reason: unavailableReason });
    const kind = tile?.querySelector('.tt-global-data-kind');
    if (kind) kind.textContent = entry?.sourceMode ? sourceModeLabel(entry.sourceMode) : 'SOURCE UNAVAILABLE';
    tile?.classList.remove('is-positive', 'is-negative');
    const numeric = finiteNumber(entry?.value);
    const directionalContext = entry?.unit === '%' || /變化|Proxy/u.test(entry?.label || '');
    if (available && directionalContext && numeric != null) {
      tile?.classList.toggle('is-positive', numeric > 0);
      tile?.classList.toggle('is-negative', numeric < 0);
    }
    tile?.setAttribute('aria-label', `${entry?.label || `來源 ${index}`}：${available ? dw4DescriptiveValue(entry) : terminalUnavailable(unavailableReason)}；${entry?.sourceMode ? sourceModeLabel(entry.sourceMode) : '來源目前無法取得'}`);
    $(`tt-global-series-${index}`)?.classList.add('is-unavailable');
  }
}

function renderHomeWorkspace() {
  if (!globalThis.HomeWorkspace || !$('decision-workspace')?.dataset?.homeVersion) return null;
  const watch = state.levelWatch, chart = state.txChartPayload;
  const matches = Boolean(watch && chart && levelWatchIsFresh(watch) && levelWatchMatchesChart(watch, chart));
  return globalThis.HomeWorkspace.render($('decision-workspace'), {
    chart, watch, flow: lastObservedFlowValue, marketOperating: state.decisionWorkspace?.marketOperating,
    flowDefinitions: OBSERVED_FLOW_WINDOW_REGISTRY, selectedFlowWindow: observedFlowSelectedWindow,
    pulse: state.marketPulse, leadership: state.indexLeadership,
    dashboardError: state.homeDashboardError || null, chartError: state.homeChartError || null,
    requestedTimeframe: state.txChartTimeframe, chartLoading: state.txChartLoading,
    focusAllowed: matches && watch?.state === 'READY' && Boolean(watch?.nextWatch),
    rendered: state.txChartBarCount > 0,
  });
}

function renderTrendStrength(chart) {
  if (!$('tt-trend-main')) return;
  const trend = chart?.trendStrength;
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const sourceMs = Date.parse(chart?.availableAt || '');
  const now = Date.now();
  const identityMatches = ['actualContract', 'tradeDate', 'session', 'sessionId'].every(key =>
    typeof chart?.[key] === 'string' && chart[key].length > 0 && trend?.identity?.[key] === chart[key]);
  let blocked = !trend ? 'TREND_SOURCE_UNAVAILABLE'
    : trend.schemaVersion !== 'trend-strength-adx14-v1' || trend.indicator !== 'ADX' || trend.period !== 14
      || !identityMatches || trend.timeframe !== chart.timeframe || trend.mode !== chart.mode
      || trend.asOf !== chart.asOf || trend.sourceAvailableAt !== chart.availableAt ? 'TREND_IDENTITY_MISMATCH'
      : !['LIVE', 'REPLAY'].includes(chart.mode) ? 'TREND_MODE_UNAVAILABLE'
        : chart.timeframe !== state.txChartTimeframe ? 'CHART_TIMEFRAME_PENDING'
          : state.homeChartError ? 'CHART_REFRESH_FAILED'
            : !['READY', 'FORMING', 'QUALITY_INSUFFICIENT'].includes(chart.status) ? 'CHART_UNAVAILABLE'
              : chart.mode === 'LIVE' && state.decisionWorkspace?.marketOperating?.marketShouldBeActive === false ? 'MARKET_NOT_ACTIVE'
                : chart.mode === 'LIVE' && (!Number.isFinite(sourceMs) || sourceMs > now + 5000) ? 'SOURCE_TIME_UNVERIFIED'
                  : chart.mode === 'LIVE' && now - sourceMs > 120000 ? 'SOURCE_STALE' : null;
  const value = numeric(trend?.value), plus = numeric(trend?.plusDI), minus = numeric(trend?.minusDI);
  const hasValue = value != null && value >= 0 && value <= 100 && plus != null && plus >= 0 && plus <= 100
    && minus != null && minus >= 0 && minus <= 100;
  const measurable = ['READY', 'QUALITY_INSUFFICIENT'].includes(trend?.state);
  const count = Number.isSafeInteger(trend?.closedBarCount) && trend.closedBarCount >= 0 ? trend.closedBarCount : null;
  const closedMs = Date.parse(trend?.lastClosedBarAt || ''), cutoffMs = Date.parse(chart?.asOf || '');
  const lastEventMs = Date.parse(chart?.lastEventTime || '');
  if (!blocked && measurable && (!(count >= 28) || !Number.isFinite(closedMs) || !Number.isFinite(cutoffMs)
    || !Number.isFinite(lastEventMs) || closedMs > cutoffMs || closedMs > lastEventMs || closedMs > sourceMs)) blocked = 'TREND_CLOSED_BARS_UNVERIFIED';
  if (!blocked && measurable && !hasValue) blocked = 'TREND_VALUE_INVALID';
  const visible = !blocked && measurable && hasValue;
  const labels = { READY: '已收K線觀察', QUALITY_INSUFFICIENT: '資料受限', WARMING_UP: '樣本累積中', UNAVAILABLE: '暫不可用' };
  const blockLabels = { TREND_SOURCE_UNAVAILABLE: '尚未取得指標', TREND_IDENTITY_MISMATCH: '資料身分不符',
    TREND_MODE_UNAVAILABLE: '模式未確認', CHART_TIMEFRAME_PENDING: '週期切換中', CHART_REFRESH_FAILED: '更新中斷',
    CHART_UNAVAILABLE: '圖表暫不可用', MARKET_NOT_ACTIVE: '非交易時段', SOURCE_TIME_UNVERIFIED: '資料時間未確認',
    SOURCE_STALE: '資料已過期', TREND_VALUE_INVALID: '指標數值未確認', TREND_CLOSED_BARS_UNVERIFIED: '收盤樣本未確認' };
  const capacityLimited = Array.isArray(trend?.reasonCodes) && trend.reasonCodes.includes('SESSION_CAPACITY_BELOW_REQUIRED_BARS');
  const label = blocked ? blockLabels[blocked] : capacityLimited ? '此週期單盤樣本不足' : labels[trend?.state] || '暫不可用';
  const modeLabel = chart?.mode === 'REPLAY' ? '歷史回放 · ' : '';
  dwText('tt-trend-main', visible ? `ADX(14) ${fmt(value, 2)}` : label);
  dwText('tt-summary-strength', visible ? `${modeLabel}${chart.timeframe} ADX ${fmt(value, 2)} · ${label}` : label);
  dwText('tt-trend-strength', visible ? fmt(value, 2) : '—');
  dwText('tt-trend-direction', visible ? `＋DI ${fmt(plus, 2)} / −DI ${fmt(minus, 2)}` : '—');
  const delta = numeric(trend?.deltaADX);
  dwText('tt-trend-change', visible && delta != null ? signed(delta, ' ADX', 2) : visible ? '再等一根已收K線' : '—');
  dwText('tt-trend-sample', `${modeLabel}${chart?.timeframe || '週期未取得'} · 連續已收K線 ${count == null ? '未知' : count} 根 · 首值至少 28 根；${capacityLimited ? '本週期現有單盤資料無法累積足夠樣本，可切換 1m／5m 查看；不跨盤拼接。' : '不是穩定性或研究通過證明。'}`);
  dwText('tt-trend-source', `合約 ${chart?.actualContract || '未知'} · ${chart?.tradeDate || '日期未知'} · ${chart?.session || '盤別未知'} · 計算起點 ${trend?.firstUsedBarAt ? timeLabel(trend.firstUsedBarAt) : '未取得'} · 最後已收K線 ${trend?.lastClosedBarAt ? timeLabel(trend.lastClosedBarAt) : '未取得'} · 來源 ${Number.isFinite(sourceMs) ? timeLabel(chart.availableAt) : '未取得'}`);
  const resetReasons = Array.isArray(trend?.limitations) ? trend.limitations.filter(code => typeof code === 'string' && code.startsWith('RESET_AFTER_')) : [];
  const reasons = [...new Set([blocked, ...(Array.isArray(trend?.reasonCodes) ? trend.reasonCodes : []), ...resetReasons].filter(Boolean))];
  dwText('tt-trend-reasons', `狀態：${label} · ${reasons.length ? reasons.join(' · ') : '無計算阻擋'}；只對已收到的 K 線描述，不保證完整行情。`);
  const trust = $('tt-trend-trust');
  if (trust) {
    trust.textContent = modeLabel + label;
    trust.className = `dw-status-pill ${visible && trend.state === 'READY' ? 'is-ready' : 'is-unavailable'}`;
  }
}

function renderTxChartFreshness(chart, fallbackQuality = state.decisionWorkspace?.globalStatus?.dataHealth) {
  const sourceTime = Date.parse(chart?.availableAt || '');
  const sourceTimeKnown = Number.isFinite(sourceTime);
  const now = Date.now();
  const warning = chart?.mode !== 'LIVE' ? null
    : !sourceTimeKnown || sourceTime > now + 5_000 ? '資料時間不可驗證'
      : now - sourceTime > 120_000 ? '資料過期' : null;
  const sourceLabel = sourceTimeKnown ? `來源 ${timeLabel(chart.availableAt)}` : '來源時間不明';
  const quality = chart?.qualityStatus || fallbackQuality || null;
  terminalWrite('tt-top-updated', sourceTimeKnown ? sourceLabel : null, { reason: 'AVAILABLE_AT_NOT_REPORTED' });
  terminalWrite('tt-top-trust', warning ? `${warning} · 品質 ${quality || '未提供'}` : quality, { reason: 'QUALITY_STATUS_UNAVAILABLE' });
  const topTrust = $('tt-top-trust');
  if (topTrust) topTrust.className = `dw-status-pill ${warning ? 'is-unavailable' : healthTone(quality || 'UNAVAILABLE')}`;
  const mode = `${chart?.mode || terminalUnavailable('MODE_NOT_REPORTED')} · ${chart?.timeframe || state.txChartTimeframe} · READ ONLY`;
  dwText('dw-chart-mode', warning ? `${warning} · ${sourceLabel} · ${mode}` : mode);
  const differentPeriod = chart?.timeframe && chart.timeframe !== state.txChartTimeframe;
  const requestWarning = differentPeriod
    ? `${state.txChartTimeframe} ${state.txChartLoading ? '載入中' : '尚未更新'} · 仍顯示 ${chart.timeframe} 快照`
    : state.homeChartError ? '圖表更新失敗 · 保留上次快照' : null;
  $('dw-chart-canvas')?.setAttribute('aria-busy', String(state.txChartLoading));
  if (requestWarning) {
    dwText('dw-chart-mode', `${requestWarning} · ${warning ? warning + ' · ' : ''}${sourceLabel} · ${mode}`);
    dwText('dw-chart-status', `${state.homeChartError === 'CHART_REQUEST_TIMEOUT' ? '圖表請求逾時 · ' : ''}${requestWarning}`);
    if ($('dw-chart-status')) $('dw-chart-status').className = 'dw-status-pill is-unavailable';
  }
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
  renderTrendStrength(chart);
}

function renderTerminalShell(workspace, chart = state.txChartPayload) {
  if (!$('tt-summary-price')) return;
  const contract = workspace?.evidenceConflict;
  const decision = workspace?.decisionSummary || {};
  const currentFacts = workspace?.currentMarketFactSummary || {};
  const global = workspace?.globalStatus || {};
  const snapshot = state.snapshot || {};
  const txDay = snapshot?.futuresMarket?.data?.txDay || {};
  const derived = snapshot?.derived || {};
  const futuresPositioning = snapshot?.futuresInstitutional?.data || {};
  const options = snapshot?.options?.data || {};
  const vwap = levelValue(chart?.levels?.vwap);
  const lastPrice = finiteNumber(chart?.lastPrice);
  const latestVolume = Array.isArray(chart?.bars) ? finiteNumber(chart.bars.at(-1)?.volume) : null;
  const previousClose = levelValue(chart?.levels?.previousClose);
  const chartContract = chart?.actualContract || null;
  const snapshotContract = txDay.contract || null;
  const declaredChartContractMonth = /^\d{6}$/.test(String(chart?.contractMonth || '')) ? String(chart.contractMonth) : null;
  const derivedChartContractMonth = terminalTxLiveContractMonth(chartContract, chart?.tradeDate);
  const chartContractMonth = declaredChartContractMonth && declaredChartContractMonth === derivedChartContractMonth
    ? declaredChartContractMonth : null;
  const snapshotContractMonth = /^\d{6}$/.test(String(snapshotContract || '')) ? String(snapshotContract) : null;
  const chartTradeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(chart?.tradeDate || '')) ? String(chart.tradeDate) : null;
  const futuresTradeDate = snapshot?.futuresMarket?.dataDate || snapshot?.futuresMarket?.sourceDataDate || null;
  const marketTradeDate = snapshot?.marketOverview?.dataDate || snapshot?.marketOverview?.sourceDataDate || null;
  const futuresMarketHealth = terminalHealthItem(workspace, 'futuresMarket');
  const marketOverviewHealth = terminalHealthItem(workspace, 'marketOverview');
  const positioningHealth = terminalHealthItem(workspace, 'futuresPositioning');
  const optionsHealth = terminalHealthItem(workspace, 'optionsEod');
  const contractIdentityComplete = Boolean(chartContract && chartContractMonth && snapshotContractMonth);
  const contractCompatible = contractIdentityComplete && chartContractMonth === snapshotContractMonth;
  const contractIdentityReason = !contractIdentityComplete ? 'CONTRACT_IDENTITY_INCOMPLETE' : 'ACTUAL_CONTRACT_MISMATCH';
  const futuresDateCompatible = Boolean(chartTradeDate && futuresTradeDate && chartTradeDate === futuresTradeDate);
  const basisTradeDateCompatible = futuresDateCompatible && Boolean(marketTradeDate && chartTradeDate === marketTradeDate);
  const futuresSourceUsable = snapshot?.futuresMarket?.ok === true && terminalEodHealthUsable(futuresMarketHealth);
  const marketSourceUsable = snapshot?.marketOverview?.ok === true && terminalEodHealthUsable(marketOverviewHealth);
  const futuresMarketUsable = futuresSourceUsable && contractCompatible && futuresDateCompatible;
  const basisIdentityCompatible = futuresMarketUsable && snapshot?.marketOverview?.ok === true
    && marketSourceUsable && basisTradeDateCompatible;
  const futuresUnavailableReason = !contractCompatible ? contractIdentityReason
    : !futuresDateCompatible ? 'TRADE_DATE_OR_SOURCE_MISMATCH'
      : !futuresSourceUsable ? 'SOURCE_QUALITY_INSUFFICIENT' : 'OPEN_INTEREST_UNAVAILABLE';
  const basisUnavailableReason = !contractCompatible ? contractIdentityReason
    : !basisTradeDateCompatible ? 'TRADE_DATE_OR_SOURCE_MISMATCH'
      : !(futuresSourceUsable && marketSourceUsable) ? 'SOURCE_QUALITY_INSUFFICIENT' : 'BASIS_UNAVAILABLE';
  const batchMode = (item) => terminalSourceMode(item, 'EOD');
  const futuresContext = terminalSourceContext(futuresMarketHealth, { tradeDate: futuresTradeDate, contract: snapshotContract });
  const basisContext = `${futuresContext} | ${terminalSourceContext(marketOverviewHealth, { tradeDate: marketTradeDate })}`;

  dwText('tt-top-contract', chart?.actualContract
    ? `台指期貨 ${chart.actualContract}`
    : `台指期貨 · ${terminalUnavailable('ACTUAL_CONTRACT_NOT_REPORTED')}`);
  terminalWrite('tt-top-price', lastPrice == null ? null : fmt(lastPrice), { reason: chart?.reason || 'LAST_PRICE_UNAVAILABLE' });
  terminalWrite('tt-top-change', lastPrice != null && previousClose != null ? signed(lastPrice - previousClose, ' 點', 2) : null, {
    reason: chart?.levels?.previousClose?.reason || 'PREVIOUS_CLOSE_UNAVAILABLE',
    title: terminalSourceContext(null, { tradeDate: chart?.tradeDate, contract: chartContract, sourceId: chart?.levels?.previousClose?.source || chart?.source }),
  });
  tone('tt-top-change', lastPrice != null && previousClose != null ? lastPrice - previousClose : 0);
  terminalWrite('tt-top-volume', latestVolume == null ? null : fmt(latestVolume), { reason: 'LATEST_BAR_VOLUME_UNAVAILABLE' });
  const marketOi = futuresMarketUsable && finiteNumber(txDay.openInterest) > 0 ? finiteNumber(txDay.openInterest) : null;
  terminalWrite('tt-top-oi', marketOi == null ? null : `${fmt(marketOi)} 口 · ${batchMode(futuresMarketHealth)}`, {
    reason: futuresMarketHealth?.reason || futuresUnavailableReason, title: futuresContext,
  });
  const basis = basisIdentityCompatible ? finiteNumber(derived?.market?.basis) : null;
  renderLiveMarketPulse(state.marketPulse);
  terminalWrite('tt-top-session', [chart?.tradeDate, chart?.session].filter(Boolean).join(' · ') || null, { reason: 'TRADE_DATE_OR_SESSION_UNAVAILABLE' });
  renderTxChartFreshness(chart, global.dataHealth);

  terminalWrite('tt-summary-price', currentFacts.priceStructureFact || null, { reason: 'PRICE_STRUCTURE_FACT_UNAVAILABLE' });
  terminalWrite('tt-summary-vwap', vwap == null ? null : fmt(vwap, 2) + captureCoverageWarning(chart?.levels?.vwap, true), { reason: chart?.levels?.vwap?.reason || 'VWAP_UNAVAILABLE' });
  const breadthAvailability = dw4FamilyEvidence(contract, 'PARTICIPATION_BREADTH')?.availabilityState;
  const flowAvailability = dw4FamilyEvidence(contract, 'FUTURES_INSTITUTIONAL')?.availabilityState;
  terminalWrite('tt-summary-breadth', breadthAvailability && breadthAvailability !== 'UNAVAILABLE' ? breadthAvailability : null, { reason: 'PARTICIPATION_BREADTH_UNAVAILABLE' });
  terminalWrite('tt-summary-flow', flowAvailability && flowAvailability !== 'UNAVAILABLE' ? flowAvailability : null, { reason: 'FUTURES_INSTITUTIONAL_UNAVAILABLE' });
  terminalWrite('tt-summary-risk', decision.risk && decision.risk !== 'UNAVAILABLE' ? decision.risk : null, { reason: 'RISK_STATUS_UNAVAILABLE' });
  updateTerminalSummaryDisclosure();

  const trendBreadthAvailability = dw4FamilyEvidence(contract, 'PARTICIPATION_BREADTH')?.availabilityState;
  const trendFuturesAvailability = dw4FamilyEvidence(contract, 'FUTURES_INSTITUTIONAL')?.availabilityState;
  for (const [id, value] of [
    ['tt-trend-price-track', 'RESEARCH_PENDING'],
    ['tt-trend-vwap-track', 'RESEARCH_PENDING'],
    ['tt-trend-path-track', 'RESEARCH_PENDING'],
    ['tt-trend-breadth-track', trendBreadthAvailability && trendBreadthAvailability !== 'UNAVAILABLE'
      ? trendBreadthAvailability : terminalUnavailable('PARTICIPATION_BREADTH_UNAVAILABLE')],
    ['tt-trend-leadership-track', 'NOT_REQUESTED'],
    ['tt-trend-futures-track', trendFuturesAvailability && trendFuturesAvailability !== 'UNAVAILABLE'
      ? trendFuturesAvailability : terminalUnavailable('FUTURES_INSTITUTIONAL_UNAVAILABLE')],
  ]) {
    const target = $(id)?.querySelector('header strong');
    if (target) target.textContent = value;
  }

  renderTerminalEvidenceCard('futures', contract, 'FUTURES_INSTITUTIONAL', 'Futures context is currently UNAVAILABLE.');
  renderTerminalEvidenceCard('options', contract, 'OPTIONS_CONTEXT', 'Verified options context is currently UNAVAILABLE.');
  renderTerminalEvidenceCard('breadth', contract, 'PARTICIPATION_BREADTH', 'Breadth participation is currently UNAVAILABLE.');
  renderTerminalEvidenceCard('global', contract, 'GLOBAL_FX', 'No governed global source is currently available.');
  renderGlobalTiles(dw4FamilyEvidence(contract, 'GLOBAL_FX'));

  terminalWrite('tt-futures-tx', lastPrice == null ? null : fmt(lastPrice), { reason: chart?.reason || 'LAST_PRICE_UNAVAILABLE' });
  const vwapDelta = lastPrice != null && vwap != null ? lastPrice - vwap : null;
  terminalWrite('tt-futures-vwap', vwapDelta == null ? null : `${vwapDelta > 0 ? '上方' : vwapDelta < 0 ? '下方' : '貼近'} ${signed(vwapDelta, ' 點', 2)}${captureCoverageWarning(chart?.levels?.vwap, true)}`, {
    reason: chart?.levels?.vwap?.reason || 'VWAP_UNAVAILABLE', title: terminalSourceContext(null, { tradeDate: chart?.tradeDate, contract: chartContract, sourceId: chart?.levels?.vwap?.source || chart?.source }),
  });
  const positioningUsable = snapshot?.futuresInstitutional?.ok === true && terminalHealthUsable(positioningHealth);
  const positioningDate = snapshot?.futuresInstitutional?.dataDate || snapshot?.futuresInstitutional?.sourceDataDate || null;
  const positioningContext = terminalSourceContext(positioningHealth, { tradeDate: positioningDate, sourceId: 'futuresPositioning' });
  for (const [id, value] of [
    ['tt-futures-foreign', futuresPositioning.foreignNet],
    ['tt-futures-dealer', futuresPositioning.dealerNet],
    ['tt-futures-trust-position', futuresPositioning.trustNet],
  ]) {
    const numeric = positioningUsable ? finiteNumber(value) : null;
    terminalWrite(id, numeric == null ? null : `${signed(numeric, ' 口')} · ${batchMode(positioningHealth)}`, {
      reason: positioningHealth?.reason || 'POSITIONING_UNAVAILABLE', title: positioningContext,
    });
  }
  terminalWrite('tt-futures-oi', marketOi == null ? null : `${fmt(marketOi)} 口 · ${batchMode(futuresMarketHealth)}`, {
    reason: futuresMarketHealth?.reason || futuresUnavailableReason, title: futuresContext,
  });
  const oiDelta = futuresMarketUsable ? finiteNumber(derived?.futures?.openInterestDelta) : null;
  terminalWrite('tt-futures-oi-change', oiDelta == null ? null : `${signed(oiDelta, ' 口')} · ${batchMode(futuresMarketHealth)}`, {
    reason: futuresMarketUsable ? 'COMPARISON_UNAVAILABLE' : futuresUnavailableReason, title: futuresContext,
  });

  const optionsUsable = snapshot?.options?.ok === true && terminalHealthUsable(optionsHealth);
  const optionsDate = snapshot?.options?.dataDate || snapshot?.options?.sourceDataDate || null;
  const optionsContext = terminalSourceContext(optionsHealth, { tradeDate: optionsDate, contract: options.contract, sourceId: 'optionsEod' });
  for (const [id, value, suffix] of [
    ['tt-options-call', options.callWall?.strike, ''],
    ['tt-options-put', options.putWall?.strike, ''],
    ['tt-options-max-pain', options.maxPain, ''],
    ['tt-options-oi', options.oiPcRatio, ' P/C'],
    ['tt-options-ring-value', options.oiPcRatio, ''],
  ]) {
    const numeric = optionsUsable ? finiteNumber(value) : null;
    terminalWrite(id, numeric == null ? null : `${fmt(numeric, id.includes('oi') || id.includes('ring') ? 2 : 0)}${suffix} · ${batchMode(optionsHealth)}`, {
      reason: optionsHealth?.reason || 'OPTIONS_EOD_UNAVAILABLE', title: optionsContext,
    });
  }

  const breadthField = workspace?.snapshot?.breadth;
  const breadthAvailable = breadthField?.availability === 'AVAILABLE';
  const breadthCounts = breadthAvailable ? terminalBreadthCounts(breadthField.value) : null;
  const breadthTitle = terminalSourceContext(terminalHealthItem(workspace, breadthField?.source || 'breadth'), {
    tradeDate: breadthField?.value?.tradeDate, sourceId: breadthField?.source || 'breadth',
  });
  for (const [id, key] of [['tt-breadth-up', 'up'], ['tt-breadth-flat', 'flat'], ['tt-breadth-down', 'down']]) {
    terminalWrite(id, breadthCounts ? fmt(breadthCounts[key]) : null, { reason: breadthField?.reason || 'BREADTH_COUNTS_UNAVAILABLE', title: breadthTitle });
  }
  const breadthRatio = breadthCounts && breadthCounts.down > 0 ? breadthCounts.up / breadthCounts.down : null;
  terminalWrite('tt-breadth-ratio', breadthRatio == null ? null : `${fmt(breadthRatio, 2)} 上／下`, {
    reason: breadthCounts ? 'DECLINE_DENOMINATOR_UNAVAILABLE' : breadthField?.reason || 'BREADTH_COUNTS_UNAVAILABLE', title: breadthTitle,
  });
  dwText('tt-breadth-strength', 'RESEARCH_PENDING');
  const breadthTotal = breadthCounts ? breadthCounts.up + breadthCounts.flat + breadthCounts.down : null;
  const participation = document.querySelector('.tt-participation-bar');
  if (participation) {
    for (const [selector, value] of [['.is-up', breadthCounts?.up], ['.is-flat', breadthCounts?.flat], ['.is-down', breadthCounts?.down]]) {
      const segment = participation.querySelector(selector);
      if (segment) segment.style.width = breadthTotal > 0 ? `${value / breadthTotal * 100}%` : '0';
    }
    participation.setAttribute('aria-label', breadthTotal > 0
      ? `市場參與度：上漲 ${breadthCounts.up}，平盤 ${breadthCounts.flat}，下跌 ${breadthCounts.down}；${breadthTitle}`
      : terminalUnavailable(breadthField?.reason || 'BREADTH_COUNTS_UNAVAILABLE'));
  }
  const breadthSeriesLabel = $('tt-breadth-series')?.previousElementSibling;
  if (breadthSeriesLabel) breadthSeriesLabel.textContent = '盤中參與趨勢 · RESEARCH_PENDING';

  dwText('tt-contribution-net', 'NOT_REQUESTED');
  const copyContextReady = typeof workspace?.chatGptCopy === 'string' && workspace.chatGptCopy.trim().length > 0;
  for (const id of ['dw-copy-gpt-prompt', 'dw-copy-chatgpt']) {
    const button = $(id);
    if (!button) continue;
    button.disabled = !copyContextReady;
    button.setAttribute('aria-disabled', String(!copyContextReady));
  }
  terminalWrite('tt-gpt-disabled-state', copyContextReady ? '複製快照已就緒（非 AI 連線狀態）' : null, {
    reason: 'COPY_CONTEXT_UNAVAILABLE',
    title: copyContextReady
      ? 'Manual question + immutable snapshot copy is available; no direct GPT API is connected.'
      : 'The dashboard copy context has not loaded; no direct GPT API is connected.',
  });

  const health = global.dataHealth || null;
  if (health) {
    for (const id of ['tt-health-main', 'tt-health-ring-value']) {
      const node = $(id);
      if (!node) continue;
      node.textContent = health;
      node.title = `overall=${health}`;
      node.setAttribute('aria-label', node.title);
      node.classList.toggle('is-unavailable', health === 'UNAVAILABLE');
    }
  } else {
    terminalWrite('tt-health-main', health, { reason: 'DATA_HEALTH_UNAVAILABLE', title: 'overall=UNAVAILABLE' });
    dwText('tt-health-ring-value', 'N/A');
    const healthRingValue = $('tt-health-ring-value');
    healthRingValue?.setAttribute('title', 'DATA_HEALTH_UNAVAILABLE');
    healthRingValue?.setAttribute('aria-label', 'DATA_HEALTH_UNAVAILABLE');
  }
  for (const [id, sourceIds] of [
    ['tt-health-market', ['chartBar', 'txTick', 'marketOverview']],
    ['tt-health-institutional', ['cashInstitutional', 'futuresPositioning']],
    ['tt-health-futures', ['futuresMarket', 'txTick']],
    ['tt-health-options', ['optionsEod']],
    ['tt-health-global', ['soxResearchContext', 'marketOverview', 'taiwanVix']],
  ]) {
    const summary = terminalHealthSummary(workspace, sourceIds);
    terminalWrite(id, summary.value, { reason: summary.reason || 'SOURCE_UNAVAILABLE', title: summary.title });
  }
  const healthTrust = $('tt-health-trust');
  if (healthTrust) {
    healthTrust.textContent = health || terminalUnavailable('DATA_HEALTH_UNAVAILABLE');
    healthTrust.className = `dw-status-pill ${healthTone(health || 'UNAVAILABLE')}`;
  }

  const risk = decision.risk && decision.risk !== 'UNAVAILABLE' ? decision.risk : null;
  if (risk) terminalWrite('tt-risk-ring-value', risk, { reason: 'RISK_STATUS_UNAVAILABLE', title: 'Existing decisionSummary.risk status only' });
  else dwText('tt-risk-ring-value', 'N/A');
  dwText('tt-risk-ring-state', risk ? 'EXISTING STATUS' : terminalUnavailable('RISK_STATUS_UNAVAILABLE'));
  $('tt-risk-ring-value')?.closest('.tt-risk-layout')?.classList.toggle('is-unavailable', !risk);
  for (const id of ['tt-risk-volatility', 'tt-risk-liquidity', 'tt-risk-event', 'tt-risk-breadth']) {
    terminalWrite(id, null, { reason: 'BREAKDOWN_NOT_IMPLEMENTED', title: 'No approved component risk contract; no value inferred.' });
  }
  const riskSeriesLabel = $('tt-risk-series')?.previousElementSibling;
  if (riskSeriesLabel) riskSeriesLabel.textContent = 'Risk Trend · RESEARCH_PENDING';
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
}

function renderTerminalDashboardFailure(reason = 'DASHBOARD_API_UNAVAILABLE') {
  const root = $('decision-workspace');
  if (!root) return;
  const unavailable = terminalUnavailable(reason);
  root.setAttribute('data-dashboard-load-state', 'UNAVAILABLE');
  root.setAttribute('aria-busy', 'false');
  if (root.dataset.homeVersion === '1' && globalThis.HomeWorkspace) {
    state.homeDashboardError = reason;
    for (const id of ['dw-copy-gpt-prompt', 'dw-copy-chatgpt']) {
      const button = $(id); if (button) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
    }
    renderHomeWorkspace();
    return; // Never replace every label, number and account summary with one raw error.
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const value = node.nodeValue.trim();
    if (['—', 'LOADING', 'UNAVAILABLE'].includes(value)) node.nodeValue = node.nodeValue.replace(value, unavailable);
    else if (value === '更新 LOADING') node.nodeValue = node.nodeValue.replace(value, `更新 ${unavailable}`);
    else if (value.length <= 80 && value.includes('—')) node.nodeValue = node.nodeValue.replace(value, unavailable);
    else if (/^0 \/ \d+ evidence families$/u.test(value) || /^0 STALE · 0 UNAVAILABLE$/u.test(value)) {
      node.nodeValue = node.nodeValue.replace(value, unavailable);
    }
  }
  for (const node of root.querySelectorAll('[id^="tt-"]')) {
    if (!['B', 'STRONG', 'SPAN', 'SMALL'].includes(node.tagName)) continue;
    const current = node.textContent.trim();
    if (current === 'RESEARCH_PENDING' || current === 'NOT_REQUESTED' || current.startsWith('UNAVAILABLE ·')) continue;
    node.textContent = unavailable;
    node.classList.add('is-unavailable');
    node.title = reason;
    node.setAttribute('aria-label', reason);
  }
  dwText('tt-top-contract', '台指期貨 · DATA UNAVAILABLE');
  dwText('tt-top-trust', unavailable);
  const topTrust = $('tt-top-trust');
  if (topTrust) topTrust.className = 'dw-status-pill is-unavailable';
  for (const id of [
    'dw-pulse-price', 'dw-pulse-vwap', 'dw-pulse-session', 'dw-pulse-breadth',
    'dw-pulse-futures', 'dw-pulse-options', 'dw-pulse-global', 'dw-pulse-change',
    'dw-pulse-volume', 'dw-pulse-vwap-mode', 'dw-pulse-breadth-mode',
    'dw-pulse-futures-mode', 'dw-pulse-options-mode', 'dw-pulse-global-mode',
  ]) terminalWrite(id, null, { reason });
  renderObservedFlow(flowChannel.view());
  for (const id of ['dw-copy-gpt-prompt', 'dw-copy-chatgpt']) {
    const button = $(id);
    if (!button) continue;
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
  }
  terminalWrite('tt-gpt-disabled-state', null, {
    reason: 'COPY_CONTEXT_UNAVAILABLE',
    title: `Dashboard source unavailable: ${reason}`,
  });
}

function leadershipRow(row, maxAbs, { compact = false } = {}) {
  const item = document.createElement('div');
  const points = finiteNumber(row?.points);
  const tone = points > 0 ? 'is-positive' : points < 0 ? 'is-negative' : '';
  item.className = `dw-leadership-row ${tone}`;
  const label = document.createElement('strong');
  const stockName = typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : null;
  const industryName = typeof row?.categoryName === 'string' && row.categoryName.trim() ? row.categoryName.trim() : null;
  label.textContent = stockName || industryName || (row?.category ? '產業名稱未提供' : '名稱未提供');
  if (stockName && row?.code) label.title = `股票代碼 ${row.code}`;
  if (industryName && row?.category) label.title = `TWSE 產業代碼 ${row.category}`;
  if (!compact) {
    const track = document.createElement('div'); track.className = 'dw-leadership-track';
    const fill = document.createElement('i'); fill.className = 'dw-leadership-fill';
    fill.style.setProperty('--magnitude', maxAbs > 0 && Number.isFinite(points) ? Math.min(1, Math.abs(points) / maxAbs) : 0);
    track.append(fill); item.append(label, track);
  } else item.append(label);
  const value = document.createElement('output'); value.textContent = Number.isFinite(points)
    ? signed(points, ' 點', 2)
    : terminalUnavailable('CONTRIBUTION_POINTS_UNAVAILABLE');
  item.append(value); return item;
}

function renderLeadershipList(id, rows, limit, {
  compact = false,
  reason = 'INDEX_LEADERSHIP_ROWS_UNAVAILABLE',
} = {}) {
  const target = $(id);
  if (!target) return;
  const selected = (Array.isArray(rows) ? rows : []).slice(0, limit);
  if (!selected.length) {
    const empty = document.createElement('p'); empty.className = 'is-empty'; empty.textContent = terminalUnavailable(reason);
    target.replaceChildren(empty); return;
  }
  const maxAbs = Math.max(...selected.map((row) => Math.abs(finiteNumber(row?.points) ?? 0)), 0);
  target.replaceChildren(...selected.map((row) => leadershipRow(row, maxAbs, { compact })));
}

function renderIndexLeadership(leadership) {
  state.indexLeadership = leadership || null;
  const value = leadership || {};
  dwText('dw-leadership-state', value.state || 'UNAVAILABLE');
  $('dw-leadership-state').className = `dw-status-pill ${value.state === 'LIVE' ? 'is-ready' : 'is-unavailable'}`;
  dwText('dw-leadership-mode', `${value.sourceMode || 'UNAVAILABLE'} · IX0001 DAY`);
  dwText('dw-leadership-time', value.lastAvailableAt
    ? `資料日 ${value.sourceTradeDate || '—'} · ${timeLabel(value.lastAvailableAt)}` : 'LIVE DAY EVENT ACCEPTANCE PENDING');
  dwText('dw-leadership-quality', value.quality || 'QUALITY_INSUFFICIENT');
  const leadershipReason = value.reasonCode || value.reason || 'INDEX_LEADERSHIP_UNAVAILABLE';
  const leadershipState = value.state && value.state !== 'UNAVAILABLE' ? value.state : null;
  terminalWrite('dw-leadership-state', leadershipState, { reason: leadershipReason });
  terminalWrite('dw-leadership-mode', value.sourceMode ? `${value.sourceMode} · IX0001 DAY` : null, { reason: leadershipReason });
  terminalWrite('dw-leadership-time', value.lastAvailableAt
    ? `資料日 ${value.sourceTradeDate || 'DATE_NOT_REPORTED'} · ${timeLabel(value.lastAvailableAt)}` : null, {
    reason: value.state === 'LIVE' ? 'AVAILABLE_AT_NOT_REPORTED' : leadershipReason,
  });
  renderLeadershipList('dw-leadership-bars', value.indexLeadership?.topAbsolute, 7, { reason: leadershipReason });
  renderLeadershipList('dw-leadership-positive', value.indexLeadership?.topPositive, 4, { compact: true, reason: leadershipReason });
  renderLeadershipList('dw-leadership-negative', value.indexLeadership?.topNegative, 4, { compact: true, reason: leadershipReason });
  renderLeadershipList('dw-industry-bars', value.industryLeadership?.rows, 6, { reason: leadershipReason });
  const invariant = value.industryLeadership || {};
  dwText('dw-industry-invariant', invariant.invariantDelta == null
    ? '總和檢核等待資料'
    : `Σ ${signed(invariant.pointsSum, ' 點', 2)} · 指數 ${signed(invariant.indexPriceChange, ' 點', 2)} · Δ ${fmt(invariant.invariantDelta, 3)} / 容許 ${fmt(invariant.invariantTolerance, 3)}`);
  const positive = finiteNumber(value.indexLeadership?.positivePointsSum);
  const negative = finiteNumber(value.indexLeadership?.negativePointsSum);
  const contributionNet = positive != null && negative != null ? positive + negative : null;
  terminalWrite('tt-contribution-net', contributionNet == null ? null : signed(contributionNet, ' 點', 2), {
    reason: leadershipReason,
    title: value.lastAvailableAt
      ? `IX0001 描述性貢獻 · ${value.sourceMode || 'UNAVAILABLE'} · ${timeLabel(value.lastAvailableAt)}`
      : 'IX0001 貢獻等待日盤合法資料',
  });
  const trendLeadership = $('tt-trend-leadership-track')?.querySelector('header strong');
  if (trendLeadership) trendLeadership.textContent = value.state === 'LIVE'
    ? 'LIVE · DESCRIPTIVE'
    : value.runtimeActivationState === 'ENABLED' ? '等待日盤資料' : '來源尚未啟用';
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
}

async function loadIndexLeadership() {
  if (state.indexLeadershipLoading) return;
  state.indexLeadershipLoading = true;
  try {
    const payload = await api('/api/v1/index-leadership');
    renderIndexLeadership(payload.data);
  } finally { state.indexLeadershipLoading = false; }
}

function renderIndexLeadershipFailure(error) {
  renderIndexLeadership({
    state: 'UNAVAILABLE',
    reason: `INDEX_LEADERSHIP_API_UNAVAILABLE:${error?.message || 'UNKNOWN_FAILURE'}`,
    quality: 'QUALITY_INSUFFICIENT',
  });
}

function renderRuntimeVersion(version = {}) {
  const product = version.productVersion || 'DW V1.1';
  const runtime = version.runtimeCommit || null;
  const main = version.approvedMainCommit || null;
  const sync = ['SYNCED', 'MISMATCH', 'UNKNOWN'].includes(version.syncState) ? version.syncState : 'UNKNOWN';
  const short = runtime ? runtime.slice(0, 7) : 'UNKNOWN';
  dwText('dw-runtime-badge', `${product} · ${short} · ${sync}`);
  $('dw-runtime-version').className = `dw-runtime-version is-${sync.toLowerCase()}`;
  dwText('dw-version-product', product);
  dwText('dw-version-main', main || 'UNKNOWN');
  dwText('dw-version-runtime', runtime || 'UNKNOWN');
  dwText('dw-version-started', version.runtimeStartedAt || 'UNKNOWN');
  dwText('dw-version-sync', sync);
  const preview = $('cru46-preview-version');
  const isIntegrationPreview = version.previewType === 'INTEGRATION_OWNER_PREVIEW'
    || version.previewType === 'CRU44_OWNER_PREVIEW' || version.previewType === 'CRU21_OWNER_PREVIEW'
    || version.previewType === 'OWNER_LOCAL_ACCEPTANCE_HTTP';
  preview?.classList.toggle('hidden', !isIntegrationPreview);
  if (!isIntegrationPreview) return;
  dwText('cru46-preview-badge', version.previewLabel || 'INTEGRATION OWNER PREVIEW');
  dwText('cru46-version-product', version.productVersion || 'UNKNOWN');
  dwText('cru46-version-type', version.previewType || 'UNKNOWN');
  dwText('cru46-version-branch', version.branch || 'UNKNOWN');
  dwText('cru46-version-head', version.exactHead || 'UNKNOWN');
  dwText('cru46-version-base', version.baseMainCommit || 'UNKNOWN');
  dwText('cru46-version-build', version.buildCommit || 'UNKNOWN');
  dwText('cru46-version-runtime', version.runtimeCommit || 'UNKNOWN');
  for (const id of ['cru46-version-cru43', 'cru46-version-cru45']) $(id)?.parentElement?.classList.toggle('hidden', version.previewType === 'CRU21_OWNER_PREVIEW');
  dwText('cru46-version-cru43', version.includedSources?.cru43 || 'UNKNOWN');
  dwText('cru46-version-cru45', version.includedSources?.cru45 || 'UNKNOWN');
  dwText('cru46-version-pending', Array.isArray(version.pendingCapabilities) ? version.pendingCapabilities.join(' / ') : 'UNKNOWN');
  dwText('cru46-version-data-mode', version.dataMode || 'UNKNOWN');
  dwText('cru46-version-complete', version.complete === false ? 'NOT COMPLETE' : 'UNKNOWN');
}

function renderDw4FamilyList(id, values) {
  const target = $(id);
  if (!target) return;
  const items = Array.isArray(values) && values.length ? values : ['目前沒有'];
  target.replaceChildren(...items.map((value) => {
    const li = document.createElement('li');
    li.textContent = value === '目前沒有' ? value : dw4FamilyLabel(value);
    return li;
  }));
}

function renderDw4Evidence(summary) {
  const value = summary || {};
  const conflictState = value.conflictState || 'NO_DIRECTIONAL_EVIDENCE';
  const coverageState = value.coverageState || 'INSUFFICIENT';
  const dataTrustState = value.dataTrustState || 'BLOCKED';
  dwText('dw-conflict-state', dw4SummaryLabel(conflictState));
  dwText('dw-coverage-state', dw4SummaryLabel(coverageState));
  dwText('dw-trust-state', dw4SummaryLabel(dataTrustState));
  dwText('dw-conflict-state-raw', conflictState);
  dwText('dw-coverage-state-raw', coverageState);
  dwText('dw-trust-state-raw', dataTrustState);
  dwText('dw-coverage-counts', `${value.eligibleFamilies || 0} / ${value.expectedFamilies || 5} evidence families`);
  $('dw-conflict-state').className = healthTone(value.conflictState === 'NO_DIRECTIONAL_EVIDENCE' ? 'UNAVAILABLE' : 'PASS');
  $('dw-coverage-state').className = healthTone(value.coverageState);
  $('dw-trust-state').className = healthTone(value.dataTrustState);

  renderDw4FamilyList('dw-eligible-families', value.eligibleEvidenceFamilies);
  renderDw4FamilyList('dw-unavailable-families', value.unavailableEvidenceFamilies);
  renderDw4FamilyList('dw-stale-families', value.staleEvidenceFamilies);
  renderDw4FamilyList('dw-quality-families', value.qualityExcludedFamilies);
  renderDw4FamilyList('dw-promotion-families', value.promotionExcludedFamilies);
  renderDw4FamilyList('dw-missing-families', value.missingEvidenceFamilies);

  const target = $('dw-family-grid');
  if (!target) return;
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  const cards = evidence.map((item) => {
    const card = document.createElement('details'); card.className = 'dw-family-card';
    const summaryNode = document.createElement('summary');
    const title = document.createElement('span');
    const strong = document.createElement('strong'); strong.textContent = dw4FamilyLabel(item.family);
    const source = document.createElement('small'); source.textContent = item.detail?.descriptiveStatus === 'AVAILABLE' ? '描述資料可查看' : '描述資料目前不可用';
    title.append(strong, source);
    const statusGrid = document.createElement('span'); statusGrid.className = 'dw-family-status-grid';
    [
      ['來源', item.availabilityState],
      ['品質', item.qualityState],
      ['方向資格', item.promotionState],
    ].forEach(([label, rawState]) => {
      const axis = document.createElement('span'); axis.className = 'dw-family-axis';
      axis.title = label === '來源'
        ? '來源可取得不代表可以影響方向彙總。'
        : label === '品質'
          ? '品質不足代表限制仍存在，不代表資料完全錯誤。'
          : 'RAW_ONLY／尚未升級的資料只供描述，不影響方向彙總。';
      const axisLabel = document.createElement('small'); axisLabel.textContent = label;
      const axisValue = document.createElement('b'); axisValue.className = healthTone(rawState); axisValue.textContent = dw4StateLabel(rawState);
      axis.append(axisLabel, axisValue); statusGrid.append(axis);
    });
    const descriptive = Array.isArray(item.detail?.descriptiveValues) ? item.detail.descriptiveValues : [];
    const preview = document.createElement('span'); preview.className = 'dw-family-preview';
    const previewValues = descriptive.length ? descriptive.slice(0, 2) : [{ label: '描述值', value: 'UNAVAILABLE' }];
    preview.append(...previewValues.map((entry) => {
      const metric = document.createElement('span');
      const metricLabel = document.createElement('small'); metricLabel.textContent = entry.label;
      const metricValue = document.createElement('b'); metricValue.textContent = dw4DescriptiveValue(entry);
      metric.append(metricLabel, metricValue);
      const modeLabel = sourceModeLabel(entry.sourceMode);
      if (modeLabel) {
        const sourceMode = document.createElement('em');
        sourceMode.className = 'dw-source-mode'; sourceMode.textContent = modeLabel;
        sourceMode.title = `原始 sourceMode：${entry.sourceMode}`;
        metric.append(sourceMode);
      }
      return metric;
    }));
    const caveat = document.createElement('em'); caveat.className = 'dw-family-caveat';
    caveat.textContent = '描述資料；尚未納入 DW-4 方向彙總';
    summaryNode.append(title, statusGrid, preview, caveat);
    const detail = document.createElement('dl'); detail.className = 'dw-family-detail';
    const rows = [
      ['方向', item.directionState], ['來源', item.availabilityState], ['品質', item.qualityState],
      ['Source ID', item.sourceId || 'UNAVAILABLE'],
      ['Promotion', item.promotionState], ['availableAt', item.availableAt || 'UNAVAILABLE'],
      ['描述值狀態', item.detail?.descriptiveStatus || 'UNAVAILABLE'],
      ['全部描述值', descriptive.map((entry) => `${entry.label}=${dw4DescriptiveValue(entry)}${entry.sourceMode ? ` [${entry.sourceMode}]` : ''}`).join(' · ') || 'UNAVAILABLE'],
      ['用途邊界', item.detail?.descriptiveUse || 'DESCRIPTIVE_ONLY_NOT_DIRECTIONAL_EVIDENCE'],
      ['識別警告', item.detail?.identityWarning || 'NONE'],
      ['技術原因', (item.qualityReasons || []).join(' · ') || 'NONE'],
    ];
    rows.forEach(([label, detailValue]) => {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = detailValue;
      detail.append(dt, dd);
    });
    card.append(summaryNode, detail);
    return card;
  });
  if (!cards.length) {
    const empty = document.createElement('p'); empty.className = 'is-empty'; empty.textContent = '證據 contract 目前無法取得。';
    target.replaceChildren(empty);
  } else target.replaceChildren(...cards);
}

function chartTimeLabel(timestampSeconds) {
  if (timestampSeconds == null) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(Number(timestampSeconds) * 1000));
}

function chartEpoch(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function activeCandlePalette() {
  return window.TraderTerminalShell?.PALETTES?.[state.txChartPalette]
    || { up: '#ff6b6b', down: '#37d67a', upVolume: 'rgba(255,107,107,.34)', downVolume: 'rgba(55,214,122,.34)' };
}

function txChartRuntimeReason() {
  const target = $('dw-chart-canvas');
  if (!target) return 'CHART_DOM_MOUNT_UNAVAILABLE';
  const L = window.LightweightCharts;
  if (!L) return 'CHART_RUNTIME_UNAVAILABLE';
  if (typeof L.createChart !== 'function'
    || !L.CandlestickSeries
    || !L.HistogramSeries
    || !L.LineSeries) return 'CHART_RUNTIME_API_MISMATCH';
  return null;
}

function captureCoverageWarning(value, sessionAggregate = false) {
  const interrupted = value?.captureCoverage?.state === 'KNOWN_INTERRUPTION'
    || value?.reason === 'KNOWN_CAPTURE_INTERRUPTION'
    || value?.qualityReasons?.includes('KNOWN_CAPTURE_INTERRUPTION');
  if (interrupted) return '（行情缺口：僅已收到資料，非完整區間）';
  // Current session aggregates have no certified capture-from-open contract.
  // PASS/freshness and absence of a recorded interruption do not prove completeness.
  return sessionAggregate ? '（僅已收到資料，完整盤初未驗證）' : '';
}
function txBarObservationLabel(chart, selectedTimeMs) {
  const observation = (chart?.bars || []).find(row => Date.parse(row.time) === selectedTimeMs);
  const warning = captureCoverageWarning(observation);
  return warning ? '觀測' + warning : '完整';
}

function ensureTxChart() {
  if (state.txChartApi) return state.txChartApi;
  state.txChartRuntimeReason = txChartRuntimeReason();
  if (state.txChartRuntimeReason) return null;
  const target = $('dw-chart-canvas');
  const L = window.LightweightCharts;
  let chart = null;
  try {
    chart = L.createChart(target, {
    autoSize: true,
    layout: { background: { type: L.ColorType.Solid, color: '#090f18' }, textColor: '#8290a4', attributionLogo: true },
    grid: { vertLines: { color: 'rgba(138,167,255,.055)' }, horzLines: { color: 'rgba(138,167,255,.055)' } },
    crosshair: { mode: L.CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(138,167,255,.16)', scaleMargins: { top: .08, bottom: .25 } },
    timeScale: {
      borderColor: 'rgba(138,167,255,.16)', timeVisible: true, secondsVisible: false,
      rightOffset: 3, barSpacing: 8,
      tickMarkFormatter: (time) => chartTimeLabel(time),
    },
    localization: { timeFormatter: (time) => chartTimeLabel(time) },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  });
    const palette = activeCandlePalette();
    const candle = chart.addSeries(L.CandlestickSeries, {
    upColor: palette.up, downColor: palette.down, borderVisible: false,
    wickUpColor: palette.up, wickDownColor: palette.down, priceLineVisible: true,
  });
    const volume = chart.addSeries(L.HistogramSeries, {
    priceScaleId: 'volume', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
  });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: .8, bottom: 0 } });
    const vwap = chart.addSeries(L.LineSeries, {
    color: '#f5c86b', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'VWAP',
  });
    const markers = typeof L.createSeriesMarkers === 'function' ? L.createSeriesMarkers(candle, []) : null;
    chart.subscribeCrosshairMove((parameter) => {
    const bar = parameter.seriesData?.get(candle);
    if (!bar || parameter.time == null) {
      dwText('dw-chart-crosshair', '移到 K 棒查看目前／收盤、漲跌、最高、最低、振幅與成交量');
      return;
    }
    const volumePoint = parameter.seriesData?.get(volume);
    const vwapPoint = parameter.seriesData?.get(vwap);
    const selectedTimeMs = Number(parameter.time) * 1000;
    const openingRange = state.txChartPayload?.openingRange;
    const openingRangeKnown = openingRange?.status === 'READY'
      && Number.isFinite(selectedTimeMs)
      && Date.parse(openingRange.availableAt) <= selectedTimeMs;
    const openingRangeText = openingRangeKnown
      ? `OR H ${fmt(openingRange.high)} L ${fmt(openingRange.low)}`
      : 'OR UNAVAILABLE_AT_SELECTED_TIME';
    const close = finiteNumber(bar.close);
    const open = finiteNumber(bar.open);
    const high = finiteNumber(bar.high);
    const low = finiteNumber(bar.low);
    const change = close == null || open == null ? null : close - open;
    const range = high == null || low == null ? null : high - low;
    const selectedVwap = finiteNumber(vwapPoint?.value);
    const distance = close == null || selectedVwap == null ? 'UNAVAILABLE' : signed(close - selectedVwap, '', 2);
    dwText('dw-chart-crosshair', `${chartTimeLabel(parameter.time)} · 目前／收盤 ${fmt(close)} · 漲跌 ${change == null ? 'UNAVAILABLE' : signed(change, ' 點', 2)} · 最高 ${fmt(high)} · 最低 ${fmt(low)} · 振幅 ${range == null ? 'UNAVAILABLE' : fmt(range, 2)} 點 · 成交量 ${fmt(volumePoint?.value)} · ${txBarObservationLabel(state.txChartPayload, selectedTimeMs)} 開 ${fmt(open)} / 高 ${fmt(high)} / 低 ${fmt(low)} / 收 ${fmt(close)} · VWAP ${fmt(selectedVwap, 2)}${captureCoverageWarning(state.txChartPayload?.levels?.vwap, true)} · 距 VWAP ${distance} · ${openingRangeText}`);
    });
    state.txChartApi = chart;
    state.txChartSeries = { candle, volume, vwap };
    state.txChartMarkers = markers;
    state.txChartRuntimeReason = null;
    return chart;
  } catch {
    try { chart?.remove(); } catch { /* best-effort disposal of a partially initialized renderer */ }
    state.txChartApi = null;
    state.txChartSeries = null;
    state.txChartMarkers = null;
    state.txChartRuntimeReason = 'CHART_RENDER_INITIALIZATION_FAILED';
    return null;
  }
}

function levelValue(level) {
  return level?.availability === 'AVAILABLE' && Number.isFinite(Number(level.value)) ? Number(level.value) : null;
}

function levelEventLabel(stateValue) {
  return ({
    MONITORING: '觀察',
    APPROACHING: '接近',
    TESTING: '測試中',
    BREAKING: '穿越中',
    ACCEPTED: '已接受',
    REJECTED: '遭拒絕',
    RECLAIMED: '已收回',
    LOST: '已失守',
  })[stateValue] || '觀察';
}

function renderNextWatchBasis(rows = []) {
  const host = $('dw-next-watch-basis');
  if (!host) return;
  const values = Array.isArray(rows) && rows.length ? rows.slice(0, 7) : ['目前沒有額外證據。'];
  host.replaceChildren(...values.map((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    return item;
  }));
}

function scenarioRrText(scenario) {
  const ratio = finiteNumber(scenario?.rr?.ratio);
  if (scenario?.rr?.state !== 'AVAILABLE' || ratio == null) return 'R:R —';
  if (!scenario.rr.applicability) return 'R:R — · 現價適用性未驗證'; // Old or mixed-version snapshots fail closed.
  return scenario.rr.applicability?.state === 'NEAR_REFERENCE_UNCONFIRMED'
    ? '結構 R:R ' + fmt(ratio, 2) + ' · 尚未確認'
    : '現價 R:R — · 條件式 ' + fmt(ratio, 2) + '（非現價）';
}

function scenarioTargetText(scenario) {
  const price = finiteNumber(scenario?.target?.price);
  return scenario?.target && price != null ? `${scenario.target.label} ${fmt(price, 2)}` : '目前無合法目標';
}

function scenarioDirectionLabel(scenarioWatch, next) {
  if (scenarioWatch?.directionState === 'BIDIRECTIONAL_TEST') return '雙向測試／方向未定';
  return '雙向觀察／方向未定';
}

function scenarioTargetWhy(scenario) {
  if (!scenario?.target) return [scenario?.targetDiagnostics?.summary, scenario?.targetDiagnostics?.waitFor].filter(Boolean).join(' ')
    || '目前沒有通過結構與品質檢查的方向目標。';
  const target = scenario.target;
  const reasons = Array.isArray(target.basisReasons) ? target.basisReasons : [];
  const qualityReasons = Array.isArray(target.qualityReasons) && target.qualityReasons.length ? `（${target.qualityReasons.join('、')}）` : '';
  return [target.why, ...reasons, `來源：${target.sourceId || '未知'}；可用時間：${target.availableAt || '未知'}；品質：${target.qualityStatus || '未知'}${qualityReasons}。`].filter(Boolean).join(' ');
}

function scenarioEvidenceText(scenario) {
  const price = ({ MET: '價格越過確認邊界，仍待維持', NOT_MET: '價格尚未達確認邊界', UNAVAILABLE: '價格確認條件不可用' })[scenario?.priceGateState] || '價格確認條件不可用';
  const flow = ({ ALIGNED: '成交壓力與價格反應同向', CONTRARY: '成交壓力與價格反應偏向另一側', MIXED: '成交壓力與價格反應尚未一致', QUALITY_INSUFFICIENT: '成交證據品質不足', UNAVAILABLE: '成交確認不可用' })[scenario?.flowConfirmationState] || '成交確認不可用';
  const rr = scenario?.rr;
  const geometry = rr?.state === 'AVAILABLE' ? '結構風險 ' + fmt(rr.riskPoints, 2) + ' 點、報酬 ' + fmt(rr.rewardPoints, 2) + ' 點。'
    : rr?.reason === 'THRESHOLDS_UNAVAILABLE' ? 'R:R 不可用：確認／失效門檻缺乏合格資料。' : 'R:R 不可用：缺少合法方向目標。';
  const a = rr?.applicability;
  const validGap = a && [a.currentPrice, a.confirmationReferencePrice, a.gapFromConfirmationPoints]
    .every(value => typeof value === 'number' && Number.isFinite(value))
    && Math.abs(a.gapFromConfirmationPoints - (a.currentPrice - a.confirmationReferencePrice)) < 1e-8;
  const applicability = rr?.state === 'AVAILABLE' && validGap
    ? '現價 ' + fmt(a.currentPrice, 2) + '、條件式確認門檻 ' + fmt(a.confirmationReferencePrice, 2)
      + '，相距 ' + fmt(Math.abs(a.gapFromConfirmationPoints), 2) + ' 點；現價可執行 R:R 不可用。'
    : '現價進場適用性不可用。';
  return price + '；' + flow + '。' + geometry + applicability + '仍是條件情境，未形成交易訊號。';
}

function renderScenarioWatch(scenarioWatch, { restrictionText = '', unavailableText = '' } = {}) {
  const long = scenarioWatch?.long || null;
  const short = scenarioWatch?.short || null;
  dwText('dw-long-target', scenarioTargetText(long));
  dwText('dw-short-target', scenarioTargetText(short));
  dwText('dw-long-rr', scenarioRrText(long));
  dwText('dw-short-rr', scenarioRrText(short));
  dwText('dw-long-target-why', [restrictionText, unavailableText || scenarioTargetWhy(long)].filter(Boolean).join(' '));
  dwText('dw-short-target-why', [restrictionText, unavailableText || scenarioTargetWhy(short)].filter(Boolean).join(' '));
  dwText('dw-long-confirm', long?.confirm || '等待合法多方確認條件。');
  dwText('dw-long-invalidate', long?.invalidate || '等待合法多方失效條件。');
  dwText('dw-short-confirm', short?.confirm || '等待合法空方確認條件。');
  dwText('dw-short-invalidate', short?.invalidate || '等待合法空方失效條件。');
  dwText('dw-long-evidence', [restrictionText, unavailableText || scenarioEvidenceText(long)].filter(Boolean).join(' '));
  dwText('dw-short-evidence', [restrictionText, unavailableText || scenarioEvidenceText(short)].filter(Boolean).join(' '));
  const available = [long, short].some((row) => row?.rr?.state === 'AVAILABLE');
  dwText('dw-scenario-rr-note', [restrictionText, available
    ? '條件式結構 R:R 以確認門檻而非當前價格起算；不是現價可執行 R:R、勝率、EV、進場或停損指令。'
    : '目前缺少合法方向目標或結構條件，因此不計算 R:R；不補造價位。'].filter(Boolean).join(' '));
}

function levelWatchUnavailableExplanation(watch) {
  const diagnostic = watch?.unavailabilityDiagnostics;
  if (!diagnostic) return null;
  const dependencies = diagnostic.dependencies || {};
  const count = value => Number.isInteger(value) && value >= 0 ? String(value) : '未知';
  const rows = [diagnostic.summary,
    `來源時間：${watch.sourceAvailableAt || '未知'}。`,
    `完成 5 分 K ${count(dependencies.completedBarCount)} 根；近期 range 輸入 ${count(dependencies.recentRangeBarCount)} 根，結構合格 ${count(dependencies.eligibleRangeBarCount)} 根，原品質受限 ${count(dependencies.restrictedRangeBarCount)} 根。`,
    ...(Array.isArray(diagnostic.sources) ? diagnostic.sources : []).map(source =>
      `${source.id || '未識別來源'}：${source.availability || 'UNKNOWN'}；品質 ${source.qualityStatus || 'UNKNOWN'}${source.reason ? `；${source.reason}` : ''}。`),
    ...(Array.isArray(diagnostic.reasonCodes) && diagnostic.reasonCodes.length ? [`限制原因：${diagnostic.reasonCodes.join('、')}。`] : []),
  ].filter(Boolean);
  return { summary: diagnostic.summary || '結構依賴尚未合格，目標與 R:R 保持空值。', rows, text: rows.join(' ') };
}

function renderDecisionLevelWatch(levelWatch) {
  state.levelWatch = levelWatch || null;
  if (state.decisionWorkspace) state.decisionWorkspace = { ...state.decisionWorkspace, levelWatch: levelWatch || null };
  const host = $('dw-next-watch');
  const needsSourceTimeValidation = Boolean(levelWatch?.structureEligibility && levelWatch.currentPriceQualityStatus !== 'PASS');
  const matchesChart = levelWatchIsFresh(levelWatch) && (state.txChartPayload
    ? levelWatchMatchesChart(levelWatch, state.txChartPayload) : !needsSourceTimeValidation);
  const next = levelWatch?.state === 'READY' && matchesChart
    && levelWatch?.decisionFocus?.state === 'ACTIVE_REFERENCE' ? levelWatch.nextWatch : null;
  if (!host || !next) {
    if (host) host.dataset.state = 'UNAVAILABLE';
    const expired = levelWatch?.reason === 'CHART_SOURCE_STALE'
      || (levelWatch?.state === 'READY' && !levelWatchIsFresh(levelWatch, state.txChartPayload));
    const diagnosticIdentityMatches = !state.txChartPayload || ['actualContract', 'tradeDate', 'session']
      .every(key => levelWatch?.identity?.[key] && levelWatch.identity[key] === state.txChartPayload[key]);
    const explanation = levelWatch?.state === 'UNAVAILABLE' && !expired && diagnosticIdentityMatches && levelWatch?.unavailabilityDiagnostics
      ? levelWatchUnavailableExplanation(levelWatch) : null;
    const noFocus = !expired && levelWatch?.decisionFocus?.state === 'NO_ACTIVE_REFERENCE';
    const f = levelWatch?.decisionFocus;
    const bg = f?.nearestBackground;
    const message = noFocus ? '目前沒有接近現價且品質合格的主要觀察節點。'
      + (bg ? ' 最近合法背景參考 ' + bg.label + ' ' + fmt(bg.price, 2)
        + '，相距 ' + fmt(bg.distancePoints, 1) + ' 點；不是當前測試。' : '')
      : '';
    dwText('dw-next-watch-label', expired ? '觀察資料非最新，等待重新取得'
      : noFocus ? '目前沒有合格且接近現價的主要觀察節點' : '等待合法關鍵價位');
    dwText('dw-next-watch-distance', '—');
    dwText('dw-next-watch-why', expired ? '行情或觀察資料已過期／時間不可驗證，因此暫停目前情境判讀。'
      : message || explanation?.text || '目前沒有可用價位。');
    renderNextWatchBasis(noFocus
      ? [message, '合法但遠端的價位只能作背景，不建立情境或 R:R。']
      : explanation?.rows || ['等待合法價位與證據。']);
    renderScenarioWatch(null, { unavailableText: message || explanation?.text || '' });
    dwText('dw-next-watch-response', explanation?.summary || '等待合法價位。');
    dwText('dw-next-watch-confirm', '—');
    dwText('dw-next-watch-invalidate', '—');
    if (globalThis.HomeWorkspace) renderHomeWorkspace();
    return;
  }
  const scenario = levelWatch?.scenarioWatch || null;
  host.dataset.state = next.state || 'MONITORING';
  const distance = finiteNumber(next.distancePoints);
  const distanceText = distance == null ? '距離未知' : distance === 0 ? '正在價位' : `距離 ${fmt(Math.abs(distance), 1)} 點`;
  const sourceTimeOnly = levelWatch?.structureEligibility && sourceTimeStructureEligible(levelWatch.structureEligibility)
    && (state.txChartPayload?.qualityStatus !== 'PASS' || levelWatch.currentPriceQualityStatus !== 'PASS');
  const restrictionText = sourceTimeOnly ? '來源時間結構：僅依來源所報時間計算幾何；跨時計品質受限，不等於可交易。' : '';
  const qualityText = sourceTimeOnly ? ' · 跨時計品質受限／不等於可交易'
    : next.qualityStatus && next.qualityStatus !== 'PASS' ? ' · 資料品質受限' : '';
  dwText('dw-next-watch-label', `${next.label} ${fmt(next.price, 2)} · ${scenarioDirectionLabel(scenario, next)}${sourceTimeOnly ? ' · 來源時間結構' : ''}`);
  dwText('dw-next-watch-distance', `${distanceText}${qualityText}`);
  dwText('dw-next-watch-why', [restrictionText, next.why || '由合法價格結構產生。'].filter(Boolean).join(' '));
  renderNextWatchBasis(next.basisReasons || []);
  renderScenarioWatch(scenario, { restrictionText });
  dwText('dw-next-watch-response', next.watchFor || next.expectedResponse || '觀察價格在此處的實際反應。');
  dwText('dw-next-watch-confirm', next.confirm || '等待更多價格反應。');
  dwText('dw-next-watch-invalidate', next.invalidate || '等待更多價格反應。');
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
}

async function loadDecisionLevelWatch() {
  if (state.levelWatchLoading || !(state.csrfToken || state.guestReadOnly) || document.hidden || $('dashboard-view')?.classList.contains('hidden')) return;
  state.levelWatchLoading = true;
  try {
    // Revalidate cached evidence while a new response is in flight.
    renderDecisionLevelWatch(state.levelWatch);
    if (state.txChartPayload) renderTxChartLevels(state.txChartPayload);
    const payload = await api('/api/v1/decision-level-watch', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    renderDecisionLevelWatch(payload.data);
    if (state.txChartPayload) renderTxChartLevels(state.txChartPayload);
  } catch {
    renderDecisionLevelWatch({ state: 'UNAVAILABLE', reason: 'LEVEL_WATCH_REFRESH_FAILED' });
    dwText('dw-next-watch-label', '觀察資料更新失敗，等待重新取得');
    if (state.txChartPayload) renderTxChartLevels(state.txChartPayload);
  } finally {
    state.levelWatchLoading = false;
  }
}
function levelWatchIsFresh(watch, chart = null) {
  const now = Date.now();
  const sourceAt = Date.parse(watch?.sourceAvailableAt);
  const snapshotAt = Date.parse(watch?.snapshotTime);
  const times = [sourceAt, snapshotAt];
  if (chart) times.push(Date.parse(chart.availableAt));
  return times.every(at => Number.isFinite(at) && at <= now + 5_000 && now - at <= 120_000)
    && sourceAt <= snapshotAt;
}
function sourceTimeStructureEligible(value) {
  return value?.schemaVersion === 'source-time-structure-v1' && value.state === 'ELIGIBLE'
    && value.basis === 'REPORTED_SOURCE_TIME_GEOMETRY' && value.scope === 'LIVE_DESCRIPTIVE_ONLY';
}
function levelWatchMatchesChart(watch, chart) {
  return watch?.state === 'READY' && levelWatchIsFresh(watch, chart) && chart?.mode !== 'REPLAY'
    && ['READY', 'FORMING', 'QUALITY_INSUFFICIENT'].includes(chart?.status)
    && ((chart?.qualityStatus === 'PASS' && (!watch.currentPriceQualityStatus || watch.currentPriceQualityStatus === 'PASS'))
      || (sourceTimeStructureEligible(watch.structureEligibility) && sourceTimeStructureEligible(chart?.structureEligibility))
      || ![watch.scenarioWatch?.long, watch.scenarioWatch?.short].some((side) => side?.rr?.state === 'AVAILABLE'))
    && ['actualContract', 'tradeDate', 'session'].every((key) => watch.identity?.[key] && watch.identity[key] === chart?.[key]);
}
function clearTxChartLevels() {
  if (!state.txChartSeries?.candle) return;
  for (const line of state.txChartLevelLines) state.txChartSeries.candle.removePriceLine(line);
  state.txChartLevelLines = [];
}

function addTxChartLevel(level, title, color, style = null) {
  const price = levelValue(level);
  if (price == null || !state.txChartSeries?.candle) return;
  const L = window.LightweightCharts;
  const line = state.txChartSeries.candle.createPriceLine({
    price, title, color, lineWidth: 1,
    lineStyle: style ?? L.LineStyle.Dashed,
    axisLabelVisible: true,
  });
  state.txChartLevelLines.push(line);
}

function renderTxChartLevels(chart) {
  const levels = chart?.levels || {};
  const prior = [levelValue(levels.previousDayHigh), levelValue(levels.previousDayLow), levelValue(levels.previousClose)];
  terminalWrite('dw-prior-levels', prior.every((value) => value != null) ? prior.map((value) => fmt(value)).join(' / ') : null, { reason: levels.previousClose?.reason || 'PRIOR_LEVELS_UNAVAILABLE' });
  const high = levelValue(levels.currentDayHigh) ?? levelValue(levels.nightHigh);
  const low = levelValue(levels.currentDayLow) ?? levelValue(levels.nightLow);
  const rangeWarning = captureCoverageWarning(levelValue(levels.currentDayHigh) != null ? levels.currentDayHigh : levels.nightHigh)
    || captureCoverageWarning(levelValue(levels.currentDayLow) != null ? levels.currentDayLow : levels.nightLow)
    || captureCoverageWarning(null, true);
  terminalWrite('dw-session-levels', high != null && low != null ? `${fmt(high)} / ${fmt(low)}${rangeWarning}` : null, { reason: 'SESSION_HIGH_LOW_UNAVAILABLE' });
  const orText = chart?.openingRange?.status === 'READY' ? `${fmt(chart.openingRange.low)}–${fmt(chart.openingRange.high)}` : null;
  terminalWrite('dw-or-state', orText, { reason: chart?.openingRange?.reason || 'OPENING_RANGE_UNAVAILABLE' });
  dwText('dw-vwap-label', chart?.vwapSession === 'DAY' ? 'DAY VWAP' : chart?.vwapSession === 'NIGHT' ? 'NIGHT VWAP' : 'VWAP');
  terminalWrite('dw-vwap-state', levelValue(levels.vwap) == null ? null : fmt(levels.vwap.value, 2) + captureCoverageWarning(levels.vwap, true), { reason: levels.vwap?.reason || 'VWAP_UNAVAILABLE' });
  terminalWrite('dw-chart-available-at', chart?.availableAt ? timeLabel(chart.availableAt) : null, { reason: 'AVAILABLE_AT_NOT_REPORTED' });
  terminalWrite('dw-chart-quality', chart?.qualityStatus || null, { reason: 'QUALITY_STATUS_UNAVAILABLE' });

  clearTxChartLevels();
  const candidate = state.levelWatch || state.decisionWorkspace?.levelWatch;
  const watch = levelWatchMatchesChart(candidate, chart)
    && candidate?.decisionFocus?.state === 'ACTIVE_REFERENCE' ? candidate : null;
  const scenario = watch?.scenarioWatch || null;
  const longTargetId = scenario?.long?.target?.id || null;
  const shortTargetId = scenario?.short?.target?.id || null;
  const nodeId = scenario?.node?.id || watch?.nextWatch?.id || null;
  const levelRoleTitle = (entry) => {
    if (!entry) return '';
    if (entry.id === nodeId) return `${entry.label} · ${scenarioDirectionLabel(scenario, entry)}`;
    if (entry.id === longTargetId) return `多方下一關 · ${entry.label}`;
    if (entry.id === shortTargetId) return `空方下一關 · ${entry.label}`;
    return `${entry.label} · ${levelEventLabel(entry.state)}`;
  };
  const vwapWatch = watch?.state === 'READY' && Array.isArray(watch.levels) ? watch.levels.find((entry) => entry.id === 'VWAP') : null;
  const vwapSeriesLabel = chart?.vwapSession === 'DAY' ? 'DAY VWAP' : chart?.vwapSession === 'NIGHT' ? 'NIGHT VWAP' : 'VWAP';
  if (state.txChartSeries?.vwap?.applyOptions) {
    state.txChartSeries.vwap.applyOptions({
      title: (vwapWatch ? levelRoleTitle(vwapWatch) : vwapSeriesLabel) + captureCoverageWarning(levels.vwap, true),
      lastValueVisible: levelValue(levels.vwap) != null,
    });
  }
  // The existing VWAP series consumes one label slot; all overlays share the remaining budget.
  const lineBudget = levelValue(levels.vwap) == null ? 3 : 2;
  const drawnPrices = new Set();
  const boundedLevel = (level, title, color, sessionAggregate = false) => {
    const price = levelValue(level);
    if (price == null || drawnPrices.has(price) || state.txChartLevelLines.length >= lineBudget) return;
    drawnPrices.add(price);
    addTxChartLevel(level, title + captureCoverageWarning(level, sessionAggregate), color);
  };
  if (watch?.state === 'READY' && Array.isArray(watch.levels)) {
    const familyColor = {
      VWAP: 'rgba(245,200,107,.58)',
      OPENING_RANGE: 'rgba(138,167,255,.50)',
      SESSION_EXTREME: 'rgba(126,202,190,.46)',
      RECENT_SWING: 'rgba(171,153,219,.42)',
      PRIOR_REFERENCE: 'rgba(139,153,174,.34)',
    };
    for (const entry of watch.levels.slice(0, 3)) {
      if (entry.id === 'VWAP') continue;
      if (!Number.isFinite(Number(entry.price))) continue;
      const isNext = entry.id === nodeId;
      const color = isNext ? (familyColor[entry.family] || 'rgba(205,216,232,.52)') : (familyColor[entry.family] || 'rgba(145,160,181,.34)');
      boundedLevel({ ...entry, availability: 'AVAILABLE', value: Number(entry.price) }, levelRoleTitle(entry), color, entry.family === 'SESSION_EXTREME');
    }
  } else {
    const hasDayLevels = levelValue(levels.currentDayHigh) != null || levelValue(levels.currentDayLow) != null;
    boundedLevel(hasDayLevels ? levels.currentDayHigh : levels.nightHigh, hasDayLevels ? 'DAY H' : 'NIGHT H', 'rgba(85,214,190,.44)', true);
    boundedLevel(hasDayLevels ? levels.currentDayLow : levels.nightLow, hasDayLevels ? 'DAY L' : 'NIGHT L', 'rgba(239,130,147,.44)', true);
  }
  if ($('decision-workspace')?.classList.contains('show-optional-levels')) {
    boundedLevel(levels.openingRangeHigh, 'OR H', 'rgba(138,167,255,.34)');
    boundedLevel(levels.openingRangeLow, 'OR L', 'rgba(138,167,255,.34)');
    boundedLevel(levels.previousDayHigh, '前一日盤高', 'rgba(119,134,156,.28)');
    boundedLevel(levels.previousDayLow, '前一日盤低', 'rgba(119,134,156,.28)');
    boundedLevel(levels.previousClose, '前一日盤收', 'rgba(161,174,192,.28)');
  }
}

function chartSeriesData(payload) {
  const palette = activeCandlePalette();
  const candles = (payload.bars || []).map((bar) => ({
    time: chartEpoch(bar.time), open: finiteNumber(bar.open), high: finiteNumber(bar.high), low: finiteNumber(bar.low), close: finiteNumber(bar.close),
  })).filter((bar) => bar.time != null && [bar.open, bar.high, bar.low, bar.close].every((value) => value != null));
  const volumes = (payload.bars || []).map((bar) => {
    const open = finiteNumber(bar.open);
    const close = finiteNumber(bar.close);
    return {
      time: chartEpoch(bar.time), value: finiteNumber(bar.volume),
      color: open == null || close == null ? 'rgba(131,145,167,.28)' : close >= open ? palette.upVolume : palette.downVolume,
    };
  }).filter((bar) => bar.time != null && bar.value != null);
  const vwap = (payload.vwap || []).map((point) => ({ time: chartEpoch(point.time), value: finiteNumber(point.value) }))
    .filter((point) => point.time != null && point.value != null);
  return { candles, volumes, vwap };
}

function marketChangeMarkerData(feed, timeframe) {
  if (timeframe !== '5m') return [];
  const optionalLevelsVisible = $('decision-workspace')?.classList.contains('show-optional-levels') || false;
  return (feed?.markers || []).filter((marker) => {
    const text = String(marker?.text || '').trim();
    if (/^(?:時段高|時段低|VWAP\s*[↑↓])$/u.test(text)) return false;
    if (!optionalLevelsVisible && /^(?:OR↑|OR↓|OR↩|OR↪)$/u.test(text)) return false;
    return true;
  }).map((marker) => ({
    time: chartEpoch(marker.time),
    position: marker.position,
    color: marker.color,
    shape: marker.shape,
    text: marker.text,
  })).filter((marker) => marker.time != null);
}

window.addEventListener('trader-terminal:palette', (event) => {
  state.txChartPalette = event.detail?.name || 'red-up';
  const palette = activeCandlePalette();
  state.txChartSeries?.candle?.applyOptions({
    upColor: palette.up, downColor: palette.down,
    wickUpColor: palette.up, wickDownColor: palette.down,
  });
  if (state.txChartSeries?.volume && state.txChartPayload) {
    state.txChartSeries.volume.setData(chartSeriesData(state.txChartPayload).volumes);
  }
});

window.addEventListener('trader-terminal:chart-layout', () => {
  window.setTimeout(() => state.txChartApi?.timeScale().fitContent(), 0);
});

window.addEventListener('trader-terminal:levels', () => {
  if (state.txChartPayload) renderTxChartLevels(state.txChartPayload);
  if (state.txChartMarkers && state.txChartPayload) {
    state.txChartMarkers.setMarkers(marketChangeMarkerData(state.marketChangeFeed, state.txChartPayload.timeframe));
  }
});

function marketChangeFactText(fact = {}) {
  const values = [];
  if (fact.close != null && Number.isFinite(Number(fact.close))) values.push(`Close ${fmt(fact.close)}`);
  if (fact.vwap != null && Number.isFinite(Number(fact.vwap))) values.push(`VWAP ${fmt(fact.vwap, 2)}${captureCoverageWarning(fact, true)}`);
  if (fact.openingRangeHigh != null && fact.openingRangeLow != null && Number.isFinite(Number(fact.openingRangeHigh)) && Number.isFinite(Number(fact.openingRangeLow))) {
    values.push(`OR ${fmt(fact.openingRangeLow)}–${fmt(fact.openingRangeHigh)}`);
  }
  if (fact.sessionHigh != null && Number.isFinite(Number(fact.sessionHigh))) values.push(`H ${fmt(fact.sessionHigh)}${captureCoverageWarning(fact, true)}`);
  if (fact.sessionLow != null && Number.isFinite(Number(fact.sessionLow))) values.push(`L ${fmt(fact.sessionLow)}${captureCoverageWarning(fact, true)}`);
  if (fact.dataTrustStatus) values.push(`Data Trust ${fact.dataTrustStatus}`);
  return values.join(' · ') || 'UNAVAILABLE';
}

function marketChangeDetail(label, value, wide = false) {
  const cell = document.createElement('div');
  if (wide) cell.className = 'is-wide';
  const caption = document.createElement('span'); caption.textContent = label;
  const content = document.createElement('strong'); content.textContent = value || 'UNAVAILABLE';
  cell.append(caption, content);
  return cell;
}

function marketChangeGroupKind(group) {
  const groups = group?.evidenceGroups || [];
  if (groups.includes('PRIMARY_STRUCTURE')) return 'PRIMARY_STRUCTURE';
  if (groups.includes('DATA_TRUST')) return 'DATA_TRUST';
  return 'SECONDARY_STRUCTURE';
}

function marketChangeGroupClass(group) {
  const kind = marketChangeGroupKind(group);
  if (kind === 'PRIMARY_STRUCTURE') return 'is-primary-structure';
  if (kind === 'DATA_TRUST') return 'is-data-trust';
  return 'is-secondary-structure';
}

function marketChangeGroupLabel(group) {
  const kind = marketChangeGroupKind(group);
  if (kind === 'PRIMARY_STRUCTURE') return '主要價格結構';
  if (kind === 'DATA_TRUST') return '資料品質事件';
  return '時段高低延伸';
}

function marketChangePresentationText(group) {
  if (group?.presentationType !== 'SESSION_EXTREME_STREAK') {
    return `${group?.events?.map((event) => event.headline).join('、') || 'UNAVAILABLE'} · 品質 ${dw4SummaryLabel(group?.qualityStatus || 'UNKNOWN')}`;
  }
  const context = group.descriptiveContext || {};
  const values = [];
  if (context.previousExtreme != null && context.newExtreme != null) values.push(`${fmt(context.previousExtreme)} → ${fmt(context.newExtreme)}`);
  if (context.absoluteExtension != null) values.push(`延伸 ${fmt(context.absoluteExtension)} 點`);
  if (context.ticksExtension != null) values.push(`${fmt(context.ticksExtension)} ticks`);
  values.push(`${context.streakCount || group.evidenceCount} 次`);
  return values.join(' · ');
}

function renderMarketChangeFeed(feed) {
  state.marketChangeFeed = feed || null;
  const groups = feed?.presentationGroupsLatestFirst || feed?.latestGroupsFirst || [];
  const engineAvailability = feed?.engineAvailability || feed?.status || 'UNAVAILABLE';
  const dataTrust = feed?.dataTrust?.status || 'UNAVAILABLE';
  dwText('dw-change-status', `引擎 ${engineAvailability}`);
  $('dw-change-status').className = `dw-status-pill ${engineAvailability === 'AVAILABLE' ? 'is-ready' : 'is-unavailable'}`;
  dwText('dw-change-trust', `資料 ${dataTrust}`);
  $('dw-change-trust').className = `dw-status-pill ${dataTrust === 'PASS' ? 'is-ready' : 'is-quality'}`;
  dwText('dw-change-reasons', (feed?.dataTrust?.reasons || []).join(' · ') || '無資料品質警告');
  dwText('dw-change-contract', feed?.actualContract ? `${feed.actualContract} · ${feed.session || '—'}` : 'TX —');

  const latestTarget = $('dw-change-latest');
  const latest = groups[0];
  if (latestTarget) {
    if (!latest) {
      const time = document.createElement('time'); time.textContent = '—';
      const body = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = '尚無合法變化事件';
      const summary = document.createElement('p'); summary.textContent = '只比較前後兩根合法完成的 5 分鐘觀察，不讀 forming K 棒。';
      body.append(title, summary); latestTarget.replaceChildren(time, body); latestTarget.className = 'dw-change-latest';
    } else {
      const time = document.createElement('time'); time.textContent = timeLabel(latest.observedAt);
      const body = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = latest.headline;
      const groupLabel = document.createElement('span'); groupLabel.className = 'dw-event-kind'; groupLabel.textContent = marketChangeGroupLabel(latest);
      const summary = document.createElement('p'); summary.textContent = marketChangePresentationText(latest);
      body.append(groupLabel, title, summary); latestTarget.replaceChildren(time, body);
      latestTarget.className = `dw-change-latest ${marketChangeGroupClass(latest)}`;
      latestTarget.classList.toggle('is-quality', latest.qualityStatus !== 'PASS');
    }
  }

  const timeline = $('dw-evidence-timeline');
  if (timeline) {
    if (!groups.length) {
      const empty = document.createElement('li'); empty.className = 'is-empty'; empty.textContent = '目前沒有可顯示的 governed event';
      timeline.replaceChildren(empty);
    } else {
      timeline.replaceChildren(...groups.slice(0, 12).map((group) => {
        const row = document.createElement('li'); row.className = marketChangeGroupClass(group);
        if (group.qualityStatus !== 'PASS') row.classList.add('is-quality');
        const at = document.createElement('time'); at.textContent = timeLabel(group.observedAt);
        const dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong'); title.textContent = group.headline;
        const context = document.createElement('small'); context.textContent = `${marketChangeGroupLabel(group)} · ${group.evidenceCount} 項`;
        row.append(at, dot, title, context); return row;
      }));
    }
  }

  const cards = $('dw-evidence-cards');
  if (cards) {
    if (!groups.length) {
      const empty = document.createElement('p'); empty.className = 'is-empty'; empty.textContent = '等待完成的 5 分鐘證據。';
      cards.replaceChildren(empty);
    } else {
      cards.replaceChildren(...groups.slice(0, 8).map((group, index) => {
        const card = document.createElement('details'); card.className = `dw-evidence-card ${marketChangeGroupClass(group)}`;
        card.open = index === 0 && marketChangeGroupKind(group) === 'PRIMARY_STRUCTURE';
        const summary = document.createElement('summary');
        const heading = document.createElement('span');
        const title = document.createElement('strong'); title.textContent = group.headline;
        const startedAt = group.startedAt && group.startedAt !== group.observedAt ? `${timeLabel(group.startedAt)}–` : '';
        const sub = document.createElement('small'); sub.textContent = `${startedAt}${timeLabel(group.observedAt)} · ${group.actualContract} · ${marketChangeGroupLabel(group)}`;
        heading.append(title, sub);
        const trust = document.createElement('span'); trust.className = 'dw-evidence-trust'; trust.textContent = group.qualityStatus;
        summary.append(heading, trust);
        const detail = document.createElement('div'); detail.className = 'dw-evidence-detail';
        if (group.presentationType === 'SESSION_EXTREME_STREAK') {
          const context = group.descriptiveContext || {};
          detail.append(
            marketChangeDetail('前一時段高／低', context.previousExtreme == null ? 'UNAVAILABLE' : fmt(context.previousExtreme)),
            marketChangeDetail('最新時段高／低', context.newExtreme == null ? 'UNAVAILABLE' : fmt(context.newExtreme)),
            marketChangeDetail('價格延伸', context.absoluteExtension == null ? 'UNAVAILABLE' : `${fmt(context.absoluteExtension)} 點`),
            marketChangeDetail('Ticks 延伸', context.ticksExtension == null ? 'UNAVAILABLE' : fmt(context.ticksExtension)),
            marketChangeDetail('顯示群組', `${context.streakCount || group.evidenceCount} 個原始事件；presentation only`, true),
          );
        }
        const evidenceList = document.createElement('ul'); evidenceList.className = 'dw-evidence-items';
        evidenceList.replaceChildren(...group.events.map((event) => {
          const item = document.createElement('li');
          const label = document.createElement('strong'); label.textContent = event.headline;
          const code = document.createElement('code'); code.textContent = event.eventType;
          item.append(label, code); return item;
        }));
        detail.append(evidenceList);
        for (const event of group.events) {
          const technical = document.createElement('details'); technical.className = 'dw-evidence-technical';
          const technicalSummary = document.createElement('summary'); technicalSummary.textContent = `${event.headline} · 技術詳情`;
          const technicalBody = document.createElement('div'); technicalBody.className = 'dw-evidence-technical-body';
          technicalBody.append(
            marketChangeDetail('Previous', marketChangeFactText(event.sourceFacts?.previous)),
            marketChangeDetail('Current', marketChangeFactText(event.sourceFacts?.current)),
            marketChangeDetail('availableAt', event.availableAt),
            marketChangeDetail('Data Trust', `${event.qualityStatus}${event.qualityReasons?.length ? ` · ${event.qualityReasons.join(', ')}` : ''}`),
            marketChangeDetail('Sources', (event.sourceIds || []).join(', '), true),
            marketChangeDetail('Derivation Version', event.derivationVersion, true),
          );
          technical.append(technicalSummary, technicalBody); detail.append(technical);
        }
        card.append(summary, detail); return card;
      }));
    }
  }
  if (state.txChartMarkers && state.txChartPayload) {
    state.txChartMarkers.setMarkers(marketChangeMarkerData(state.marketChangeFeed, state.txChartPayload.timeframe));
  }
}

function renderTxDecisionChart(payload, { fit = false, replaceData = false } = {}) {
  state.txChartPayload = payload;
  renderDecisionLevelWatch(state.levelWatch);
  renderObservedFlow(flowChannel.view());
  const chartReason = payload?.reason || 'TX_CHART_UNAVAILABLE';
  const chartUnavailable = terminalUnavailable(chartReason);
  dwText('dw-chart-session', payload?.session || chartUnavailable);
  dwText('dw-chart-contract', payload?.actualContract ? `TX ${payload.actualContract}` : chartUnavailable);
  renderTxChartFreshness(payload);
  const chartLastPrice = finiteNumber(payload?.lastPrice);
  dwText('dw-reference-price', chartLastPrice == null ? chartUnavailable : fmt(chartLastPrice), chartUnavailable);
  const chart = ensureTxChart();
  renderTxChartLevels(payload);
  if ($('decision-workspace')?.dataset.dashboardLoadState !== 'UNAVAILABLE') {
    renderMarketPulse(state.decisionWorkspace, payload);
    renderTerminalShell(state.decisionWorkspace, payload);
  }

  const payloadEligible = ['READY', 'FORMING', 'QUALITY_INSUFFICIENT'].includes(payload?.status) && payload?.bars?.length > 0;
  let visibleRenderReady = false;
  let visibleFailureReason = payload?.reason || 'TX_TICK_SOURCE_UNAVAILABLE';
  if (!chart || !state.txChartSeries) {
    visibleFailureReason = state.txChartRuntimeReason || 'CHART_RENDER_INITIALIZATION_FAILED';
  }
  const data = chartSeriesData(payload || {});
  const dataEligible = payloadEligible && data.candles.length > 0;
  if (payloadEligible && !dataEligible) visibleFailureReason = 'CHART_VALID_CANDLES_UNAVAILABLE';
  const identity = `${payload?.timeframe}|${payload?.tradeDate}|${payload?.sessionId}|${payload?.actualContract}`;
  const mustReset = replaceData || !dataEligible || state.txChartIdentity !== identity || data.candles.length < state.txChartBarCount;
  if (chart && state.txChartSeries) {
    try {
      if (mustReset) {
        state.txChartSeries.candle.setData(dataEligible ? data.candles : []);
        state.txChartSeries.volume.setData(dataEligible ? data.volumes : []);
        state.txChartSeries.vwap.setData(dataEligible ? data.vwap : []);
      } else if (data.candles.length) {
        state.txChartSeries.candle.update(data.candles.at(-1));
        if (data.volumes.length) state.txChartSeries.volume.update(data.volumes.at(-1));
        if (data.vwap.length) state.txChartSeries.vwap.update(data.vwap.at(-1));
      }
      if (state.txChartMarkers) state.txChartMarkers.setMarkers(dataEligible ? marketChangeMarkerData(state.marketChangeFeed, payload?.timeframe) : []);
      state.txChartIdentity = dataEligible ? identity : null;
      state.txChartBarCount = dataEligible ? data.candles.length : 0;
      state.txChartVolumeCount = dataEligible ? data.volumes.length : 0;
      if ((mustReset || fit) && dataEligible) chart.timeScale().fitContent();
      visibleRenderReady = dataEligible;
    } catch {
      state.txChartIdentity = null;
      state.txChartBarCount = 0;
      state.txChartVolumeCount = 0;
      visibleFailureReason = 'CHART_SERIES_WRITE_FAILED';
    }
  }
  const visibleStatus = visibleRenderReady
    ? payload.status
    : payloadEligible ? terminalUnavailable(visibleFailureReason) : payload?.status && payload.status !== 'UNAVAILABLE' ? payload.status : chartUnavailable;
  dwText('dw-chart-status', visibleStatus);
  $('dw-chart-status').className = `dw-status-pill ${visibleRenderReady && payload?.status === 'READY' ? 'is-ready' : 'is-unavailable'}`;
  $('dw-chart-empty').classList.toggle('hidden', visibleRenderReady);
  dwText('dw-chart-empty-reason', dwHumanize(visibleFailureReason));
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
  return { visibleRenderReady, reason: visibleRenderReady ? null : visibleFailureReason };
}

async function loadTxDecisionChart({ fit = false } = {}) {
  if (state.decisionCaptureBusy) return;
  if (state.txChartPayload) renderTxChartFreshness(state.txChartPayload);
  if (state.txChartLoading) {
    state.txChartPendingFit = state.txChartPendingFit || fit;
    if (state.txChartRequestTimeframe && state.txChartRequestTimeframe !== state.txChartTimeframe) {
      state.txChartAbortController?.abort('CHART_REQUEST_SUPERSEDED');
    }
    return;
  }
  const requestId = ++state.txChartRequestId;
  const timeframe = state.txChartTimeframe;
  const sessionToken = state.csrfToken;
  state.txChartLoading = true;
  state.txChartRequestTimeframe = timeframe;
  const controller = new AbortController();
  state.txChartAbortController = controller;
  if (state.txChartPayload) renderTxChartFreshness(state.txChartPayload);
  else {
    dwText('dw-chart-status', `${timeframe} 載入中`);
    $('dw-chart-canvas')?.setAttribute('aria-busy', 'true');
  }
  // Bound the whole request, including a stalled response body. The abort also releases fetch.
  const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () => {
    reject(new Error(controller.signal.reason === 'CHART_REQUEST_SUPERSEDED' ? 'CHART_REQUEST_SUPERSEDED' : 'CHART_REQUEST_TIMEOUT'));
  }, { once: true }));
  const timer = setTimeout(() => controller.abort('CHART_REQUEST_TIMEOUT'), 10_000);
  const params = new URLSearchParams({ timeframe, mode: 'LIVE' });
  let retryTimer = null, auditIdentity = null;
  try {
    // Only an explicit frozen audit is continued, within this operation's one
    // deadline. Ordinary input warmup still belongs to the existing 5s poll.
    while (!controller.signal.aborted) {
      if (sessionToken !== state.csrfToken || state.decisionCaptureBusy
          || requestId !== state.txChartRequestId || timeframe !== state.txChartTimeframe) return;
      const payload = await Promise.race([api(`/api/v1/tx-chart?${params}`, { signal: controller.signal, cache: 'no-store' }), cancelled]);
      if (requestId !== state.txChartRequestId || timeframe !== state.txChartTimeframe || sessionToken !== state.csrfToken) return;
      const chart = payload.data;
      if (chart?.timeframe !== timeframe) throw new Error('CHART_RESPONSE_TIMEFRAME_MISMATCH');
      const identity = JSON.stringify([chart.tradeDate, chart.actualContract, chart.session, chart.sessionId, chart.continuityEpoch, chart.asOf]);
      if (auditIdentity !== null && (identity !== auditIdentity || !['PENDING','COMPLETE'].includes(chart.sourceAuditProgress?.state)))
        throw new Error('CHART_AUDIT_RESPONSE_MISMATCH');
      if (chart.sourceAuditProgress && (!Number.isFinite(Date.parse(chart.asOf)) || chart.sourceAuditProgress.cutoff !== chart.asOf))
        throw new Error('CHART_AUDIT_RESPONSE_MISMATCH');
      state.homeChartError = null;
      renderTxDecisionChart(chart, { fit });
      if (chart.sourceAuditProgress?.state !== 'PENDING') break;
      auditIdentity = identity;
      await Promise.race([new Promise(resolve => { retryTimer = setTimeout(resolve, 250); }), cancelled]);
      clearTimeout(retryTimer); retryTimer = null;
    }
  } catch (error) {
    if (requestId !== state.txChartRequestId || timeframe !== state.txChartTimeframe || sessionToken !== state.csrfToken) return;
    if (controller.signal.reason === 'CHART_REQUEST_SUPERSEDED') return;
    state.homeChartError = error?.message || 'CHART_REFRESH_FAILED';
    if (state.txChartPayload) renderTxChartFreshness(state.txChartPayload);
    else renderTxDecisionChart({ timeframe, mode: 'LIVE', status: 'UNAVAILABLE', reason: state.homeChartError, bars: [], levels: {} });
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    state.txChartLoading = false;
    state.txChartAbortController = null;
    state.txChartRequestTimeframe = null;
    $('dw-chart-canvas')?.setAttribute('aria-busy', 'false');
    if (state.txChartPayload) renderTxChartFreshness(state.txChartPayload);
    if (controller.signal.reason === 'CHART_REQUEST_SUPERSEDED' || requestId !== state.txChartRequestId || timeframe !== state.txChartTimeframe) {
      const pendingFit = state.txChartPendingFit;
      state.txChartPendingFit = false;
      await loadTxDecisionChart({ fit: pendingFit });
    }
  }
}

// Returns only a candidate's own binding. The server independently verifies
// this before normalizing a proof; a formal/old frame cannot be relabeled.
function marketCandidateBrowserBinding(version, location) {
  if (version?.previewType !== 'CRU21_MARKET_RESEARCH_CANDIDATE'
      || version.releaseScope !== 'MARKET_RESEARCH_AI_DISABLED_CANDIDATE'
      || version.branch !== 'codex/cru61-smc-cvd-profile-v1'
      || version.aiEnabled !== false || version.complete !== false || version.deliveryAccepted !== false
      || !/^[a-f0-9]{40}$/.test(version.exactHead || '') || version.exactHead !== version.runtimeCommit
      || version.exactHead !== version.buildCommit || !/^[a-f0-9]{40}$/.test(version.exactTree || '')
      || version.exactTree !== version.runtimeTree || version.exactTree !== version.buildTree
      || !Number.isFinite(Date.parse(version.runtimeStartedAt))
      || location?.origin !== 'https://127.0.0.1:18723') return null;
  return {candidateScope:version.releaseScope,previewType:version.previewType,origin:location.origin,
    exactHead:version.exactHead,exactTree:version.exactTree,runtimeStartedAt:version.runtimeStartedAt};
}

async function reportCru46BrowserRuntimeProof(service = null) {
  const version = state.decisionWorkspace?.runtimeVersion;
  const marketCandidateBinding = marketCandidateBrowserBinding(version, window.location);
  const isPreview = ['INTEGRATION_OWNER_PREVIEW', 'CRU44_OWNER_PREVIEW', 'CRU21_OWNER_PREVIEW'].includes(version?.previewType);
  const isFormalRuntime = !version?.previewType && version?.syncState === 'SYNCED'
    && /^[0-9a-f]{40}$/.test(version?.runtimeCommit || '')
    && version.runtimeCommit === version.approvedMainCommit
    && window.location?.hostname === '127.0.0.1' && window.location?.port === '8787';
  const isReaderCandidate = service?.candidateReadOnly === true && !version?.previewType
    && /^[0-9a-f]{40}$/.test(version?.runtimeCommit || '')
    && typeof version?.runtimeStartedAt === 'string'
    && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(version.runtimeStartedAt)
    && Number.isFinite(Date.parse(version.runtimeStartedAt))
    && window.location?.hostname === '127.0.0.1' && window.location?.port === '18723';
  if (!isPreview && !isFormalRuntime && !isReaderCandidate && !marketCandidateBinding) return;
  const target = $('dw-chart-canvas');
  const rect = target?.getBoundingClientRect();
  const api = window.LightweightCharts;
  const flow = lastObservedFlowValue;
  const visible = (element) => Boolean(element && element.offsetParent !== null && element.getClientRects().length);
  const chartStatus = $('dw-chart-status');
  const homeView = globalThis.HomeWorkspace ? renderHomeWorkspace() : null;
  const flow1m = $('dw-flow-tab-1m');
  const flow5m = $('dw-flow-tab-5m');
  const flow15m = $('dw-flow-tab-15m');
  const flow30m = $('dw-flow-tab-30m');
  const flow1h = $('dw-flow-tab-1h');
  const flow4h = $('dw-flow-tab-4h');
  await apiRequestCru46Proof({
    ...marketCandidateBinding,
    lightweightChartsApiMajor: typeof api?.createChart === 'function' && api?.CandlestickSeries && api?.HistogramSeries ? 5 : null,
    canvasCount: target?.querySelectorAll('canvas').length || 0,
    chartWidth: Math.round(rect?.width || 0),
    chartHeight: Math.round(rect?.height || 0),
    candleCount: state.txChartBarCount,
    volumeCount: state.txChartVolumeCount,
    chartStatusVisible: visible(chartStatus) && (homeView
      ? homeView.chartCurrent && chartStatus?.dataset.sourceStatus === state.txChartPayload?.status && chartStatus?.textContent === homeView.chartLabel
      : chartStatus?.textContent === state.txChartPayload?.status),
    observedFlow1m: Boolean(flow?.windows?.primary60s && flow.windows.primary60s.status !== 'UNAVAILABLE' && visible(flow1m)),
    observedFlow5m: Boolean(flow?.windows?.context300s && flow.windows.context300s.status !== 'UNAVAILABLE' && visible(flow5m)),
    observedFlow15m: Boolean(flow?.windows?.window900s
      && (flow.windows.window900s.status !== 'UNAVAILABLE' || flow.windows.window900s.truthState === 'WARMING_UP')
      && visible(flow15m)),
    observedFlow30m: Boolean(flow?.windows?.window1800s
      && (flow.windows.window1800s.status !== 'UNAVAILABLE' || flow.windows.window1800s.truthState === 'WARMING_UP')
      && visible(flow30m)),
    observedFlow1h: Boolean(flow?.windows?.window3600s
      && (flow.windows.window3600s.status !== 'UNAVAILABLE' || flow.windows.window3600s.truthState === 'WARMING_UP')
      && visible(flow1h)),
    observedFlow4h: Boolean(flow?.windows?.window14400s
      && (flow.windows.window14400s.status !== 'UNAVAILABLE' || flow.windows.window14400s.truthState === 'WARMING_UP')
      && visible(flow4h)),
  });
}

async function apiRequestCru46Proof(body) {
  try {
    await api('/api/v1/cru46-browser-runtime-proof', { method: 'POST', body: JSON.stringify(body) });
  } catch { /* health stays fail-closed; acceptance tooling reads the reason */ }
}

function renderDecisionWorkspace(workspace, { captured = false } = {}) {
  workspace = workspace ? { ...workspace, observedFlow: captured ? workspace.observedFlow : flowChannel.view() } : null;
  state.decisionWorkspace = workspace;
  renderDecisionCaptureStatus();
  const global = workspace?.globalStatus || {};
  const decision = workspace?.decisionSummary || {};
  const chart = workspace?.priceChartSlot || {};
  const forward = workspace?.forwardShadowStatus || {};
  dwText('dw-global-mode', dwHumanize(global.mode));
  dwText('dw-global-contract', global.actualContract ? `契約 ${global.actualContract}` : '契約目前無法取得');
  const operating = workspace?.marketOperating;
  const closed = operating?.state === 'MARKET_CLOSED';
  dwText('dw-global-session', closed
    ? `休市 · ${dwHumanize(operating.reasonCode)}（歷史資料保留）`
    : operating?.state === 'UNAVAILABLE' ? '開休市日曆未驗證'
    : global.session ? `時段 ${global.session}` : '時段目前無法取得');
  dwText('dw-global-trade-date', global.tradeDate ? `交易日 ${global.tradeDate}` : '交易日目前無法取得');
  dwText('dw-global-time', global.asOf ? `截至 ${timeLabel(global.asOf)}` : '截至時間目前無法取得');
  dwText('dw-global-posture', decision.posture === 'MANUAL_REVIEW_ONLY' ? '僅供人工判讀' : '系統不提供交易方向');
  dwText('dw-global-readiness', global.decisionReadiness || decision.readiness || 'UNAVAILABLE');
  $('dw-global-readiness').className = `dw-status-pill ${healthTone(global.decisionReadiness || decision.readiness)}`;
  dwText('dw-global-health', `資料 ${dwHumanize(global.dataHealth || 'UNAVAILABLE')}`);
  $('dw-global-health').className = `dw-status-pill ${healthTone(global.dataHealth)}`;
  dwText('dw-global-trust', `資料信任 ${dw4SummaryLabel(workspace?.evidenceConflict?.dataTrustState || 'BLOCKED')}`);
  $('dw-global-trust').className = `dw-status-pill ${healthTone(workspace?.evidenceConflict?.dataTrustState)}`;
  dwText('dw-global-counts', `${global.staleCount || 0} 項過期 · ${global.unavailableCount || 0} 項無法取得`);
  renderRuntimeVersion(workspace?.runtimeVersion);

  dwText('dw-forward-status-value', forward.status || 'UNKNOWN');
  dwText('dw-forward-reason-summary', forward.reasonSummary || '證據不足，無法判定');
  dwText('dw-forward-trade-date', `最近正式紀錄：${forward.tradeDate || '—'} · ${forward.status || 'UNKNOWN'}`);
  dwText('dw-forward-timing', `預期 ${forward.expectedAt ? timeLabel(forward.expectedAt) : '—'} · 觀測 ${forward.observedAt ? timeLabel(forward.observedAt) : '—'}`);
  dwText('dw-forward-stage', `最後成功階段 ${forward.lastSuccessfulStage || '—'} · 失敗階段 ${forward.failedStage || '—'}`);
  dwText('dw-forward-evidence', `證據來源 ${forward.evidenceSource || 'UNAVAILABLE'} · Data Trust ${forward.dataTrust || 'UNAVAILABLE'}`);
  dwText('dw-forward-reason-code', forward.reasonCode || 'NONE');

  dwText('dw-posture', decision.posture === 'MANUAL_REVIEW_ONLY' ? '僅供人工判讀' : '系統不提供交易方向');
  dwText('dw-readiness', decision.readiness || 'NOT_READY');
  $('dw-readiness').className = `dw-status-pill ${healthTone(decision.readiness)}`;
  dwText('dw-no-trade-reason', dwHumanize(decision.noTradeReason || 'DATA_INSUFFICIENT'));
  dwText('dw-decision-explanation', decision.explanation);
  dwText('dw-direction', decision.direction);
  dwText('dw-global-alignment', decision.globalAlignment);
  dwText('dw-risk', decision.risk);
  dwText('dw-entry-quality', decision.entryQuality);
  dwText('dw-contrary-evidence', availabilityLabel(decision.strongestContraryEvidence));
  dwText('dw-contrary-reason', dwHumanize(decision.strongestContraryEvidence?.reason));
  const currentFacts = workspace?.currentMarketFactSummary || {};
  dwText('dw-now-price-fact', currentFacts.priceStructureFact || '目前沒有新的 governed 盤中結構事件。');
  dwText('dw-now-evidence-fact', currentFacts.evidenceEligibilityFact || '目前沒有符合方向彙總資格的證據家族。');
  dwText('dw-now-trust-fact', `完整度：${dw4SummaryLabel(currentFacts.coverageState || 'INSUFFICIENT')} · 資料信任：${dw4SummaryLabel(currentFacts.dataTrustState || 'BLOCKED')}`);
  renderDw4Evidence(workspace?.evidenceConflict);
  renderMarketPulse(workspace, state.txChartPayload || chart);
  renderObservedFlow(workspace?.observedFlow);
  renderTerminalShell(workspace, state.txChartPayload || chart);
  renderLiveMarketPulse(workspace?.marketPulse);
  renderIndexLeadership(workspace?.indexLeadership);
  renderDecisionLevelWatch(workspace?.levelWatch);

  const compactCapabilityValues = [decision.direction, decision.globalAlignment, decision.risk, decision.entryQuality, decision.strongestContraryEvidence?.availability];
  $('dw-focus-mode')?.classList.toggle('is-capability-limited', compactCapabilityValues.every((value) => !value || ['UNAVAILABLE', 'NOT_IMPLEMENTED'].includes(value)));

  // A rendered chart owns its visible status; payload readiness cannot replace a render failure.
  if (!state.txChartPayload) dwText('dw-chart-status', dwHumanize(chart.status || 'NOT_IMPLEMENTED'));
  const reference = chart.price?.availability === 'AVAILABLE' ? fmt(chart.price.value) : null;
  terminalWrite('dw-reference-price', reference, { reason: chart.price?.reason || chart.reason || 'PRICE_REFERENCE_UNAVAILABLE' });
  for (const [id, field, fallback] of [
    ['dw-or-state', chart.OR, 'OPENING_RANGE_UNAVAILABLE'],
    ['dw-vwap-state', chart.VWAP, 'VWAP_UNAVAILABLE'],
  ]) {
    const label = availabilityLabel(field);
    const value = label && label !== 'UNAVAILABLE' ? label : null;
    terminalWrite(id, value != null && id === 'dw-vwap-state' && field?.availability === 'AVAILABLE'
      ? `${value}${captureCoverageWarning(field, true)}` : value, { reason: field?.reason || fallback });
  }

  renderPlainList('dw-support-list', workspace?.againstMyTrade?.support, 'NOT_IMPLEMENTED');
  renderPlainList('dw-against-list', workspace?.againstMyTrade?.against, 'NOT_IMPLEMENTED');
  renderPlainList('dw-missing-list', workspace?.againstMyTrade?.missingEvidence, '無可用反證衍生資料');
  renderMarketChangeFeed(workspace?.whatChanged);

  const healthTarget = $('dw-health-list');
  const healthItems = workspace?.snapshot?.dataHealth?.items || [];
  const rows = healthItems.map((item) => {
    const row = document.createElement('article'); row.className = 'dw-health-row';
    const name = document.createElement('strong'); name.textContent = item.sourceId === 'shioajiContinuity' ? 'Shioaji 即時行情持續性' : item.sourceId;
    const status = document.createElement('span'); status.textContent = item.freshnessState;
    const contract = document.createElement('span'); contract.textContent = item.actualContract || item.instrument || item.sourceType;
    const reason = document.createElement('small'); reason.textContent = `技術詳情：${item.sourceAvailability} · ${item.readinessState}${item.reason ? ` · ${dwHumanize(item.reason)} (${item.reason})` : ''}`;
    row.append(name, status, contract, reason);
    return row;
  });
  if (healthTarget) healthTarget.replaceChildren(...rows);
}

function renderJournalHistory(rows, outcomes = []) {
  const target = $('dw-journal-history');
  if (!target) return;
  const dirty = target._journalDirty || (target._journalDirty = new Set());
  const pending = target._journalPending || (target._journalPending = new Set());
  // Background reads must not discard personal drafts or unlock an active append.
  if (dirty.size || pending.size) return;
  if (!rows?.length) {
    const empty = document.createElement('p'); empty.textContent = '尚無人工決策紀錄。'; target.replaceChildren(empty); return;
  }
  const nodes = rows.map((entry) => {
    const row = document.createElement('article');
    const time = document.createElement('span'); time.textContent = timeLabel(entry.recordedAt);
    const intent = document.createElement('strong'); intent.textContent = entry.intent;
    const reason = document.createElement('span'); reason.textContent = entry.reason || entry.setup || '未填寫說明';
    const hash = document.createElement('code'); hash.textContent = typeof entry.snapshotHash === 'string' ? `${entry.snapshotHash.slice(0, 10)}…` : '快照雜湊不可用';
    const details = document.createElement('details'); details.className = 'dw-journal-snapshot';
    const summary = document.createElement('summary'); summary.textContent = '查看當時快照（摘要）';
    const notice = document.createElement('p'); notice.textContent = '歷史快照・非即時・唯讀，不代表結果回顧或交易建議。';
    details.append(summary, notice);
    const valueText = value => value == null || value === '' || !['string', 'number', 'boolean'].includes(typeof value)
      || (typeof value === 'number' && !Number.isFinite(value)) ? '不可用' : String(value);
    const line = (label, value) => {
      const text = document.createElement('p'); text.textContent = `${label}：${valueText(value)}`; details.append(text);
    };
    line('快照雜湊', entry.snapshotHash);
    const snapshot = entry.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      const unavailable = document.createElement('p'); unavailable.textContent = '原始快照不可用；不以目前盤況代替。'; details.append(unavailable);
    } else {
      line('快照時間', snapshot.snapshotTime);
      if (snapshot.marketObservation) {
        const observation = snapshot.marketObservation;
        line('整合快照', observation.snapshotId); line('觀測截至', observation.cutoff);
        line('成交位置', observation.summary?.position); line('成交力道', observation.summary?.force);
        line('結構', observation.summary?.structure); line('反證', observation.summary?.counterEvidence);
        line('資料狀態', observation.summary?.dataStatus);
      }
      line('契約', snapshot.contract); line('盤別', snapshot.session); line('交易日', snapshot.tradeDate);
      line('價格', snapshot.price?.value); line('價格來源時間', snapshot.price?.availableAt);
      line('價格狀態', snapshot.price?.availability); line('價格限制', snapshot.price?.reason);
      line('OR 高', snapshot.OR?.value?.high); line('OR 低', snapshot.OR?.value?.low);
      line('OR 狀態', snapshot.OR?.availability); line('OR 限制', snapshot.OR?.reason);
      line('VWAP', snapshot.VWAP?.value); line('VWAP 狀態', snapshot.VWAP?.availability); line('VWAP 限制', snapshot.VWAP?.reason);
      line('Market State 方向', snapshot.marketState?.direction); line('Market State 限制', snapshot.marketState?.reason);
      line('Flow 來源狀態', snapshot.observedFlow?.sourceState);
      line('Flow 來源時間', snapshot.observedFlow?.source?.availableAt);
      for (const [label, key] of [['1分', 'primary60s'], ['5分', 'context300s']]) {
        const window = snapshot.observedFlow?.windows?.[key];
        line(`${label} Flow 比率`, window?.pressure?.pressureRatio);
        line(`${label} 分類覆蓋`, window?.pressure?.classifiedCoverage);
        line(`${label} 價格反應`, window?.response?.displacementPoints);
        line(`${label} Flow 狀態`, window?.status);
      }
      line('資料品質', snapshot.dataHealth?.overall);
      for (const item of (Array.isArray(snapshot.dataHealth?.items) ? snapshot.dataHealth.items : [])) {
        line(`來源 ${valueText(item?.sourceId)}`, [valueText(item?.freshnessState), valueText(item?.quality), valueText(item?.reason)].join(' · '));
      }
    }
    const confidenceLabels = { LOW: '低', MEDIUM: '中', HIGH: '高' };
    const executionLabels = { UNKNOWN: '未知', EXECUTED: '已執行', NOT_EXECUTED: '未執行' };
    const thesisLabels = { UNKNOWN: '未知', FOLLOWED: '已遵守', VIOLATED: '未遵守', NOT_APPLICABLE: '不適用' };
    const personal = document.createElement('p'); personal.className = 'dw-journal-personal';
    personal.textContent = `原始自評信心：${confidenceLabels[entry.confidence] || '未填'}（非勝率） · 原始是否執行：${executionLabels[entry.executionStatus] || '未知'}`;
    const result = document.createElement('details'); result.className = 'dw-journal-outcomes';
    const resultTitle = document.createElement('summary'); resultTitle.textContent = '人工結果與執行紀錄';
    const resultNotice = document.createElement('p'); resultNotice.textContent = '僅人工追加，不修改原決策或快照；不計算績效、MAE/MFE或交易建議。只列近期20筆決策相關的最新200筆結果；未列出不代表從未記錄。';
    const history = document.createElement('div');
    const relatedResults = items => (Array.isArray(items) ? items : []).filter(item => item.decisionRecordHash === entry.recordHash && item.snapshotHash === entry.snapshotHash)
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const linked = relatedResults(outcomes);
    const resultText = item => {
      const text = document.createElement('p');
      text.textContent = `${timeLabel(item.recordedAt)} · 是否執行：${executionLabels[item.executionStatus] || '未知'} · 原判斷／條件是否遵守：${thesisLabels[item.thesisStatus] || '未知'} · ${item.outcomeNote || '未填結果說明'}`;
      return text;
    };
    if (linked.length) history.append(...linked.map(resultText));
    else { const empty = document.createElement('p'); empty.textContent = '本次讀取未列出人工結果；不代表從未記錄，請勿據此重送。'; history.append(empty); }
    result.append(resultTitle, resultNotice, history);
    if (/^[a-f0-9]{64}$/.test(entry.recordHash || '')) {
      const form = document.createElement('form'); form.className = 'dw-journal-outcome-form';
      const select = (name, title, labels) => {
        const label = document.createElement('label'); label.textContent = title;
        const field = document.createElement('select'); field.name = name;
        for (const [value, text] of Object.entries(labels)) {
          const option = document.createElement('option'); option.value = value; option.textContent = text; field.append(option);
        }
        field.value = 'UNKNOWN'; label.append(field); form.append(label); return field;
      };
      const execution = select('executionStatus', '是否執行（自行登錄）', executionLabels);
      const thesis = select('thesisStatus', '原判斷／條件是否遵守（自行登錄）', thesisLabels);
      const noteLabel = document.createElement('label'); noteLabel.className = 'dw-journal-outcome-note'; noteLabel.textContent = '結果說明（自行觀察，不計算損益）';
      const note = document.createElement('textarea'); note.name = 'outcomeNote'; note.maxLength = 1000; note.rows = 3;
      noteLabel.append(note); form.append(noteLabel);
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = '追加人工結果';
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary'; clear.textContent = '清除未送出內容';
      const recover = document.createElement('button'); recover.type = 'button'; recover.className = 'secondary'; recover.name = 'recoverOutcome'; recover.textContent = '查回已存結果';
      const feedback = document.createElement('p'); feedback.setAttribute('role', 'status');
      const markDirty = () => {
        if (execution.value !== 'UNKNOWN' || thesis.value !== 'UNKNOWN' || note.value) dirty.add(entry.recordHash);
        else dirty.delete(entry.recordHash);
      };
      execution.addEventListener('change', markDirty); thesis.addEventListener('change', markDirty); note.addEventListener('input', markDirty);
      clear.addEventListener('click', () => {
        if (pending.has(entry.recordHash)) return;
        note.value = ''; execution.value = 'UNKNOWN'; thesis.value = 'UNKNOWN'; markDirty(); feedback.textContent = '未送出內容已清除；原紀錄保持不變。';
      });
      recover.addEventListener('click', async () => {
        if (pending.has(entry.recordHash) || recover.disabled) return;
        recover.disabled = true; submit.disabled = true; clear.disabled = true; pending.add(entry.recordHash);
        try {
          const payload = await api('/api/v1/decision-journal?limit=20');
          if (!payload.data?.some(item => item.recordHash === entry.recordHash)) throw new Error('DECISION_NOT_IN_RECENT_HISTORY');
          target._journalLoadTicket = (target._journalLoadTicket || 0) + 1;
          const saved = relatedResults(payload.outcomes);
          linked.splice(0, linked.length, ...saved);
          history.replaceChildren(...saved.map(resultText));
          if (!saved.length) { const empty = document.createElement('p'); empty.textContent = '本次查回未列出結果，不表示從未記錄；保留未送出內容。'; history.append(empty); }
          feedback.textContent = '已查回本次可見結果（最多200筆），可能不完整；請核對時間與內容，未自動重送或清除草稿。';
        } catch (error) { feedback.textContent = `結果尚無法確認，保留草稿且不重送。原因：${error.message}`; }
        finally { recover.disabled = false; submit.disabled = false; clear.disabled = false; pending.delete(entry.recordHash); }
      });
      form.append(submit, clear, recover, feedback);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled || pending.has(entry.recordHash)) return;
        markDirty();
        if (execution.value === 'UNKNOWN' && thesis.value === 'UNKNOWN' && !note.value.trim()) {
          feedback.textContent = '請選擇一項結果或填寫說明；不會把未知補成結果。'; return;
        }
        submit.disabled = true; clear.disabled = true; recover.disabled = true; execution.disabled = true; thesis.disabled = true; note.disabled = true; pending.add(entry.recordHash);
        try {
          const payload = await api('/api/v1/decision-journal/outcomes', { method: 'POST', body: JSON.stringify({
            decisionRecordHash: entry.recordHash, executionStatus: execution.value, thesisStatus: thesis.value, outcomeNote: note.value,
          }) });
          const saved = payload.data;
          if (!saved || saved.decisionRecordHash !== entry.recordHash || saved.snapshotHash !== entry.snapshotHash) throw new Error('OUTCOME_RESPONSE_IDENTITY_MISMATCH');
          // Reject any history GET that began before this append completed.
          target._journalLoadTicket = (target._journalLoadTicket || 0) + 1;
          if (!linked.length) history.replaceChildren();
          linked.push(saved); history.append(resultText(saved));
          note.value = ''; execution.value = 'UNKNOWN'; thesis.value = 'UNKNOWN'; markDirty();
          feedback.textContent = '已追加人工結果；原決策及快照保持不變。';
        } catch (error) { feedback.textContent = `尚未確認追加結果，沒有自動重送；請先查回已存結果再決定。原決策保持不變。原因：${error.message}`; }
        finally { submit.disabled = false; clear.disabled = false; recover.disabled = false; execution.disabled = false; thesis.disabled = false; note.disabled = false; pending.delete(entry.recordHash); }
      });
      result.append(form);
    } else {
      const unavailable = document.createElement('p'); unavailable.textContent = '此筆紀錄識別不可用，無法追加結果。'; result.append(unavailable);
    }
    row.append(time, intent, reason, hash, personal, details, result); return row;
  });
  target.replaceChildren(...nodes);
}

async function loadDecisionJournal() {
  const target = $('dw-journal-history');
  const ticket = (target?._journalLoadTicket || 0) + 1;
  if (target) target._journalLoadTicket = ticket;
  try {
    const payload = await api('/api/v1/decision-journal?limit=20');
    if (target && target._journalLoadTicket !== ticket) return;
    renderJournalHistory(payload.data || [], payload.outcomes || []);
  } catch (error) {
    if (target && target._journalLoadTicket === ticket && !target._journalDirty?.size && !target._journalPending?.size) target.textContent = `Journal UNAVAILABLE · ${error.message}`;
  }
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value; textarea.setAttribute('readonly', ''); textarea.style.position = 'fixed'; textarea.style.opacity = '0';
  document.body.append(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('CLIPBOARD_WRITE_FAILED');
  } finally { textarea.remove(); }
}

async function loadDashboard() {
  if (state.decisionCaptureBusy) return false;
  const dashboardRequestId = ++state.dashboardRequestId;
  const flowTicket = flowChannel.ticket();
  const terminalRoot = $('decision-workspace');
  terminalRoot?.setAttribute('data-dashboard-load-state', 'LOADING');
  terminalRoot?.setAttribute('aria-busy', 'true');
  if (!state.guestReadOnly) void Promise.allSettled([loadHistory(), loadBacktest()]);
  const payload = await api('/api/v1/dashboard');
  if (dashboardRequestId !== state.dashboardRequestId || !(state.csrfToken || state.guestReadOnly) || !flowChannel.isCurrentSession(flowTicket)) return false;
  state.homeDashboardError = null;
  const partial = payload.service?.degraded;
  let partialNotice = $('candidate-partial-data-notice');
  if (partial?.reason === 'EOD_SNAPSHOT_UNAVAILABLE' && partial.status === 'PARTIAL') {
    if (!partialNotice) { partialNotice = document.createElement('p');partialNotice.id = 'candidate-partial-data-notice';
      partialNotice.className = 'alert warn';partialNotice.setAttribute('role','status');
      $('dashboard-view').prepend(partialNotice); }
    partialNotice.textContent = '部分資料模式：' + (partial.eodReason === 'EOD_SNAPSHOT_DATA_MODE_REJECTED'
      ? '快取資料模式與即時來源不符，已隔離。' : '盤後總覽資料不可用。')
      + '圖表與 Flow 僅顯示各自已取得的觀察；時效、盤別、品質與判讀資格仍各自檢查，並不代表完整盤況或正式驗收。';
  } else partialNotice?.remove();
  flowChannel.merge(payload.decisionWorkspace?.observedFlow, flowTicket);
  if (payload.data) render(payload.data);
  else renderSnapshotUnavailable(partial?.eodReason || partial?.reason);
  renderDecisionWorkspace(payload.decisionWorkspace);
  await loadIndexLeadership().catch(renderIndexLeadershipFailure);
  await loadTxDecisionChart({ fit: true }).catch((error) => {
    if (!globalThis.HomeWorkspace || !state.txChartPayload) renderTxDecisionChart({ status: 'UNAVAILABLE', reason: error.message, bars: [], levels: {} });
    else renderHomeWorkspace();
  });
  await loadLiveMarketPulse().catch(() => {});
  if (!state.guestReadOnly) { await reportCru46BrowserRuntimeProof(payload.service); await loadDecisionJournal(); renderPrelive(payload.service?.prelive); }
  if (!state.guestReadOnly && payload.service?.prelive?.marketFeed?.replayImported) await loadReplay(Number.MAX_SAFE_INTEGER, state.replayDate);
  terminalRoot?.setAttribute('data-dashboard-load-state', partial?.status === 'PARTIAL' ? 'PARTIAL' : 'READY');
  terminalRoot?.setAttribute('aria-busy', 'false');
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
  return true;
}

function reportDashboardLoadError(error, context = 'DASHBOARD_LOAD') {
  const message = error?.message || 'UNKNOWN_DASHBOARD_API_FAILURE';
  const box = document.createElement('div');
  box.className = 'alert bad';
  box.dataset.dashboardLoadError = 'true';
  box.textContent = `Dashboard data unavailable · ${context} · ${message}`;
  if ($('decision-workspace')?.dataset?.homeVersion === '1') box.hidden = true; // Same error is visible in the home status + technical details.
  $('alert-area')?.replaceChildren(box);
  renderTerminalDashboardFailure(`${context}:${message}`);
  console.error(`[${context}] ${message}`);
}

document.querySelectorAll('#v2-range-controls button').forEach((button) => button.addEventListener('click', async () => {
  state.v2Days = Number(button.dataset.days) || 60;
  document.querySelectorAll('#v2-range-controls button').forEach((item) => item.classList.toggle('is-selected', item === button));
  await loadV2Research();
}));

document.querySelectorAll('[data-dashboard-page]').forEach((button) => button.addEventListener('click', () => setDashboardPage(button.dataset.dashboardPage)));
if (!$('home-nav-toggle')) { // Home navigation has one owner; legacy layouts retain their original handler.
const sidebarPreferenceKey = 'twchip.dashboard.sidebarCollapsed.v1';
function setSidebarCollapsed(collapsed, { persist = false } = {}) {
  const layout = document.querySelector('.workspace-layout');
  const toggle = $('side-nav-toggle');
  if (!layout || !toggle) return;
  layout.classList.toggle('is-nav-collapsed', collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.title = collapsed ? '展開側邊欄' : '收合側邊欄';
  const label = toggle.querySelector('b');
  if (label) label.textContent = collapsed ? '展開' : '收合';
  if (persist && document.documentElement.dataset.guestReadOnly !== 'true') {
    try { localStorage.setItem(sidebarPreferenceKey, collapsed ? '1' : '0'); } catch { /* local preference is optional */ }
  }
}
let sidebarCollapsed = false;
try { if (document.documentElement.dataset.guestReadOnly !== 'true') sidebarCollapsed = localStorage.getItem(sidebarPreferenceKey) === '1'; } catch { /* local preference is optional */ }
setSidebarCollapsed(sidebarCollapsed);
$('side-nav-toggle')?.addEventListener('click', () => {
  const collapsed = !document.querySelector('.workspace-layout')?.classList.contains('is-nav-collapsed');
  setSidebarCollapsed(collapsed, { persist: true });
});
}
document.querySelectorAll('[data-dw-mode]').forEach((button) => button.addEventListener('click', () => {
  const mode = button.dataset.dwMode;
  document.querySelectorAll('[data-dw-mode]').forEach((item) => item.classList.toggle('is-selected', item === button));
  $('dw-focus-mode').classList.toggle('hidden', mode !== 'FOCUS');
  $('dw-review-mode').classList.toggle('hidden', mode !== 'REVIEW');
}));
function selectObservedFlowWindow(windowKey) {
  observedFlowSelectedWindow = windowKey;
  const value = flowChannel.view();
  const available = ['LIVE', 'WARMING_UP', 'STALE', 'HISTORICAL'].includes(value.sourceState) && value.windows;
  renderObservedFlowStrip(value, available);
  renderObservedFlowSelected(value, available, value.unavailableReason || 'OBSERVED_FLOW_UNAVAILABLE');
  if (globalThis.HomeWorkspace) renderHomeWorkspace();
}

function selectChartTimeframe(timeframe) {
  state.txChartTimeframe = timeframe;
  document.querySelectorAll('[data-chart-timeframe]').forEach((item) => {
    const selected = item.dataset.chartTimeframe === timeframe;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  // The loader owns failure presentation and retains explicitly labelled previous-period bars.
  loadTxDecisionChart({ fit: true }).catch(() => {});
}

function bindObservationControls() {
  // K-line aggregation and rolling executed-flow windows are independent selections.
  document.querySelectorAll('[data-chart-timeframe]').forEach((button) => button.addEventListener('click', () => {
    selectChartTimeframe(button.dataset.chartTimeframe);
  }));
  document.querySelectorAll('[data-flow-window]').forEach((button) => button.addEventListener('click', () => {
    selectObservedFlowWindow(button.dataset.flowWindow);
  }));
}
bindObservationControls();
document.querySelectorAll('[data-flow-window]').forEach((button) => button.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...document.querySelectorAll('[data-flow-window]')].filter(item => item.dataset.flowWindow !== 'tradingDay');
  const current = tabs.indexOf(button);
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}));
document.querySelectorAll('[data-review-intent]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-review-intent]').forEach((item) => item.classList.toggle('is-selected', item === button));
}));
document.querySelectorAll('[data-journal-intent]').forEach((button) => button.addEventListener('click', () => {
  state.journalIntent = button.dataset.journalIntent;
  document.querySelectorAll('[data-journal-intent]').forEach((item) => item.classList.toggle('is-selected', item === button));
}));
document.querySelectorAll('[data-gpt-question]').forEach((button) => button.addEventListener('click', () => {
  state.gptQuestion = button.dataset.gptQuestion;
  document.querySelectorAll('[data-gpt-question]').forEach((item) => item.classList.toggle('is-selected', item === button));
}));
$('dw-health-toggle')?.addEventListener('click', () => $('dw-data-health-panel').classList.remove('hidden'));
$('dw-health-close')?.addEventListener('click', () => $('dw-data-health-panel').classList.add('hidden'));
function decisionCaptureIdentity(chart) {
  return ['tradeDate','actualContract','session','sessionId','continuityEpoch'].map(key => chart?.[key] ?? null);
}
function createDecisionCaptureController({ request, selection, ticket, currentSession, apply, clipboard,
  schedule = setTimeout, cancel = clearTimeout, timeoutMs = 10_000, busy = () => {} }) {
  let flight = null, copyFlight = null, locked = null, generation = 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const present = () => locked && currentSession(locked.ticket) ? locked : null;
  function capture() {
    if (flight) return flight.promise;
    const session = ticket(), chosen = selection(), epoch = generation;
    if (!currentSession(session)) return Promise.reject(Error('DECISION_CAPTURE_SESSION_CHANGED'));
    if (chosen.timeframe !== '5m') return Promise.reject(Error('DECISION_CAPTURE_REQUIRES_5M'));
    const controller = new AbortController(), slot = { controller, promise: null };
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () =>
      reject(Error(controller.signal.reason || 'DECISION_CAPTURE_CANCELLED')), { once: true }));
    const timer = schedule(() => controller.abort('DECISION_CAPTURE_TIMEOUT'), timeoutMs);
    const pendingReasons = new Set(['SOURCE_CATCHUP_PENDING', 'DERIVED_HISTORY_VERIFYING', 'VERIFIED_SOURCE_PENDING_DERIVATION',
      'VERIFIED_SOURCE_PERSISTED_PENDING_DERIVATION', 'DERIVATION_CATCHUP_PENDING', 'LEGACY_CACHE_VALIDATION_PENDING', 'LEGACY_CACHE_MIGRATION_PENDING']);
    let pendingCutoff = null, latestPendingCutoff = null;
    const assertCurrent = () => {
      if (controller.signal.aborted) throw Error(controller.signal.reason || 'DECISION_CAPTURE_CANCELLED');
      if (generation !== epoch || !currentSession(session)) throw Error('DECISION_CAPTURE_SESSION_CHANGED');
      const view = selection();
      if (chosen.timeframe !== view.timeframe || !same(chosen.identity, view.identity)) throw Error('DECISION_CAPTURE_VIEW_CHANGED');
      return view;
    };
    const pause = () => new Promise((resolve, reject) => {
      let delay;
      const onAbort = () => { cancel(delay); controller.signal.removeEventListener('abort', onAbort);
        reject(Error(controller.signal.reason || 'DECISION_CAPTURE_CANCELLED')); };
      if (controller.signal.aborted) { onAbort(); return; }
      controller.signal.addEventListener('abort', onAbort, { once: true });
      delay = schedule(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, 250);
    });
    const requestReady = async () => {
      for (;;) {
        assertCurrent();
        const minimumCutoff = Number.isFinite(Date.parse(chosen.asOf)) ? new Date(chosen.asOf).toISOString() : null;
        const payload = await Promise.race([request(chosen.timeframe, controller.signal, minimumCutoff), aborted]);
        const view = assertCurrent(), data = payload?.data;
        if (data?.schemaVersion !== 'decision-capture-pending-v1') {
          if (pendingCutoff !== null && data?.chartCutoff !== pendingCutoff) throw Error('DECISION_CAPTURE_PENDING_CUTOFF_MISMATCH');
          if (latestPendingCutoff !== null && (!Number.isFinite(Date.parse(data?.chartCutoff))
              || Date.parse(data.chartCutoff) < Date.parse(latestPendingCutoff))) throw Error('DECISION_CAPTURE_PENDING_CUTOFF_MISMATCH');
          return payload;
        }
        const cutoffState = data.cutoffState ?? 'FROZEN';
        if (data.state !== 'PENDING' || data.timeframe !== chosen.timeframe || !same(data.identity, chosen.identity)
            || !['FROZEN','WARMING_INPUT'].includes(cutoffState)
            || !Number.isFinite(Date.parse(data.chartCutoff)) || data.retryAfterMs !== 250
            || !Array.isArray(data.reasonCodes) || !data.reasonCodes.length || !data.reasonCodes.every(reason => pendingReasons.has(reason))
            || (pendingCutoff !== null && (cutoffState !== 'FROZEN' || data.chartCutoff !== pendingCutoff))
            || (latestPendingCutoff !== null && Date.parse(data.chartCutoff) < Date.parse(latestPendingCutoff))) throw Error('DECISION_CAPTURE_PENDING_RESPONSE_MISMATCH');
        if (Number.isFinite(Date.parse(view.asOf)) && Date.parse(view.asOf) > Date.parse(data.chartCutoff)) throw Error('DECISION_CAPTURE_SUPERSEDED_BY_LIVE_CHART');
        latestPendingCutoff = data.chartCutoff;
        // Input warmup has no frozen source lease or copyable snapshot yet.
        // Once the audit pins a prefix, its cutoff must never advance again.
        if (cutoffState === 'FROZEN') pendingCutoff = data.chartCutoff;
        // Only explicit bounded warmup is retried; the original total deadline stays armed.
        await pause();
      }
    };
    slot.promise = Promise.race([Promise.resolve().then(requestReady), aborted]).then(payload => {
      const now = selection(), data = payload?.data, workspace = data?.workspace, chart = data?.chart, snapshot = workspace?.snapshot;
      if (generation !== epoch || !currentSession(session)) throw Error('DECISION_CAPTURE_SESSION_CHANGED');
      if (chosen.timeframe !== now.timeframe || !same(chosen.identity, now.identity)) throw Error('DECISION_CAPTURE_VIEW_CHANGED');
      if (data?.schemaVersion !== 'decision-capture-v1' || chart?.timeframe !== chosen.timeframe
          || !snapshot || data.captureId !== snapshot.snapshotHash || !/^[a-f0-9]{64}$/.test(snapshot.snapshotHash || '')
          || data.capturedAt !== snapshot.snapshotTime || data.chartCutoff !== chart.asOf
          || !Number.isFinite(Date.parse(chart.asOf)) || !Number.isFinite(Date.parse(snapshot.snapshotTime))
          || Date.parse(chart.asOf) > Date.parse(snapshot.snapshotTime)
          || !chart.actualContract || !chart.tradeDate || !chart.session
          || snapshot.contract !== chart.actualContract || snapshot.tradeDate !== chart.tradeDate || snapshot.session !== chart.session
          || !same(decisionCaptureIdentity(chart), chosen.identity)
          || typeof workspace.chatGptCopy !== 'string'
          || !workspace.chatGptCopy.includes(`Snapshot: ${snapshot.snapshotTime}\nHash: ${snapshot.snapshotHash}\n`)) throw Error('DECISION_CAPTURE_RESPONSE_MISMATCH');
      if (chart.sourceAuditProgress?.state === 'PENDING' || chart.sourceReadState === 'CATCHUP_PENDING'
          || [...(chart.qualityReasons || []), ...(chart.marketObservation?.reasonCodes || [])].some(reason => pendingReasons.has(reason))) throw Error('DECISION_CAPTURE_NOT_READY');
      if (chart.marketObservation?.reasonCodes?.includes('CHART_OBSERVATION_PREFIX_MISMATCH')) throw Error('DECISION_CAPTURE_OBSERVATION_MISMATCH');
      if (Number.isFinite(Date.parse(now.asOf)) && Date.parse(now.asOf) > Date.parse(chart.asOf)) throw Error('DECISION_CAPTURE_SUPERSEDED_BY_LIVE_CHART');
      const number = value => value == null || value === '' ? null : Number(value);
      if (number(snapshot.price?.value) !== number(chart.lastPrice)) throw Error('DECISION_CAPTURE_PRICE_MISMATCH');
      if (snapshot.marketObservation && (snapshot.marketObservation.snapshotId !== chart.marketObservation?.snapshotId
          || snapshot.marketObservation.cutoff !== chart.asOf
          || ['actualContract', 'tradeDate', 'session'].some(key => chart.marketObservation.identity?.[key] !== chart[key]))) throw Error('DECISION_CAPTURE_OBSERVATION_MISMATCH');
      const frozenSnapshot = JSON.parse(JSON.stringify(snapshot));
      const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
      const pair = Object.freeze({ snapshot: freeze(frozenSnapshot), copyText: workspace.chatGptCopy,
        chartCutoff: chart.asOf, timeframe: chart.timeframe, ticket: session });
      // The apply callback is synchronous: chart, summary and lock advance as one UI action.
      apply(data, pair);
      locked = pair;
      return pair;
    }).finally(() => { cancel(timer); if (flight === slot) { flight = null; busy(false); } });
    flight = slot; busy(true); return slot.promise;
  }
  function copy() {
    if (copyFlight) return copyFlight;
    const operation = (async () => {
      const pair = flight ? await flight.promise : present() || await capture();
      if (!currentSession(pair.ticket)) throw Error('DECISION_CAPTURE_SESSION_CHANGED');
      await clipboard(pair.copyText);
      return pair;
    })();
    copyFlight = operation;
    operation.finally(() => { if (copyFlight === operation) copyFlight = null; }).catch(() => {});
    return operation;
  }
  function reset() {
    generation += 1; locked = null;
    flight?.controller.abort('DECISION_CAPTURE_SESSION_CHANGED');
    flight = null; copyFlight = null; busy(false);
  }
  function adoptObservation(snapshot, copyText, timeframe) {
    const session = ticket();
    if (!currentSession(session) || !snapshot?.marketObservation || !/^[a-f0-9]{64}$/.test(snapshot.snapshotHash || '')
        || snapshot.marketObservation.cutoff !== (snapshot.chartCutoff ?? snapshot.snapshotTime)) throw Error('DECISION_CAPTURE_OBSERVATION_MISMATCH');
    reset();
    const cloned = JSON.parse(JSON.stringify(snapshot));
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
    locked = Object.freeze({ snapshot: freeze(cloned), copyText, chartCutoff: snapshot.chartCutoff ?? snapshot.snapshotTime, timeframe, ticket: session });
    return locked;
  }
  return Object.freeze({ capture, copy, reset, adoptObservation, locked: present,
    context: () => flight ? flight.promise : Promise.resolve(present() || capture()) });
}
function renderDecisionCaptureStatus(pair = state.decisionCapturePair) {
  if (!pair) { dwText('dw-snapshot-status', 'Snapshot 尚未鎖定；鎖定或複製時以 5 分 K 擷取最新快照。'); return; }
  const snapshot = pair.snapshot;
  dwText('dw-snapshot-status', `LOCKED ${snapshot.snapshotTime} · ${snapshot.snapshotHash} · 固定價格 ${fmt(snapshot.price?.value)} · VWAP ${fmt(snapshot.VWAP?.value, 2)} · 圖表截至 ${pair.chartCutoff} · 主圖仍持續即時更新；再次鎖定才更換此快照。`);
}
function applyDecisionCapture(data, pair) {
  state.dashboardRequestId += 1;
  state.txChartRequestId += 1;
  state.txChartAbortController?.abort('CHART_CAPTURE_APPLIED');
  state.marketPulse = data.workspace.marketPulse;
  state.levelWatch = data.workspace.levelWatch;
  state.txChartPayload = data.chart;
  // Explicit capture replaces the complete selected snapshot, including intervening bars and historical corrections.
  const rendered = renderTxDecisionChart(data.chart, { replaceData: true });
  if (rendered?.visibleRenderReady !== true) throw Error(`DECISION_CAPTURE_CHART_RENDER_FAILED:${rendered?.reason || 'CHART_RENDER_UNVERIFIED'}`);
  renderDecisionWorkspace(data.workspace, { captured: true });
  globalThis.MarketObservationWorkspace?.capture(data.chart.marketObservation);
  state.decisionCapturePair = pair;
  state.lockedDecisionSnapshot = pair.snapshot;
  renderDecisionCaptureStatus(pair);
  $('decision-workspace')?.setAttribute('data-dashboard-load-state', 'READY');
  $('decision-workspace')?.setAttribute('aria-busy', 'false');
}
const decisionCaptureController = createDecisionCaptureController({
  request: (timeframe, signal, minimumCutoff) => api(`/api/v1/decision-capture?timeframe=${encodeURIComponent(timeframe)}${minimumCutoff ? `&minimumCutoff=${encodeURIComponent(minimumCutoff)}` : ''}`, { cache: 'no-store', signal }),
  selection: () => ({ timeframe: state.txChartTimeframe, identity: decisionCaptureIdentity(state.txChartPayload), asOf: state.txChartPayload?.asOf }),
  ticket: () => ({ csrf: state.csrfToken, flow: flowChannel.ticket() }),
  currentSession: token => Boolean(token?.csrf && token.csrf === state.csrfToken && !state.guestReadOnly && flowChannel.isCurrentSession(token.flow)),
  apply: applyDecisionCapture,
  clipboard: value => copyToClipboard(value),
  busy: value => {
    state.decisionCaptureBusy = value;
    if (value) {
      state.dashboardRequestId += 1; state.txChartRequestId += 1;
      state.txChartAbortController?.abort('CHART_CAPTURE_PENDING');
    }
  },
});
function clearDecisionCapture() {
  decisionCaptureController.reset();
  globalThis.MarketObservationWorkspace?.reset();
  state.decisionCaptureActionId += 1;
  state.decisionCapturePair = null; state.lockedDecisionSnapshot = null;
  for (const id of ['dw-lock-snapshot','dw-copy-chatgpt']) {
    const button = $(id); if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
  renderDecisionCaptureStatus(null);
}
async function runDecisionCaptureAction(kind) {
  const lock = $('dw-lock-snapshot'), copy = $('dw-copy-chatgpt');
  if (lock.disabled || copy.disabled) return;
  const actionId = ++state.decisionCaptureActionId;
  const session = state.csrfToken;
  lock.disabled = true; copy.disabled = true;
  lock.setAttribute('aria-busy', 'true'); copy.setAttribute('aria-busy', 'true');
  dwText('dw-journal-feedback', kind === 'copy' && decisionCaptureController.locked() ? '正在複製已鎖定快照…' : '正在擷取同一盤況快照…');
  try {
    const pair = await (kind === 'copy' ? decisionCaptureController.copy() : decisionCaptureController.capture());
    if (session !== state.csrfToken) return;
    dwText('dw-journal-feedback', `${kind === 'copy' ? '已複製已鎖定快照' : '已擷取並鎖定快照'} · ${pair.snapshot.snapshotTime} · ${pair.snapshot.snapshotHash.slice(0, 12)}… · 主圖繼續即時更新；NOT A TRADING SIGNAL`);
  } catch (error) {
    if (session === state.csrfToken) dwText('dw-journal-feedback', error.message === 'DECISION_CAPTURE_REQUIRES_5M'
      ? '請先切換回 5 分 K，再鎖定或複製新快照；既有鎖定快照仍可複製。其他週期的圖表可照常使用。'
      : `尚未${kind === 'copy' ? '複製' : '更換快照'} · ${error.message}；既有鎖定快照保持原樣，請確認後重試。`);
  } finally {
    if (actionId === state.decisionCaptureActionId) {
      lock.disabled = false; copy.disabled = false;
      lock.removeAttribute('aria-busy'); copy.removeAttribute('aria-busy');
    }
  }
}

$('dw-lock-snapshot').addEventListener('click', () => void runDecisionCaptureAction('lock'));
$('dw-copy-chatgpt').addEventListener('click', () => void runDecisionCaptureAction('copy'));
window.addEventListener('market-observation-journal', (event) => {
  const observation = event.detail?.snapshot;
  const selected = event.detail?.event;
  const snapshot = observation?.journalSnapshot;
  if (!snapshot || !selected || snapshot.marketObservation?.snapshotId !== observation.snapshotId) {
    dwText('dw-journal-feedback', '整合事件快照不可用，未鎖定或儲存。'); return;
  }
  const copyText = observation.journalCopy;
  if (typeof copyText !== 'string' || !copyText.includes(`Snapshot: ${snapshot.snapshotTime}\nHash: ${snapshot.snapshotHash}\n`)) {
    dwText('dw-journal-feedback', '整合事件 Copy 與快照不一致，未鎖定。'); return;
  }
  let pair;
  try { pair = decisionCaptureController.adoptObservation(snapshot, copyText, observation.timeframe); }
  catch (error) { dwText('dw-journal-feedback', error.message); return; }
  state.decisionCapturePair = pair; state.lockedDecisionSnapshot = pair.snapshot;
  state.journalIntent = 'NO_TRADE';
  document.querySelectorAll('[data-journal-intent]').forEach(button => button.classList.toggle('is-selected', button.dataset.journalIntent === 'NO_TRADE'));
  $('dw-journal-setup').value = `${selected.type} · ${selected.id}`;
  $('dw-journal-reason').value = `${selected.title}；ΔCVD ${selected.deltaCvd ?? '未知'}；${(selected.contraryEvidence || []).join('；')}`;
  $('dw-journal-invalidation').value = (selected.invalidationConditions || []).join('；');
  dwText('dw-snapshot-status', `LOCKED 整合事件 ${observation.cutoff} · ${snapshot.snapshotHash}`);
  dwText('dw-journal-feedback', '已鎖定畫面同一快照；請核對後按儲存，Outcome 沿用既有 Review。');
  $('dw-journal-form').scrollIntoView({ block: 'center', behavior: 'smooth' });
});
$('dw-copy-gpt-prompt').addEventListener('click', async () => {
  const button = $('dw-copy-gpt-prompt');
  if (button.disabled) return;
  const openLink = $('dw-open-chatgpt');
  const feedback = (message) => {
    dwText('dw-gpt-feedback', message);
    dwText('dw-journal-feedback', message);
  };
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  openLink?.classList.add('hidden');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const session = state.csrfToken;
  feedback('正在準備同一鎖定快照，請暫時留在此頁…');
  try {
    const pair = await decisionCaptureController.context({ signal: controller.signal });
    if (session !== state.csrfToken || pair !== decisionCaptureController.locked() || controller.signal.aborted) throw Error('DECISION_CAPTURE_SESSION_CHANGED');
    if (typeof pair.copyText !== 'string' || !pair.copyText || !pair.snapshot?.snapshotHash) throw Error('DISCUSSION_PROMPT_UNAVAILABLE');
    const prompt = pair.copyText + `\n\nUSER QUESTION: ${String(state.gptQuestion || '').slice(0, 500)}`;
    // Clipboard write must finish while this document still owns focus.
    await copyToClipboard(prompt);
    openLink?.classList.remove('hidden');
    feedback(`已複製鎖定盤況 · ${pair.snapshot.snapshotHash.slice(0, 12)}… · 請到 ChatGPT 貼上；若未開啟，請點下方連結。`);
    // noopener may return null even when the tab opens: do not infer popup failure from it.
    try { window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer'); }
    catch { /* The visible, user-activated link remains available after successful copying. */ }
  } catch (error) {
    feedback(controller.signal.aborted
      ? '建立盤況逾時，尚未複製。請稍後重試。'
      : `尚未複製盤況，請保持此頁在前景後重試。原因：${error.message}`);
  } finally {
    clearTimeout(timeout);
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
});
$('dw-journal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.lockedDecisionSnapshot || !decisionCaptureController.locked()) {
    dwText('dw-journal-feedback', '請先 Lock Snapshot；未鎖定資料不得寫入人工決策日誌。');
    return;
  }
  const submit = $('dw-journal-submit'); submit.disabled = true;
  try {
    const payload = await api('/api/v1/decision-journal', {
      method: 'POST',
      body: JSON.stringify({
        intent: state.journalIntent,
        setup: $('dw-journal-setup').value,
        reason: $('dw-journal-reason').value,
        invalidation: $('dw-journal-invalidation').value,
        confidence: $('dw-journal-confidence').value || null,
        executionStatus: $('dw-journal-execution').value,
        snapshot: state.lockedDecisionSnapshot,
      }),
    });
    dwText('dw-journal-feedback', `Saved #${payload.data.sequence} · ${payload.data.recordHash.slice(0, 12)}… · executionAuthorized=false`);
    await loadDecisionJournal();
  } catch (error) {
    dwText('dw-journal-feedback', `Journal write rejected · ${error.message}`);
  } finally { submit.disabled = false; }
});
document.querySelectorAll('#v2-delta-controls button').forEach((button) => button.addEventListener('click', async () => {
  state.v2Delta = Number(button.dataset.delta) || 1;
  document.querySelectorAll('#v2-delta-controls button').forEach((item) => item.classList.toggle('is-selected', item === button));
  await loadV2Research();
}));
$('v2-contract-select').addEventListener('change', async (event) => { state.v2Contract = event.target.value; await loadV2Research(); });

document.querySelectorAll('.history-range').forEach((button) => {
  button.addEventListener('click', () => {
    state.historyDays = Number(button.dataset.days) || 20;
    document.querySelectorAll('.history-range').forEach((item) => item.classList.toggle('is-selected', item === button));
    renderHistory();
  });
});

$('option-contract-select').addEventListener('change', (event) => renderOptionOiChart(event.target.value));
$('replay-date-select').addEventListener('change', (event) => {
  state.replayDate = event.target.value;
  loadReplay(Number.MAX_SAFE_INTEGER, state.replayDate).catch(() => {});
});
$('replay-reset').addEventListener('click', () => loadReplay(1, state.replayDate).catch(() => {}));
$('replay-next').addEventListener('click', () => loadReplay(state.replayCursor + 1, state.replayDate).catch(() => {}));
$('replay-all').addEventListener('click', () => loadReplay(Number.MAX_SAFE_INTEGER, state.replayDate).catch(() => {}));

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  text('login-error', '');

  let payload;
  try {
    payload = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        password: $('password').value,
        remember: $('remember-login').checked,
      }),
    });
  } catch (error) {
    const messages = {
      TOO_MANY_ATTEMPTS: '嘗試次數過多。請關閉啟動視窗，重新開啟後再試。',
      INVALID_CREDENTIALS: '密碼不正確。可執行 3_CHECK_PASSWORD.bat 檢查。',
      INVALID_RESPONSE: '伺服器回應異常，請查看黑色啟動視窗。',
    };
    text('login-error', messages[error.message] || '無法連線到登入服務，請查看黑色啟動視窗。');
    button.disabled = false;
    return;
  }

  clearDecisionCapture();
  state.csrfToken = payload.csrfToken;
  $('password').value = '';
  show('dashboard-view');

  try {
    await loadDashboard();
  } catch (error) {
    reportDashboardLoadError(error, 'POST_LOGIN_DASHBOARD_LOAD');
  } finally {
    button.disabled = false;
  }
});

const DAILY_STAGE_LABELS = Object.freeze({
  prepare: '準備資料庫',
  taifex: '期貨與選擇權日資料',
  intraday_replay: '5分鐘官方回放',
  intraday_features: '盤中特徵重建',
  intraday_strategy_engineering: '策略工程稽核',
  twse_gaps: '現貨法人補齊',
  twse_margin: '融資融券',
  futures_positions: '法人期貨部位',
  domestic_institutions: '投信與自營商明細',
  spot_institution_gross: '現貨法人買賣',
  option_institutions: '選擇權法人',
  option_large_traders: '選擇權大額交易人',
  market_breadth: '上市櫃市場廣度',
  securities_lending: '借券資料',
  global_context: '海外市場',
  macro_context: '總體環境',
  taiwan_vix: '臺指波動率',
  normalized_futures_oi: '期貨OI口徑',
  option_volatility: '選擇權波動',
  volatility_relative: '相對波動',
  basis_term_structure: '基差與期限結構',
  features: '日資料特徵',
  quality: '資料品質',
  official_validation: '官方一致性',
  status: '資料狀態摘要',
  available_at_audit: '資料可用時間',
  extended_quality_audit: '擴充品質',
  v362_gate_audit: '研究資料閘門',
  forward_decisions: '前推判斷',
  forward_outcomes: '前推結果',
  v34_forward: 'V3.4前推追蹤',
  forward_ledger_audit: '前推帳本稽核',
  paper_event_ledger_audit: '盤中紙上帳本稽核',
});

async function monitorDailyUpdate() {
  const button = $('daily-update-button');
  const sessionTicket = flowChannel.ticket();
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!flowChannel.isCurrentSession(sessionTicket)) return;
    const payload = await api('/api/v2/daily-update');
    if (!flowChannel.isCurrentSession(sessionTicket)) return;
    const update = payload.data || {};
    const completedStages = Array.isArray(update.stages) ? update.stages.length : 0;
    const totalStages = Number(update.totalStages) || 33;
    const stageLabel = DAILY_STAGE_LABELS[update.currentStage] || update.currentStage || '整理更新結果';
    button.textContent = `更新中 ${Math.min(completedStages + 1, totalStages)}/${totalStages}：${stageLabel}`;
    const finished = !payload.processRunning && ['completed', 'completed_with_warnings', 'failed'].includes(update.state);
    if (!finished) continue;
    // Capture owns the locked snapshot. Retry within this bounded monitor rather
    // than treating loadDashboard's capture-busy no-op as a completed reread.
    if (state.decisionCaptureBusy) {
      button.textContent = '批次已結束，等待快照擷取後重讀資料';
      continue;
    }
    const box = document.createElement('div');
    box.className = update.state === 'completed' ? 'alert good' : update.state === 'completed_with_warnings' ? 'alert warning' : 'alert bad';
    box.textContent = update.state === 'completed'
      ? '每日資料更新完成；日資料、5分鐘回放與研究稽核已同步，正式研究門檻未被重新調整。'
      : update.state === 'completed_with_warnings'
        ? `每日資料已完成，但有 ${update.failures?.length || 0} 個來源待補；面板會標示尚待公布或舊資料。`
        : `每日更新未完成：${update.fatalError || '請查看更新紀錄'}；仍會重讀各來源，請依資料卡的日期與品質狀態判斷可用性。`;
    // A later historical audit failure must not suppress qualified source updates.
    // The normal reader still enforces each source's date, cutoff and quality.
    try {
      // Capture or another refresh can supersede this response while its API is
      // in flight. Only an applied reread completes this monitor's obligation.
      if (await loadDashboard() === false) continue;
    }
    catch (error) {
      box.className = 'alert bad';
      box.textContent += ` 面板重讀失敗：${error.message}；目前畫面尚未確認更新。`;
    }
    // render() clears the shared alert area; retain the batch outcome afterwards.
    if (flowChannel.isCurrentSession(sessionTicket)) $('alert-area').prepend(box);
    return;
  }
  throw new Error('DAILY_UPDATE_TIMEOUT');
}

$('daily-update-button').addEventListener('click', async () => {
  const button = $('daily-update-button');
  button.disabled = true;
  button.textContent = '啟動更新中';
  try {
    await api('/api/v2/daily-update', { method: 'POST', body: '{}' });
    const box = document.createElement('div');
    box.className = 'alert good';
    box.textContent = '安全每日更新已啟動。可繼續查看面板；資料會依序補齊並執行時間稽核。';
    $('alert-area').prepend(box);
    await monitorDailyUpdate();
  } catch (error) {
    const box = document.createElement('div');
    const readOnly = error.message === 'CANDIDATE_READ_ONLY_DAILY_UPDATE';
    box.className = readOnly ? 'alert warning' : 'alert bad';
    box.setAttribute('role', 'status');
    box.textContent = readOnly
      ? 'BLOCKED：候選唯讀模式不執行每日批次更新，手動決策紀錄仍可使用。（CANDIDATE_READ_ONLY_DAILY_UPDATE）'
      : error.message === 'DAILY_UPDATE_ALREADY_RUNNING' ? '每日更新已在執行中，請稍候。' : `每日更新啟動失敗：${error.message}`;
    $('alert-area').prepend(box);
  } finally {
    button.disabled = false;
    button.textContent = '每日資料更新';
  }
});

$('refresh-button').addEventListener('click', async () => {
  const button = $('refresh-button');
  button.disabled = true; button.textContent = '更新中…';
  try {
    const payload = await api('/api/v1/refresh', { method: 'POST', body: '{}' });
    if (payload.data) render(payload.data);
    await Promise.all([loadHistory(), loadV2Research().catch(() => {})]);
    const box = document.createElement('div');
    box.className = 'alert good';
    box.textContent = `最新資料檢查完成：${timeLabel(payload.data?.generatedAt)}；資料日 ${payload.data?.asOfDate || '—'}`;
    $('alert-area').prepend(box);
  } catch (error) {
    reportDashboardLoadError(error, 'DASHBOARD_REFRESH');
  } finally { button.disabled = false; button.textContent = '更新最新資料'; }
});

$('logout-button').addEventListener('click', async () => {
  clearDecisionCapture();
  flowChannel.stop(); flowChannel.reset();
  dataOperationsChannel.reset();
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
  state.csrfToken = '';
  show('login-view');
});

(async function boot() {
  let authenticated = false;
  try {
    const session = await api('/api/session');
    if (document.documentElement.dataset.guestReadOnly === 'true') {
      if (session.guestReadOnly !== true || session.authenticated !== false || !enableGuestView(session)) { expireGuestView(); return; }
    } else if (!session.authenticated) { show('login-view'); return; }
    authenticated = true;
    state.csrfToken = session.csrfToken;
    show('dashboard-view');
    await loadDashboard();
  } catch (error) {
    if (!authenticated) { show('login-view'); return; }
    reportDashboardLoadError(error, 'INITIAL_DASHBOARD_LOAD');
  }
})();

// Keep an open dashboard current without storing credentials in JavaScript.
document.addEventListener('visibilitychange', () => flowChannel.visibilityChanged());
setInterval(() => {
  if (!$('dashboard-view').classList.contains('hidden')) {
    loadDashboard().catch((error) => reportDashboardLoadError(error, 'DASHBOARD_REFRESH'));
  }
}, 300_000);

// Only the current candle/last point is updated when identity is unchanged.
// This consumes the existing read-only ledger; it never starts a collector.
setInterval(() => {
  if (!$('dashboard-view').classList.contains('hidden')) loadTxDecisionChart().catch(() => {});
}, 5_000);

// IX0001 Leadership consumes the bounded latest cache only; it never reloads the full ledger.
setInterval(() => {
  if (!$('dashboard-view').classList.contains('hidden')) loadIndexLeadership().catch(renderIndexLeadershipFailure);
}, 5_000);

// Market Pulse reads the bounded 5m chart + 8790 latest snapshot; no collector or history rebuild is started.
setInterval(() => {
  if (!$('dashboard-view').classList.contains('hidden')) loadLiveMarketPulse().catch(() => {});
}, 5_000);

// Key level watcher is deterministic/local. It never calls a model and only reads governed chart/flow projections.
setInterval(() => {
  if (!$('dashboard-view').classList.contains('hidden')) void loadDecisionLevelWatch();
}, 5_000);

// Suspended tabs must hide retained guest data on return after the fixed deadline.
document.addEventListener('visibilitychange', () => {
  if (state.guestReadOnly && (Date.now() >= Date.parse(state.guestExpiresAt) || performance.now() >= state.guestExpiryMono)) expireGuestView();
});
