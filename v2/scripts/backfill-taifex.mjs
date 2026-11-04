import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { backfillTaifex } from '../src/official-backfill.mjs';
import { rebuildFeatures } from '../src/features.mjs';
import { runQualityChecks } from '../src/quality.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const latestStoredDate = db.prepare('SELECT MAX(trade_date) AS date FROM futures_contract_daily').get()?.date;
  const routineStartDate = latestStoredDate ? `${latestStoredDate.slice(0, 7)}-01` : '2025-07-01';
  const startDate = process.env.V2_BACKFILL_START || routineStartDate;
  // Always advance toward today. Using the latest stored date as the end date
  // caused every later update to stop at the already-downloaded snapshot.
  const taipeiToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const endDate = process.env.V2_BACKFILL_END || taipeiToday;
  console.log(`TAIFEX official backfill ${startDate} to ${endDate}`);
  const result = await backfillTaifex(db, {
    startDate, endDate, cacheDir: path.join(config.root, 'data', 'official-cache'),
    onProgress: (message) => console.log(`[${new Date().toISOString()}] ${message}`),
  });
  console.log(`[${new Date().toISOString()}] Starting post-import rebuildFeatures`);
  let started = Date.now();
  const features = rebuildFeatures(db);
  console.log(`[${new Date().toISOString()}] Completed post-import rebuildFeatures: ${features.rows} rows / ${Date.now() - started}ms`);
  console.log(`[${new Date().toISOString()}] Starting post-import runQualityChecks`);
  started = Date.now();
  const quality = runQualityChecks(db);
  console.log(`[${new Date().toISOString()}] Completed post-import runQualityChecks: ${Date.now() - started}ms`);
  fs.mkdirSync(config.reportsPath, { recursive: true });
  fs.writeFileSync(path.join(config.reportsPath, 'latest-quality.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...quality }, null, 2)}\n`);
  const ok = result.state === 'COMPLETE' && result.failures.length === 0;
  console.log(JSON.stringify({ ok, ...result, coverage: quality.coverage, issues: quality.issues, byRule: quality.byRule }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  db.close();
}
