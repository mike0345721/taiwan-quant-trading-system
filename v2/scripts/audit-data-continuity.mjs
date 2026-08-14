import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildContinuityReport } from '../../src/data-continuity.mjs';
import { readBoundedLiveCoverage } from '../../src/data-continuity-audit.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.dirname(scriptDir);
const appRoot = path.dirname(v2Root);
const value = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const databasePath = path.resolve(value('--database', path.join(v2Root, 'data', 'research-v2.sqlite')));
const liveEventsDir = path.resolve(value('--live-events-dir', path.join(appRoot, 'data', 'live-events')));
const reportPath = path.resolve(value('--report', path.join(v2Root, 'reports', 'data-continuity-status.json')));
const maxBytesPerFile = Number(value('--max-bytes-per-file', String(64 * 1024 * 1024)));
if (!Number.isFinite(maxBytesPerFile) || maxBytesPerFile < 1024) throw new Error('INVALID_MAX_BYTES_PER_FILE');

function taipeiDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function distinctDates(db, table) {
  return db.prepare(`SELECT DISTINCT trade_date FROM ${table} ORDER BY trade_date`)
    .all().map((row) => row.trade_date);
}

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const inputDiscoveryStarted = performance.now();
  const today = taipeiDate();
  const expectedDates = distinctDates(db, 'market_daily').filter((date) => date < today);
  const recoverableCoverage = {
    marketDaily: distinctDates(db, 'market_daily'),
    spotInstitutionalDaily: distinctDates(db, 'spot_institutional_daily'),
    futuresPositionsDaily: distinctDates(db, 'futures_positions_daily'),
    futuresOiDaily: distinctDates(db, 'futures_oi_daily'),
    optionsContractDaily: distinctDates(db, 'options_contract_daily'),
    optionsStrikeDaily: distinctDates(db, 'options_strike_daily'),
  };
  const inputDiscoveryElapsedMs = Math.round((performance.now() - inputDiscoveryStarted) * 10) / 10;
  const live = await readBoundedLiveCoverage({ liveEventsDir, expectedDates, maxBytesPerFile });
  live.telemetry.inputDiscoveryElapsedMs = inputDiscoveryElapsedMs;
  const report = buildContinuityReport({
    generatedAt: new Date().toISOString(),
    expectedDates,
    recoverableCoverage,
    liveCoverage: live.coverage,
    liveCoverageAudit: live,
  });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, reportPath);
  console.log(JSON.stringify(report, null, 2));
  if (report.liveEventLedger.status === 'AUDIT_INCOMPLETE') process.exitCode = 2;
} finally {
  db.close();
}
