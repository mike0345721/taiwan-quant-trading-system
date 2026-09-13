import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Names, keys and scopes come from the Master registry and existing V2 schemas.
// This reader never invokes an importer, migrations, a collector, or a network source.
const DEFINITIONS = Object.freeze({
  taifex_daily_market: { stage: 'taifex', tables: { market_daily: ['trade_date', 'tx_contract', 'tx_close', 'tx_volume', 'tx_open_interest'] }, keys: { market_daily: ['trade_date'] } },
  tx_futures_oi: { stage: 'futures_positions', tables: { futures_oi_daily: ['trade_date', 'near_contract', 'near_contract_oi', 'research_definition', 'quality_status', 'built_at', 'product_scope', 'near_scope_market_oi', 'all_contracts_market_oi'] }, keys: { futures_oi_daily: ['trade_date'] } },
  tx_institutional_positions: { stage: 'futures_positions', tables: { futures_positions_daily: ['trade_date', 'foreign_long', 'foreign_short', 'foreign_net', 'dealer_net', 'trust_net'], institutional_futures_detail_daily: ['trade_date', 'institution_type', 'open_interest_long', 'open_interest_short', 'open_interest_net', 'source_url', 'fetched_at'] }, keys: { futures_positions_daily: ['trade_date'], institutional_futures_detail_daily: ['trade_date', 'institution_type'] } },
  tx_large_trader: { stage: 'taifex', tables: { large_trader_futures_daily: ['trade_date', 'product_scope', 'expiry_scope', 'top5_long', 'top5_short', 'top10_long', 'top10_short', 'market_open_interest', 'source_url', 'fetched_at'] }, keys: { large_trader_futures_daily: ['trade_date', 'product_scope', 'expiry_scope'] } },
  txo_strike_expiry_cp_oi: { stage: 'taifex', tables: { options_strike_daily: ['trade_date', 'contract', 'strike', 'call_oi', 'put_oi'], options_contract_daily: ['trade_date', 'contract', 'expiry_date', 'expiry_date_source'] }, keys: { options_strike_daily: ['trade_date', 'contract', 'strike'], options_contract_daily: ['trade_date', 'contract'] } },
  market_breadth_and_sector_leadership: { stage: 'market_breadth', tables: { market_breadth_history_daily: ['trade_date', 'market', 'advance', 'decline', 'unchanged', 'limit_up', 'limit_down', 'universe_scope', 'derivation', 'available_at', 'retrieved_at', 'source_url', 'payload_sha256', 'quality_status'] }, keys: { market_breadth_history_daily: ['trade_date', 'market'] } },
});

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value) => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const ordered = (rows) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));

function initial(datasetId, definition, tradeDate, observedAt) {
  return {
    datasetId, sourceStage: definition.stage, sourceDate: tradeDate,
    sourceTables: Object.keys(definition.tables), sourceArtifactIdentity: null,
    recordCount: null, tableCounts: {}, observedAt, availableAt: null,
    cutoffValidated: false, captureState: 'UNKNOWN', persistenceState: 'UNKNOWN',
    integrityState: 'UNKNOWN', researchEligibility: 'UNKNOWN', reasonCodes: [], lineage: {},
    coverageScope: 'EXISTING_DATE_SCOPED_ROWS_ONLY',
  };
}

function selected(db, table, columns, tradeDate) {
  const schema = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  if (!schema.size || !columns.every((column) => schema.has(column))) return null;
  // Table/column identifiers are fixed constants above; only the requested date is bound.
  return ordered(db.prepare(`SELECT ${columns.join(',')} FROM ${table} WHERE trade_date=?`).all(tradeDate));
}

function metadataLineage(db, tradeDate) {
  const sources = selected(db, 'data_sources', ['trade_date', 'source_key', 'source_data_date', 'fetched_at', 'ok', 'stale', 'fallback_from_cache'], tradeDate);
  const snapshots = selected(db, 'raw_snapshots', ['trade_date', 'generated_at', 'as_of_date', 'data_mode', 'payload_sha256', 'imported_at'], tradeDate);
  return { sources: sources || [], snapshots: snapshots || [] };
}

function coverage(datasetId, rows) {
  if (datasetId === 'taifex_daily_market') {
    const row = rows.market_daily[0];
    return Boolean(row && text(row.tx_contract) && finite(row.tx_close) && finite(row.tx_volume));
  }
  if (datasetId === 'tx_futures_oi') {
    const row = rows.futures_oi_daily[0];
    return Boolean(row && text(row.near_contract) && finite(row.near_contract_oi) && row.research_definition === 'near_contract_oi');
  }
  if (datasetId === 'tx_institutional_positions') {
    const row = rows.futures_positions_daily[0];
    return Boolean(row && ['foreign_long', 'foreign_short', 'foreign_net', 'dealer_net', 'trust_net'].every((key) => finite(row[key])) && ['investment_trust', 'dealer'].every((participant) => rows.institutional_futures_detail_daily.some((detail) => detail.institution_type === participant && ['open_interest_long', 'open_interest_short', 'open_interest_net'].every((key) => finite(detail[key])))));
  }
  if (datasetId === 'tx_large_trader') {
    return ['near_month', 'all_contracts'].every((scope) => rows.large_trader_futures_daily.some((row) => row.expiry_scope === scope && row.product_scope === 'TX_MTX_TMF_EQUIVALENT' && ['top5_long', 'top5_short', 'top10_long', 'top10_short', 'market_open_interest'].every((key) => finite(row[key]))));
  }
  if (datasetId === 'txo_strike_expiry_cp_oi') {
    return rows.options_strike_daily.length > 0 && rows.options_strike_daily.every((row) => text(row.contract) && finite(row.strike) && finite(row.call_oi) && finite(row.put_oi) && rows.options_contract_daily.some((contract) => contract.contract === row.contract && text(contract.expiry_date)));
  }
  const row = rows.market_breadth_history_daily.find((item) => item.market === 'TWSE');
  return Boolean(row && ['advance', 'decline', 'unchanged', 'limit_up', 'limit_down'].every((key) => finite(row[key])) && text(row.universe_scope) && text(row.derivation) && text(row.source_url) && /^[a-f\d]{64}$/i.test(row.payload_sha256 || '') && row.quality_status === 'official_complete');
}

/**
 * Acquire metadata from one read-only SQLite snapshot, without returning raw rows.
 * observedAt is an injectable test clock. Production callers omit it, then freeze
 * this returned map and choose report generatedAt after this acquisition finishes.
 * An omitted generatedAt uses the actual acquisition completion as this map cutoff.
 * Replaying a historical generatedAt against today's DB never proves past persistence.
 */
export function readDailyBatchEvidence({ databasePath, tradeDate, generatedAt, observedAt } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '') || new Date(`${tradeDate}T00:00:00Z`).toISOString().slice(0, 10) !== tradeDate) throw new Error('A valid tradeDate is required');
  if (generatedAt !== undefined && !timestamp(generatedAt)) throw new Error('generatedAt must be a timestamp with offset');
  if (observedAt !== undefined && !timestamp(observedAt)) throw new Error('observedAt must be a timestamp with offset');
  const result = Object.fromEntries(Object.entries(DEFINITIONS).map(([id, definition]) => [id, initial(id, definition, tradeDate, null)]));
  let db;
  try {
    if (!databasePath || !fs.existsSync(databasePath)) {
      for (const row of Object.values(result)) row.reasonCodes.push('ARTIFACT_IDENTITY_MISSING');
      return result;
    }
    db = new DatabaseSync(databasePath, { readOnly: true });
    db.exec('BEGIN');
    const lineage = metadataLineage(db, tradeDate);
    for (const [id, definition] of Object.entries(DEFINITIONS)) {
      const item = result[id];
      const rows = Object.fromEntries(Object.entries(definition.tables).map(([table, columns]) => [table, selected(db, table, columns, tradeDate)]));
      item.tableCounts = Object.fromEntries(Object.entries(rows).map(([table, values]) => [table, values?.length ?? null]));
      const readableCount = Object.values(rows).reduce((sum, values) => sum + (values?.length || 0), 0);
      item.recordCount = Object.values(rows).some((values) => values === null) ? null : readableCount;
      if (Object.values(rows).some((values) => values === null)) item.reasonCodes.push('BATCH_SCHEMA_UNVERIFIED');
      if (!readableCount) { item.reasonCodes.push('ARTIFACT_IDENTITY_MISSING'); continue; }
      const existingRows = Object.fromEntries(Object.entries(rows).filter(([, values]) => values !== null));
      const rowKeys = Object.fromEntries(Object.entries(existingRows).map(([table, values]) => [table, values.map((row) => Object.fromEntries(definition.keys[table].map((key) => [key, row[key]])))]));
      item.sourceArtifactIdentity = { kind: 'sqlite-selected-rows-sha256', sha256: hash(existingRows), rowKeySha256: hash(rowKeys), databasePath, tables: Object.keys(existingRows) };
      item.lineage = {
        ...lineage,
        timestampFields: Object.fromEntries(Object.entries(existingRows).map(([table, values]) => [table, Object.fromEntries(['built_at', 'fetched_at', 'retrieved_at', 'available_at'].filter((field) => definition.tables[table].includes(field)).map((field) => [field, [...new Set(values.map((row) => row[field]))].sort()]))])),
        sourceScope: id === 'tx_large_trader' ? 'TX_MTX_TMF_EQUIVALENT' : id === 'tx_futures_oi' ? 'near_contract_oi; total and equivalent product scopes remain separate' : null,
      };
      const complete = Object.values(rows).every((values) => values !== null) && coverage(id, rows);
      if (!complete) item.reasonCodes.push('COVERAGE_PARTIAL');
      item.reasonCodes.push('SOURCE_INTEGRITY_NOT_VERIFIED');
      if (id === 'txo_strike_expiry_cp_oi') item.reasonCodes.push('SOURCE_NULL_SEMANTICS_UNVERIFIED');
      if (id === 'market_breadth_and_sector_leadership') {
        const breadth = rows.market_breadth_history_daily?.find((row) => row.market === 'TWSE');
        item.components = { breadth: 'UNKNOWN', sectorLeadership: 'UNKNOWN' };
        item.coverageScope = 'TWSE_OFFICIAL_EOD_BREADTH_ONLY';
        item.reasonCodes.push('COVERAGE_PARTIAL', 'PROJECTION_NOT_READY');
        if (breadth && timestamp(breadth.available_at)) item.availableAt = breadth.available_at;
        item.lineage.availabilitySemantics = 'Existing EOD publication policy; distinct from receipt and observation, not an intraday availability proof.';
        item.lineage.breadthRetrievedAt = breadth?.retrieved_at ?? null;
        item.lineage.breadthEligible = Boolean(complete && timestamp(breadth?.available_at) && breadth.available_at.startsWith(`${tradeDate}T`) && timestamp(breadth?.retrieved_at));
        if (breadth && (!timestamp(breadth.available_at) || !breadth.available_at.startsWith(`${tradeDate}T`) || !timestamp(breadth.retrieved_at))) item.reasonCodes.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
      }
      if (!item.availableAt) item.reasonCodes.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
    }
    db.exec('COMMIT');
    const acquisitionTime = observedAt ?? new Date().toISOString();
    const cutoffTime = generatedAt ?? acquisitionTime;
    for (const item of Object.values(result)) {
      item.observedAt = acquisitionTime;
      const observedByCutoff = Date.parse(acquisitionTime) <= Date.parse(cutoffTime);
      if (item.sourceArtifactIdentity && observedByCutoff) item.persistenceState = 'PASS';
      if (!observedByCutoff && item.recordCount) item.reasonCodes.push('EVIDENCE_AFTER_CUTOFF');
      if (item.availableAt && (!timestamp(item.availableAt) || Date.parse(item.availableAt) > Date.parse(cutoffTime))) item.reasonCodes.push('EVIDENCE_AFTER_CUTOFF');
      if (timestamp(item.lineage.breadthRetrievedAt) && Date.parse(item.lineage.breadthRetrievedAt) > Date.parse(cutoffTime)) item.reasonCodes.push('EVIDENCE_AFTER_CUTOFF');
      if (item.components && observedByCutoff && item.lineage.breadthEligible && Date.parse(item.availableAt) <= Date.parse(cutoffTime) && Date.parse(item.lineage.breadthRetrievedAt) <= Date.parse(cutoffTime)) {
        item.cutoffValidated = true;
        item.captureState = 'PARTIAL';
        item.components.breadth = 'PASS';
      }
      item.reasonCodes = [...new Set(item.reasonCodes)].sort();
    }
    return result;
  } catch {
    // Malformed/locked/unreadable DBs are never repaired by the acceptance reader.
    for (const item of Object.values(result)) {
      item.captureState = 'UNKNOWN'; item.persistenceState = 'UNKNOWN';
      item.cutoffValidated = false; item.recordCount = null; item.reasonCodes = [...new Set([...item.reasonCodes, 'BATCH_EVIDENCE_UNREADABLE'])].sort();
    }
    return result;
  } finally {
    db?.close();
  }
}
