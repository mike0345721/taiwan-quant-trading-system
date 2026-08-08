import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase } from '../src/db.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';
import { analyzeReverseEvents } from '../src/reverse-event-study.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  const report = analyzeReverseEvents(loadResearchRows(db), { startDate: '2023-07-14' });
  fs.mkdirSync(config.reportsPath, { recursive: true });
  const output = path.join(config.reportsPath, 'reverse-large-move-study.json');
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, sourceRows: report.sourceRows, eventCounts: report.eventCounts, candidates: report.candidates.length }, null, 2));
} finally { db.close(); }
