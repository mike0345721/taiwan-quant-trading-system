import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { buildContinuityReport } from '../../src/data-continuity.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.dirname(scriptDir);
const appRoot = path.dirname(v2Root);
const databasePath = path.join(v2Root, 'data', 'research-v2.sqlite');
const liveEventsDir = path.join(appRoot, 'data', 'live-events');
const reportPath = path.join(v2Root, 'reports', 'data-continuity-status.json');

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

async function readLiveCoverage() {
  const coverage = {};
  if (!fs.existsSync(liveEventsDir)) return coverage;
  const files = fs.readdirSync(liveEventsDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name)).sort();
  for (const name of files) {
    const date = name.slice(0, 10);
    const products = new Set();
    const input = fs.createReadStream(path.join(liveEventsDir, name), 'utf8');
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if ((event.kind === 'index_quote' && event.code === 'IX0001')
          || (event.kind === 'stock_tick' && event.code === '2330')) {
          products.add(event.code);
        }
      } catch {
        // Ledger format validity is handled by the dedicated hash/row audit.
      }
    }
    if (products.size > 0) coverage[date] = [...products].sort();
  }
  return coverage;
}

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
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
  const report = buildContinuityReport({
    generatedAt: new Date().toISOString(),
    expectedDates,
    recoverableCoverage,
    liveCoverage: await readLiveCoverage(),
  });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, reportPath);
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
