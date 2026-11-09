// Read-only: summarise Shioaji live-event ledgers (data/live-events/YYYY-MM-DD.ndjson) into compact 1-minute files.
// Never writes to the ledger, never reads credentials, never sends orders.
// Output per ledger day: out/flow1m-YYYY-MM-DD.json  (skip if already built for the same ledger size; resumable)
// Usage: node build-flow-1m-shioaji.mjs --ledger-dir "D:\Taiwan stock\standalone-v1\data\live-events" --out out --from 2026-07-27 --to 2026-11-07
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const LEDGER = opt('--ledger-dir', 'D:\\Taiwan stock\\standalone-v1\\data\\live-events');
const OUT = opt('--out', 'out');
const FROM = opt('--from', '2026-07-27'), TO = opt('--to', '2026-11-07');
fs.mkdirSync(OUT, { recursive: true });

const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
function parseLocal(ts) {
  if (typeof ts !== 'string' || !ts.trim()) return null;
  let t = ts.trim().replace(' ', 'T'); if (!/(Z|[+-]\d{2}:?\d{2})$/.test(t)) t += '+08:00';
  const ms = Date.parse(t); return Number.isFinite(ms) ? ms : null;
}
const sum5 = a => Array.isArray(a) ? a.slice(0, 5).reduce((s, x) => s + (num(x) || 0), 0) : null;
function sample(rec) {
  const p = rec.payload || {};
  return { kind: rec.kind, code: rec.code, product: rec.product, topKeys: Object.keys(rec), payloadKeys: Object.keys(p),
    payload: Object.fromEntries(Object.entries(p).slice(0, 40).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 5) : (typeof v === 'string' ? v.slice(0, 40) : v)])) };
}

async function buildDay(file) {
  const date = path.basename(file, '.ndjson');
  const size = fs.statSync(file).size;
  const outFile = path.join(OUT, `flow1m-${date}.json`);
  if (fs.existsSync(outFile)) { try { const o = JSON.parse(fs.readFileSync(outFile, 'utf8')); if (o.ledgerSize === size) return 'skip'; } catch {} }
  const tx = new Map(), idx = new Map(), stk = new Map();
  const kinds = {}, samples = {}; const book = new Map(); // contract -> {bid, ask}
  let lines = 0, bad = 0, dups = 0;
  const onLine = line => {
    lines++;
    const isTick = line.includes('"futures_tick"'), isBA = !isTick && line.includes('"futures_bidask"');
    const isIdx = !isTick && !isBA && line.includes('"index_quote"'), isStk = !isTick && !isBA && !isIdx && line.includes('"stock_tick"');
    if (!isTick && !isBA && !isIdx && !isStk) return;
    if ((isTick || isBA) && !/"_product_family"\s*:\s*"TX"/.test(line)) return;
    let r; try { r = JSON.parse(line); } catch { bad++; return; }
    kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    if (!samples[r.kind]) samples[r.kind] = sample(r);
    if (r.duplicate === true) { dups++; return; }
    const p = r.payload || {}; if (p.simtrade === true) return;
    const ms = parseLocal(p.datetime || r.exchangeTimestamp); if (ms == null) return;
    const m = ms - (ms % 60000);
    if (isTick || isBA) {
      const contract = String(p._target_code || r.product || p.code || 'TX');
      if (isBA) {
        const bid = num(Array.isArray(p.bid_price) ? p.bid_price[0] : p.bid_price), ask = num(Array.isArray(p.ask_price) ? p.ask_price[0] : p.ask_price);
        const B = sum5(p.bid_volume), A = sum5(p.ask_volume);
        if (bid != null && ask != null && bid > 0 && ask > 0) book.set(contract, { bid, ask });
        const k = `${contract}|${m}`; const x = tx.get(k) || newMin(m, contract, null); tx.set(k, x);
        if (B != null && A != null && B + A > 0) { x.ban++; x.imbSum += (B - A) / (B + A); x.bvLast = B; x.avLast = A; }
        if (bid != null && ask != null && ask >= bid && bid > 0) { x.sprSum += ask - bid; x.sprN++; x.bid = bid; x.ask = ask; }
        return;
      }
      const price = num(p.close), vol = num(p.volume); if (price == null || vol == null || vol <= 0) return;
      const k = `${contract}|${m}`; const x = tx.get(k) || newMin(m, contract, price); tx.set(k, x);
      if (x.o == null) { x.o = x.h = x.l = price; }
      x.h = Math.max(x.h, price); x.l = Math.min(x.l, price); x.c = price; x.v += vol; x.n++;
      const side = Number(p.tick_type);
      if (side === 1) { x.bv += vol; x.bn++; } else if (side === 2) { x.sv += vol; x.sn++; } else x.uv += vol;
      const bk = book.get(contract);
      if (bk) { if (price >= bk.ask) x.qb += vol; else if (price <= bk.bid) x.qs += vol; else x.qi += vol; } else x.qu += vol;
      return;
    }
    if (isIdx) { const code = String(r.code || p.code || ''); if (code !== 'IX0001') return; const c = num(p.close ?? p.price ?? p.index); if (c == null) return; idx.set(m, c); return; }
    if (isStk) { const code = String(r.code || p.code || ''); if (code !== '2330') return; const c = num(p.close), v = num(p.volume); if (c == null) return; const s = stk.get(m) || { c, v: 0, bv: 0, sv: 0 }; s.c = c; s.v += v || 0; const sd = Number(p.tick_type); if (sd === 1) s.bv += v || 0; else if (sd === 2) s.sv += v || 0; stk.set(m, s); }
  };
  await new Promise((resolve, reject) => {
    let carry = '';
    const st = fs.createReadStream(file, { highWaterMark: 16 * 1024 * 1024, encoding: 'utf8' });
    st.on('data', chunk => { const text = carry + chunk; let start = 0, nl; while ((nl = text.indexOf('\n', start)) >= 0) { onLine(text.slice(start, nl)); start = nl + 1; } carry = text.slice(start); });
    st.on('end', () => { if (carry.trim()) onLine(carry); resolve(); });
    st.on('error', reject);
  });
  const cols = ['t', 'contract', 'o', 'h', 'l', 'c', 'v', 'n', 'bv', 'sv', 'uv', 'bn', 'sn', 'qb', 'qs', 'qi', 'qu', 'ban', 'imbSum', 'bvLast', 'avLast', 'sprSum', 'sprN', 'bid', 'ask'];
  const rows = [...tx.values()].sort((a, b) => a.t - b.t || a.contract.localeCompare(b.contract)).map(x => cols.map(c => x[c] ?? null));
  const out = { schemaVersion: 'flow1m-shioaji-v1', date, ledgerFile: path.basename(file), ledgerSize: size, builtAt: new Date().toISOString(), lines, badJson: bad, duplicatesSkipped: dups, kinds, samples,
    txColumns: cols, tx: rows, ix0001: [...idx.entries()].sort((a, b) => a[0] - b[0]), s2330: [...stk.entries()].sort((a, b) => a[0] - b[0]).map(([t, s]) => [t, s.c, s.v, s.bv, s.sv]),
    researchOnly: true, executionAuthorized: false };
  fs.writeFileSync(outFile, JSON.stringify(out));
  return `${rows.length} TX minutes, ${idx.size} index minutes, ${stk.size} 2330 minutes`;
}
function newMin(t, contract, price) { return { t, contract, o: price, h: price, l: price, c: price, v: 0, n: 0, bv: 0, sv: 0, uv: 0, bn: 0, sn: 0, qb: 0, qs: 0, qi: 0, qu: 0, ban: 0, imbSum: 0, bvLast: null, avLast: null, sprSum: 0, sprN: 0, bid: null, ask: null }; }

const files = fs.readdirSync(LEDGER).filter(f => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).map(f => f.slice(0, 10)).filter(d => d >= FROM && d <= TO).sort();
console.log(`[${new Date().toISOString()}] ${files.length} ledger files ${FROM}..${TO}`);
for (const d of files) {
  const t0 = Date.now();
  try { const r = await buildDay(path.join(LEDGER, `${d}.ndjson`)); console.log(`${d}: ${r} (${((Date.now() - t0) / 1000).toFixed(0)}s)`); }
  catch (e) { console.log(`${d}: ERROR ${e.message}`); }
}
console.log(`[${new Date().toISOString()}] done`);
