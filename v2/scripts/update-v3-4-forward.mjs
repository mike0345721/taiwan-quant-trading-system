import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase } from '../src/db.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';
import { specificationHash } from '../src/forward-ledger.mjs';
import { resolveCandidateOutcome, v34CandidateSignals } from '../src/v3-4-forward.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
const specification = JSON.parse(fs.readFileSync(path.join(config.root, 'config', 'forward-v3.4.json'), 'utf8'));
const hash = specificationHash(specification); const dir = path.join(path.dirname(config.databasePath), 'forward');
const signalPath = path.join(dir, 'v3.4-candidate-signals.jsonl'); const outcomePath = path.join(dir, 'v3.4-candidate-outcomes.jsonl');
const statusPath = path.join(config.reportsPath, 'v3.4-forward-status.json');
const readJsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
const append = (file, records) => { if (!records.length) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, records.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8'); };

try {
  const rows = loadResearchRows(db, { includeUnresolved: true }); const rowByDate = new Map(rows.map((row) => [row.tradeDate, row]));
  const existingSignals = readJsonl(signalPath); const signalKeys = new Set(existingSignals.map((row) => `${row.strategyKey}|${row.signalDate}`)); const additions = [];
  for (let index = specification.assumptions.minimumTrainingDays; index < rows.length; index += 1) {
    const row = rows[index]; if (row.tradeDate <= specification.freezeThroughDate) continue;
    for (const candidate of v34CandidateSignals(rows.slice(0, index), row)) {
      const key = `${candidate.strategyKey}|${row.tradeDate}`; if (signalKeys.has(key)) continue;
      additions.push({ schemaVersion: 1, specificationVersion: specification.version, specificationHash: hash,
        recordedAt: new Date().toISOString(), signalDate: row.tradeDate, txContract: row.txContract, ...candidate, researchOnly: true });
      signalKeys.add(key);
    }
  }
  append(signalPath, additions);
  const allSignals = [...existingSignals, ...additions]; const existingOutcomes = readJsonl(outcomePath);
  const outcomeKeys = new Set(existingOutcomes.map((row) => `${row.strategyKey}|${row.signalDate}`)); const newOutcomes = [];
  for (const signal of allSignals) {
    const key = `${signal.strategyKey}|${signal.signalDate}`; if (outcomeKeys.has(key)) continue;
    const outcome = resolveCandidateOutcome(signal, rowByDate.get(signal.signalDate), specification.assumptions.costPoints);
    if (outcome) { newOutcomes.push({ ...outcome, specificationHash: hash }); outcomeKeys.add(key); }
  }
  append(outcomePath, newOutcomes);
  const status = { generatedAt: new Date().toISOString(), specificationVersion: specification.version, specificationHash: hash,
    freezeThroughDate: specification.freezeThroughDate, registeredStrategies: specification.strategyKeys,
    signalDays: allSignals.length, activeSignals: allSignals.filter((row) => row.signal !== 0).length,
    resolvedOutcomes: existingOutcomes.length + newOutcomes.length, newlyRecorded: additions.length, newlyResolved: newOutcomes.length,
    status: allSignals.length ? 'tracking' : 'waiting_for_post_freeze_data', researchOnly: true };
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8'); console.log(JSON.stringify(status, null, 2));
} finally { db.close(); }
