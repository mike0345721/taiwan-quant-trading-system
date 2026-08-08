import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { importSnapshots } from '../src/history-importer.mjs';
import { rebuildFeatures } from '../src/features.mjs';
import { runQualityChecks } from '../src/quality.mjs';

const migrationsPath = path.resolve(import.meta.dirname, '../migrations');

function sample(date, close, foreignSpot, foreignFutures, putOi) {
  return {
    dataMode: 'live', generatedAt: `${date}T10:00:00.000Z`, asOfDate: date,
    marketOverview: { data: { twii: { price: close - 2, change: 1, changePct: 0.1 }, otc: { price: 200, changePct: 0.2 }, vix: 18 } },
    taiwanVix: { data: { close: 20 } },
    marketBreadth: { data: { listed: { advance: 500, decline: 400 }, otc: { advance: 300, decline: 250 } } },
    spotInstitutional: { dataDate: date, data: { foreignNetE: foreignSpot, trustNetE: 2, dealerProprietaryNetE: 1, dealerHedgeNetE: -1, dealerTotalNetE: 0 } },
    futuresMarket: { data: { txDay: { contract: '202607', close, change: 10, changePct: 0.1, volume: 1000, openInterest: 2000 } } },
    futuresInstitutional: { dataDate: date, data: { foreignLong: 1000, foreignShort: 1200, foreignNet: foreignFutures, dealerNet: 10, trustNet: 20 } },
    largeTraders: { data: { marketOi: 2000, top5Long: 700, top5Short: 750, top10Long: 900, top10Short: 950 } },
    options: { dataDate: date, data: { contract: '202607W2', contracts: [{ contract: '202607W2', type: 'weekly', expiryDate: '2026-07-15', daysToExpiry: 5, callVolume: 100, putVolume: 120, callOi: 500, putOi, oiPcRatio: putOi / 500, maxPain: 100, strikes: [{ strike: 100, callOi: 200, putOi }] }] } },
    signal: { version: 'test', totalScore: 10, bias: 'lean_long', regime: 'range', components: { spot: 10, futures: 5, options: 5, breadth: 5 }, modelCoveragePct: 100, completenessPct: 100 },
    sources: {},
  };
}

test('V2 imports normalized history, rebuilds features, and reports quality', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-v2-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    applyMigrations(db, migrationsPath);
    importSnapshots(db, [sample('2026-07-08', 100, 10, -100, 600), sample('2026-07-09', 102, 20, -80, 800)]);
    rebuildFeatures(db);
    const quality = runQualityChecks(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM raw_snapshots').get().count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM options_strike_daily').get().count, 2);
    const latest = db.prepare(`SELECT * FROM daily_features WHERE trade_date='2026-07-09'`).get();
    assert.equal(latest.foreign_futures_delta_1d, 20);
    assert.equal(Math.round(latest.tx_return_1d_pct), 2);
    assert.equal(quality.issues.error, 0);

    db.prepare(`INSERT INTO data_sources(trade_date, source_key, source_name, source_data_date, ok, stale, fallback_from_cache)
      VALUES ('2026-07-09', 'taifexFuturesHistory', 'official', '2026-07-09', 1, 1, 0)`).run();
    db.prepare(`INSERT INTO data_sources(trade_date, source_key, source_name, source_data_date, ok, stale, fallback_from_cache)
      VALUES ('2026-07-09', 'taifexOptionsHistory', 'official', '2026-07-09', 1, 1, 0)`).run();
    db.prepare(`UPDATE market_daily SET tx_close=999 WHERE trade_date='2026-07-09'`).run();
    db.prepare(`UPDATE options_strike_daily SET put_oi=777 WHERE trade_date='2026-07-09'`).run();
    importSnapshots(db, [sample('2026-07-09', 102, 20, -80, 800)]);
    assert.equal(db.prepare(`SELECT tx_close FROM market_daily WHERE trade_date='2026-07-09'`).get().tx_close, 999);
    assert.equal(db.prepare(`SELECT put_oi FROM options_strike_daily WHERE trade_date='2026-07-09'`).get().put_oi, 777);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V2 never imports mock snapshots into the research database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-v2-mock-gate-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    applyMigrations(db, migrationsPath);
    const mock = { ...sample('2026-07-10', 23860, 100, -30000, 120000), dataMode: 'mock' };
    const result = importSnapshots(db, [mock]);
    assert.equal(result.imported, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM raw_snapshots').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM market_daily').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM options_contract_daily').get().count, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V2 feature windows preserve missing futures positions as null instead of zero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-v2-null-features-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    applyMigrations(db, migrationsPath);
    importSnapshots(db, [
      sample('2026-07-08', 100, 10, -100, 600),
      sample('2026-07-09', 102, 20, -80, 800),
    ]);
    db.prepare(`UPDATE futures_positions_daily SET foreign_net=NULL WHERE trade_date='2026-07-09'`).run();
    rebuildFeatures(db);
    const latest = db.prepare(`SELECT foreign_futures_net, foreign_futures_delta_1d
      FROM daily_features WHERE trade_date='2026-07-09'`).get();
    assert.equal(latest.foreign_futures_net, null);
    assert.equal(latest.foreign_futures_delta_1d, null);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
