import fs from 'node:fs';
import { runLevelReactionStudy } from '../../../src/level-reaction-study.mjs';
import { loadSessions } from './load-msi-archive.mjs';
const { sessions } = loadSessions();
const f = x => x == null ? '—' : x.toFixed(3);
const show = (label, r) => {
  console.log(`\n### ${label}: sessions ${r.sessions}, events ${JSON.stringify(r.events)}, trades ${r.tradesSimulated}, skipped ${JSON.stringify(r.skipped)}`);
  console.log('family reaction    n  days  grossR  netR(2t)  netR(1t)  netR(3t)  ctrlR  excess  CI95              win  PF    pRaw   pHolm');
  for (const c of r.cells) console.log(`${c.family.padEnd(6)} ${c.reaction.padEnd(7)} ${String(c.n).padStart(5)} ${String(c.days).padStart(4)}  ${f(c.meanRGross).padStart(6)}  ${f(c.meanRNet).padStart(7)}  ${f(c.meanRByCostView.OPTIMISTIC_1_TICK_PER_SIDE).padStart(7)}  ${f(c.meanRByCostView.CONSERVATIVE_3_TICKS_PER_SIDE).padStart(7)}  ${f(c.controlMeanRNet).padStart(6)} ${f(c.excessOverControl).padStart(6)}  [${f(c.ci95[0])}, ${f(c.ci95[1])}]  ${c.winRate==null?'—':(c.winRate*100).toFixed(0)+'%'}  ${c.profitFactor==null?'—':c.profitFactor.toFixed(2)}  ${f(c.pRaw)}  ${f(c.pHolm)}`);
};
const t0 = Date.now();
const primary = runLevelReactionStudy(sessions);
show('PRIMARY all sessions', primary);
const day = runLevelReactionStudy(sessions.filter(s => s.session === 'DAY'));
show('secondary DAY only', day);
const night = runLevelReactionStudy(sessions.filter(s => s.session === 'NIGHT'));
show('secondary NIGHT only', night);
const h1 = runLevelReactionStudy(sessions.filter(s => s.tradeDate < '2026-05-01'));
show('secondary first half (Jan-Apr)', h1);
const h2 = runLevelReactionStudy(sessions.filter(s => s.tradeDate >= '2026-05-01'));
show('secondary second half (May-Aug)', h2);
// cost & risk in points for context
const tr = primary._trades;
const risk = tr.map(t => 0).length;
const strip = r => { const { _trades, ...x } = r; return x; };
fs.writeFileSync('./training-2026-01-02_2026-08-31.json', JSON.stringify({ primary: strip(primary), day: strip(day), night: strip(night), firstHalf: strip(h1), secondHalf: strip(h2), primaryTrades: primary._trades }, null, 1));
console.log('\nelapsed', ((Date.now() - t0) / 1000).toFixed(1), 's');
