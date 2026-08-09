import { buildCanonicalFeatureRows } from './phase-a-canonical.mjs';

function readAll(db, sql) {
  return db.prepare(sql).all();
}

export function loadMarketStateHistoricalRaw(db) {
  return {
    marketRows: readAll(db, 'SELECT * FROM market_daily ORDER BY trade_date'),
    spotRows: readAll(db, 'SELECT * FROM spot_institutional_daily ORDER BY trade_date'),
    futuresRows: readAll(db, 'SELECT * FROM futures_positions_daily ORDER BY trade_date'),
    futuresOiRows: readAll(db, 'SELECT * FROM futures_oi_daily ORDER BY trade_date'),
    largeRows: readAll(db, 'SELECT * FROM large_trader_futures_daily ORDER BY trade_date, expiry_scope'),
    basisRows: readAll(db, 'SELECT * FROM basis_term_structure_daily ORDER BY trade_date'),
    optionsRows: readAll(db, 'SELECT * FROM options_contract_daily ORDER BY trade_date, expiry_date, contract'),
    optionVolRows: readAll(db, 'SELECT * FROM option_volatility_daily ORDER BY trade_date, expiry_date, contract'),
    optionTermRows: readAll(db, 'SELECT * FROM option_volatility_term_daily ORDER BY trade_date'),
    globalRows: readAll(db, 'SELECT * FROM global_market_daily ORDER BY symbol, trade_date'),
    macroRows: readAll(db, 'SELECT * FROM macro_observations ORDER BY series_key, observation_date'),
  };
}

export function buildMarketStateCanonicalRows(db, featureSpec) {
  return buildCanonicalFeatureRows(loadMarketStateHistoricalRaw(db), featureSpec);
}
