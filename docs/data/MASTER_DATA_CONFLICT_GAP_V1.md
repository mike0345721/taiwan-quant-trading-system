# Master Data Conflict / Gap Register V1

> Generated from `config/data-requirements-v1.json`. This register records truth, impact, and the recommended next owner/work item; it does not attempt to fix every gap in CRU-39.

- Registry: `MASTER_DATA_REQUIREMENTS_V1`
- Baseline: `cc516428175ef85411b2d082107300bddb81a182`
- Blocking findings in registry: 0

| Conflict ID | Type | Truth | Impacted dataset IDs | Recommended next owner | Recommended work item | Blocking |
|---|---|---|---|---|---|---|
| `G-001` | NOT_VERIFIED | Notion Product Home and Future Data Expansion were named by CRU-39 but are not available in this local session; local docs are not substituted as Notion evidence. | `cross_market_future_identity_contract`, `cross_market_tsm_adr`, `cross_market_intraday_candidates` | Product Owner / Product documentation owner | Attach or reconcile the current Notion source before changing source priority. | NO |
| `G-002` | DOCUMENT_CONFLICT | Historical roadmap/candidate text describes possible future inputs, while CRU-37 and DW-4 audits classify several of them as missing or source-pending. | `cross_market_future_identity_contract`, `cross_market_tsm_adr`, `spot_major_weighted_names` | Product Owner | Resolve source authorization before any implementation work. | NO |
| `G-003` | DUPLICATE_REQUIREMENT | TXO OI, TXO intraday raw, and IV/Greeks dependencies were previously described at different layers; registry keeps them as separate identities and eligibility states. | `txo_strike_expiry_cp_oi`, `txo_intraday_trade_quote_candidates`, `txo_iv_greeks_dependencies` | Data contract owner | Use these IDs in future task packets instead of introducing aliases. | NO |
| `G-004` | OVER_GRANULAR_REQUIREMENT | The 1m TWN/TX price-discovery candidate is not evidence that a tick-level source is required. | `tx_ohlcv_1m_5m`, `cross_market_intraday_candidates` | CRU-37 owner | Validate the minimum cadence against the named research question. | NO |
| `G-005` | IMPLEMENTATION_GAP | Canonical dataset IDs and cross-artifact generation did not exist before CRU-39. | `data_truth_lineage_quality_and_recovery` | CRU-39 engineering | Adopt the registry and validation command in task setup. | NO |
| `G-006` | COVERAGE_GAP | TX event and quote coverage is present only partially; native sequence and complete capture are not proven. | `tx_actual_trade`, `tx_best_quote`, `derived_pressure_response_efficiency` | CRU-34 / runtime evidence owner | Run a separately authorized evidence audit; do not infer completeness from zero observed gaps. | NO |
| `G-007` | LICENSE_GAP | Existing daily/proxy presence does not establish redistribution, non-display, or repurposing rights for a new consumer. | `cross_market_daily_context_storage`, `cross_market_proxy_and_macro_storage`, `cross_market_tsm_adr` | Product Owner / source entitlement owner | Record source-specific license and permitted-use decisions. | NO |
| `G-008` | QUALITY_GAP | Local option IV/Greeks estimates exist as a probe, but provider snapshot timestamp semantics remain pending and provider-native Greeks were not observed. | `txo_iv_greeks_dependencies` | Options data owner | Resolve timestamp/provider-field gate before formal or forward use. | NO |
| `G-009` | TIMESTAMP_GAP | Existing daily global rows retain run-level fetched time but not universal row-level eventTime, receivedAt and availableAt. | `cross_market_daily_context_storage`, `cross_market_proxy_and_macro_storage` | Cross-market data contract owner | Define source-specific availability evidence before point-in-time replay. | NO |
| `G-010` | REPLAY_GAP | Historical roadmap snapshots and fetched daily rows cannot by themselves prove what an earlier decision lawfully knew. | `cross_market_daily_context_storage`, `cross_market_proxy_and_macro_storage`, `decision_evidence_and_outcome_records` | Research governance owner | Keep eligibility descriptive until an as-of audit exists. | NO |
| `G-011` | OWNER_DECISION_REQUIRED | Top-10 effective-date membership/weights/methodology, corporate actions and TSMC contribution have no governed source. | `spot_major_weighted_names`, `spot_index_effective_weights`, `spot_corporate_actions`, `taiex_index_contribution` | Product Owner | Approve or reject a named source and intended usage. | NO |
| `G-012` | OWNER_DECISION_REQUIRED | TWN/NQ/MNQ/ES and intraday cross-market sources are not authorized by existing evidence. | `cross_market_future_identity_contract`, `twn_futures`, `nq_futures`, `mnq_futures`, `es_futures`, `cross_market_intraday_candidates` | Product Owner | Decide source, license, cadence and venue scope before implementation. | NO |
| `G-013` | NOT_VERIFIED | Runtime-only data and CRU-38 local Storage Phase 0 evidence are not part of the approved-main worktree and are not copied into this branch. | `tx_actual_trade`, `tx_best_quote`, `data_truth_lineage_quality_and_recovery` | CRU-38 / operations owner | Attach immutable evidence through the established preservation path when a future task requires it. | NO |
| `G-014` | REPLAY_GAP | Outcome records are downstream observations and must not be inputs to same-decision-time features. | `decision_evidence_and_outcome_records`, `market_intelligence_expected_control_state` | Research contract owner | Keep input_dataset_ids and outcome records separated in future contracts. | NO |
| `G-015` | IMPLEMENTATION_GAP | The registry can enumerate candidate IDs, but enumeration does not create a collector, migration, provider account, or production activation. | `tx_depth_candidate`, `txo_intraday_trade_quote_candidates`, `cross_market_future_identity_contract` | CRU-39 reviewer / Product Owner | Reject scope expansion during review and route authorized work separately. | NO |

## Interpretation

- `NOT_VERIFIED` is an explicit state, not a claim that the source is absent.
- Historical roadmap text is not implementation evidence.
- Source/license, timestamp, replay, and owner-decision gaps remain fail-closed.
