import fs from 'node:fs'; import { loadConfig, buildReport, renderHtml } from '../build-preopen-report.mjs';
const cfg = loadConfig('test/config.test.json'); cfg.yahoo = true;
const now = new Date('2026-08-28T08:35:00+08:00');
const t5 = Date.parse('2026-08-28T05:00:00+08:00');
const mk = (p, pc, drift = 0) => ({ price: p, prevClose: pc, points: [[t5 - 600000, p / (1 + drift)], [t5, p / (1 + drift)], [now - 60000, p]] });
const fake = async () => ({ sox: mk(5810, 5702), nasdaq: mk(21950, 21880), tsmADR: mk(312.4, 305.1), usVix: mk(15.8, 16.4), nq: mk(23010, 22990, 0.0021), es: mk(6450, 6440, -0.0008), nikkei: mk(42800, 42650), kospi: { error: 'timeout' }, usdtwd: mk(30.52, 30.58), tw2330: mk(1460, 1455) });
const r = await buildReport(cfg, now, { fetchQuotes: fake });
fs.writeFileSync('test/out/mock.html', renderHtml(r)); console.log(JSON.stringify(r.overnight));
