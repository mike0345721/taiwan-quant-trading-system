import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { runQualityChecks } from '../src/quality.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const result = runQualityChecks(db);
  fs.mkdirSync(config.reportsPath, { recursive: true });
  const reportPath = path.join(config.reportsPath, 'latest-quality.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`);
  console.log(`Snapshots: ${result.snapshots} (${result.first_date || '—'} to ${result.last_date || '—'})`);
  console.log(`Option contracts: ${result.contracts}; strike rows: ${result.strikes}`);
  console.log(`Quality issues: ${result.issues.error} errors, ${result.issues.warning} warnings`);
  console.log(`Report: ${reportPath}`);
  if (result.issues.error > 0) process.exitCode = 2;
} finally {
  db.close();
}
