import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';
import { analyzePositionStates } from '../src/position-state-research.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const report = analyzePositionStates(loadResearchRows(db));
  const reportPath = path.resolve('reports', 'position-state-research.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, reportPath, coverage: report.coverage, holdout: report.holdout }, null, 2));
} finally {
  db.close();
}
