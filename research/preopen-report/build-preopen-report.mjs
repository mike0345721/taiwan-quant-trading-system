// 勢衡 pre-open report. Read-only research tool: reads local files (and public Yahoo quotes), writes an HTML report.
// Never sends orders. Usage:
//   node build-preopen-report.mjs --mode cache    (05:20 / 13:55: update tick caches only)
//   node build-preopen-report.mjs --mode report   (08:35: update caches and write out/YYYY-MM-DD.html + out/latest.html)
//   optional: --config <file> --now <ISO time>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateCache, sessionsFromCaches, volumeProfile, tpeDate, tpeMinutes } from './tick-cache.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const fmt = (x, d = 0) => x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readJson = f => { if (!f) return null; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const resolve = p => path.isAbsolute(p) || /^[A-Za-z]:\\/.test(p) ? p : path.join(HERE, p);

export function loadConfig(file) { const c = readJson(file); if (!c) throw new Error('CONFIG_MISSING ' + file); return c; }

export function updateAllCaches(cfg, now) {
  const cacheDir = resolve(cfg.cacheDir); fs.mkdirSync(cacheDir, { recursive: true });
  const caches = [];
  for (let k = 0; k <= (cfg.lookbackDays ?? 6); k++) {
    const d = tpeDate(now.getTime() - k * 86400000);
    const ledger = path.join(resolve(cfg.ledgerDir), `${d}.ndjson`);
    if (!fs.existsSync(ledger)) continue;
    caches.push(updateCache(ledger, path.join(cacheDir, `${d}.cache.json`)));
  }
  return caches;
}

function costPoints(ins, price, cfg) {
  const c = cfg.costs[ins]; const tax = Math.round(price * c.mult * cfg.costs.taxRate);
  return (2 * c.comm + 2 * tax + 2 * cfg.costs.slipTicks * c.mult) / c.mult;
}

async function yahoo(symbols, timeoutMs = 8000) {
  if (typeof fetch !== 'function') return { error: 'NO_FETCH' };
  const out = {};
  await Promise.all(Object.entries(symbols).map(async ([key, sym]) => {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2d&interval=5m`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res) throw new Error('no result');
      const ts = res.timestamp || [], cl = res.indicators?.quote?.[0]?.close || [];
      const pts = ts.map((x, i) => [x * 1000, cl[i]]).filter(p => Number.isFinite(p[1]));
      out[key] = { symbol: sym, price: res.meta?.regularMarketPrice ?? pts.at(-1)?.[1], prevClose: res.meta?.chartPreviousClose ?? res.meta?.previousClose, points: pts };
    } catch (e) { out[key] = { symbol: sym, error: String(e.message || e) }; }
  }));
  return out;
}
function changeSince(points, sinceMs) { if (!points?.length) return null; const base = points.filter(p => p[0] <= sinceMs).at(-1); const last = points.at(-1); return base ? (last[1] / base[1] - 1) : null; }

export async function buildReport(cfg, now, { fetchQuotes = yahoo } = {}) {
  const caches = updateAllCaches(cfg, now);
  const sessions = sessionsFromCaches(caches);
  const today = tpeDate(now.getTime());
  const nowMs = now.getTime();
  const done = sessions.filter(s => s.bars.length && s.bars.at(-1).t + 300000 <= nowMs);
  const priorDay = done.filter(s => s.type === 'DAY' && s.key.slice(4) < today).at(-1) || null;
  const night = done.filter(s => s.type === 'NIGHT' && (!priorDay || s.bars[0].t > priorDay.bars.at(-1).t)).at(-1) || null;
  const ref = night?.bars.at(-1).cl ?? priorDay?.bars.at(-1).cl ?? null;

  // volatility
  const hl = s => s ? { high: Math.max(...s.bars.map(b => b.h)), low: Math.min(...s.bars.map(b => b.l)), open: s.bars[0].o, close: s.bars.at(-1).cl } : null;
  const N = hl(night), D = hl(priorDay);
  const vm = cfg.volModel;
  let vol = null;
  if (N && ref) {
    const nr = (N.high - N.low) / N.open;
    const pct = Math.exp(vm.a + vm.b * Math.log(nr));
    const pts = pct * ref;
    const group = nr < vm.nightTerciles[0] ? '小' : nr < vm.nightTerciles[1] ? '中' : '大';
    const atr5 = vm.atrOverRange * pts;
    const stopMin = Math.round(1.5 * atr5 / 10) * 10, stopTyp = Math.round(2.5 * atr5 / 10) * 10;
    const riskBudget = cfg.account * cfg.riskPct / 100;
    const lots = Object.fromEntries(['TX', 'MTX', 'TMF'].map(ins => { const per = (stopTyp + costPoints(ins, ref, cfg)) * cfg.costs[ins].mult; return [ins, { perLot: per, lots: Math.floor(riskBudget / per) }]; }));
    vol = { nightRangePct: nr * 100, nightRangePts: N.high - N.low, group, expPts: pts, lo: pts * Math.exp(vm.lo), hi: pts * Math.exp(vm.hi), atr5, stopMin, stopTyp, lots, riskBudget,
      costTMF: costPoints('TMF', ref, cfg), costMTX: costPoints('MTX', ref, cfg), costTX: costPoints('TX', ref, cfg), costShareTMF: costPoints('TMF', ref, cfg) / stopTyp };
  }

  // market snapshot (options walls etc.)
  const latest = (cfg.latestJsonCandidates || []).map(readJson).filter(Boolean).sort((a, b) => String(b.asOfDate).localeCompare(String(a.asOfDate)))[0] || null;
  const opt = latest?.options?.data;
  const expiries = (opt?.contracts || []).filter(c => c.expiryDate >= today).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const isMonthly = c => c.type === 'monthly' || /^\d{6}$/.test(c.contract);
  const monthly = expiries.find(isMonthly);
  const nearest = expiries[0];

  // levels
  const levels = [];
  const add = (price, label, source, real = true) => { if (Number.isFinite(price)) levels.push({ price, label, source, real }); };
  if (D) { add(D.high, '昨日日盤高點', '自收逐筆'); add(D.low, '昨日日盤低點', '自收逐筆'); add(D.close, '昨日日盤收盤', '自收逐筆'); }
  const vp = priorDay ? volumeProfile(priorDay.hist) : null;
  if (vp) { add(vp.poc, '昨日成交最多價位（POC）', '自收逐筆'); add(vp.vah, '昨日價值區上緣（VAH）', '自收逐筆'); add(vp.val, '昨日價值區下緣（VAL）', '自收逐筆'); }
  if (N) { add(N.high, '夜盤高點', '自收逐筆'); add(N.low, '夜盤低點', '自收逐筆'); }
  for (const c of [nearest, monthly].filter((c, i, a) => c && a.indexOf(c) === i)) {
    const tag = isMonthly(c) ? '月選' : '週選';
    add(c.callWall?.strike, `${tag} ${c.expiryDate.slice(5)} Call 牆（OI ${fmt(c.callWall?.openInterest)}）`, `期交所 ${latest.asOfDate}`);
    add(c.putWall?.strike, `${tag} ${c.expiryDate.slice(5)} Put 牆（OI ${fmt(c.putWall?.openInterest)}）`, `期交所 ${latest.asOfDate}`);
    add(c.maxPain, `${tag} ${c.expiryDate.slice(5)} Max Pain`, `期交所 ${latest.asOfDate}`);
  }
  if (ref && vol) { const span = 1.5 * vol.expPts; for (let p = Math.ceil((ref - span) / 500) * 500; p <= ref + span; p += 500) add(p, '整數關卡', '整數'); }
  const dedup = [...new Map(levels.map(l => [l.price + '|' + l.label, l])).values()].sort((a, b) => b.price - a.price);
  for (const l of dedup) { l.dist = ref ? l.price - ref : null; l.distX = vol ? Math.abs(l.dist) / vol.expPts : null; }

  // overnight quotes
  const q = cfg.yahoo === false ? null : await fetchQuotes(cfg.yahooSymbols);
  let overnight = null;
  if (q && !q.error) {
    const d = new Date(nowMs + 8 * 3600000); const at5 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 5) - 8 * 3600000;
    const pc = k => q[k]?.price && q[k]?.prevClose ? q[k].price / q[k].prevClose - 1 : null;
    const adr = q.tsmADR?.price, twd = q.usdtwd?.price, tw2330 = q.tw2330?.prevClose ?? q.tw2330?.price;
    overnight = { sox: pc('sox'), nasdaq: pc('nasdaq'), tsmADR: pc('tsmADR'), usVix: q.usVix?.price, nqSince5: changeSince(q.nq?.points, at5), esSince5: changeSince(q.es?.points, at5), nikkei: pc('nikkei'), kospi: pc('kospi'), usdtwd: twd, usdtwdChg: pc('usdtwd'),
      adrPremium: adr && twd && tw2330 ? (adr * twd / 5) / tw2330 - 1 : null, errors: Object.entries(q).filter(([, v]) => v.error).map(([k]) => k) };
  }

  // calendar
  const cal = readJson(resolve(cfg.calendarFile)) || [];
  const horizon = tpeDate(nowMs + 10 * 86400000);
  const events = [
    ...expiries.filter(c => c.expiryDate <= horizon).map(c => ({ date: c.expiryDate, text: `${isMonthly(c) ? '月選' : '週選'}結算（${c.contract}）`, source: '期交所' })),
    ...cal.filter(e => e.date >= today && e.date <= horizon).map(e => ({ date: e.date, text: e.event, source: '手動行事曆' })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // health
  const audit = readJson(cfg.liveAuditLatest);
  const v310 = readJson(cfg.v310Status);
  const v4 = readJson(cfg.v4Status);
  const lastTick = Math.max(0, ...caches.map(c => c.lastTickMs || 0)) || null;
  const health = [
    { label: '行情收集', ok: !!(lastTick && nowMs - lastTick < 5 * 3600000), text: lastTick ? `最後一筆台指期成交 ${new Date(lastTick + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ')}` : '找不到今天的逐筆資料' },
    { label: '前向測試（V3.10）', ok: v310?.state === 'PASS' && Math.abs(nowMs - Date.parse(v310.tradeDate + 'T14:00:00+08:00')) < 4 * 86400000, text: v310 ? `${v310.tradeDate} ${v310.state}` : '讀不到狀態' },
    { label: 'V4 趨勢紙上追蹤', ok: !!v4, text: v4 ? `已平倉 ${v4.closedTrades}/60 筆，資料到 ${v4.lastTradeDate}` : '讀不到狀態' },
    { label: '下單功能', ok: true, text: '關閉（研究與計畫用途）' },
  ];

  return { generatedAt: now.toISOString(), today, ref, night: N, nightKey: night?.key, priorDay: D, priorKey: priorDay?.key, contract: night?.contract || priorDay?.contract, vp, vol, levels: dedup, overnight, events, health, v4, latestAsOf: latest?.asOfDate, taiwanVix: latest?.taiwanVix?.data?.close, nightFlow: night ? night.bars.reduce((s, b) => s + b.buy - b.sell, 0) : null, cfg: { account: cfg.account, riskPct: cfg.riskPct, costs: cfg.costs } };
}

const pct = (x, d = 2) => x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
export function renderHtml(r) {
  const groupBars = ['小', '中', '大'].map(g => `<span style="width:56px;height:12px;border-radius:3px;background:${r.vol?.group === g ? '#15171C' : '#DCDDD8'}"></span>`).join('');
  const lv = r.levels.map(l => {
    const cur = '';
    const color = l.dist > 0 ? '#B4232C' : '#17693F';
    const faded = l.distX != null && l.distX > 1.5 ? 'opacity:.45' : '';
    return `<tr style="${faded}"><td class="mono">${fmt(l.price)}</td><td>${esc(l.label)}</td><td style="text-align:right;color:${color}">${l.dist == null ? '—' : (l.dist > 0 ? '+' : '') + fmt(l.dist)}</td><td style="text-align:right">${l.distX == null ? '—' : l.distX.toFixed(1)}</td><td>${esc(l.source)}</td></tr>${cur}`;
  });
  const refRowIdx = r.levels.findIndex(l => l.price < r.ref);
  if (r.ref != null) lv.splice(refRowIdx < 0 ? lv.length : refRowIdx, 0, `<tr style="background:#15171C;color:#F6F6F3"><td class="mono">${fmt(r.ref)}</td><td><b>目前（夜盤收）</b></td><td style="text-align:right">—</td><td style="text-align:right">—</td><td>自收逐筆</td></tr>`);
  const o = r.overnight;
  const row = (k, v) => `<div class="kv"><span>${k}</span><strong>${v}</strong></div>`;
  const healthHtml = r.health.map(h => `<div class="hl ${h.ok ? 'ok' : 'warn'}"><div class="ht">${h.ok ? '●' : '▲'} ${esc(h.label)}</div><div class="hs">${esc(h.text)}</div></div>`).join('');
  const ev = r.events.length ? r.events.map(e => `<div class="ev"><strong>${e.date.slice(5)}</strong> ${esc(e.text)} <span class="src">${esc(e.source)}</span></div>`).join('') : '<div class="muted">10 天內沒有登記的事件（美國數據請填 calendar.json）</div>';
  const v = r.vol;
  const v4 = r.v4;
  const data = JSON.stringify({ ref: r.ref, costs: r.cfg.costs, account: r.cfg.account, riskPct: r.cfg.riskPct, stopTyp: v?.stopTyp ?? null });
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>勢衡 開盤前報告 ${r.today}</title>
<style>
body{margin:0;background:#F6F6F3;color:#15171C;font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;font-variant-numeric:tabular-nums}
header{background:#15171C;color:#F6F6F3}.wrap{max-width:1280px;margin:0 auto;padding:16px 24px}
main{max-width:1280px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:20px}
.card{background:#fff;border:1px solid #DCDDD8;border-radius:10px;padding:20px}h2{margin:0;font-size:18px}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.tag{font-size:12px;padding:4px 8px;border-radius:4px;font-weight:700}.ok{background:#EAF5EE}.warn{background:#FFF4DD}.hl{border-radius:8px;padding:12px}.ht{font-size:13px;font-weight:700}.ok .ht{color:#17693F}.warn .ht{color:#7A4A00}.hs{font-size:13px;color:#3D4350;margin-top:4px}
.box{background:#F6F6F3;border-radius:8px;padding:12px}.lab{font-size:13px;color:#5B6270}.big{font-size:22px;font-weight:700;margin-top:4px}.muted{font-size:13px;color:#5B6270}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:#5B6270;font-weight:500;font-size:13px;border-bottom:1px solid #DCDDD8;padding:8px}td{padding:8px}.mono{font-family:Consolas,"JetBrains Mono",monospace;font-weight:600}
.kv{display:flex;justify-content:space-between;font-size:14px;padding:4px 0}.ev{font-size:14px;padding:8px;border:1px solid #DCDDD8;border-radius:8px;margin-top:6px}.src{color:#5B6270;font-size:12px}
label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#5B6270}input,select{min-height:40px;border:1px solid #A9ADB5;border-radius:6px;padding:0 10px;font-size:15px;color:#15171C}
@media (max-width:800px){.grid2,.grid3,.grid4{grid-template-columns:1fr}}
</style></head><body>
<header><div class="wrap" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:baseline"><div><b style="font-size:20px">勢衡 開盤前報告</b> <span style="color:#C9CDD4;font-size:14px">${r.today}｜產生於 ${new Date(new Date(r.generatedAt).getTime() + 8 * 3600000).toISOString().slice(11, 16)}｜合約 ${esc(r.contract || '—')}</span></div><div style="color:#C9CDD4;font-size:13px">研究與計畫用途，不會下單</div></div></header>
<main>
<section class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><h2>系統健康</h2><span class="muted">不是綠燈的項目，今天的紀錄要打折看</span></div><div class="grid4" style="margin-top:12px">${healthHtml}</div></section>

<section class="grid2">
<div class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><h2>今天會動多大？</h2><span class="tag ok" style="color:#17693F">已驗證：夜盤波幅 → 日盤波幅，相關 0.49</span></div>
${v ? `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:14px"><div style="font-size:40px;font-weight:700">${v.group}</div><div style="display:flex;gap:6px">${groupBars}</div><div>預期日盤高低差約 <b>${fmt(v.expPts, 0)} 點</b>（多數落在 ${fmt(v.lo, 0)}–${fmt(v.hi, 0)}）</div></div>
<div class="grid3" style="margin-top:16px"><div class="box"><div class="lab">建議停損寬度</div><div class="big">${fmt(v.stopMin)}–${fmt(v.stopTyp)} 點</div><div class="lab">小於 ${fmt(v.stopMin)} 容易被洗掉</div></div>
<div class="box"><div class="lab">每筆口數上限（${r.cfg.riskPct}%）</div><div class="big">微台 ${v.lots.TMF.lots}／小台 ${v.lots.MTX.lots}／大台 ${v.lots.TX.lots}</div><div class="lab">以 ${fmt(v.stopTyp)} 點停損、帳戶 ${fmt(r.cfg.account)} 計</div></div>
<div class="box"><div class="lab">成本佔每筆風險（微台）</div><div class="big">${(v.costShareTMF * 100).toFixed(1)}%</div><div class="lab">來回 微台 ${v.costTMF.toFixed(1)}／小台 ${v.costMTX.toFixed(1)}／大台 ${v.costTX.toFixed(1)} 點</div></div></div>
<p class="muted" style="line-height:1.7">夜盤波幅 ${fmt(v.nightRangePts)} 點（${v.nightRangePct.toFixed(2)}%）。這張卡只說「會動多大」，不說往哪邊。</p>` : '<p class="muted">缺少夜盤資料，無法估計。</p>'}</div>
<div class="card"><h2>今日背景數字</h2><div style="margin-top:10px">
${row('夜盤 高／低／收', r.night ? `${fmt(r.night.high)} ／ ${fmt(r.night.low)} ／ ${fmt(r.night.close)}` : '—')}
${row('昨日日盤 高／低／收', r.priorDay ? `${fmt(r.priorDay.high)} ／ ${fmt(r.priorDay.low)} ／ ${fmt(r.priorDay.close)}` : '—')}
${row('昨日 POC／VAH／VAL', r.vp ? `${fmt(r.vp.poc)} ／ ${fmt(r.vp.vah)} ／ ${fmt(r.vp.val)}` : '—')}
${row('夜盤主動買賣差（口）', r.nightFlow == null ? '—' : (r.nightFlow > 0 ? '+' : '') + fmt(r.nightFlow))}
${row('台灣 VIX', r.taiwanVix ?? '—')}
<div class="muted" style="border-top:1px solid #DCDDD8;padding-top:8px;margin-top:6px">籌碼與選擇權資料日期：${esc(r.latestAsOf || '—')}。主動買賣差只是描述，不代表方向。</div></div></div>
</section>

<section class="grid2">
<div class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><h2>隔夜摘要</h2><span class="tag" style="background:#F0F0EC;color:#3D4350">只說發生什麼，不給偏多／偏空</span></div>
${o ? `<div class="grid2" style="margin-top:10px"><div><div class="lab" style="margin-bottom:6px">美股時段（已反映在夜盤）</div>${row('費城半導體', pct(o.sox))}${row('那斯達克', pct(o.nasdaq))}${row('台積電 ADR', pct(o.tsmADR) + (o.adrPremium != null ? `（溢價 ${pct(o.adrPremium, 1)}）` : ''))}${row('美國 VIX', o.usVix != null ? o.usVix.toFixed(2) : '—')}</div>
<div><div class="lab" style="margin-bottom:6px">05:00 之後（開盤前的新資訊）</div>${row('那斯達克期貨 05:00→現在', pct(o.nqSince5))}${row('S&amp;P 500 期貨 05:00→現在', pct(o.esSince5))}${row('日經', pct(o.nikkei))}${row('韓國 KOSPI', pct(o.kospi))}${row('美元／新台幣', o.usdtwd ? `${o.usdtwd.toFixed(3)}（${pct(o.usdtwdChg)}）` : '—')}</div></div>
${o.errors.length ? `<p class="muted">取不到：${esc(o.errors.join(', '))}</p>` : ''}` : '<p class="muted">取不到隔夜行情（網路或 Yahoo 暫時無法連線）。</p>'}</div>
<div class="card"><h2>未來 10 天行事曆</h2><div class="muted">會放大波動的事件</div>${ev}</div>
</section>

<section class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><h2>參考價位地圖</h2><span class="tag warn" style="color:#7A4A00">參考價位，不是預測目標</span></div>
<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>價位</th><th>來源</th><th style="text-align:right">距離目前</th><th style="text-align:right">約幾倍預期波幅</th><th>資料</th></tr></thead><tbody>${lv.join('')}</tbody></table></div>
<p class="muted">紅字在上方、綠字在下方。超過 1.5 倍預期波幅的價位已淡化，今天大多碰不到。</p></section>

<section class="grid2">
<div class="card"><h2>交易計畫計算器</h2><p class="muted">你決定方向和價位，系統算風險報酬、打平勝率和口數</p>
<div class="grid3"><label>方向<select id="dir"><option value="1">做多</option><option value="-1">做空</option></select></label><label>進場價<input id="entry" inputmode="decimal"></label><label>停損價<input id="stop" inputmode="decimal"></label>
<label>目標 1<input id="t1" inputmode="decimal"></label><label>目標 2（可空白）<input id="t2" inputmode="decimal"></label><label>帳戶／每筆風險 %<input id="acct" inputmode="decimal"></label></div>
<div id="calc" style="margin-top:14px"></div></div>
<div class="card"><h2>V4 趨勢追蹤（紙上）</h2>${v4 ? `<div style="margin-top:10px">${row('已平倉／目標', `${v4.closedTrades} ／ 60 筆`)}${row('累計（大台成本後）', `${v4.totalRNetTX >= 0 ? '+' : ''}${v4.totalRNetTX}R`)}${row('平均每筆', v4.meanRNetTX == null ? '—' : `${v4.meanRNetTX}R`)}${row('目前部位', v4.openPosition ? `${v4.openPosition.direction === 'LONG' ? '多' : '空'} @ ${fmt(v4.openPosition.entry)}，移動停利 ${fmt(v4.openPosition.currentStop)}` : '無')}${row('資料截至', v4.lastTradeDate)}</div><p class="muted">60 分 K 突破＋ATR 移動停利。規則凍結，未驗證，只記錄不下單。</p>` : '<p class="muted">讀不到 V4 狀態。</p>'}</div>
</section>

<section class="card"><h2>開盤前檢查</h2><div class="grid2" style="margin-top:10px;font-size:15px">
<label style="flex-direction:row;align-items:center;color:#15171C"><input type="checkbox"> 系統健康全部綠燈或已知原因</label><label style="flex-direction:row;align-items:center;color:#15171C"><input type="checkbox"> 知道今天的波動組別和口數上限</label>
<label style="flex-direction:row;align-items:center;color:#15171C"><input type="checkbox"> 只在參考價位附近找機會，不追價</label><label style="flex-direction:row;align-items:center;color:#15171C"><input type="checkbox"> 每筆進場前用計算器填完計畫</label>
<label style="flex-direction:row;align-items:center;color:#15171C"><input type="checkbox"> 今日虧損達 3R 就停止交易</label></div></section>
</main>
<script>
const D=${data};
const $=id=>document.getElementById(id);
const fmt=(x,d=0)=>Number.isFinite(x)?x.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
function cost(ins,p){const c=D.costs[ins];const tax=Math.round(p*c.mult*D.costs.taxRate);return (2*c.comm+2*tax+2*D.costs.slipTicks*c.mult)/c.mult;}
function init(){if(D.ref){$('entry').value=D.ref;if(D.stopTyp){$('stop').value=D.ref-D.stopTyp;$('t1').value=D.ref+Math.round(D.stopTyp*1.5);$('t2').value=D.ref+D.stopTyp*3;}}$('acct').value=D.account+' / '+D.riskPct;['dir','entry','stop','t1','t2','acct'].forEach(i=>$(i).addEventListener('input',calc));$('dir').addEventListener('change',()=>{const d=+$('dir').value,e=+$('entry').value;if(e&&D.stopTyp){$('stop').value=e-d*D.stopTyp;$('t1').value=e+d*Math.round(D.stopTyp*1.5);$('t2').value=e+d*D.stopTyp*3;}calc();});calc();}
function calc(){const d=+$('dir').value,e=+$('entry').value,s=+$('stop').value;const [acct,rp]=String($('acct').value).split('/').map(x=>+x.trim());const S=d*(e-s);
if(!(S>0)){$('calc').innerHTML='<p class="muted">停損要在進場價的'+(d>0?'下方':'上方')+'。</p>';return;}
const rows=['t1','t2'].map(k=>+$(k).value).filter(t=>t&&d*(t-e)>0).map((t,i)=>{const T=d*(t-e);const c=cost('TMF',e);const rnd=S/(S+T),be=(S+c)/(S+T);return '<tr><td>目標 '+(i+1)+' '+fmt(t)+'（'+(d>0?'+':'−')+fmt(T)+'）</td><td style="text-align:right">1 : '+(T/S).toFixed(2)+'</td><td style="text-align:right">'+(rnd*100).toFixed(1)+'%</td><td style="text-align:right">'+(be*100).toFixed(1)+'%</td><td style="text-align:right"><b>+'+((be-rnd)*100).toFixed(1)+' 個百分點</b></td></tr>';});
const budget=(acct||D.account)*(rp||D.riskPct)/100;const lots=['TMF','MTX','TX'].map(ins=>{const per=(S+cost(ins,e))*D.costs[ins].mult;const n=Math.floor(budget/per);return {ins,per,n};});
const name={TMF:'微台',MTX:'小台',TX:'大台'};
$('calc').innerHTML='<div style="overflow-x:auto"><table><thead><tr><th>目標</th><th style="text-align:right">風險報酬比</th><th style="text-align:right">隨機勝率</th><th style="text-align:right">打平需要</th><th style="text-align:right">需要多贏</th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>'+
'<p class="muted">以微台成本計。風險報酬比本身不產生優勢，進場理由必須讓勝率高出上表差距。</p><div class="grid3">'+lots.map(l=>'<div class="box"><div class="lab">'+name[l.ins]+'（每口虧 '+fmt(l.per)+'）</div><div class="big">'+l.n+' 口</div></div>').join('')+'</div><p class="muted">每筆最多虧 '+fmt(budget)+'。系統只計算，不會下單。</p>';}
init();
</script></body></html>`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig(opt('--config', path.join(HERE, 'config.json')));
  const now = opt('--now') ? new Date(opt('--now')) : new Date();
  const mode = opt('--mode', 'report');
  if (mode === 'cache') { const c = updateAllCaches(cfg, now); console.log(`cache updated: ${c.length} ledger files, ticks ${c.reduce((s, x) => s + x.ticks, 0)}`); }
  else {
    const r = await buildReport(cfg, now);
    const outDir = resolve(cfg.outDir); fs.mkdirSync(outDir, { recursive: true });
    const html = renderHtml(r);
    fs.writeFileSync(path.join(outDir, `${r.today}.html`), html); fs.writeFileSync(path.join(outDir, 'latest.html'), html);
    fs.writeFileSync(path.join(outDir, `${r.today}.json`), JSON.stringify({ ...r, cfg: undefined }, null, 1));
    console.log(`report written: ${path.join(outDir, r.today + '.html')} | ref ${r.ref} | vol ${r.vol?.group ?? '—'} | levels ${r.levels.length} | overnight ${r.overnight ? 'ok' : 'missing'}`);
  }
}
