# Master Data Requirements V1

> Generated from `config/data-requirements-v1.json` by `scripts/validate-data-requirements-v1.mjs --write`. This is a human-readable view, not a second source of truth.

## Registry identity

- Registry: `MASTER_DATA_REQUIREMENTS_V1`
- Schema: `data-requirements-v1`
- Master version: `CRU-39-MASTER-DATA-REQUIREMENTS-V1`
- Approved main baseline: `cc516428175ef85411b2d082107300bddb81a182`
- Generated at: 2026-09-05 Asia/Taipei
- Validation: PASS (44 datasets, 15 conflicts)
- Safety: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`

## Governance boundary

- Consolidation and governance only; no new source, collector, migration, schema redesign, storage migration, strategy, Market State promotion, broker, order, position, risk, or execution work.
- CRU-5 remains the CURRENT Product lane and CRU-9 real-day gate remains PENDING.
- CRU-38 Storage Phase 0 and source evidence are preserved as references; broad vendor/source expansion is paused until canonical dataset IDs exist.
- No change is made to the formal validated runtime or local runtime-only data.
- formalWeight=0, researchOnly=true, executionAuthorized=false, orderRoutesEnabled=false.

## Project-wide audit basis

- AGENTS.md
- DATA_DICTIONARY.md
- docs/data/**
- docs/research/**
- docs/product/**
- docs/operations/**
- src/**
- v2/**
- scripts/**
- v2/migrations/**
- tests/**
- CRU-5, CRU-9, CRU-34, CRU-37 and CRU-38 references

Notion references requested by CRU-39 are recorded as NOT_VERIFIED in this local session; no unavailable workspace source is promoted to implementation evidence.

## Dataset universe coverage

### TX

- actual_trade: `tx_actual_trade`
- best_quote: `tx_best_quote`
- depth_candidate: `tx_depth_candidate`
- ohlcv_1m_5m: `tx_ohlcv_1m_5m`
- basis: `tx_basis`
- contract_directory: `taifex_contract_and_roll_reference`
- expiry_rollover: `taifex_contract_and_roll_reference`

### TX_TXO

- daily_market: `taifex_daily_market`
- futures_oi: `tx_futures_oi`
- institutions: `tx_institutional_positions`
- large_trader: `tx_large_trader`
- strike_expiry_call_put_oi: `txo_strike_expiry_cp_oi`
- intraday_trades_candidate: `txo_intraday_trade_quote_candidates`
- quote_candidate: `txo_intraday_trade_quote_candidates`
- iv_greeks_dependencies: `txo_iv_greeks_dependencies`

### SPOT

- 2330: `equity_2330_raw_price`
- taiex: `taiex_index`
- major_weighted_names: `spot_major_weighted_names`
- constituents: `spot_major_weighted_names`
- corporate_actions: `spot_corporate_actions`
- effective_weights: `spot_index_effective_weights`
- index_contribution: `taiex_index_contribution`
- breadth: `market_breadth_and_sector_leadership`
- sector_leadership: `market_breadth_and_sector_leadership`

### CROSS_MARKET

- TWN: `twn_futures`
- NQ: `nq_futures`
- MNQ: `mnq_futures`
- SOX_daily: `sox_daily`
- SOX_intraday_candidate: `sox_intraday_candidate`
- USD_TWD_daily: `usdtwd_daily`
- USD_TWD_intraday_candidate: `usdtwd_intraday_candidate`
- ES: `es_futures`
- VIX: `vix_daily`
- TSM_ADR: `cross_market_tsm_adr`
- DXY: `dxy_daily`
- US2Y: `us2y_daily`
- US10Y: `us10y_daily`

### DERIVED

- BuyProxyVolume: `derived_pressure_response_efficiency`
- SellProxyVolume: `derived_pressure_response_efficiency`
- UnknownVolume: `derived_pressure_response_efficiency`
- PressureRatio: `derived_pressure_response_efficiency`
- classified_coverage: `derived_pressure_response_efficiency`
- best_quote_matched_coverage: `derived_pressure_response_efficiency`
- conflict_rate: `derived_pressure_response_efficiency`
- VWAP: `derived_pressure_response_efficiency`
- RVOL: `derived_pressure_response_efficiency`
- Price_Response: `derived_pressure_response_efficiency`
- Path_Efficiency: `derived_pressure_response_efficiency`

### INTELLIGENCE

- Expected_Response: `market_intelligence_expected_control_state`
- Market_Control: `market_intelligence_expected_control_state`
- Market_State: `market_intelligence_expected_control_state`
- confidence_contradiction_evidence: `market_intelligence_expected_control_state`

### DECISION_OUTCOME

- Evidence_Snapshot: `decision_evidence_and_outcome_records`
- Decision_Snapshot: `decision_evidence_and_outcome_records`
- No_Trade_reason: `decision_evidence_and_outcome_records`
- T_plus_5_15_30_60_120: `decision_evidence_and_outcome_records`
- EOD: `decision_evidence_and_outcome_records`
- MAE: `decision_evidence_and_outcome_records`
- MFE: `decision_evidence_and_outcome_records`
- path: `decision_evidence_and_outcome_records`
- cost_slippage_assumptions: `decision_cost_risk_and_future_order_records`
- risk_decision: `decision_cost_risk_and_future_order_records`
- future_own_order_fill_reject_records: `decision_cost_risk_and_future_order_records`

### REFERENCE

- calendar: `reference_calendar_session_timezone_and_market_parameters`
- sessions: `reference_calendar_session_timezone_and_market_parameters`
- timezone_DST: `reference_calendar_session_timezone_and_market_parameters`
- expiry: `reference_calendar_session_timezone_and_market_parameters`
- rollover: `reference_calendar_session_timezone_and_market_parameters`
- tick_size: `reference_calendar_session_timezone_and_market_parameters`
- multiplier: `reference_calendar_session_timezone_and_market_parameters`
- settlement: `reference_calendar_session_timezone_and_market_parameters`
- constituent_effective_date: `spot_index_effective_weights`
- weight_effective_date: `spot_index_effective_weights`
- corporate_action: `spot_corporate_actions`
- fees: `reference_calendar_session_timezone_and_market_parameters`
- margin_version: `reference_calendar_session_timezone_and_market_parameters`

### DATA_TRUTH

- source_identity: `data_truth_lineage_quality_and_recovery`
- entitlement_license: `data_truth_lineage_quality_and_recovery`
- eventTime_receivedAt_availableAt: `data_truth_lineage_quality_and_recovery`
- sequence_ledger_ordinal: `data_truth_lineage_quality_and_recovery`
- continuity_epoch_reconnect_gap: `data_truth_lineage_quality_and_recovery`
- raw_payload_hash_quality_state: `data_truth_lineage_quality_and_recovery`
- subscription_scope_backup_restore: `data_truth_lineage_quality_and_recovery`

## Dataset requirements

| Priority | Domain | Dataset ID | Purpose | Required by | Minimum granularity | Historical | Ongoing | Current status | License | Quality | Usage | Input dataset IDs | Evidence qualification | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CORE | DATA_TRUTH_OPERATIONS | `data_truth_lineage_quality_and_recovery` | Source identity, entitlement/license, eventTime, receivedAt, availableAt, sequence, ledger ordinal, continuity epoch, reconnect/gap, raw hash, quality, subscription scope and backup/restore evidence. | all raw and derived datasets, CRU-34, CRU-36, CRU-37, replay | PER_SOURCE_RECORD_AND_APPEND_ONLY_OPERATIONAL_EPOCH | EXISTING | OWN_EVENT | PARTIAL / PARTIAL | APPROVED_INTERNAL | QUALITY_INSUFFICIENT | DESCRIPTIVE | UNKNOWN | UNQUALIFIED | Use as the common evidence contract and route concrete gaps to the impacted dataset. |
| CORE | PRESSURE_RESPONSE_EFFICIENCY | `derived_pressure_response_efficiency` | Buy/Sell/Unknown proxy volumes, Pressure Ratio, classified/best-quote coverage, conflict rate, VWAP, RVOL, Price Response and Path Efficiency. | CRU-34, CRU-35, CRU-36, DW-2 | GOVERNED_TX_EVENT_WINDOW_WITH_PHYSICAL_LEDGER_CUTOFF | DERIVED | DERIVED | PARTIAL / IMPLEMENTED | APPROVED_INTERNAL | QUALITY_INSUFFICIENT | DESCRIPTIVE | tx_actual_trade, tx_best_quote, tx_ohlcv_1m_5m | UNQUALIFIED | Keep descriptive and evidence-qualified only; resolve gaps before any stronger eligibility. |
| CORE | SPOT_INDEX_STRUCTURE | `equity_2330_raw_price` | Taiwan Semiconductor 2330 constituent price observations kept distinct from the TAIEX index and contribution data. | CRU-5, CRU-37, index leadership | DAILY_AND_DAY_EVENT_PRICE_WHERE_VERIFIED | OFFICIAL | LIVE_STREAM | PARTIAL / PARTIAL | NOT_VERIFIED | QUALITY_LIMITED | DESCRIPTIVE | UNKNOWN | UNQUALIFIED | Keep price-only descriptive use and list weights/methodology separately. |
| CORE | REFERENCE_DATA | `reference_calendar_session_timezone_and_market_parameters` | Exchange calendars, session/trade-date rules, timezone/DST, expiry/rollover, tick size, multiplier, settlement, fees, margin and effective-date references. | all market datasets, replay, CRU-34, CRU-37 | VERSIONED_BY_VENUE_PRODUCT_AND_EFFECTIVE_DATE | OFFICIAL | CHANGE_SNAPSHOT | PARTIAL / PARTIAL | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Use existing TAIFEX rules; list other venue/reference gaps before any acquisition. |
| CORE | SPOT_INDEX_STRUCTURE | `taiex_index` | TAIEX index price observations kept distinct from constituent price, contribution and ADR data. | CRU-5, CRU-37, index leadership | DAILY_AND_DAY_EVENT_PRICE_WHERE_VERIFIED | OFFICIAL | LIVE_STREAM | PARTIAL / PARTIAL | NOT_VERIFIED | QUALITY_LIMITED | DESCRIPTIVE | UNKNOWN | UNQUALIFIED | Keep index price descriptive and list weights/methodology separately. |
| CORE | REFERENCE_DATA | `taifex_contract_and_roll_reference` | Actual TAIFEX contract directory, expiry, rollover, tick-size, multiplier and settlement reference. | CRU-34, CRU-36, CRU-37, all TX/TXO consumers | VERSIONED_CONTRACT_AND_EFFECTIVE_DATE | OFFICIAL | CHANGE_SNAPSHOT | PARTIAL / PARTIAL | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Use existing versioned references and list uncovered fields in the gap register. |
| CORE | PRICE_MICROSTRUCTURE | `taifex_daily_market` | Official daily market price and volume context for Taiwan instruments. | V2 research, CRU-5, CRU-34 context | DAILY_BY_INSTRUMENT | OFFICIAL | DAILY_DOWNLOAD | VERIFIED_PRESENT / IMPLEMENTED | APPROVED_INTERNAL | PASS | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep current use and preserve source-date / availability distinctions. |
| CORE | PRICE_MICROSTRUCTURE | `tx_actual_trade` | Actual TX executed trade observations for descriptive intraday research. | CRU-34, DW-2, CRU-36 | EVENT_TICK | UNKNOWN | LIVE_STREAM | PARTIAL / PARTIAL | NOT_VERIFIED | QUALITY_INSUFFICIENT | DESCRIPTIVE | UNKNOWN | UNQUALIFIED | Keep as bounded existing substrate; resolve source and quality evidence in a separately authorized work item. |
| CORE | PRICE_MICROSTRUCTURE | `tx_best_quote` | Best Bid/Ask observations used only for matched quote cross-checks. | CRU-34, CRU-36 | EVENT_BEST_BID_ASK | UNKNOWN | LIVE_STREAM | PARTIAL / PARTIAL | NOT_VERIFIED | QUALITY_INSUFFICIENT | DESCRIPTIVE | UNKNOWN | UNQUALIFIED | Retain as existing evidence input; no scope expansion. |
| CORE | POSITION | `tx_futures_oi` | TAIFEX futures open interest by explicit product and contract scope. | CRU-5, V3.10 research, OI normalization | DAILY_BY_PRODUCT_AND_CONTRACT_SCOPE | OFFICIAL | DAILY_DOWNLOAD | VERIFIED_PRESENT / IMPLEMENTED | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep explicit scope and NULL semantics. |
| CORE | POSITION | `tx_institutional_positions` | Cash and futures institutional position/net-flow observations, preserving participant and market scope. | CRU-5, V3.10 research | DAILY_BY_MARKET_AND_PARTICIPANT | OFFICIAL | DAILY_DOWNLOAD | VERIFIED_PRESENT / IMPLEMENTED | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Retain source and quality provenance per row/run. |
| CORE | PRICE_MICROSTRUCTURE | `tx_ohlcv_1m_5m` | Intraday OHLCV bars, with 5m governed historical replay and 1m candidate granularity kept distinct. | CRU-34, CRU-36, CRU-37 TWN comparison candidate | 5M_VERIFIED; 1M_CANDIDATE_PENDING_VALIDATION | EXISTING | UNKNOWN | VERIFIED_PRESENT / IMPLEMENTED | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Use verified 5m where its existing gate permits; validate 1m only under a future scoped task. |
| CORE | POSITION | `txo_strike_expiry_cp_oi` | TXO open interest by strike, expiry and call/put side. | CRU-5, options structure research | DAILY_BY_EXPIRY_STRIKE_AND_CALL_PUT | OFFICIAL | DAILY_DOWNLOAD | VERIFIED_PRESENT / IMPLEMENTED | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep strike and expiry identity explicit. |
| HIGH_VALUE | CROSS_MARKET | `cross_market_daily_context_storage` | Existing overseas daily context for SOX, NDX proxy, USD/TWD, VIX and permitted macro series. | V3.10 research, Market State context | DAILY_BY_NAMED_SERIES | EXISTING | UNKNOWN | PARTIAL / IMPLEMENTED | SOURCE_LIMITED | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Maintain descriptive daily context and series-specific limitations. |
| HIGH_VALUE | CROSS_MARKET | `cross_market_future_identity_contract` | Versioned identity, session, multiplier and rollover requirements for distinct SGX/CME futures; not a market-observation series. | CRU-37, Future Data Expansion | VERSIONED_BY_VENUE_PRODUCT_AND_EXPIRY | UNKNOWN | UNKNOWN | NOT_FOUND / DESIGN_ONLY | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep the identity contract unimplemented and route each venue/product source decision separately. |
| HIGH_VALUE | CROSS_MARKET | `cross_market_proxy_and_macro_storage` | Named daily proxy/macro series for DXY, US2Y and US10Y where support is present or needs confirmation. | Future Data Expansion, Market State context | DAILY_BY_SERIES_WITH_PROVIDER_ID | EXISTING | UNKNOWN | PARTIAL / PARTIAL | SOURCE_LIMITED | QUALITY_LIMITED | DESCRIPTIVE | UNKNOWN | UNQUALIFIED | Keep descriptive only; reconcile each series in a future source decision. |
| HIGH_VALUE | CROSS_MARKET | `cross_market_tsm_adr` | TSM ADR price series, distinct from Taiwan 2330 and requiring US session/currency/ratio identity. | CRU-37, Future Data Expansion | DAILY_OR_INTRADAY_BY_US_SESSION_AND_ADR_RATIO | UNKNOWN | UNKNOWN | NOT_FOUND / NOT_IMPLEMENTED | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep missing. |
| HIGH_VALUE | DECISION_OUTCOME_EV | `decision_evidence_and_outcome_records` | Evidence Snapshot, Decision Snapshot, No-Trade reason, T+5/T+15/T+30/T+60/T+120, EOD, MAE, MFE, path and decision-linked outcome records. | CRU-5, forward/paper evidence, future outcome research | ONE_IMMUTABLE_DECISION_WITH_NAMED_OUTCOME_HORIZONS | EXISTING | OWN_EVENT | VERIFIED_PRESENT / PARTIAL | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep append-only and separate decision-time inputs from later outcomes. |
| HIGH_VALUE | SPOT_INDEX_STRUCTURE | `market_breadth_and_sector_leadership` | Breadth raw/derived observations and sector leadership context, with live raw distinct from derived leadership. | CRU-5, DW-4, index leadership | SESSION_SNAPSHOT_AND_DAILY_BY_MARKET_OR_SECTOR | OFFICIAL | LIVE_STREAM | PARTIAL / PARTIAL | NOT_VERIFIED | QUALITY_LIMITED | DESCRIPTIVE | UNKNOWN | UNQUALIFIED | Retain RAW_ONLY / descriptive status; separate sector derivation from raw breadth. |
| HIGH_VALUE | MARKET_INTELLIGENCE | `market_intelligence_expected_control_state` | Expected Response, Market Control, Market State and confidence/contradiction evidence as separate research layers. | CRU-33, CRU-35, Market State research | VERSIONED_DECISION_TIME_SNAPSHOT | DERIVED | DERIVED | PARTIAL / DESIGN_ONLY | APPROVED_INTERNAL | QUALITY_INSUFFICIENT | DESCRIPTIVE | derived_pressure_response_efficiency, cross_market_daily_context_storage | UNQUALIFIED | Keep design/research-only and fail closed on missing evidence. |
| HIGH_VALUE | CROSS_MARKET | `ndx_proxy_daily` | Nasdaq-100 cash-index proxy used only as named daily context, never as NQ/MNQ. | V3.10 research, Market State context | DAILY_INDEX_CLOSE_PROXY | EXISTING | DAILY_DOWNLOAD | PROXY_ONLY / IMPLEMENTED | SOURCE_LIMITED | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep proxy label and prohibit NQ substitution. |
| HIGH_VALUE | CROSS_MARKET | `nq_futures` | Actual CME E-mini Nasdaq-100 futures observations by expiry. | CRU-37, Future Data Expansion | ACTUAL_EXPIRY_EVENT_OR_GOVERNED_DAILY | UNKNOWN | UNKNOWN | NOT_FOUND / DESIGN_ONLY | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep missing. |
| HIGH_VALUE | CROSS_MARKET | `sox_daily` | PHLX Semiconductor Index daily context, explicitly an index series. | V3.10 research, Market State context | DAILY_INDEX_CLOSE | EXISTING | DAILY_DOWNLOAD | PARTIAL / IMPLEMENTED | SOURCE_LIMITED | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep explicitly labelled daily context. |
| HIGH_VALUE | SPOT_INDEX_STRUCTURE | `spot_corporate_actions` | Versioned constituent corporate actions required to interpret historical prices and index contribution inputs. | CRU-37, index leadership, future contribution research | EFFECTIVE_DATE_BY_INSTRUMENT_AND_ACTION | UNKNOWN | UNKNOWN | NOT_FOUND / NOT_IMPLEMENTED | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep unavailable and route source/methodology decision to the owner. |
| HIGH_VALUE | SPOT_INDEX_STRUCTURE | `spot_index_effective_weights` | Versioned TAIEX constituent membership and effective weights for any contribution or leadership calculation. | CRU-37, index leadership, future contribution research | EFFECTIVE_DATE_BY_INDEX_AND_CONSTITUENT | UNKNOWN | UNKNOWN | NOT_FOUND / NOT_IMPLEMENTED | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep unavailable and route source/methodology decision to the owner. |
| HIGH_VALUE | SPOT_INDEX_STRUCTURE | `spot_major_weighted_names` | Price observations for named major weighted constituents, kept separate from effective-date membership, weights and corporate actions. | CRU-37, index leadership, future contribution research | DAILY_BY_CONSTITUENT_AND_TRADE_DATE | UNKNOWN | UNKNOWN | NOT_FOUND / NOT_IMPLEMENTED | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep constituent price data unimplemented and route to owner decision. |
| HIGH_VALUE | SPOT_INDEX_STRUCTURE | `taiex_index_contribution` | Contribution points derived only from governed prices, effective weights, corporate actions and index methodology. | CRU-37, index leadership | EFFECTIVE_DATE_AND_INDEX_METHODOLOGY_ALIGNED | DERIVED | DERIVED | NOT_FOUND / DESIGN_ONLY | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | taiex_index, equity_2330_raw_price, spot_major_weighted_names | UNQUALIFIED | Remain unavailable until the prerequisite reference dataset is governed. |
| HIGH_VALUE | CROSS_MARKET | `twn_futures` | Actual SGX FTSE Taiwan Index Futures observations, distinct from TAIFEX TX. | CRU-37, Future Data Expansion | ACTUAL_EXPIRY_EVENT_OR_GOVERNED_DAILY | UNKNOWN | UNKNOWN | NOT_FOUND / DESIGN_ONLY | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep missing. |
| HIGH_VALUE | PRICE_MICROSTRUCTURE | `tx_basis` | Cash/futures basis and term-structure context with contract scope visible. | V3.10 research, CRU-34 context | DAILY_BY_CONTRACT_SCOPE | DERIVED | DERIVED | VERIFIED_PRESENT / IMPLEMENTED | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Retain current descriptive/research role and document scope per consumer. |
| HIGH_VALUE | PRICE_MICROSTRUCTURE | `tx_depth_candidate` | Deeper TX order-book observations if a future governed research contract needs them. | DW-4, future pressure research | FIVE_LEVEL_BID_ASK_CANDIDATE | UNKNOWN | UNKNOWN | NOT_VERIFIED / NOT_IMPLEMENTED | NOT_VERIFIED | NOT_VERIFIED | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Defer until a bounded owner-approved research contract exists. |
| HIGH_VALUE | POSITION | `tx_large_trader` | Large-trader futures observations by explicit expiry scope and category. | CRU-5, large-trader research | DAILY_BY_EXPIRY_SCOPE_AND_CATEGORY | OFFICIAL | DAILY_DOWNLOAD | VERIFIED_PRESENT / IMPLEMENTED | APPROVED_INTERNAL | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep expiry scope explicit. |
| HIGH_VALUE | PRICE_MICROSTRUCTURE | `txo_intraday_trade_quote_candidates` | Candidate TXO intraday trade and quote raw records for a future bounded activation decision. | DW-4 candidate, future options intraday research | EVENT_TICK_AND_BID_ASK_CANDIDATE | UNKNOWN | UNKNOWN | NOT_VERIFIED / DESIGN_ONLY | NOT_VERIFIED | NOT_VERIFIED | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep deferred; do not activate from this registry. |
| HIGH_VALUE | PRESSURE_RESPONSE_EFFICIENCY | `txo_iv_greeks_dependencies` | Raw option price, underlying, expiry, rate and quote dependencies for local IV/Greeks probes. | options research, DW-4 | PER_QUOTE_SNAPSHOT_WITH_EXPIRY_AND_UNDERLYING | EXISTING | DERIVED | PARTIAL / IMPLEMENTED | APPROVED_INTERNAL | QUALITY_INSUFFICIENT | DESCRIPTIVE | UNKNOWN | UNQUALIFIED | Keep probe descriptive only until the named gate is resolved. |
| HIGH_VALUE | CROSS_MARKET | `us10y_daily` | US 10-year yield daily context, with FRED DGS10 identity kept explicit. | V3.10 research, macro research | DAILY_OBSERVATION_BY_SERIES | EXISTING | DAILY_DOWNLOAD | PARTIAL / PARTIAL | SOURCE_LIMITED | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep descriptive/research role until as-of availability is audited. |
| HIGH_VALUE | CROSS_MARKET | `usdtwd_daily` | USD/TWD daily context with named spot/provider role, not intraday FX evidence. | V3.10 research, Market State context | DAILY_SPOT_OR_PROVIDER_CLOSE | EXISTING | DAILY_DOWNLOAD | PARTIAL / IMPLEMENTED | SOURCE_LIMITED | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep daily label and separate from intraday. |
| HIGH_VALUE | CROSS_MARKET | `vix_daily` | VIX daily/delayed context, with FRED VIXCLS and any display quote kept as separate source/cadence records. | V3.10 research, Market State context | DAILY_CLOSE_OR_DELAYED_DISPLAY_BY_SOURCE | EXISTING | DAILY_DOWNLOAD | PARTIAL / PARTIAL | SOURCE_LIMITED | QUALITY_LIMITED | DESCRIPTIVE, HISTORICAL_RESEARCH | UNKNOWN | GOVERNED | Keep source/cadence labels explicit. |
| OPTIONAL | CROSS_MARKET | `cross_market_intraday_candidates` | Candidate intraday SOX and USD/TWD observations without implying an authorized source. | CRU-37 future expansion | SOURCE_DEFINED_INTRADAY_CANDIDATE | UNKNOWN | UNKNOWN | NOT_VERIFIED / NOT_IMPLEMENTED | NOT_VERIFIED | NOT_VERIFIED | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Defer. |
| OPTIONAL | DECISION_OUTCOME_EV | `decision_cost_risk_and_future_order_records` | Cost/slippage assumptions, risk decision and future own order/fill/reject records without enabling execution. | research accounting, future paper/forward work | VERSIONED_ASSUMPTION_OR_APPEND_ONLY_OWN_EVENT | OWN_RECORD | OWN_EVENT | PARTIAL / OWN_RECORD_ONLY | NOT_APPLICABLE | QUALITY_LIMITED | DESCRIPTIVE |  | UNQUALIFIED | Keep deferred and research-only. |
| OPTIONAL | CROSS_MARKET | `dxy_daily` | DXY daily context if and only if a named governed series is found. | Future Data Expansion | DAILY_BY_NAMED_PROVIDER | UNKNOWN | UNKNOWN | NOT_FOUND / NOT_IMPLEMENTED | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep candidate and missing. |
| OPTIONAL | CROSS_MARKET | `es_futures` | Actual CME E-mini S&P 500 futures observations by expiry. | CRU-37, Future Data Expansion | ACTUAL_EXPIRY_EVENT_OR_GOVERNED_DAILY | UNKNOWN | UNKNOWN | NOT_FOUND / DESIGN_ONLY | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep candidate and missing. |
| OPTIONAL | CROSS_MARKET | `mnq_futures` | Actual CME Micro E-mini Nasdaq-100 futures observations by expiry, distinct from NQ. | CRU-37, Future Data Expansion | ACTUAL_EXPIRY_EVENT_OR_GOVERNED_DAILY | UNKNOWN | UNKNOWN | NOT_FOUND / DESIGN_ONLY | NOT_VERIFIED | UNAVAILABLE | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Keep candidate and missing. |
| OPTIONAL | CROSS_MARKET | `sox_intraday_candidate` | Candidate intraday SOX observations requiring source, timestamp and license qualification. | CRU-37 future expansion | SOURCE_DEFINED_INTRADAY_CANDIDATE | UNKNOWN | UNKNOWN | NOT_VERIFIED / NOT_IMPLEMENTED | NOT_VERIFIED | NOT_VERIFIED | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Defer. |
| OPTIONAL | CROSS_MARKET | `us2y_daily` | US 2-year yield daily context under a named macro series identity. | Future Data Expansion, macro research | DAILY_OBSERVATION_BY_SERIES | UNKNOWN | UNKNOWN | NOT_VERIFIED / PARTIAL | SOURCE_LIMITED | NOT_VERIFIED | UNKNOWN | UNKNOWN | UNQUALIFIED | Reconcile exact series before use. |
| OPTIONAL | CROSS_MARKET | `usdtwd_intraday_candidate` | Candidate intraday USD/TWD observations requiring a lawful FX source and session contract. | CRU-37 future expansion | SOURCE_DEFINED_INTRADAY_QUOTE_CANDIDATE | UNKNOWN | UNKNOWN | NOT_VERIFIED / NOT_IMPLEMENTED | NOT_VERIFIED | NOT_VERIFIED | NOT_ELIGIBLE | UNKNOWN | UNQUALIFIED | Defer. |

## Reading rules

- UNKNOWN and missing are not zero or neutral.
- A proxy remains a proxy and cannot reuse the canonical identity of the source it stands in for.
- A table or code path is not evidence that data exists; persisted runtime evidence is required for VERIFIED_PRESENT.
- Historical acquisition and ongoing acquisition are independent columns.
- Formal, forward, and point-in-time replay eligibility requires approved license evidence, PASS quality, and governed evidence qualification.
- Outcome datasets are never inputs to same-decision-time features.
