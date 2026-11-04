// Synthetic-only post-import profile. Never opens an existing database or config.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { openDatabase, applyMigrations, withTransaction } from '../src/db.mjs';
import { reconcileOptionExpiriesAndActive, rebuildOptionOiChanges } from '../src/official-backfill.mjs';
import { rebuildFeatures } from '../src/features.mjs';

const output = process.argv[2];
const count = Number(process.argv[3] || 617157);
if (!output || !path.isAbsolute(output) || fs.existsSync(output) || !Number.isSafeInteger(count) || count < 1 || count > 1000000)
  throw Error('Expected a new absolute isolated output directory and 1..1000000 synthetic rows');
fs.mkdirSync(output, { recursive: false });
const startedAt = new Date().toISOString();
const source = fileURLToPath(new URL('../src/official-backfill.mjs', import.meta.url));
const result = { schema: 'taifex-post-import-synthetic-profile-v1', startedAt, node: process.version,
  sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), synthetic: true,
  realDataRead: false, stages: [] };
const db = openDatabase(path.join(output, 'synthetic.sqlite'));
function stage(name, fn) {
  const started = performance.now(), before = process.memoryUsage();
  const value = fn();
  const record = { name, elapsedMs: performance.now() - started, value, memoryBefore: before, memoryAfter: process.memoryUsage() };
  result.stages.push(record); console.log(JSON.stringify(record));
  fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify(result, null, 2));
  return value;
}
try {
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  stage('seed', () => withTransaction(db, () => {
    db.exec(`WITH RECURSIVE days(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM days WHERE i<364)
      INSERT INTO raw_snapshots SELECT date('2025-01-01','+'||i||' days'), '2026-11-04T00:00:00Z', date('2025-01-01','+'||i||' days'),
        'synthetic-isolated', '{}', 'synthetic', '2026-11-04T00:00:00Z' FROM days;
      INSERT INTO market_daily(trade_date,tx_close) SELECT trade_date,20000 FROM raw_snapshots;
      WITH contracts(c) AS (VALUES('202601'),('202602'),('202603'),('202604'),('202605'),('202606'),('202607'),('202608'),('202609'),('202610'))
      INSERT INTO options_contract_daily(trade_date,contract,expiry_date,call_oi,put_oi)
        SELECT trade_date,c,'2026-12-31',100,100 FROM raw_snapshots CROSS JOIN contracts;`);
    const insert = db.prepare('INSERT INTO options_strike_daily(trade_date,contract,strike,call_oi,put_oi) VALUES(?,?,?,?,?)');
    const identities = db.prepare('SELECT trade_date,contract FROM options_contract_daily ORDER BY trade_date,contract').all();
    for (let i = 0; i < count; i++) {
      const identity = identities[i % identities.length], strike = 10000 + Math.floor(i / identities.length) * 50;
      insert.run(identity.trade_date, identity.contract, strike, i % 731, i % 997);
    }
    return { strikeRows: count, contractRows: identities.length };
  }));
  stage('reconcileOptionExpiriesAndActive', () => reconcileOptionExpiriesAndActive(db));
  stage('rebuildOptionOiChanges', () => rebuildOptionOiChanges(db));
  stage('rebuildFeatures', () => rebuildFeatures(db));
  result.counts = { source: db.prepare('SELECT count(*) AS n FROM options_strike_daily').get().n,
    derived: db.prepare('SELECT count(*) AS n FROM option_oi_changes').get().n };
  result.integrity = db.prepare('PRAGMA integrity_check').get();
  result.completedAt = new Date().toISOString();
  result.status = result.counts.source === result.counts.derived ? 'PASS' : 'FAIL';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error.message); process.exitCode = 1;
} finally {
  db.close(); result.databaseBytes = fs.statSync(path.join(output, 'synthetic.sqlite')).size;
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, output, counts: result.counts, error: result.error }));
}
