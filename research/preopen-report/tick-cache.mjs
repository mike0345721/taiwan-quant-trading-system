// Incremental, read-only aggregator for the Shioaji live-event ledger (data/live-events/YYYY-MM-DD.ndjson).
// Keeps, per ledger file, the byte offset already read plus 5-minute TX bars and per-session price/volume histograms.
// Never writes to the ledger. Lines are pre-filtered by text before JSON.parse to keep multi-GB files fast.
import fs from 'node:fs';
import path from 'node:path';

const TICK_RE = /"futures_tick"/;
const TX_RE = /"_product_family"\s*:\s*"TX"/;

export function parseLocal(ts) {
  if (typeof ts !== 'string' || !ts.trim()) return null;
  let t = ts.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(t)) t += '+08:00';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}
// Taipei wall clock helpers
const TPE = 8 * 3600000;
export const tpeDate = ms => new Date(ms + TPE).toISOString().slice(0, 10);
export const tpeMinutes = ms => { const d = new Date(ms + TPE); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export function sessionOf(ms) {
  const m = tpeMinutes(ms);
  if (m >= 525 && m <= 825) return { type: 'DAY', key: `DAY:${tpeDate(ms)}` };                    // 08:45-13:45
  if (m >= 900) return { type: 'NIGHT', key: `NIGHT:${tpeDate(ms)}` };                             // 15:00-23:59, keyed by start date
  if (m <= 300) return { type: 'NIGHT', key: `NIGHT:${tpeDate(ms - 86400000)}` };                  // 00:00-05:00 belongs to previous evening
  return null;
}
export function bucket5(ms) {
  const m = tpeMinutes(ms);
  if (m === 825) return ms - (ms % 60000) - 5 * 60000;           // 13:45 closing tick -> 13:40 bar
  if (m === 300) return ms - (ms % 60000) - 5 * 60000;           // 05:00 closing tick -> 04:55 bar
  return ms - (ms % 300000);
}

export function emptyCache(file) { return { schemaVersion: 'preopen-tick-cache-v1', file, offset: 0, bars: {}, hist: {}, ticks: 0, lastTickMs: null }; }

export function ingestLine(cache, line) {
  if (!TICK_RE.test(line) || !TX_RE.test(line)) return;
  let r; try { r = JSON.parse(line); } catch { return; }
  if (r.kind !== 'futures_tick' || r.duplicate === true) return;
  const p = r.payload || {};
  if (p._product_family !== 'TX') return;
  const price = Number(p.close), vol = Number(p.volume);
  const ms = parseLocal(p.datetime || r.exchangeTimestamp);
  if (!Number.isFinite(price) || !Number.isFinite(vol) || vol <= 0 || ms == null) return;
  const s = sessionOf(ms); if (!s) return;
  const contract = String(p._target_code || r.product || p.code || 'TX');
  const b5 = bucket5(ms), key = `${contract}|${b5}`;
  const b = cache.bars[key];
  const side = Number(p.tick_type);
  if (!b) cache.bars[key] = { t: b5, c: contract, s: s.key, o: price, h: price, l: price, cl: price, v: vol, buy: side === 1 ? vol : 0, sell: side === 2 ? vol : 0 };
  else { b.h = Math.max(b.h, price); b.l = Math.min(b.l, price); b.cl = price; b.v += vol; if (side === 1) b.buy += vol; else if (side === 2) b.sell += vol; }
  const hk = `${s.key}|${contract}`;
  const hist = cache.hist[hk] || (cache.hist[hk] = {});
  hist[price] = (hist[price] || 0) + vol;
  cache.ticks++; cache.lastTickMs = Math.max(cache.lastTickMs || 0, ms);
}

export function updateCache(ledgerFile, cacheFile, { chunkBytes = 64 * 1024 * 1024 } = {}) {
  let cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : emptyCache(path.basename(ledgerFile));
  if (!fs.existsSync(ledgerFile)) return cache;
  const size = fs.statSync(ledgerFile).size;
  if (size < cache.offset) cache = emptyCache(path.basename(ledgerFile)); // file replaced: rebuild
  const fd = fs.openSync(ledgerFile, 'r');
  try {
    let pos = cache.offset, carry = '';
    const buf = Buffer.allocUnsafe(chunkBytes);
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(chunkBytes, size - pos), pos);
      if (n <= 0) break;
      const text = carry + buf.toString('utf8', 0, n);
      const lastNl = text.lastIndexOf('\n');
      if (lastNl < 0) { carry = text; pos += n; continue; }
      const complete = text.slice(0, lastNl);
      carry = text.slice(lastNl + 1);
      for (const line of complete.split('\n')) if (line) ingestLine(cache, line.replace(/\r$/, ''));
      pos += n;
      cache.offset = pos - Buffer.byteLength(carry, 'utf8');
    }
  } finally { fs.closeSync(fd); }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return cache;
}

// Merge caches into sessions: { key, type, contract, bars[], hist{} } using the dominant contract by volume.
export function sessionsFromCaches(caches) {
  const byKey = new Map();
  for (const c of caches) {
    for (const b of Object.values(c.bars)) {
      const s = byKey.get(b.s) || { key: b.s, type: b.s.split(':')[0], vol: {}, bars: {}, hist: {} };
      s.vol[b.c] = (s.vol[b.c] || 0) + b.v;
      (s.bars[b.c] || (s.bars[b.c] = [])).push(b);
      byKey.set(b.s, s);
    }
    for (const [hk, h] of Object.entries(c.hist)) {
      const [sk, contract] = hk.split('|');
      const s = byKey.get(sk); if (!s) continue;
      const tgt = (s.hist[contract] || (s.hist[contract] = {}));
      for (const [p, v] of Object.entries(h)) tgt[p] = (tgt[p] || 0) + v;
    }
  }
  const out = [];
  for (const s of byKey.values()) {
    const contract = Object.entries(s.vol).sort((a, b) => b[1] - a[1])[0][0];
    const bars = s.bars[contract].sort((a, b) => a.t - b.t);
    // merge duplicate bars (same bucket from two caches across midnight is impossible, but be safe)
    const merged = [];
    for (const b of bars) {
      const last = merged.at(-1);
      if (last && last.t === b.t) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.cl = b.cl; last.v += b.v; last.buy += b.buy; last.sell += b.sell; }
      else merged.push({ ...b });
    }
    out.push({ key: s.key, type: s.type, contract, bars: merged, hist: s.hist[contract] || {} });
  }
  return out.sort((a, b) => a.bars[0].t - b.bars[0].t);
}

export function volumeProfile(hist, valueArea = 0.7, bin = 10) {
  const binned = {};
  for (const [p, v] of Object.entries(hist)) { const k = Math.round(Number(p) / bin) * bin; binned[k] = (binned[k] || 0) + v; }
  const rows = Object.entries(binned).map(([p, v]) => [Number(p), v]).sort((a, b) => a[0] - b[0]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r[1], 0);
  let pocIdx = 0; rows.forEach((r, i) => { if (r[1] > rows[pocIdx][1]) pocIdx = i; });
  let lo = pocIdx, hi = pocIdx, acc = rows[pocIdx][1];
  while (acc < valueArea * total && (lo > 0 || hi < rows.length - 1)) {
    const up = hi < rows.length - 1 ? rows[hi + 1][1] : -1, dn = lo > 0 ? rows[lo - 1][1] : -1;
    if (up >= dn) { hi++; acc += rows[hi][1]; } else { lo--; acc += rows[lo][1]; }
  }
  return { poc: rows[pocIdx][0], val: rows[lo][0], vah: rows[hi][0], totalVolume: total };
}
