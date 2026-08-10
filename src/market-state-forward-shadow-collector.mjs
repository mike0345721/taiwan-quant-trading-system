import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildMarketStateCanonicalRows } from './market-state-historical-adapter.mjs';
import { buildHistoricalMarketStateRecords } from './market-state-historical.mjs';
import { digest } from './market-state-forward-shadow.mjs';

function latestAvailableAt(evidence = []) {
  const timestamps = evidence.map((item) => item.availableAt).filter((value) => Number.isFinite(Date.parse(value)));
  return timestamps.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || null;
}

export function collectForwardMarketStateSnapshot({ databasePath, featureSpecPath, tradeDate }) {
  if (!fs.existsSync(databasePath)) throw new Error('FORWARD_SHADOW_SOURCE_DATABASE_MISSING');
  if (!fs.existsSync(featureSpecPath)) throw new Error('FORWARD_SHADOW_FEATURE_SPEC_MISSING');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('FORWARD_SHADOW_TRADE_DATE_INVALID');
  const featureSpecBytes = fs.readFileSync(featureSpecPath);
  const featureSpec = JSON.parse(featureSpecBytes.toString('utf8'));
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let canonicalRows;
  try {
    canonicalRows = buildMarketStateCanonicalRows(database, featureSpec);
  } finally {
    database.close();
  }
  const record = buildHistoricalMarketStateRecords(canonicalRows).find((item) => item.tradeDate === tradeDate);
  if (!record) {
    return Object.freeze({
      state: 'UNAVAILABLE',
      unavailableReason: 'NO_LEGAL_PREMARKET_SNAPSHOT',
      tradeDate,
      featureSpecHash: digest(featureSpecBytes),
      canonicalRowCount: canonicalRows.length,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    });
  }
  const evidenceLineage = (record.evidence || []).map((item) => ({
    source: item.source || item.key,
    availableAt: item.availableAt,
    sourceHash: digest(item),
  }));
  return Object.freeze({
    state: 'AVAILABLE',
    tradeDate,
    decisionAt: record.decisionAt,
    availableAt: latestAvailableAt(record.evidence),
    evaluation: record,
    evidenceLineage,
    sourceHashes: {
      featureSpec: digest(featureSpecBytes),
      selectedMarketStateRecord: digest(record),
    },
    sourceTimestamps: Object.fromEntries((record.evidence || []).map((item) => [item.key, item.availableAt])),
    featureVersion: featureSpec.featureVersion || null,
    canonicalRowCount: canonicalRows.length,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  });
}
