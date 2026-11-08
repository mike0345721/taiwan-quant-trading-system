import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { validateOfficialBackfill } from '../src/official-validation.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const result = validateOfficialBackfill(db, path.join(config.dataRoot, 'data', 'official-cache'));
  fs.mkdirSync(config.reportsPath, { recursive: true });
  const reportPath = path.join(config.reportsPath, 'official-validation.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Official validation: ${result.passedChecks}/${result.totalChecks} checks passed`);
  console.log(`Coverage: futures ${result.coverage.futures_days} days; options ${result.coverage.option_days} days; strikes ${result.coverage.option_strikes}; OI deltas ${result.coverage.delta_rows}`);
  console.log(`Report: ${reportPath}`);
  if (result.failedChecks) {
    result.checks.filter((item) => !item.passed).slice(0, 20).forEach((item) => console.log(`FAIL ${item.name}: ${item.detail}`));
    process.exitCode = 2;
  }
} finally { db.close(); }
