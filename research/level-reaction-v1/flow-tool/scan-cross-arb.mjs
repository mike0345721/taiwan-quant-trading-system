// Read-only descriptive scan: executable price gaps between TX, MTX (x4) and TMF (x20) using Shioaji best bid/ask.
// Never writes to the ledger, never reads credentials, never sends orders.
// For each pair and side, an "episode" starts when the executable gap (sell the rich leg at its bid, buy the cheap leg at its ask,
// in TX-equivalent index points) exceeds the fee-only round-trip cost, and ends when it falls back below.
// Recorded per episode: start time, duration, start/max gap, top-of-book size, the gap still available 300 ms / 1 s later
// (what a slower trader would get), and the best round-trip result within 60 s (entry gap + best later reverse gap).
// Usage: node scan-cross-arb.mjs --ledger-dir "...\live-events" --out out --from 2026-07-30 --to 2026-11-07
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const LEDGER = opt('--ledger-dir', 'D:\\Taiwan stock\\standalone-v1\\data\\live-events');
const OUT = opt('--out', 'out');
const FROM = opt('--from', '2026-07-30'), TO = opt('--to', '2026-11-07');
fs.mkdirSync(OUT, { recursive: true });

// fee-only round trip (commission + futures transaction tax 0.00002 per side), NT$; converted to TX index points per pair unit
const FEES = { TX: { mult: 200, comm: 30 }, MTX: { mult: 50, comm: 17 }, TMF: { mult: 10, comm: 12 } };
const rtFee = (ins, price) => 2 * (FEES[ins].comm + Math.round(price * FEES[ins].mult * 0.00002));
const PAIRS = [ // a = larger contract, b = smaller, k = number of b per a
  { name: 'TX-MTX', a: 'TX', b: 'MTX', k: 4, unitMult: 200 },
  { name: 'TX-TMF', a: 'TX', b: 'TMF', k: 20, unitMult: 200 },
  { name: 'MTX-TMF', a: 'MTX', b: 'TMF', k: 5, unitMult: 50 },
];
const feePoints = (pr, price) => (rtFee(pr.a, price) + pr.k * rtFee(pr.b, price)) / pr.unitMult;

const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
function parseLocal(ts) {
  if (typeof ts !== 'string' || !ts.trim()) return null;
  let t = ts.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'); if (!/(Z|[+-]\d{2}:?\d{2})$/.test(t)) t += '+08:00';
  const ms = Date.parse(t); return Number.isFinite(ms) ? ms : null;
}
const FAM_RE = /"_product_family"\s*:\s*"(TX|MTX|TMF)"/;

async function scanDay(file) {
  const date = path.basename(file, '.ndjson');
  const size = fs.statSync(file).size;
  const outFile = path.join(OUT, `arb-${date}.json`);
  if (fs.existsSync(outFile)) { try { if (JSON.parse(fs.readFileSync(outFile, 'utf8')).ledgerSize === size) return 'skip'; } catch {} }
  const book = {}; // `${fam}|${suffix}` -> {bid, ask, bq, aq, t}
  let clock = 0, updates = 0, lines = 0;
  const state = new Map(); // `${pair}|${side}|${suffix}` -> {gap, ep}
  const episodes = [], pending = [];
  const timeAbove = {}; // `${pair}|${side}|${hour}` -> ms above fee
  const exposure = {}; // `${pair}|${hour}` -> ms with both books present
  let lastClock = null;
  const gapsFor = (suffix) => {
    const out = [];
    for (const pr of PAIRS) {
      const A = book[`${pr.a}|${suffix}`], B = book[`${pr.b}|${suffix}`]; if (!A || !B) continue;
      const mid = (A.bid + A.ask) / 2;
      const fee = feePoints(pr, mid);
      // side 'sellA': sell 1 A at A.bid, buy k B at B.ask  -> gap = A.bid - B.ask (index points, same per unit)
      // side 'sellB': sell k B at B.bid, buy 1 A at A.ask  -> gap = B.bid - A.ask
      out.push({ pr, side: 'sellA', gap: A.bid - B.ask, rev: B.bid - A.ask, fee, qty: Math.min(A.bq, Math.floor(B.aq / pr.k)) });
      out.push({ pr, side: 'sellB', gap: B.bid - A.ask, rev: A.bid - B.ask, fee, qty: Math.min(A.aq, Math.floor(B.bq / pr.k)) });
    }
    return out;
  };
  const onBook = (fam, suffix, t) => {
    clock = Math.max(clock, t);
    // accumulate time-above and exposure since the last update, using the previous state
    if (lastClock != null && clock > lastClock) {
      const dt = clock - lastClock; const hour = new Date(lastClock + 8 * 3600000).toISOString().slice(11, 13);
      for (const [key, s] of state) { const [pair, side] = key.split('|'); if (side === 'sellA') exposure[`${pair}|${hour}`] = (exposure[`${pair}|${hour}`] || 0) + dt; if (s.gap > s.fee) timeAbove[`${pair}|${side}|${hour}`] = (timeAbove[`${pair}|${side}|${hour}`] || 0) + dt; }
    }
    lastClock = clock;
    // latency checks use the state before this update
    for (const p of pending) {
      const s = state.get(p.key); if (!s) continue;
      if (p.ep.g300 == null && clock >= p.ep.t + 300) p.ep.g300 = s.gap;
      if (p.ep.g1000 == null && clock >= p.ep.t + 1000) p.ep.g1000 = s.gap;
      if (clock <= p.ep.t + 60000) p.ep.bestRev60 = Math.max(p.ep.bestRev60, s.rev);
    }
    for (let i = pending.length - 1; i >= 0; i--) if (clock > pending[i].ep.t + 60000) pending.splice(i, 1);
    for (const g of gapsFor(suffix)) {
      const key = `${g.pr.name}|${g.side}|${suffix}`;
      const s = state.get(key) || { gap: null, rev: null, fee: g.fee, ep: null };
      s.gap = g.gap; s.rev = g.rev; s.fee = g.fee;
      if (g.gap > g.fee) {
        if (!s.ep) { s.ep = { pair: g.pr.name, side: g.side, contract: suffix, t: clock, startGap: g.gap, maxGap: g.gap, fee: +g.fee.toFixed(2), qty: g.qty, g300: null, g1000: null, bestRev60: g.rev, dur: 0, updates: 0 }; episodes.push(s.ep); pending.push({ key, ep: s.ep }); }
        s.ep.maxGap = Math.max(s.ep.maxGap, g.gap); s.ep.updates++;
      } else if (s.ep) { s.ep.dur = clock - s.ep.t; s.ep = null; }
      state.set(key, s);
    }
  };
  const onLine = line => {
    lines++;
    if (!line.includes('"futures_bidask"')) return;
    const fm = FAM_RE.exec(line); if (!fm) return;
    let r; try { r = JSON.parse(line); } catch { return; }
    if (r.kind !== 'futures_bidask' || r.duplicate === true) return;
    const p = r.payload || {}; if (p.simtrade === true) return;
    const bid = num(p.bid_price?.[0]), ask = num(p.ask_price?.[0]), bq = num(p.bid_volume?.[0]), aq = num(p.ask_volume?.[0]);
    const t = parseLocal(p.datetime || r.exchangeTimestamp); if (t == null) return;
    const code = String(p._target_code || r.code || ''); const suffix = code.slice(-2);
    if (!(bid > 0 && ask > 0 && ask >= bid)) { delete book[`${fm[1]}|${suffix}`]; return; } // one-sided book: not executable
    book[`${fm[1]}|${suffix}`] = { bid, ask, bq: bq || 0, aq: aq || 0, t };
    updates++; onBook(fm[1], suffix, t);
  };
  await new Promise((resolve, reject) => {
    let carry = '';
    const st = fs.createReadStream(file, { highWaterMark: 16 * 1024 * 1024, encoding: 'utf8' });
    st.on('data', chunk => { const text = carry + chunk; let s = 0, nl; while ((nl = text.indexOf('\n', s)) >= 0) { onLine(text.slice(s, nl)); s = nl + 1; } carry = text.slice(s); });
    st.on('end', () => { if (carry.trim()) onLine(carry); resolve(); });
    st.on('error', reject);
  });
  for (const s of state.values()) if (s.ep) s.ep.dur = clock - s.ep.t;
  const cols = ['pair', 'side', 'contract', 't', 'dur', 'startGap', 'maxGap', 'fee', 'qty', 'g300', 'g1000', 'bestRev60', 'updates'];
  fs.writeFileSync(outFile, JSON.stringify({ schemaVersion: 'cross-arb-scan-v1', date, ledgerSize: size, lines, bookUpdates: updates, feeModel: 'commission + tax only, no slippage', epColumns: cols, episodes: episodes.map(e => cols.map(c => e[c])), timeAboveMs: timeAbove, exposureMs: exposure, researchOnly: true, executionAuthorized: false }));
  return `${updates} book updates, ${episodes.length} episodes`;
}

const files = fs.readdirSync(LEDGER).filter(f => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).map(f => f.slice(0, 10)).filter(d => d >= FROM && d <= TO).sort();
console.log(`[${new Date().toISOString()}] ${files.length} ledger files ${FROM}..${TO}`);
for (const d of files) {
  const t0 = Date.now();
  try { console.log(`${d}: ${await scanDay(path.join(LEDGER, `${d}.ndjson`))} (${((Date.now() - t0) / 1000).toFixed(0)}s)`); }
  catch (e) { console.log(`${d}: ERROR ${e.message}`); }
}
console.log(`[${new Date().toISOString()}] done`);
