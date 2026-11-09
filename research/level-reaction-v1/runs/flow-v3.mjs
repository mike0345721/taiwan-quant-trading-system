// Level-reaction V3: does order flow at the level add information to the price reaction?
// Events and exits are exactly V2 (spec cfb0160d3c12). Flow = tick-rule buy/sell volume per 5m bar
// built from TAIFEX tick files (PROXY: no aggressor flag, no bid/ask in the source).
// Feature (known at the decision bar close): push = approach * (buy - sell) / volume over touch..decision bars.
//   push > 0 means aggressive volume leaned toward / through the level.
// Primary tests (Holm over 2):
//   P1 REJECT pooled: mean net R (push > 0, "absorbed") minus mean net R (push <= 0)  > 0 ?
//   P2 ACCEPT pooled: mean net R (push > 0, "pushed through") minus mean net R (push <= 0) > 0 ?
// p-value: one-sided permutation of the flow label within trading day (10,000 draws).
// Secondary (descriptive): same split per level family; push terciles; DAY vs NIGHT.
// Missing flow on any of the 3 bars or contract mismatch -> event excluded (kept unknown, never 0).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { runLevelReactionStudy, STUDY_SPEC_V2, STUDY_SPEC_V2_HASH, holm, stableJson } from '../../../src/level-reaction-study.mjs';
import { loadSessions } from './load-msi-archive.mjs';

export const FLOW_SPEC = Object.freeze({
  version: 'level-reaction-flow-v3', eventSpecHash: STUDY_SPEC_V2_HASH, feature: 'approach*(buy-sell)/volume over touch..decision bars',
  split: 'push>0 vs push<=0', primary: ['REJECT_POOLED', 'ACCEPT_POOLED'], permutation: 'WITHIN_DAY', draws: 10000, alpha: 0.05,
  decisionRule: 'Flow adds information if difference > 0 with pHolm < 0.05. A tradable candidate additionally needs the flow-confirmed subset to have n>=100, mean net R>0, day-cluster CI lower>0.',
  side: 'TICK_RULE_PROXY', researchOnly: true, executionAuthorized: false,
});
export const FLOW_SPEC_HASH = crypto.createHash('sha256').update(stableJson(FLOW_SPEC)).digest('hex');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

export function permTest(items, draws, rand) { // items: {day, flag, r}
  const obs = mean(items.filter(x => x.flag).map(x => x.r)) - mean(items.filter(x => !x.flag).map(x => x.r));
  const byDay = new Map(); items.forEach((x, i) => { (byDay.get(x.day) ?? byDay.set(x.day, []).get(x.day)).push(i); });
  const flags = items.map(x => x.flag); let ge = 0;
  for (let b = 0; b < draws; b++) {
    const f = flags.slice();
    for (const idx of byDay.values()) for (let k = idx.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [f[idx[k]], f[idx[j]]] = [f[idx[j]], f[idx[k]]]; }
    let s1 = 0, n1 = 0, s0 = 0, n0 = 0; items.forEach((x, i) => { if (f[i]) { s1 += x.r; n1++; } else { s0 += x.r; n0++; } });
    if (n1 && n0 && s1 / n1 - s0 / n0 >= obs) ge++;
  }
  return { diff: obs, p: (1 + ge) / (draws + 1) };
}
function dayCi(items, rand, draws = 2000) {
  const days = new Map(); for (const x of items) { const d = days.get(x.day) ?? { s: 0, n: 0 }; d.s += x.r; d.n++; days.set(x.day, d); }
  const L = [...days.values()]; if (L.length < 2) return [null, null]; const m = [];
  for (let b = 0; b < draws; b++) { let s = 0, n = 0; for (let k = 0; k < L.length; k++) { const d = L[Math.floor(rand() * L.length)]; s += d.s; n += d.n; } m.push(s / n); }
  m.sort((a, b) => a - b); return [m[Math.floor(0.025 * draws)], m[Math.ceil(0.975 * draws) - 1]];
}

export function attachFlow(trades, sessions, flowByDate) {
  const out = []; const excluded = { NO_FLOW_FILE: 0, CONTRACT_MISMATCH: 0, MISSING_BAR: 0, ZERO_VOLUME: 0 };
  const sess = new Map(sessions.map(s => [`${s.tradeDate}:${s.session}`, s]));
  for (const t of trades) {
    const s = sess.get(t.session); const f = flowByDate.get(s.tradeDate);
    if (!f) { excluded.NO_FLOW_FILE++; continue; }
    if (f.contract !== s.contract) { excluded.CONTRACT_MISMATCH++; continue; }
    const fb = new Map((s.session === 'DAY' ? f.day : f.night).map(b => [b.timestamp, b]));
    let buy = 0, sell = 0, vol = 0, ok = true;
    for (let i = t.touchIndex; i <= t.decisionIndex; i++) { const b = fb.get(s.bars[i].timestamp); if (!b) { ok = false; break; } buy += b.buyVol; sell += b.sellVol; vol += b.volume; }
    if (!ok) { excluded.MISSING_BAR++; continue; }
    if (!(vol > 0)) { excluded.ZERO_VOLUME++; continue; }
    out.push({ ...t, push: t.approach * (buy - sell) / vol, flowVolume: vol });
  }
  return { trades: out, excluded };
}

export function analyse(trades, { draws = FLOW_SPEC.draws, seed = parseInt(FLOW_SPEC_HASH.slice(0, 8), 16) } = {}) {
  const rand = rng(seed);
  const cell = list => {
    const items = list.map(t => ({ day: t.day, flag: t.push > 0, r: t.rNet }));
    const yes = items.filter(x => x.flag), no = items.filter(x => !x.flag);
    const pt = yes.length && no.length ? permTest(items, draws, rand) : { diff: null, p: null };
    return { n: items.length, nConfirmed: yes.length, meanConfirmed: mean(yes.map(x => x.r)), meanOther: mean(no.map(x => x.r)), diff: pt.diff, pRaw: pt.p, ciConfirmed: dayCi(yes, rand) };
  };
  const primary = { REJECT_POOLED: cell(trades.filter(t => t.reaction === 'REJECT')), ACCEPT_POOLED: cell(trades.filter(t => t.reaction === 'ACCEPT')) };
  const ph = holm([primary.REJECT_POOLED.pRaw ?? 1, primary.ACCEPT_POOLED.pRaw ?? 1]);
  primary.REJECT_POOLED.pHolm = ph[0]; primary.ACCEPT_POOLED.pHolm = ph[1];
  for (const c of Object.values(primary)) {
    c.flowAddsInfo = c.diff > 0 && c.pHolm < FLOW_SPEC.alpha;
    c.tradableCandidate = c.flowAddsInfo && c.nConfirmed >= 100 && c.meanConfirmed > 0 && c.ciConfirmed[0] > 0;
  }
  const secondary = {};
  for (const fam of STUDY_SPEC_V2.levelFamilies) for (const re of ['REJECT', 'ACCEPT']) secondary[`${fam}:${re}`] = cell(trades.filter(t => t.family === fam && t.reaction === re));
  for (const re of ['REJECT', 'ACCEPT']) for (const ses of ['DAY', 'NIGHT']) secondary[`${re}:${ses}`] = cell(trades.filter(t => t.reaction === re && t.session.endsWith(ses)));
  const terciles = {};
  for (const re of ['REJECT', 'ACCEPT']) {
    const L = trades.filter(t => t.reaction === re).sort((a, b) => a.push - b.push); const k = Math.floor(L.length / 3);
    terciles[re] = [L.slice(0, k), L.slice(k, 2 * k), L.slice(2 * k)].map(g => ({ n: g.length, pushMax: g.at(-1)?.push ?? null, meanR: mean(g.map(t => t.rNet)) }));
  }
  return { flowSpecHash: FLOW_SPEC_HASH, primary, secondary, terciles };
}

export function loadFlowDir(dir, before = '2026-09-01') {
  const m = new Map();
  for (const f of fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}-flow\.json$/.test(f))) {
    const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
    if (d.tradeDate >= before) throw new Error('HOLDOUT_FLOW_FILE ' + f);
    m.set(d.tradeDate, d);
  }
  return m;
}

if (process.argv[1]?.endsWith('flow-v3.mjs') && process.argv[2]) {
  const flow = loadFlowDir(process.argv[2]);
  const { sessions } = loadSessions();
  const r = runLevelReactionStudy(sessions, { baseSpec: STUDY_SPEC_V2 });
  const { trades, excluded } = attachFlow(r._trades, sessions, flow);
  const res = analyse(trades);
  const out = { ...res, flowDays: flow.size, tradesWithFlow: trades.length, tradesTotal: r._trades.length, excluded };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
  const f = x => x == null ? '—' : x.toFixed(3);
  console.log(`flow days ${flow.size}, trades with flow ${trades.length}/${r._trades.length}, excluded ${JSON.stringify(excluded)}`);
  for (const [k, c] of Object.entries(res.primary)) console.log(`PRIMARY ${k}: n ${c.n}, confirmed ${c.nConfirmed} meanR ${f(c.meanConfirmed)} vs other ${f(c.meanOther)}, diff ${f(c.diff)}, pRaw ${f(c.pRaw)}, pHolm ${f(c.pHolm)}, CI ${f(c.ciConfirmed[0])}..${f(c.ciConfirmed[1])}, flowAddsInfo ${c.flowAddsInfo}, tradable ${c.tradableCandidate}`);
  for (const [k, c] of Object.entries(res.secondary)) console.log(`  ${k.padEnd(14)} n ${String(c.n).padStart(5)} conf ${String(c.nConfirmed).padStart(5)}  R ${f(c.meanConfirmed)} vs ${f(c.meanOther)}  diff ${f(c.diff)}  p ${f(c.pRaw)}`);
  for (const [k, g] of Object.entries(res.terciles)) console.log(`  terciles ${k}: ${g.map(x => `n${x.n} pushMax ${f(x.pushMax)} R ${f(x.meanR)}`).join(' | ')}`);
}
