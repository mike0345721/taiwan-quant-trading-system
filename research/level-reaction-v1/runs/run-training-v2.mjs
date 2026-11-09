import fs from 'node:fs';
import { runLevelReactionStudy, STUDY_SPEC_V2 } from '../../../src/level-reaction-study.mjs';
import { loadSessions } from './load-msi-archive.mjs';
const pre = JSON.parse(fs.readFileSync(new URL('./prereg-v2-2026-11-09.json', import.meta.url)));
const { sessions } = loadSessions();
const f = x => x == null ? '—' : x.toFixed(3);
const out = {};
const show = (label, r) => {
  console.log(`\n### ${label}: sessions ${r.sessions}, events ${JSON.stringify(r.events)}, trades ${r.tradesSimulated}, skipped ${JSON.stringify(r.skipped)}`);
  console.log('family reaction    n  days  grossR  netR   ctrlR  excess  adjExcess  CI95              win   pHolm  PASS');
  for (const c of r.cells) {
    const bias = pre.syntheticNullBiasOfExcess[`${c.family}:${c.reaction}`] ?? 0;
    c.adjExcess = c.excessOverControl == null ? null : c.excessOverControl - bias;
    c.pass = c.n >= 100 && c.pHolm !== null && c.pHolm < 0.05 && c.meanRNet > 0 && c.ci95[0] > 0 && c.adjExcess > 0;
    console.log(`${c.family.padEnd(6)} ${c.reaction.padEnd(7)} ${String(c.n).padStart(5)} ${String(c.days).padStart(4)}  ${f(c.meanRGross).padStart(6)} ${f(c.meanRNet).padStart(6)} ${f(c.controlMeanRNet).padStart(6)} ${f(c.excessOverControl).padStart(6)}  ${f(c.adjExcess).padStart(8)}  [${f(c.ci95[0])}, ${f(c.ci95[1])}]  ${c.winRate == null ? '—' : (c.winRate * 100).toFixed(0) + '%'}  ${f(c.pHolm)}  ${c.pass ? 'YES' : '-'}`);
  }
  const { _trades, ...rest } = r; out[label] = rest; return r;
};
const p = show('PRIMARY', runLevelReactionStudy(sessions, { baseSpec: STUDY_SPEC_V2 }));
show('DAY', runLevelReactionStudy(sessions.filter(s => s.session === 'DAY'), { baseSpec: STUDY_SPEC_V2 }));
show('NIGHT', runLevelReactionStudy(sessions.filter(s => s.session === 'NIGHT'), { baseSpec: STUDY_SPEC_V2 }));
show('JAN-APR', runLevelReactionStudy(sessions.filter(s => s.tradeDate < '2026-05-01'), { baseSpec: STUDY_SPEC_V2 }));
show('MAY-AUG', runLevelReactionStudy(sessions.filter(s => s.tradeDate >= '2026-05-01'), { baseSpec: STUDY_SPEC_V2 }));
fs.writeFileSync(new URL('./training-v2.json', import.meta.url), JSON.stringify(out, null, 1));
fs.writeFileSync(new URL('./training-v2-trades.ndjson', import.meta.url), p._trades.map(t => JSON.stringify(t)).join('\n'));
