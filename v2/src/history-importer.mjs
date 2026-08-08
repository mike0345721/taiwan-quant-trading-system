import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSnapshot, snapshotTradeDate } from './snapshot-normalizer.mjs';
import { withTransaction } from './db.mjs';

function bindRun(statement, values) {
  statement.run(...values.map((value) => value === undefined ? null : value));
}

function chooseNewest(current, candidate) {
  if (!current) return candidate;
  const currentTime = Date.parse(current.generatedAt || 0) || 0;
  const candidateTime = Date.parse(candidate.generatedAt || 0) || 0;
  if (candidate.dataMode === 'live' && current.dataMode !== 'live') return candidate;
  return candidateTime >= currentTime ? candidate : current;
}

export function loadV1Snapshots(historyPath, latestPath) {
  const files = fs.existsSync(historyPath)
    ? fs.readdirSync(historyPath).filter((name) => name.endsWith('.json')).map((name) => path.join(historyPath, name))
    : [];
  if (latestPath && fs.existsSync(latestPath)) files.push(latestPath);
  const snapshots = new Map();
  const errors = [];
  const skipped = [];
  for (const file of files) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
      // V1 mock snapshots exist only to exercise the local UI.  They must never
      // become research observations or overwrite official post-close data.
      if (snapshot?.dataMode !== 'live') {
        skipped.push({ file, reason: `non_live_snapshot:${snapshot?.dataMode || 'unknown'}` });
        continue;
      }
      const tradeDate = snapshotTradeDate(snapshot);
      if (!tradeDate) throw new Error('missing trade date');
      snapshots.set(tradeDate, chooseNewest(snapshots.get(tradeDate), snapshot));
    } catch (error) {
      errors.push({ file, error: error.message });
    }
  }
  return { files, snapshots: [...snapshots.values()].sort((a, b) => snapshotTradeDate(a).localeCompare(snapshotTradeDate(b))), errors, skipped };
}

function statements(db) {
  return {
    raw: db.prepare(`INSERT INTO raw_snapshots(trade_date, generated_at, as_of_date, data_mode, payload_json, payload_sha256, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trade_date) DO UPDATE SET generated_at=excluded.generated_at, as_of_date=excluded.as_of_date,
      data_mode=excluded.data_mode, payload_json=excluded.payload_json, payload_sha256=excluded.payload_sha256, imported_at=excluded.imported_at`),
    source: db.prepare(`INSERT OR REPLACE INTO data_sources(trade_date, source_key, source_name, source_data_date, fetched_at, ok, stale, fallback_from_cache, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    marketBase: db.prepare(`INSERT INTO market_daily
      (trade_date, twii_close, twii_change, twii_change_pct, otc_close, otc_change_pct, taiwan_vix, us_vix,
       listed_advance, listed_decline, listed_limit_up, listed_limit_down, otc_advance, otc_decline, otc_limit_up, otc_limit_down)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trade_date) DO UPDATE SET twii_close=excluded.twii_close, twii_change=excluded.twii_change,
      twii_change_pct=excluded.twii_change_pct, otc_close=excluded.otc_close, otc_change_pct=excluded.otc_change_pct,
      taiwan_vix=excluded.taiwan_vix, us_vix=excluded.us_vix, listed_advance=excluded.listed_advance,
      listed_decline=excluded.listed_decline, listed_limit_up=excluded.listed_limit_up, listed_limit_down=excluded.listed_limit_down,
      otc_advance=excluded.otc_advance, otc_decline=excluded.otc_decline, otc_limit_up=excluded.otc_limit_up, otc_limit_down=excluded.otc_limit_down`),
    marketTx: db.prepare(`UPDATE market_daily SET tx_contract=?, tx_close=?, tx_change=?, tx_change_pct=?, tx_volume=?, tx_open_interest=?, basis=? WHERE trade_date=?`),
    spot: db.prepare(`INSERT INTO spot_institutional_daily
      (trade_date, foreign_net_e, trust_net_e, dealer_proprietary_net_e,
       dealer_hedge_net_e, dealer_total_net_e, institutional_total_e)
      VALUES (${Array(7).fill('?').join(',')})
      ON CONFLICT(trade_date) DO UPDATE SET
        foreign_net_e=excluded.foreign_net_e,
        trust_net_e=excluded.trust_net_e,
        dealer_proprietary_net_e=excluded.dealer_proprietary_net_e,
        dealer_hedge_net_e=excluded.dealer_hedge_net_e,
        dealer_total_net_e=excluded.dealer_total_net_e,
        institutional_total_e=excluded.institutional_total_e`),
    futures: db.prepare(`INSERT OR REPLACE INTO futures_positions_daily VALUES (${Array(11).fill('?').join(',')})`),
    largeTrader: db.prepare(`INSERT OR REPLACE INTO large_trader_futures_daily
      (trade_date, product_scope, expiry_scope, expiry_label,
       top5_long, top5_long_specific, top10_long, top10_long_specific,
       top5_short, top5_short_specific, top10_short, top10_short_specific,
       market_open_interest, source_url, fetched_at)
      VALUES (?, 'TX_MTX_TMF_EQUIVALENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'https://www.taifex.com.tw/cht/3/largeTraderFutQry', ?)`),
    domesticFutures: db.prepare(`INSERT INTO institutional_futures_detail_daily
      (trade_date, institution_type, open_interest_long, open_interest_short, open_interest_net, source_url, fetched_at)
      VALUES (?, ?, ?, ?, ?, 'snapshot:TAIFEX institutional', ?)
      ON CONFLICT(trade_date, institution_type) DO UPDATE SET
        open_interest_long=COALESCE(excluded.open_interest_long, institutional_futures_detail_daily.open_interest_long),
        open_interest_short=COALESCE(excluded.open_interest_short, institutional_futures_detail_daily.open_interest_short),
        open_interest_net=COALESCE(excluded.open_interest_net, institutional_futures_detail_daily.open_interest_net),
        fetched_at=excluded.fetched_at`),
    margin: db.prepare(`INSERT OR REPLACE INTO margin_short_daily
      (trade_date, margin_balance_e, short_balance_lots, source_name, source_data_date, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    option: db.prepare(`INSERT OR REPLACE INTO options_contract_daily
      (trade_date, contract, contract_type, expiry_date, days_to_expiry, is_active, call_volume, put_volume, volume_pc_ratio,
       call_oi, put_oi, oi_pc_ratio, call_wall_strike, call_wall_oi, put_wall_strike, put_wall_oi, max_pain)
      VALUES (${Array(17).fill('?').join(',')})`),
    strike: db.prepare(`INSERT OR REPLACE INTO options_strike_daily(trade_date, contract, strike, call_oi, put_oi) VALUES (?, ?, ?, ?, ?)`),
    signal: db.prepare(`INSERT OR REPLACE INTO signals_daily VALUES (${Array(13).fill('?').join(',')})`),
  };
}

export function importSnapshots(db, snapshots, { sourcePath = 'V1 history' } = {}) {
  const startedAt = new Date().toISOString();
  const run = db.prepare(`INSERT INTO import_runs(started_at, source_path, files_seen, status) VALUES (?, ?, ?, 'running')`).run(startedAt, sourcePath, snapshots.length);
  const runId = Number(run.lastInsertRowid);
  const sql = statements(db);
  let imported = 0;
  try {
    withTransaction(db, () => {
      for (const snapshot of snapshots) {
        const normalized = normalizeSnapshot(snapshot);
        // Defensive second gate for direct callers that bypass loadV1Snapshots.
        // Missing/unknown modes are rejected as well; research imports must be
        // explicitly identified as live observations.
        if (normalized.dataMode !== 'live') continue;
        const officialFutures = Boolean(db.prepare(`SELECT 1 FROM data_sources WHERE trade_date=? AND source_key='taifexFuturesHistory'`).get(normalized.tradeDate));
        const officialOptions = Boolean(db.prepare(`SELECT 1 FROM data_sources WHERE trade_date=? AND source_key='taifexOptionsHistory'`).get(normalized.tradeDate));
        const payload = JSON.stringify(snapshot);
        const hash = crypto.createHash('sha256').update(payload).digest('hex');
        bindRun(sql.raw, [normalized.tradeDate, normalized.generatedAt, normalized.asOfDate, normalized.dataMode, payload, hash, new Date().toISOString()]);
        for (const item of normalized.sources) bindRun(sql.source, [item.tradeDate, item.key, item.name, item.dataDate, item.fetchedAt, item.ok, item.stale, item.fallback, item.error]);
        const m = normalized.market;
        bindRun(sql.marketBase, [m.tradeDate, m.twiiClose, m.twiiChange, m.twiiChangePct, m.otcClose, m.otcChangePct, m.taiwanVix, m.usVix, m.listedAdvance, m.listedDecline, m.listedLimitUp, m.listedLimitDown, m.otcAdvance, m.otcDecline, m.otcLimitUp, m.otcLimitDown]);
        if (!officialFutures) bindRun(sql.marketTx, [m.txContract, m.txClose, m.txChange, m.txChangePct, m.txVolume, m.txOpenInterest, m.basis, m.tradeDate]);
        const s = normalized.spot;
        bindRun(sql.spot, [s.tradeDate, s.foreignNetE, s.trustNetE, s.dealerProprietaryNetE, s.dealerHedgeNetE, s.dealerTotalNetE, s.institutionalTotalE]);
        const f = normalized.futures;
        bindRun(sql.futures, [f.tradeDate, f.foreignLong, f.foreignShort, f.foreignNet, f.dealerNet, f.trustNet, f.marketOpenInterest, f.top5Long, f.top5Short, f.top10Long, f.top10Short]);
        for (const row of normalized.largeTraders) {
          bindRun(sql.largeTrader, [row.tradeDate, row.expiryScope, row.expiryLabel,
            row.top5Long, row.top5LongSpecific, row.top10Long, row.top10LongSpecific,
            row.top5Short, row.top5ShortSpecific, row.top10Short, row.top10ShortSpecific,
            row.marketOpenInterest, row.fetchedAt]);
        }
        if (normalized.dataMode === 'live') {
          for (const row of normalized.domesticFutures) {
            bindRun(sql.domesticFutures, [normalized.tradeDate, row.institutionType, row.long, row.short, row.net, normalized.generatedAt || new Date().toISOString()]);
          }
        }
        const margin = normalized.margin;
        if (margin.marginBalanceE != null || margin.shortBalanceLots != null) {
          bindRun(sql.margin, [margin.tradeDate, margin.marginBalanceE, margin.shortBalanceLots, margin.sourceName, margin.sourceDataDate, margin.fetchedAt]);
        }
        if (!officialOptions) {
          db.prepare('DELETE FROM options_contract_daily WHERE trade_date = ?').run(normalized.tradeDate);
          for (const c of normalized.contracts) {
            bindRun(sql.option, [c.tradeDate, c.contract, c.contractType, c.expiryDate, c.daysToExpiry, c.isActive, c.callVolume, c.putVolume, c.volumePcRatio, c.callOi, c.putOi, c.oiPcRatio, c.callWallStrike, c.callWallOi, c.putWallStrike, c.putWallOi, c.maxPain]);
            for (const strike of c.strikes) bindRun(sql.strike, [c.tradeDate, c.contract, strike.strike, strike.callOi, strike.putOi]);
          }
        }
        const g = normalized.signal;
        bindRun(sql.signal, [g.tradeDate, g.version, g.totalScore, g.bias, g.regime, g.volatilityRisk, g.spotScore, g.futuresScore, g.optionsScore, g.breadthScore, g.modelCoveragePct, g.completenessPct, g.adviceJson]);
        imported += 1;
      }
      db.exec('UPDATE market_daily SET basis=tx_close-twii_close WHERE tx_close IS NOT NULL AND twii_close IS NOT NULL;');
    });
    db.prepare(`UPDATE import_runs SET finished_at=?, snapshots_imported=?, status='completed' WHERE id=?`).run(new Date().toISOString(), imported, runId);
    return { runId, imported };
  } catch (error) {
    db.prepare(`UPDATE import_runs SET finished_at=?, snapshots_imported=?, status='failed', error=? WHERE id=?`).run(new Date().toISOString(), imported, error.message, runId);
    throw error;
  }
}
