import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { evaluateHoldout, loadResearchRows, strategyDefinitions } from '../src/backtest-engine.mjs';
import { appendForwardRecords, specificationHash, validateForwardRecord } from '../src/forward-ledger.mjs';

const config = v2Config();
const specificationPath = path.join(config.root, 'config', 'forward-v2.9.4.json');
const ledgerPath = path.join(path.dirname(config.databasePath), 'forward', 'paper-ledger-v2.9.4.jsonl');
const specification = JSON.parse(fs.readFileSync(specificationPath, 'utf8'));
const hash = specificationHash(specification);
const db = openDatabase(config.databasePath);

try {
  applyMigrations(db, config.migrationsPath);
  const rows = loadResearchRows(db);
  const strategies = strategyDefinitions().filter((item) => specification.strategyKeys.includes(item.key));
  const assumptions = specification.assumptions;
  const records = [];
  for (let index = assumptions.minimumTrainingDays; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.tradeDate <= specification.freezeThroughDate) continue;
    for (const strategy of strategies) {
      const sample = rows.slice(0, index + 1);
      const result = evaluateHoldout(sample, strategy, {
        ...assumptions,
        minTrainDays: index,
        holdoutPct: 1 / sample.length,
      });
      const outcome = result.daily?.at(-1);
      if (!outcome || outcome.tradeDate !== row.tradeDate) continue;
      const record = {
        schemaVersion: 1,
        specificationVersion: specification.version,
        specificationHash: hash,
        recordedAt: new Date().toISOString(),
        strategyKey: strategy.key,
        strategyVersion: strategy.version,
        signalDate: row.tradeDate,
        signal: Number(outcome.signal || 0),
        entryDate: outcome.entryTradeDate || row.nextTradeDate || null,
        exitDate: outcome.exitTradeDate || null,
        outcomeStatus: Number(outcome.signal) && Number.isFinite(Number(outcome.netPoints)) ? 'resolved' : 'pending',
        netPoints: Number(outcome.signal) && Number.isFinite(Number(outcome.netPoints)) ? Number(outcome.netPoints) : null,
        maePoints: Number(outcome.signal) && Number.isFinite(Number(outcome.maePoints)) ? Number(outcome.maePoints) : null,
        mfePoints: Number(outcome.signal) && Number.isFinite(Number(outcome.mfePoints)) ? Number(outcome.mfePoints) : null,
        researchOnly: true,
      };
      validateForwardRecord(record, specification);
      records.push(record);
    }
  }
  const result = appendForwardRecords(ledgerPath, records);
  console.log(JSON.stringify({ specificationVersion: specification.version, specificationHash: hash, freezeThroughDate: specification.freezeThroughDate, candidateRecords: records.length, ...result, ledgerPath }, null, 2));
} finally {
  db.close();
}
