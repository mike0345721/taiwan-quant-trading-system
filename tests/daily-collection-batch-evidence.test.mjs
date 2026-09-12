import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readDailyBatchEvidence } from '../src/daily-collection-batch-evidence.mjs';

const date = '2026-09-09';
const observedAt = '2026-09-12T01:00:00Z';
const generatedAt = '2026-09-12T01:01:00Z';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-batch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'fixture.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE market_daily(trade_date TEXT PRIMARY KEY,tx_contract TEXT,tx_close REAL,tx_volume INTEGER,tx_open_interest INTEGER);
    CREATE TABLE futures_oi_daily(trade_date TEXT PRIMARY KEY,near_contract TEXT,near_contract_oi INTEGER,research_definition TEXT,quality_status TEXT,built_at TEXT,product_scope TEXT,near_scope_market_oi INTEGER,all_contracts_market_oi INTEGER);
    CREATE TABLE futures_positions_daily(trade_date TEXT PRIMARY KEY,foreign_long INTEGER,foreign_short INTEGER,foreign_net INTEGER,dealer_net INTEGER,trust_net INTEGER);
    CREATE TABLE institutional_futures_detail_daily(trade_date TEXT,institution_type TEXT,open_interest_long INTEGER,open_interest_short INTEGER,open_interest_net INTEGER,source_url TEXT,fetched_at TEXT);
    CREATE TABLE large_trader_futures_daily(trade_date TEXT,product_scope TEXT,expiry_scope TEXT,top5_long INTEGER,top5_short INTEGER,top10_long INTEGER,top10_short INTEGER,market_open_interest INTEGER,source_url TEXT,fetched_at TEXT);
    CREATE TABLE options_strike_daily(trade_date TEXT,contract TEXT,strike REAL,call_oi INTEGER,put_oi INTEGER);
    CREATE TABLE options_contract_daily(trade_date TEXT,contract TEXT,expiry_date TEXT,expiry_date_source TEXT);
    CREATE TABLE market_breadth_history_daily(trade_date TEXT,market TEXT,advance INTEGER,decline INTEGER,unchanged INTEGER,limit_up INTEGER,limit_down INTEGER,universe_scope TEXT,derivation TEXT,available_at TEXT,retrieved_at TEXT,source_url TEXT,payload_sha256 TEXT,quality_status TEXT);
    CREATE TABLE raw_snapshots(trade_date TEXT,generated_at TEXT,as_of_date TEXT,data_mode TEXT,payload_sha256 TEXT,imported_at TEXT);
    CREATE TABLE data_sources(trade_date TEXT,source_key TEXT,source_data_date TEXT,fetched_at TEXT,ok INTEGER,stale INTEGER,fallback_from_cache INTEGER);
    INSERT INTO market_daily VALUES('2026-09-09','202609',22000,100,42);
    INSERT INTO futures_oi_daily VALUES('2026-09-09','202609',42,'near_contract_oi','clean','2026-09-10T08:00:00Z',NULL,NULL,NULL);
    INSERT INTO futures_positions_daily VALUES('2026-09-09',10,20,-10,0,1);
    INSERT INTO institutional_futures_detail_daily VALUES('2026-09-09','dealer',1,1,0,'snapshot:TAIFEX institutional','2026-09-10T08:00:00Z'),('2026-09-09','investment_trust',2,1,1,'snapshot:TAIFEX institutional','2026-09-10T08:00:00Z');
    INSERT INTO large_trader_futures_daily VALUES('2026-09-09','TX_MTX_TMF_EQUIVALENT','near_month',1,2,3,4,10,'https://www.taifex.com.tw/cht/3/largeTraderFutQry','2026-09-09T13:00:00Z'),('2026-09-09','TX_MTX_TMF_EQUIVALENT','all_contracts',1,2,3,4,10,'https://www.taifex.com.tw/cht/3/largeTraderFutQry','2026-09-09T13:00:00Z');
    INSERT INTO options_strike_daily VALUES('2026-09-09','202609',22000,0,0);
    INSERT INTO options_contract_daily VALUES('2026-09-09','202609','2026-09-16','calendar_estimate');
    INSERT INTO raw_snapshots VALUES('2026-09-09','2026-09-09T13:00:00Z','2026-09-09','live','source-hash','2026-09-10T08:00:00Z');
    INSERT INTO data_sources VALUES('2026-09-09','futuresMarket','2026-09-09','2026-09-09T13:00:00Z',1,0,0);
  `);
  db.prepare('INSERT INTO market_breadth_history_daily VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(date, 'TWSE', 10, 20, 3, 0, 0, 'TWSE_COMMON_STOCKS', 'official_market_summary_stock_column', `${date}T20:05:00+08:00`, '2026-09-10T08:00:00Z', 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX', 'a'.repeat(64), 'official_complete');
  db.close();
  const read = (extra = {}) => readDailyBatchEvidence({ databasePath, tradeDate: date, generatedAt, observedAt, ...extra });
  const mutate = (sql) => { const writer = new DatabaseSync(databasePath); try { writer.exec(sql); } finally { writer.close(); } };
  return { databasePath, read, mutate };
}

test('six canonical mappings preserve dataset-specific identity, zero values and timestamp distinctions', (t) => {
  const { read } = fixture(t);
  const items = read();
  assert.equal(Object.keys(items).length, 6);
  for (const [id, item] of Object.entries(items)) {
    assert.equal(item.datasetId, id);
    assert.equal(item.sourceDate, date);
    assert.equal(item.persistenceState, 'PASS');
    assert.match(item.sourceArtifactIdentity.sha256, /^[a-f\d]{64}$/);
    assert.match(item.sourceArtifactIdentity.rowKeySha256, /^[a-f\d]{64}$/);
    assert.equal(item.researchEligibility, 'UNKNOWN');
    assert.equal(item.integrityState, 'UNKNOWN');
    assert.equal(JSON.stringify(item).includes('22000'), false, 'No raw financial values leave the reader');
  }
  for (const item of Object.values(items).slice(0, 5)) {
    assert.equal(item.captureState, 'UNKNOWN');
    assert.equal(item.availableAt, null);
    assert.equal(item.cutoffValidated, false);
    assert.ok(item.reasonCodes.includes('TIMESTAMP_LINEAGE_INSUFFICIENT'));
  }
  assert.ok(items.txo_strike_expiry_cp_oi.reasonCodes.includes('SOURCE_NULL_SEMANTICS_UNVERIFIED'));
  assert.equal(items.tx_large_trader.lineage.sourceScope, 'TX_MTX_TMF_EQUIVALENT');
});

test('EOD breadth can prove only its bounded component, never sector leadership or whole dataset PASS', (t) => {
  const { read } = fixture(t);
  const row = read().market_breadth_and_sector_leadership;
  assert.equal(row.captureState, 'PARTIAL');
  assert.equal(row.cutoffValidated, true);
  assert.deepEqual(row.components, { breadth: 'PASS', sectorLeadership: 'UNKNOWN' });
  assert.ok(row.reasonCodes.includes('PROJECTION_NOT_READY'));
  assert.equal(row.researchEligibility, 'UNKNOWN');
});

test('backfilled/current data cannot prove persistence or breadth capture at a historical cutoff', (t) => {
  const { read } = fixture(t);
  const items = read({ generatedAt: `${date}T23:59:59+08:00` });
  for (const item of Object.values(items)) {
    assert.equal(item.captureState, 'UNKNOWN');
    assert.equal(item.persistenceState, 'UNKNOWN');
    assert.equal(item.cutoffValidated, false);
    assert.ok(item.reasonCodes.includes('EVIDENCE_AFTER_CUTOFF'));
  }
});

test('breadth future retrieval, invalid availability or missing numeric field remains UNKNOWN', (t) => {
  const { read, mutate } = fixture(t);
  for (const sql of [
    "UPDATE market_breadth_history_daily SET retrieved_at='2026-09-13T00:00:00Z'",
    "UPDATE market_breadth_history_daily SET retrieved_at='2026-09-10T00:00:00Z',available_at='2026-09-09'",
    "UPDATE market_breadth_history_daily SET available_at='2026-09-09T20:05:00+08:00',advance=NULL",
  ]) {
    mutate(sql);
    const row = read().market_breadth_and_sector_leadership;
    assert.equal(row.captureState, 'UNKNOWN');
    assert.equal(row.cutoffValidated, false);
    assert.equal(row.components.breadth, 'UNKNOWN');
  }
});

test('absence is date scoped and never substituted by latest rows or another dataset', (t) => {
  const { read, mutate } = fixture(t);
  assert.ok(Object.values(read({ tradeDate: '2026-09-08' })).every((row) => row.recordCount === 0 && row.captureState === 'UNKNOWN' && row.persistenceState === 'UNKNOWN'));
  mutate('DELETE FROM large_trader_futures_daily');
  const items = read();
  assert.equal(items.tx_large_trader.sourceArtifactIdentity, null);
  assert.ok(items.tx_large_trader.reasonCodes.includes('ARTIFACT_IDENTITY_MISSING'));
  assert.equal(items.taifex_daily_market.persistenceState, 'PASS');
});

test('missing schema and unreadable input fail closed without creating or migrating a DB', (t) => {
  const { read, mutate, databasePath } = fixture(t);
  mutate('DROP TABLE futures_oi_daily');
  const item = read().tx_futures_oi;
  assert.equal(item.persistenceState, 'UNKNOWN');
  assert.equal(item.recordCount, null);
  assert.ok(item.reasonCodes.includes('BATCH_SCHEMA_UNVERIFIED'));
  const missing = `${databasePath}.missing`;
  assert.ok(Object.values(read({ databasePath: missing })).every((row) => row.captureState === 'UNKNOWN' && row.recordCount === null));
  assert.equal(fs.existsSync(missing), false);
  const corrupt = `${databasePath}.corrupt`;
  fs.writeFileSync(corrupt, 'not sqlite');
  assert.ok(Object.values(read({ databasePath: corrupt })).every((row) => row.reasonCodes.includes('BATCH_EVIDENCE_UNREADABLE')));
});

test('frozen observation is deterministic and SQLite content remains unchanged', (t) => {
  const { read, databasePath, mutate } = fixture(t);
  const digest = () => crypto.createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex');
  const before = digest();
  const first = read();
  assert.deepEqual(first, read());
  assert.equal(digest(), before);
  mutate('UPDATE market_daily SET tx_volume=101');
  const second = read();
  assert.notEqual(first.taifex_daily_market.sourceArtifactIdentity.sha256, second.taifex_daily_market.sourceArtifactIdentity.sha256);
  assert.equal(first.taifex_daily_market.sourceArtifactIdentity.rowKeySha256, second.taifex_daily_market.sourceArtifactIdentity.rowKeySha256);
});

test('invalid date or unzoned cutoff cannot acquire evidence', () => {
  assert.throws(() => readDailyBatchEvidence({ tradeDate: '2026-02-30', generatedAt }), /tradeDate/);
  assert.throws(() => readDailyBatchEvidence({ tradeDate: date, generatedAt: date }), /generatedAt/);
});

test('omitted cutoff uses actual acquisition completion without a future ceiling', (t) => {
  const { read } = fixture(t);
  const result = read({ generatedAt: undefined, observedAt: undefined });
  assert.equal(result.taifex_daily_market.persistenceState, 'PASS');
  assert.ok(Date.parse(result.taifex_daily_market.observedAt) <= Date.now());
});
