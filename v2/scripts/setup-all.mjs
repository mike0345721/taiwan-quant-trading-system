import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { loadV1Snapshots, importSnapshots } from '../src/history-importer.mjs';
import { rebuildFeatures } from '../src/features.mjs';
import { runQualityChecks } from '../src/quality.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  const migration = applyMigrations(db, config.migrationsPath);
  const loaded = loadV1Snapshots(config.historyPath, config.latestPath);
  const imported = importSnapshots(db, loaded.snapshots, { sourcePath: config.historyPath });
  const features = rebuildFeatures(db);
  const quality = runQualityChecks(db);
  fs.mkdirSync(config.reportsPath, { recursive: true });
  fs.writeFileSync(path.join(config.reportsPath, 'latest-quality.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...quality }, null, 2)}\n`);
  console.log('V2 local data core is ready.');
  console.log(`Database: ${config.databasePath}`);
  console.log(`Migrations: ${migration.applied} new; snapshots: ${imported.imported}; features: ${features.rows}`);
  console.log(`Options: ${quality.contracts} contracts / ${quality.strikes} strike rows`);
  console.log(`Coverage days: TWII ${quality.coverage.twii_days}; TX ${quality.coverage.tx_days}; spot ${quality.coverage.spot_days}; futures positions ${quality.coverage.futures_position_days}; options ${quality.coverage.option_days}`);
  console.log(`Quality: ${quality.issues.error} errors / ${quality.issues.warning} warnings`);
  quality.byRule.slice(0, 6).forEach((item) => console.log(`- ${item.rule_code}: ${item.count} ${item.severity}`));
  if (loaded.errors.length) console.log(`Unreadable V1 files: ${loaded.errors.length}`);
  if (loaded.skipped.length) console.log(`Non-live V1 snapshots skipped: ${loaded.skipped.length}`);
} finally {
  db.close();
}
