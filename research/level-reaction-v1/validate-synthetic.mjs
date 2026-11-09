import fs from 'node:fs';
import { runLevelReactionStudy, prepareSession, extractLevels, findEvents, STUDY_SPEC, STUDY_SPEC_HASH } from '../../src/level-reaction-study.mjs';
import { syntheticSessions } from './synthetic.mjs';

const outPath = process.argv[2];
const fmt = x => x === null || x === undefined ? '—' : (Math.abs(x) < 10 ? x.toFixed(3) : x.toFixed(0));
const strip = r => { const { _trades, ...rest } = r; return rest; };

// A. Null control: pure random walk, 20 independent seeds
const nullRuns = [];
for (let seed = 1; seed <= 20; seed++) {
  const r = runLevelReactionStudy(syntheticSessions({ seed, plantedEdge: 0 }), { seed });
  nullRuns.push(r);
}
const nullCells = nullRuns.flatMap(r => r.cells);
const nullFalsePositives = nullRuns.filter(r => r.cells.some(c => c.pHolm !== null && c.pHolm < 0.05 && c.meanRNet > 0)).length;
const rawFalsePositiveCells = nullCells.filter(c => c.pRaw !== null && c.pRaw < 0.05).length;
const avgNull = Object.fromEntries(['meanRGross', 'meanRNet', 'excessOverControl'].map(k => [k, nullCells.filter(c => c.n > 0).reduce((s, c) => s + c[k] * c.n, 0) / nullCells.filter(c => c.n > 0).reduce((s, c) => s + c.n, 0)]));

// B. Planted edge: price is pushed away from the prior-day high/low after the first touch
const plantRuns = [];
for (let seed = 101; seed <= 110; seed++) plantRuns.push(runLevelReactionStudy(syntheticSessions({ seed, plantedEdge: 1.2 }), { seed }));
const detected = plantRuns.filter(r => { const c = r.cells.find(c => c.family === 'PD' && c.reaction === 'REJECT'); return c.pHolm !== null && c.pHolm < 0.05 && c.meanRNet > 0; }).length;
const otherFlags = plantRuns.reduce((s, r) => s + r.cells.filter(c => !(c.family === 'PD' && c.reaction === 'REJECT') && c.pHolm !== null && c.pHolm < 0.05 && c.meanRNet > 0).length, 0);

// C. Look-ahead: rebuild every event with all bars after its entry bar deleted, and with future bars scrambled
const sessions = syntheticSessions({ seed: 7, plantedEdge: 0 }).map(prepareSession);
let checked = 0, mismatched = 0;
for (let k = 1; k < sessions.length; k++) {
  const s = sessions[k], prior = sessions[k - 1];
  const full = findEvents(s, extractLevels(s, prior)).events;
  for (const ev of full) {
    for (const mode of ['TRUNCATE', 'SCRAMBLE']) {
      let bars = s.rows.slice(0, ev.entryIndex + 1);
      if (mode === 'SCRAMBLE') bars = bars.concat(s.rows.slice(ev.entryIndex + 1).map(r => { const o = r.open + 300; return { t: r.t, open: o, high: o + 5, low: o - 400, close: o - 200 }; }));
      const raw = { contract: s.contract, tradeDate: s.tradeDate, session: s.session, bars: bars.map(r => ({ timestamp: new Date(r.t).toISOString(), open: r.open, high: r.high, low: r.low, close: r.close })) };
      const t = prepareSession(raw);
      const evs = findEvents(t, extractLevels(t, prior)).events;
      const same = evs.find(e => e.kind === ev.kind && e.price === ev.price && e.touchIndex === ev.touchIndex);
      checked++;
      if (!same || same.reaction !== ev.reaction || same.entryIndex !== ev.entryIndex || same.tradeDir !== ev.tradeDir) mismatched++;
    }
  }
}

// D. One example matrix (null seed 1 and planted seed 101)
const table = r => r.cells.map(c => `| ${c.family} | ${c.reaction} | ${c.n} | ${fmt(c.meanRGross)} | ${fmt(c.meanRNet)} | ${fmt(c.controlMeanRNet)} | ${c.ci95[0] === null ? '—' : `${fmt(c.ci95[0])} ~ ${fmt(c.ci95[1])}`} | ${c.winRate === null ? '—' : (c.winRate * 100).toFixed(0) + '%'} | ${fmt(c.pHolm)} |`).join('\n');
const result = {
  specHash: STUDY_SPEC_HASH, spec: STUDY_SPEC,
  nullControl: { runs: nullRuns.length, sessionsPerRun: nullRuns[0].sessions, runsWithAnyHolmSignificantPositiveCell: nullFalsePositives, rawP05CellsOutOf: [rawFalsePositiveCells, nullCells.filter(c => c.pRaw !== null).length], pooledMeans: avgNull },
  plantedEdge: { runs: plantRuns.length, pdRejectDetected: detected, otherCellsFlagged: otherFlags },
  lookAhead: { eventsChecked: checked, mismatched },
  exampleNull: strip(nullRuns[0]), examplePlanted: strip(plantRuns[0]),
};
if (outPath) fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`spec ${STUDY_SPEC_HASH.slice(0, 12)}  attempts=${nullRuns[0].attempts}`);
console.log('A null:', JSON.stringify(result.nullControl));
console.log('B planted:', JSON.stringify(result.plantedEdge));
console.log('C lookahead:', JSON.stringify(result.lookAhead));
console.log('\nNULL seed1 events', JSON.stringify(nullRuns[0].events), 'skipped', JSON.stringify(nullRuns[0].skipped));
console.log('| 價位 | 反應 | 筆數 | 毛R | 淨R | 隨機對照淨R | 95%區間 | 勝率 | Holm p |\n|---|---|---|---|---|---|---|---|---|\n' + table(nullRuns[0]));
console.log('\nPLANTED seed101 events', JSON.stringify(plantRuns[0].events));
console.log('| 價位 | 反應 | 筆數 | 毛R | 淨R | 隨機對照淨R | 95%區間 | 勝率 | Holm p |\n|---|---|---|---|---|---|---|---|---|\n' + table(plantRuns[0]));
