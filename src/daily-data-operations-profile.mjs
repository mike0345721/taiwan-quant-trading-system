export const OPERATIONAL_PROFILE_VERSION = 'CORE_DAILY_DATA_OPERATIONS_V1';

const row = (datasetId, feedIdentity, operationalRole, applicableSession, dueRule, blocksCoreLive, blocksCoreEod, blocksResearch, governanceState = 'GOVERNED_OPERATIONAL_ROLE') =>
  Object.freeze({ datasetId, feedIdentity, operationalRole, applicableSession: Object.freeze(applicableSession), dueRule,
    blocksCoreLive, blocksCoreEod, blocksResearch, governanceState });

// Operational requirements only. This module does not mutate the canonical registry.
export const OPERATIONAL_PROFILE = Object.freeze([
  row('tx_actual_trade', 'TX Tick', 'CORE_INTRADAY_REQUIRED', ['DAY', 'NIGHT'], 'A1_GOVERNED_SESSION', true, false, true),
  row('tx_best_quote', 'TX BidAsk', 'CORE_INTRADAY_REQUIRED', ['DAY', 'NIGHT'], 'A1_GOVERNED_SESSION', true, false, true),
  row('equity_2330_raw_price', '2330 live Tick', 'CORE_DAY_CONTEXT_REQUIRED', ['DAY'], 'A1_GOVERNED_SESSION', true, false, false),
  row('taiex_index', 'IX0001 live Quote', 'CORE_DAY_CONTEXT_REQUIRED', ['DAY'], 'A1_GOVERNED_SESSION', true, false, false),
  ...['taifex_daily_market', 'tx_futures_oi', 'tx_institutional_positions', 'txo_strike_expiry_cp_oi'].map(id =>
    row(id, id, 'CORE_EOD_REQUIRED', ['EOD'], 'DATASET_PUBLICATION_EVIDENCE_REQUIRED', false, true, false, 'DUE_SEMANTICS_REQUIRE_EVIDENCE')),
  ...['MTX Tick', 'MTX BidAsk', 'TMF Tick', 'TMF BidAsk'].map(feed =>
    row(null, feed, 'SUPPORTING_OPERATIONAL_MONITOR', ['DAY', 'NIGHT'], 'A1_GOVERNED_SESSION', false, false, false, 'CANONICAL_DATASET_ID_UNAVAILABLE')),
  ...['tx_large_trader', 'market_breadth_and_sector_leadership'].map(id =>
    row(id, id, 'CONDITIONAL_CONTEXT', ['EOD'], 'APPLICABILITY_NOT_GOVERNED', false, false, false, 'CONDITIONAL_NOT_CORE_BLOCKER')),
  row('derived_pressure_response_efficiency', 'Pressure / Price Response / Path Efficiency', 'DERIVED_RESEARCH_READINESS', ['DAY', 'NIGHT'], 'A1_DERIVED_ELIGIBILITY', false, false, true),
  ...['txo_intraday_trade_quote_candidates', 'twn_futures', 'nq_futures'].map(id =>
    row(id, id, 'FUTURE_NOT_ENABLED', [], 'NOT_ENABLED', false, false, false, 'NOT_ENABLED')),
]);
