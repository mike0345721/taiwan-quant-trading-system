import crypto from 'node:crypto';
import fs from 'node:fs';
import { createMarketStructureState, appendMarketStructureBars, marketStructureSnapshot } from './market-structure-core.mjs';
import { calculateTradeCost } from './t0-data-replay-gate.mjs';

// Level-reaction event study V1.
// Price touches a pre-defined level -> a fixed reaction rule classifies what price did next ->
// a fixed ATR stop / R target / time exit is simulated with the repository cost policy ->
// results are compared with matched random entries that use the same exit rules.
// Every rule below is frozen before any real outcome is read. New choices require a new version.

const BAR_MS = 300000;
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const STUDY_SPEC = Object.freeze({
  version: 'level-reaction-study-v1',
  timeframe: '5m',
  levelFamilies: Object.freeze(['SWING', 'OB', 'FVG', 'OR', 'PD']),
  reactions: Object.freeze(['REJECT', 'ACCEPT']),
  firstTouchOnly: true,
  gapThroughTouch: 'CONSUMED_NO_TRADE',
  reactionBars: 2,
  reject: 'ALL_CLOSES_FROM_TOUCH_BAR_THROUGH_REACTION_BAR_ON_APPROACH_SIDE_OF_LEVEL -> FADE',
  accept: 'ALL_CLOSES_FROM_TOUCH_BAR_THROUGH_REACTION_BAR_BEYOND_LEVEL -> CONTINUE',
  entry: 'NEXT_BAR_OPEN_AFTER_REACTION_BAR',
  atrPeriod: 14,
  atrMethod: 'SMA_OF_TRUE_RANGE_SAME_SESSION',
  stopAtrMultiple: 1.5,
  targetR: 2,
  maxHoldBars: 12,
  sameBarStopTarget: 'STOP_FIRST',
  gapThroughStopFill: 'BAR_OPEN',
  targetFill: 'TARGET_PRICE_NO_GAP_BONUS',
  timeExit: 'OPEN_OF_BAR_AFTER_LAST_HOLD_BAR_ELSE_LAST_CLOSE',
  instrument: 'TX',
  costViews: Object.freeze(['OPTIMISTIC_1_TICK_PER_SIDE', 'BASE_2_TICKS_PER_SIDE', 'CONSERVATIVE_3_TICKS_PER_SIDE']),
  primaryCostView: 'BASE_2_TICKS_PER_SIDE',
  control: 'SAME_SESSION_SAME_HOUR_RANDOM_BAR_AND_DIRECTION_SAME_EXIT_RULES',
  bootstrap: 'DAY_CLUSTER',
  bootstrapDraws: 2000,
  controlDraws: 2000,
  ciLevel: 0.95,
  alpha: 0.05,
  multipleTesting: 'HOLM_ACROSS_FAMILY_X_REACTION_CELLS',
  overlap: 'INDEPENDENT_EVENTS_NOT_A_PORTFOLIO_SIMULATION',
  researchOnly: true, formalWeight: 0, executionAuthorized: false, orderRoutesEnabled: false,
});
export const STUDY_SPEC_HASH = sha(stableJson(STUDY_SPEC));
export const ATTEMPT_COUNT = STUDY_SPEC.levelFamilies.length * STUDY_SPEC.reactions.length;

export function loadCostPolicy(path = new URL('../research/t0-v1/cost-policy.json', import.meta.url)) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- session preparation ----------
export function prepareSession({ contract, tradeDate, session, bars }) {
  if (!contract || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || !['DAY', 'NIGHT'].includes(session) || !Array.isArray(bars) || !bars.length) throw new Error('STUDY_SESSION_INVALID');
  const rows = bars.map(b => {
    const t = Date.parse(b.timestamp);
    const row = { t, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close) };
    if (!Number.isFinite(t) || ![row.open, row.high, row.low, row.close].every(Number.isFinite) || row.high < Math.max(row.open, row.close, row.low) || row.low > Math.min(row.open, row.close, row.high)) throw new Error('STUDY_BAR_INVALID');
    return row;
  });
  for (let i = 1; i < rows.length; i++) if (rows[i].t <= rows[i - 1].t) throw new Error('STUDY_BAR_ORDER_INVALID');
  const identity = { actualContract: contract, tradeDate, session, continuityEpoch: 0, sourceLedgerIdentity: `sha256:${sha(stableJson({ contract, tradeDate, session, rows }))}` };
  const coreBars = rows.map(r => ({ identity, time: new Date(r.t).toISOString(), endTime: new Date(r.t + BAR_MS).toISOString(), availableAt: new Date(r.t + BAR_MS).toISOString(), open: r.open, high: r.high, low: r.low, close: r.close, closed: true }));
  return { contract, tradeDate, session, rows, identity, coreBars, id: `${tradeDate}:${session}` };
}

function atrSeries(rows, period) {
  const tr = rows.map((r, i) => i === 0 ? r.high - r.low : Math.max(r.high - r.low, Math.abs(r.high - rows[i - 1].close), Math.abs(r.low - rows[i - 1].close)));
  const atr = new Array(rows.length).fill(null);
  let sum = 0;
  for (let i = 1; i < rows.length; i++) {
    sum += tr[i];
    if (i > period) sum -= tr[i - period];
    if (i >= period) atr[i] = sum / period;
  }
  return atr;
}

// ---------- levels ----------
export function extractLevels(session, priorDay) {
  const snap = marketStructureSnapshot(appendMarketStructureBars(createMarketStructureState({ identity: session.identity, timeframe: '5m', maxBars: 20000 }), session.coreBars));
  const resets = snap.events.filter(e => e.type === 'STRUCTURE_RESET').map(e => Date.parse(e.availableAt));
  const nextReset = from => resets.filter(t => t > from).sort((a, b) => a - b)[0] ?? Infinity;
  const levels = [];
  for (const e of snap.events) {
    if (e.type !== 'SWING_HIGH' && e.type !== 'SWING_LOW') continue;
    const from = Date.parse(e.availableAt);
    levels.push({ id: e.id, family: 'SWING', kind: e.type, price: e.level, approach: e.type === 'SWING_HIGH' ? 1 : -1, from, until: nextReset(from) });
  }
  for (const z of snap.zones) {
    if (z.type !== 'ORDER_BLOCK' && z.type !== 'FVG') continue;
    const from = Date.parse(z.availableAt);
    const ends = [z.invalidatedAt, z.filledAt, z.unavailableAt].filter(Boolean).map(Date.parse);
    const bullish = z.direction === 'UP';
    levels.push({ id: z.id, family: z.type === 'FVG' ? 'FVG' : 'OB', kind: `${z.type}_${bullish ? 'BULL' : 'BEAR'}`, price: bullish ? z.upper : z.lower, approach: bullish ? -1 : 1, from, until: Math.min(nextReset(from), ...ends) });
  }
  const rows = session.rows;
  if (session.session === 'DAY' && rows.length >= 3 && rows[0].t === Date.parse(`${session.tradeDate}T00:45:00Z`) && rows[1].t === rows[0].t + BAR_MS && rows[2].t === rows[0].t + 2 * BAR_MS) {
    const from = rows[2].t + BAR_MS;
    levels.push({ id: `${session.id}:OR_H`, family: 'OR', kind: 'OR_HIGH', price: Math.max(...rows.slice(0, 3).map(r => r.high)), approach: 1, from, until: Infinity });
    levels.push({ id: `${session.id}:OR_L`, family: 'OR', kind: 'OR_LOW', price: Math.min(...rows.slice(0, 3).map(r => r.low)), approach: -1, from, until: Infinity });
  }
  if (priorDay) {
    levels.push({ id: `${session.id}:PD_H`, family: 'PD', kind: 'PRIOR_DAY_HIGH', price: Math.max(...priorDay.rows.map(r => r.high)), approach: 1, from: rows[0].t, until: Infinity });
    levels.push({ id: `${session.id}:PD_L`, family: 'PD', kind: 'PRIOR_DAY_LOW', price: Math.min(...priorDay.rows.map(r => r.low)), approach: -1, from: rows[0].t, until: Infinity });
  }
  return levels;
}

export function findEvents(session, levels, spec = STUDY_SPEC) {
  const rows = session.rows, n = rows.length, K = spec.reactionBars, out = [], skipped = { GAP_THROUGH: 0, INSUFFICIENT_BARS: 0 };
  for (const L of levels) {
    for (let i = 0; i < n; i++) {
      const bar = rows[i];
      if (bar.t < L.from) continue;
      if (bar.t >= L.until) break;
      const touched = L.approach > 0 ? bar.high >= L.price : bar.low <= L.price;
      if (!touched) continue;
      if (L.approach > 0 ? bar.open >= L.price : bar.open <= L.price) { skipped.GAP_THROUGH++; break; }
      const c = i + K;
      if (c + 1 >= n) { skipped.INSUFFICIENT_BARS++; break; }
      let beyond = 0;
      for (let j = i; j <= c; j++) if (L.approach * (rows[j].close - L.price) > 0) beyond++;
      const reaction = beyond === 0 ? 'REJECT' : beyond === K + 1 ? 'ACCEPT' : 'CHOP';
      out.push({ levelId: L.id, family: L.family, kind: L.kind, price: L.price, approach: L.approach, touchIndex: i, decisionIndex: c, entryIndex: c + 1, reaction, tradeDir: reaction === 'REJECT' ? -L.approach : L.approach, session: session.id });
      break;
    }
  }
  return { events: out, skipped };
}

// ---------- trade simulation ----------
export function simulateTrade(rows, entryIndex, dir, atr, spec, costPolicy) {
  if (!(atr > 0) || entryIndex >= rows.length) return null;
  const entry = rows[entryIndex].open, risk = spec.stopAtrMultiple * atr;
  const stop = entry - dir * risk, target = entry + dir * spec.targetR * risk;
  const last = Math.min(entryIndex + spec.maxHoldBars - 1, rows.length - 1);
  let exit = null, reason = null, exitIndex = last;
  for (let j = entryIndex; j <= last; j++) {
    const b = rows[j];
    if (j > entryIndex && (dir > 0 ? b.open <= stop : b.open >= stop)) { exit = b.open; reason = 'STOP_GAP'; exitIndex = j; break; }
    if (dir > 0 ? b.low <= stop : b.high >= stop) { exit = stop; reason = 'STOP'; exitIndex = j; break; }
    if (dir > 0 ? b.high >= target : b.low <= target) { exit = target; reason = 'TARGET'; exitIndex = j; break; }
  }
  if (exit === null) {
    const next = rows[entryIndex + spec.maxHoldBars];
    if (next) { exit = next.open; reason = 'TIME'; exitIndex = entryIndex + spec.maxHoldBars; } else { exit = rows[last].close; reason = 'SESSION_END'; exitIndex = last; }
  }
  const direction = dir > 0 ? 'LONG' : 'SHORT', mult = costPolicy.instruments[spec.instrument].contractMultiplier;
  const r = { entry, exit, reason, risk, heldBars: exitIndex - entryIndex + 1, rGross: (dir * (exit - entry)) / risk, rNet: {} };
  for (const view of costPolicy.costViews) {
    if (!spec.costViews.includes(view.viewId)) continue;
    const cost = calculateTradeCost({ instrument: spec.instrument, entryIndex: entry, exitIndex: exit, direction, slippageTicksPerSide: view.slippageTicksPerSide }, costPolicy);
    r.rNet[view.viewId] = cost.netPnl / mult / risk;
  }
  return r;
}

// ---------- statistics ----------
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function dayClusterCi(items, draws, level, rand) {
  const days = new Map();
  for (const it of items) { const d = days.get(it.day) ?? { sum: 0, n: 0 }; d.sum += it.r; d.n += 1; days.set(it.day, d); }
  const list = [...days.values()];
  if (list.length < 2) return [null, null];
  const means = [];
  for (let b = 0; b < draws; b++) {
    let s = 0, n = 0;
    for (let k = 0; k < list.length; k++) { const d = list[Math.floor(rand() * list.length)]; s += d.sum; n += d.n; }
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const lo = (1 - level) / 2;
  return [means[Math.floor(lo * draws)], means[Math.min(draws - 1, Math.ceil((1 - lo) * draws) - 1)]];
}
export function holm(pValues) {
  const order = pValues.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adjusted = new Array(pValues.length);
  let running = 0;
  order.forEach(([p, i], rank) => { running = Math.max(running, Math.min(1, (pValues.length - rank) * p)); adjusted[i] = running; });
  return adjusted;
}

// ---------- study ----------
export function runLevelReactionStudy(rawSessions, { costPolicy = loadCostPolicy(), seed = null, overrides = {} } = {}) {
  const spec = { ...STUDY_SPEC, ...overrides };
  const primary = spec.primaryCostView;
  const rand = rng(seed ?? parseInt(STUDY_SPEC_HASH.slice(0, 8), 16));
  const sessions = rawSessions.map(prepareSession).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.session.localeCompare(b.session));
  const trades = [], bySession = new Map(), skipped = { GAP_THROUGH: 0, INSUFFICIENT_BARS: 0, NO_ATR: 0 };
  const reactionCounts = { REJECT: 0, ACCEPT: 0, CHOP: 0 };
  for (const s of sessions) {
    const prior = sessions.filter(x => x.session === 'DAY' && x.contract === s.contract && x.tradeDate < s.tradeDate).at(-1) ?? null;
    const levels = extractLevels(s, prior);
    const atr = atrSeries(s.rows, spec.atrPeriod);
    const { events, skipped: sk } = findEvents(s, levels, spec);
    skipped.GAP_THROUGH += sk.GAP_THROUGH; skipped.INSUFFICIENT_BARS += sk.INSUFFICIENT_BARS;
    // control outcome table: every possible entry bar and direction, grouped by hour
    const hourBuckets = new Map();
    for (let e = spec.atrPeriod + 1; e < s.rows.length - 1; e++) {
      const a = atr[e - 1];
      const hour = Math.floor(s.rows[e].t / 3600000);
      for (const dir of [1, -1]) {
        const t = simulateTrade(s.rows, e, dir, a, spec, costPolicy);
        if (!t) continue;
        const list = hourBuckets.get(hour) ?? []; list.push(t.rNet[primary]); hourBuckets.set(hour, list);
      }
    }
    bySession.set(s.id, hourBuckets);
    for (const ev of events) {
      reactionCounts[ev.reaction]++;
      if (ev.reaction === 'CHOP') continue;
      const a = atr[ev.decisionIndex];
      const t = simulateTrade(s.rows, ev.entryIndex, ev.tradeDir, a, spec, costPolicy);
      if (!t) { skipped.NO_ATR++; continue; }
      trades.push({ ...ev, day: s.tradeDate, hour: Math.floor(s.rows[ev.entryIndex].t / 3600000), rNet: t.rNet[primary], rGross: t.rGross, views: t.rNet, reason: t.reason, heldBars: t.heldBars });
    }
  }
  const cells = [];
  for (const family of spec.levelFamilies) for (const reaction of spec.reactions) {
    const items = trades.filter(t => t.family === family && t.reaction === reaction);
    const r = items.map(t => ({ day: t.day, r: t.rNet }));
    const observed = mean(items.map(t => t.rNet));
    let pRaw = null, controlMean = null;
    if (items.length >= 1) {
      const pools = items.map(t => bySession.get(t.session)?.get(t.hour) ?? []);
      if (pools.every(p => p.length)) {
        let ge = 0, acc = 0;
        for (let b = 0; b < spec.controlDraws; b++) {
          let s = 0;
          for (const p of pools) s += p[Math.floor(rand() * p.length)];
          const m = s / pools.length; acc += m; if (m >= observed) ge++;
        }
        pRaw = (1 + ge) / (spec.controlDraws + 1); controlMean = acc / spec.controlDraws;
      }
    }
    const wins = items.filter(t => t.rNet > 0), losses = items.filter(t => t.rNet <= 0);
    const gp = wins.reduce((s, t) => s + t.rNet, 0), gl = -losses.reduce((s, t) => s + t.rNet, 0);
    const ci = items.length >= 2 ? dayClusterCi(r, spec.bootstrapDraws, spec.ciLevel, rand) : [null, null];
    cells.push({ family, reaction, n: items.length, days: new Set(items.map(t => t.day)).size, meanRNet: observed, meanRGross: mean(items.map(t => t.rGross)), medianRNet: median(items.map(t => t.rNet)),
      winRate: items.length ? wins.length / items.length : null, profitFactor: gl > 0 ? gp / gl : null, ci95: ci, controlMeanRNet: controlMean, excessOverControl: controlMean === null || observed === null ? null : observed - controlMean,
      meanRByCostView: Object.fromEntries(spec.costViews.map(v => [v, mean(items.map(t => t.views[v]))])), pRaw });
  }
  const adj = holm(cells.map(c => c.pRaw ?? 1));
  cells.forEach((c, i) => { c.pHolm = c.pRaw === null ? null : adj[i]; });
  return { specVersion: spec.version, specHash: STUDY_SPEC_HASH, specOverridden: Object.keys(overrides).length > 0, attempts: ATTEMPT_COUNT, sessions: sessions.length, days: new Set(sessions.map(s => s.tradeDate)).size,
    events: reactionCounts, skipped, tradesSimulated: trades.length, cells, notes: ['Independent events; overlapping trades are not a portfolio simulation.', 'Bar-based fills; intrabar order of stop and target is unknown (STOP_FIRST).', 'Research only: formalWeight=0, executionAuthorized=false.'], _trades: trades };
}
