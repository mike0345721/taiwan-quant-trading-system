import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { applyMigrations, openDatabase } from '../src/db.mjs';
import {
  auditInstitutionalFuturesOiConsistency,
  downloadDomesticInstitutionPeriod,
  periodCacheIsImmutable,
  parseDomesticOpenApiValues,
  reconcileDomesticInstitutionNets,
  selectDomesticInstitutionRanges,
  upsertDomesticInstitutionRows,
} from '../src/domestic-institution-backfill.mjs';
import { runQualityChecks } from '../src/quality.mjs';

const migrationsPath = path.resolve(import.meta.dirname, '../migrations');

test('domestic institution current period is refreshed using Taipei date', () => {
  const range = { start: '2026-07-01', end: '2026-07-18' };
  assert.equal(periodCacheIsImmutable(range, new Date('2026-07-18T15:30:00Z')), false);
  assert.equal(periodCacheIsImmutable(range, new Date('2026-07-31T16:30:00Z')), true);
  assert.deepEqual(selectDomesticInstitutionRanges([
    { start: '2026-06-01', end: '2026-06-30' }, range,
  ], { skipHistory: true, now: new Date('2026-07-18T15:30:00Z') }), [range]);
});

test('current domestic institution cache is atomically replaced after a valid refresh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-domestic-cache-'));
  const range = { start: '2026-07-01', end: '2026-07-18' };
  const cachePath = path.join(dir, `${range.start}-${range.end}.csv.gz`);
  const oldBuffer = Buffer.alloc(120, 1);
  const newBuffer = Buffer.alloc(140, 2);
  fs.writeFileSync(cachePath, zlib.gzipSync(oldBuffer));
  try {
    const result = await downloadDomesticInstitutionPeriod(range, dir, {
      now: new Date('2026-07-18T10:00:00Z'),
      fetchImpl: async () => new Response(newBuffer, { status: 200 }),
      validateBuffer: (buffer) => buffer.length >= 100,
      maxAttempts: 1,
    });
    assert.equal(result.cacheHit, false);
    assert.equal(result.fallbackFromCache, false);
    assert.deepEqual(zlib.gunzipSync(fs.readFileSync(cachePath)), newBuffer);
    assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('network failure uses only a valid existing cache as an explicit fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-domestic-fallback-'));
  const range = { start: '2026-07-01', end: '2026-07-18' };
  const cachePath = path.join(dir, `${range.start}-${range.end}.csv.gz`);
  const cached = Buffer.alloc(120, 3);
  fs.writeFileSync(cachePath, zlib.gzipSync(cached));
  try {
    const result = await downloadDomesticInstitutionPeriod(range, dir, {
      now: new Date('2026-07-18T10:00:00Z'),
      fetchImpl: async () => { throw new Error('network unavailable'); },
      validateBuffer: (buffer) => buffer.length >= 100,
      maxAttempts: 1,
    });
    assert.equal(result.cacheHit, true);
    assert.equal(result.fallbackFromCache, true);
    assert.match(result.refreshError, /network unavailable/);
    assert.deepEqual(result.buffer, cached);

    fs.writeFileSync(cachePath, zlib.gzipSync(Buffer.from('invalid')));
    await assert.rejects(downloadDomesticInstitutionPeriod(range, dir, {
      now: new Date('2026-07-18T10:00:00Z'),
      fetchImpl: async () => { throw new Error('network unavailable'); },
      validateBuffer: (buffer) => buffer.length >= 100,
      maxAttempts: 1,
    }), /network unavailable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('source refresh replaces a complete tuple; reconciliation quarantines conflicting sources without rewriting history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-domestic-db-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    applyMigrations(db, migrationsPath);
    db.prepare(`INSERT INTO raw_snapshots
      (trade_date,generated_at,as_of_date,data_mode,payload_json,payload_sha256,imported_at)
      VALUES ('2026-07-15','2026-07-15T10:00:00.000Z','2026-07-15','official-history','{}','test','2026-07-15T10:00:00.000Z')`).run();
    db.prepare(`INSERT INTO futures_positions_daily(trade_date, trust_net, dealer_net)
      VALUES ('2026-07-15', 100, -20)`).run();
    upsertDomesticInstitutionRows(db, new Map([['2026-07-15', {
      trust: { tradeLong: 1, tradeShort: 2, tradeNet: -1, long: 80, short: 20, net: 60 },
      dealer: { tradeLong: 3, tradeShort: 4, tradeNet: -1, long: 10, short: 10, net: 0 },
    }]]), { fetchedAt: '2026-07-15T08:30:00.000Z' });
    upsertDomesticInstitutionRows(db, new Map([['2026-07-15', {
      trust: { tradeLong: 5, tradeShort: 2, tradeNet: 3, long: 130, short: 30, net: 100 },
    }]]), { fetchedAt: '2026-07-15T09:00:00.000Z' });

    const trust = db.prepare(`SELECT * FROM institutional_futures_detail_daily
      WHERE trade_date='2026-07-15' AND institution_type='investment_trust'`).get();
    assert.equal(trust.open_interest_long, 130);
    assert.equal(trust.open_interest_short, 30);
    assert.equal(trust.open_interest_net, 100);
    assert.equal(trust.trade_net, 3);

    const before = auditInstitutionalFuturesOiConsistency(db);
    assert.equal(before.summary.cross_table_mismatch_rows, 1);
    const beforeRows = db.prepare('SELECT * FROM institutional_futures_detail_daily ORDER BY institution_type').all();
    const repaired = reconcileDomesticInstitutionNets(db, { fetchedAt: '2026-07-15T10:00:00.000Z' });
    assert.deepEqual(repaired.reconciled, []);
    assert.deepEqual(repaired.quarantined.map(row=>row.institutionType), ['dealer']);
    assert.equal(repaired.audit.summary.cross_table_mismatch_rows, 1);
    assert.equal(repaired.audit.summary.internal_mismatch_rows, 0);
    assert.deepEqual(db.prepare('SELECT * FROM institutional_futures_detail_daily ORDER BY institution_type').all(), beforeRows);

    const failedQuality = runQualityChecks(db);
    assert.equal(failedQuality.institutionalFuturesOiConsistency.summary.passed, false);
    assert.equal(failedQuality.byRule.some((row) => row.rule_code === 'INSTITUTIONAL_OI_ARITHMETIC_MISMATCH'), false);
    db.prepare(`UPDATE institutional_futures_detail_daily
      SET open_interest_long=10,open_interest_short=30,open_interest_net=-20
      WHERE trade_date='2026-07-15' AND institution_type='dealer'`).run();
    const passedQuality = runQualityChecks(db);
    assert.equal(passedQuality.institutionalFuturesOiConsistency.summary.passed, true);
    assert.equal(passedQuality.byRule.some((row) => row.rule_code.startsWith('INSTITUTIONAL_OI_') && row.rule_code.endsWith('MISMATCH')), false);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing OpenAPI values remain unknown and a newer partial tuple cannot borrow old long/short fields', () => {
  assert.deepEqual(parseDomesticOpenApiValues({'TradingVolume(Long)':'1,000','TradingVolume(Short)':'',
    'TradingVolume(Net)':null,'OpenInterest(Long)':'--','OpenInterest(Short)':'0','OpenInterest(Net)':'-3'}),
    {tradeLong:1000,tradeShort:null,tradeNet:null,long:null,short:0,net:-3});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tw-domestic-partial-')),db=openDatabase(path.join(dir,'test.sqlite'));
  try {
    applyMigrations(db,migrationsPath);
    upsertDomesticInstitutionRows(db,new Map([['2026-11-04',{dealer:{long:10,short:3,net:7}}]]));
    upsertDomesticInstitutionRows(db,new Map([['2026-11-04',{dealer:{long:null,short:null,net:8}}]]),{fetchedAt:'2026-11-04T09:00:00Z'});
    const row=db.prepare('SELECT * FROM institutional_futures_detail_daily').get();
    assert.equal(row.open_interest_long,null);assert.equal(row.open_interest_short,null);assert.equal(row.open_interest_net,8);
    assert.equal(row.fetched_at,'2026-11-04T09:00:00Z');
  } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
