import { openDatabase, applyMigrations, withTransaction } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { FRED_MACRO_SERIES, importMacroSeries } from '../src/macro-environment.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
const startDate = process.env.MACRO_START_DATE || '2023-06-01';

try {
  applyMigrations(db, config.migrationsPath);
  const results = [];
  for (const definition of FRED_MACRO_SERIES) {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(definition.key)}&cosd=${encodeURIComponent(startDate)}`;
    const response = await fetch(url, { headers: { 'user-agent': 'tw-chip-dashboard-research/2.8' }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${definition.key} download failed: HTTP ${response.status}`);
    const csv = await response.text();
    const imported = withTransaction(db, () => importMacroSeries(db, definition, csv));
    results.push({ series: definition.key, url, ...imported });
  }
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), startDate, availabilityRule: 'only observations strictly earlier than the Taiwan trade date are research-eligible', results }, null, 2));
} finally {
  db.close();
}
