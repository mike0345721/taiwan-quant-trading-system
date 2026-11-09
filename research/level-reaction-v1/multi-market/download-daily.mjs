// Read-only: download public daily bars (Yahoo Finance chart API) for the multi-market trend study. No orders, no credentials.
import fs from 'node:fs'; import path from 'node:path';
const OUT = process.argv[2] || 'out'; fs.mkdirSync(OUT, { recursive: true });
const SYMBOLS = {
  TWII: '^TWII', TSMC: '2330.TW', MEDIATEK: '2454.TW', SP500_FUT: 'ES=F', UST10Y_FUT: 'ZN=F', EUR_FUT: '6E=F', JPY_FUT: '6J=F',
  GOLD_FUT: 'GC=F', CRUDE_FUT: 'CL=F', COPPER_FUT: 'HG=F', SOYBEAN_FUT: 'ZS=F', CORN_FUT: 'ZC=F', NASDAQ_FUT: 'NQ=F', NIKKEI: '^N225', USDTWD: 'TWD=X',
};
const log = []; const say = s => { console.log(s); log.push(s); };
for (const [name, sym] of Object.entries(SYMBOLS)) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%2Csplit`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res) throw new Error(JSON.stringify(j?.chart?.error || r.status));
    const q = res.indicators.quote[0], adj = res.indicators.adjclose?.[0]?.adjclose;
    const rows = res.timestamp.map((t, i) => [new Date((t + (res.meta.gmtoffset || 0)) * 1000).toISOString().slice(0, 10), q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i], adj ? adj[i] : null]).filter(r => Number.isFinite(r[4]));
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, symbol: sym, currency: res.meta.currency, columns: ['date', 'open', 'high', 'low', 'close', 'volume', 'adjclose'], rows }));
    say(`${name} (${sym}): ${rows.length} days ${rows[0]?.[0]} .. ${rows.at(-1)?.[0]}`);
  } catch (e) { say(`${name} (${sym}): ERROR ${e.message}`); }
  await new Promise(r => setTimeout(r, 1500));
}
fs.writeFileSync(path.join(OUT, '_download-log.txt'), log.join('\n'));
