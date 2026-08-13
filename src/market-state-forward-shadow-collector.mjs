import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildCanonicalFeatureRows } from './phase-a-canonical.mjs';
import { loadMarketStateHistoricalRaw } from './market-state-historical-adapter.mjs';
import { buildHistoricalMarketStateRecords } from './market-state-historical.mjs';
import { digest } from './market-state-forward-shadow.mjs';

function latestAvailableAt(evidence = []) {
  const timestamps = evidence.map((item) => item.availableAt).filter((value) => Number.isFinite(Date.parse(value)));
  return timestamps.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || null;
}

export function materializeForwardDecisionDate(raw, { tradeDate, priorTradeDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('FORWARD_SHADOW_TRADE_DATE_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(priorTradeDate || '') || priorTradeDate >= tradeDate) {
    throw new Error('FORWARD_SHADOW_PREVIOUS_TRADING_DATE_INVALID');
  }
  const marketRows = Array.isArray(raw?.marketRows) ? raw.marketRows : [];
  if (marketRows.some((row) => row.trade_date === tradeDate)) {
    return Object.freeze({ raw, state: 'EXISTING_DECISION_DATE', sourceTradeDate: priorTradeDate });
  }
  const priorRow = marketRows.find((row) => row.trade_date === priorTradeDate);
  if (!priorRow) {
    return Object.freeze({ raw, state: 'UNAVAILABLE', unavailableReason: 'PREVIOUS_GOVERNED_TRADE_DATE_SOURCE_MISSING', sourceTradeDate: priorTradeDate });
  }
  return Object.freeze({
    state: 'MATERIALIZED_PREMARKET_DECISION_DATE',
    sourceTradeDate: priorTradeDate,
    raw: {
      ...raw,
      marketRows: [...marketRows, { ...priorRow, trade_date: tradeDate }]
        .sort((left, right) => left.trade_date.localeCompare(right.trade_date)),
    },
  });
}

export function collectForwardMarketStateSnapshot({ databasePath, featureSpecPath, tradeDate, priorTradeDate }) {
  if (!fs.existsSync(databasePath)) throw new Error('FORWARD_SHADOW_SOURCE_DATABASE_MISSING');
  if (!fs.existsSync(featureSpecPath)) throw new Error('FORWARD_SHADOW_FEATURE_SPEC_MISSING');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('FORWARD_SHADOW_TRADE_DATE_INVALID');
  const featureSpecBytes = fs.readFileSync(featureSpecPath);
  const featureSpec = JSON.parse(featureSpecBytes.toString('utf8'));
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let raw;
  try {
    raw = loadMarketStateHistoricalRaw(database);
  } finally {
    database.close();
  }
  const materialized = materializeForwardDecisionDate(raw, { tradeDate, priorTradeDate });
  if (materialized.state === 'UNAVAILABLE') {
    return Object.freeze({
      state: 'UNAVAILABLE',
      unavailableReason: materialized.unavailableReason,
      tradeDate,
      priorTradeDate,
      featureSpecHash: digest(featureSpecBytes),
      canonicalRowCount: 0,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    });
  }
  const canonicalRows = buildCanonicalFeatureRows(materialized.raw, featureSpec);
  const record = buildHistoricalMarketStateRecords(canonicalRows).find((item) => item.tradeDate === tradeDate);
  if (!record) {
    return Object.freeze({
      state: 'UNAVAILABLE',
      unavailableReason: 'NO_LEGAL_PREMARKET_SNAPSHOT',
      tradeDate,
      priorTradeDate,
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
    priorTradeDate,
    decisionDateMaterializationState: materialized.state,
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
