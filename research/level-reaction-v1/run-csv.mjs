// Run the frozen level-reaction study on real 5m bars (e.g. TX day/night bars on the MSI D drive).
// Usage: node research/level-reaction-v1/run-csv.mjs <bars.csv> --holdout-start YYYY-MM-DD [--out result.json]
// CSV header (required): tradeDate,session,contract,timestamp,open,high,low,close
//   timestamp = ISO bar START time with offset, e.g. 2026-03-02T08:45:00+08:00 ; session = DAY | NIGHT
// Any row with tradeDate >= holdout-start is refused: the locked out-of-sample stays untouched.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { runLevelReactionStudy, STUDY_SPEC_HASH } from '../../src/level-reaction-study.mjs';

const args = process.argv.slice(2);
const file = args[0];
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const holdout = opt('--holdout-start'), out = opt('--out');
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(holdout ?? '')) { console.error('usage: run-csv.mjs <bars.csv> --holdout-start YYYY-MM-DD [--out file]'); process.exit(2); }

const text = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
const head = text[0].split(',').map(s => s.trim());
const need = ['tradeDate', 'session', 'contract', 'timestamp', 'open', 'high', 'low', 'close'];
for (const k of need) if (!head.includes(k)) { console.error(`missing column ${k}`); process.exit(2); }
const groups = new Map(); let refused = 0;
for (const line of text.slice(1)) {
  const v = line.split(','); const row = Object.fromEntries(head.map((h, i) => [h, v[i]?.trim()]));
  if (row.tradeDate >= holdout) { refused++; continue; }
  const key = `${row.tradeDate}|${row.session}|${row.contract}`;
  if (!groups.has(key)) groups.set(key, { contract: row.contract, tradeDate: row.tradeDate, session: row.session, bars: [] });
  groups.get(key).bars.push({ timestamp: new Date(row.timestamp).toISOString(), open: row.open, high: row.high, low: row.low, close: row.close });
}
const sessions = [...groups.values()].map(g => ({ ...g, bars: g.bars.sort((a, b) => a.timestamp.localeCompare(b.timestamp)) }));
const result = runLevelReactionStudy(sessions);
const { _trades, ...summary } = result;
const report = { ...summary, input: { file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), holdoutStart: holdout, holdoutRowsRefused: refused }, specHash: STUDY_SPEC_HASH, trades: _trades };
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`sessions ${summary.sessions}, holdout rows refused ${refused}, spec ${STUDY_SPEC_HASH.slice(0, 12)}`);
for (const c of summary.cells) console.log(`${c.family.padEnd(5)} ${c.reaction.padEnd(6)} n=${String(c.n).padStart(4)} netR=${c.meanRNet?.toFixed(3) ?? '—'} ctrl=${c.controlMeanRNet?.toFixed(3) ?? '—'} pHolm=${c.pHolm?.toFixed(3) ?? '—'}`);
