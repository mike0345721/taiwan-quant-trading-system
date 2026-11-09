// Build a fake Shioaji ledger from official 5m archive bars (4 ticks per bar) to test the cache/report against known OHLC.
import fs from 'node:fs'; import path from 'node:path';
const [archiveDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const files = {};
const local = ms => new Date(ms + 8 * 3600000).toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
let seq = 0;
function emit(ms, price, vol, side, family = 'TX', code = 'TXFI6', dup = false) {
  const d = new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const rec = { seq: ++seq, kind: 'futures_tick', product: code, duplicate: dup, receivedAt: local(ms) + '+08:00', payload: { code, _target_code: code, _product_family: family, datetime: local(ms), close: price, volume: vol, tick_type: side } };
  (files[d] ||= []).push(JSON.stringify(rec));
  if (seq % 7 === 0) (files[d] ||= []).push(JSON.stringify({ kind: 'futures_bidask', payload: { _product_family: 'TX' } }));
}
for (const n of ['2026-08-27-day', '2026-08-28-night']) {
  const j = JSON.parse(fs.readFileSync(path.join(archiveDir, n + '.json'), 'utf8'));
  for (const b of j.bars) {
    const t = Date.parse(b.timestamp), v = Math.max(4, b.volume), q = Math.floor(v / 4);
    emit(t + 1000, b.open, q, 1); emit(t + 60000, b.high, q, 1); emit(t + 120000, b.low, q, 2); emit(t + 299000, b.close, v - 3 * q, b.close >= b.open ? 1 : 2);
    emit(t + 150000, b.high + 500, 1, 1, 'MTX', 'MXFI6');          // other family: must be ignored
    emit(t + 151000, b.high + 900, 5, 1, 'TX', 'TXFI6', true);       // duplicate: must be ignored
  }
}
for (const [d, lines] of Object.entries(files)) fs.writeFileSync(path.join(outDir, d + '.ndjson'), lines.join('\n') + '\n');
console.log(Object.fromEntries(Object.entries(files).map(([d, l]) => [d, l.length])));
