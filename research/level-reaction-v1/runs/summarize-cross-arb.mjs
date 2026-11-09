// Summarise arb-YYYY-MM-DD.json scan outputs (descriptive only).
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(f => /^arb-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const pairs = {}; const hours = {}; let days = 0;
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const examples = [];
for (const f of files) {
  const o = JSON.parse(fs.readFileSync(path.join(dir, f)));
  if (o.bookUpdates < 100000) continue; days++;
  for (const r of o.episodes) {
    const e = Object.fromEntries(o.epColumns.map((c, i) => [c, r[i]]));
    const P = pairs[e.pair] ||= { all: 0, size1: 0, dur300: 0, dur1000: 0, live300: 0, live1000: 0, live1000size: 0, gaps: [], durs: [], rt1000: [] };
    P.all++; P.gaps.push(e.startGap); P.durs.push(e.dur);
    if (e.qty >= 1) P.size1++;
    if (e.dur >= 300) P.dur300++;
    if (e.dur >= 1000) P.dur1000++;
    if (e.g300 != null && e.g300 > e.fee) P.live300++;
    if (e.g1000 != null && e.g1000 > e.fee) { P.live1000++; P.rt1000.push(e.g1000 + e.bestRev60 - e.fee); if (e.qty >= 1) P.live1000size++; if (examples.length < 12) examples.push({ date: o.date, ...e, tpe: new Date(e.t + 8 * 3600000).toISOString().slice(11, 23) }); }
    const h = new Date(e.t + 8 * 3600000).toISOString().slice(11, 13);
    const H = hours[h] ||= { all: 0, live1000: 0 }; H.all++; if (e.g1000 != null && e.g1000 > e.fee) H.live1000++;
  }
}
const out = { days, pairs: Object.fromEntries(Object.entries(pairs).map(([k, P]) => [k, { episodes: P.all, perDay: +(P.all / days).toFixed(1), withSize1: P.size1, durAtLeast300ms: P.dur300, durAtLeast1s: P.dur1000, stillAbove300ms: P.live300, stillAbove1s: P.live1000, stillAbove1sWithSize: P.live1000size,
  startGapMedian: q(P.gaps, 0.5), durMedianMs: q(P.durs, 0.5), durP90Ms: q(P.durs, 0.9), durP99Ms: q(P.durs, 0.99), optimisticRoundTripAfter1s: { n: P.rt1000.length, median: q(P.rt1000, 0.5) } }])), hours, examples };
console.log(JSON.stringify(out, null, 1));
