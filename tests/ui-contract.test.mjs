import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('today page exposes the separated research score surfaces', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const id of ['score', 'risk-scores', 'risk-score-note', 'confidence', 'tradability', 'trade-state']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`["']${id}["']`));
  }
  assert.match(html, /研究方向分數/);
  assert.match(html, /不是勝率或預期報酬/);
  assert.match(html, /風險尺，不是發生機率/);
  assert.match(html, /目前尚無5分鐘價格確認/);
});

test('V3.9 decision cockpit separates direction, risk, evidence and veto conditions', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const id of ['cockpit-action', 'cockpit-direction', 'cockpit-research-bias', 'cockpit-prohibition',
    'axis-direction', 'axis-volatility', 'axis-options', 'axis-price', 'axis-tradability', 'axis-evidence',
    'bull-evidence-list', 'conflict-evidence-list', 'bear-evidence-list', 'cockpit-component-bars']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`['"]${id}['"]`));
  }
  assert.match(html, /研究分數不等於勝率/);
  assert.match(html, /展開完整研究雷達與四道閘門/);
  assert.match(app, /高波動否決/);
  assert.match(app, /價格尚未確認/);
});

test('six-axis shadow score exposes composition without changing formal decisions', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const id of ['shadow-score-summary', 'shadow-score-note', 'shadow-six-axis-list', 'shadow-score-audit']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`['"]${id}['"]`));
  }
  assert.match(html, /正式權重固定為 0/);
  assert.match(app, /sixAxisShadow/);
});

test('V3.6.2 homepage exposes risk-only fields and safe daily update controls', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const runner = fs.readFileSync(new URL('../v2/scripts/run-v3-daily-update.mjs', import.meta.url), 'utf8');
  for (const id of [
    'v362-data-date', 'v362-volatility', 'v362-vix-change', 'v362-option-vol',
    'v362-foreign-5d', 'v362-short-add', 'v362-price', 'v362-cache',
    'v362-pending', 'v362-evidence-badge', 'daily-update-button',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /風險候選，非下單訊號/);
  assert.match(app, /\/api\/v2\/daily-update/);
  assert.match(app, /DAILY_STAGE_LABELS/);
  assert.match(app, /5分鐘官方回放/);
  assert.match(app, /策略工程稽核/);
  assert.match(runner, /totalStages:\s*stages\.length/);
  assert.match(runner, /formalResearchRerun:\s*false/);
  assert.doesNotMatch(runner, /analyze-v3-6-2-extended-factors/);
  assert.doesNotMatch(runner, /build-v3-6-2-final-report/);
});

test('V3.7.3 intraday page exposes selectable candlestick replay and quality context', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const id of ['replay-date-select', 'replay-all', 'replay-chart', 'replay-hover', 'replay-metrics', 'replay-quality']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`["']${id}["']`));
  }
  assert.match(html, /盤中價格/);
  assert.match(app, /candle-body/);
  assert.match(app, /relativeVolume20d/);
  assert.match(html, /不含券商憑證/);
});

test('today decision gate cannot present a live-ready state without research evidence', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /id=["']v3-gate-evidence["']/);
  assert.match(html, /研究證據未達門檻時禁止實單/);
  assert.match(app, /evidence\.liveEligible === true/);
  assert.match(app, /紙上條件成立，禁止實單/);
  assert.doesNotMatch(app, /條件成立，可規劃交易/);
});

test('options cards expose verified data state instead of roadmap placeholders', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /選擇權波動資料/);
  assert.match(app, /履約價分布狀態/);
  assert.match(app, /不以 0 代替/);
  assert.doesNotMatch(app, /metric\('履約價 OI 長條圖', '下一階段'/);
  assert.doesNotMatch(app, /metric\('Call／Put OI 熱圖', '下一階段'/);
});

test('market page exposes compact trend cards with expandable history', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const id of ['breadth-trend-panel', 'spot-trend-panel', 'margin-trend-panel', 'futures-trend-panel']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`['"]${id}['"]`));
  }
  assert.match(html, /展開全部現貨欄位與說明/);
  assert.doesNotMatch(html, /展開全部資券欄位與說明/);
  assert.doesNotMatch(html, /id=["']margin-cards["']/);
  assert.match(html, /展開全部期貨欄位與評分/);
  assert.match(app, /每日三大法人買賣超/);
  assert.match(app, /每日融資餘額增減/);
  assert.match(app, /外資淨部位每日變化/);
  assert.match(app, /上市市場廣度/);
  assert.match(app, /上櫃市場廣度/);
  assert.match(app, /快照日無缺漏/);
  assert.match(app, /價格跨換月需分段解讀/);
  assert.match(app, /展開近 \$\{rows\.length\} 日歷史明細/);
  assert.match(css, /\.flow-mini-chart/);
  assert.match(css, /\.flow-data-meta/);
  assert.match(css, /\.compact-data-details/);
});

test('options page exposes same-contract short trends without joining expiries', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(html, /id=["']options-trend-panel["']/);
  assert.match(html, /展開全部選擇權欄位與說明/);
  assert.match(app, /function renderOptionsTrendPanel/);
  assert.match(app, /Call OI 每日增減/);
  assert.match(app, /Put OI 每日增減/);
  assert.match(app, /換約後重新累積，不跨到期日串接/);
  const dealerMapIds = [
    'dealer-map-panel',
    'dealer-map-status',
    'dealer-map-summary',
    'dealer-map-zones',
    'dealer-map-history',
    'dealer-map-safeguard',
  ];
  for (const id of dealerMapIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const id of dealerMapIds.filter((id) => id !== 'dealer-map-panel')) {
    assert.match(app, new RegExp(`['"]${id}['"]`));
  }
  assert.match(html, /透明莊家地圖 Beta/);
  assert.match(html, /不代表真實莊家部位、成交成本或勝率/);
  assert.match(app, /function renderDealerMap/);
  assert.match(app, /公開 OI 結構，不代表真實莊家部位、成本或勝率/);
  assert.match(app, /正式評分權重維持 0/);
  assert.match(css, /\.dealer-map-summary/);
  assert.match(css, /\.dealer-zone-range/);
});
