# DW-4 Data Requirements and Forward Collection

Status: **DATA REQUIREMENTS / COLLECTION CANDIDATE — PRODUCTION ACTIVATION NOT PERFORMED**

Captured at: 2026-08-14 Asia/Taipei

Canonical code observed: `6751b2d316cde66f091b8162f0ffd22cb287c59a`

## Classification

- `AVAILABLE_AND_USABLE_NOW`
- `AVAILABLE_BUT_QUALITY_LIMITED`
- `RAW_EXISTS_DERIVATION_NOT_IMPLEMENTED`
- `COLLECT_NOW_EXISTING_SOURCE`
- `SOURCE_GAP_OWNER_DECISION_REQUIRED`
- `FUTURE_NOT_REQUIRED`

## Data requirements matrix

| evidenceId | purpose / required raw source | current source and collection | live/batch and coverage | time / sequence / quality | history / startup / reconnect | DW-4 eligibility and collection action |
|---|---|---|---|---|---|---|
| `tx_price_structure` | Price, session high/low / TX executed Tick | Shioaji `TXFR1` resolved to actual `TXFH6`; single append-only ledger | LIVE, DAY+NIGHT | exchange event time + receivedAt; effective availableAt is governed by existing chart; native sequence unavailable; timestamp lineage insufficient | Forward history exists; AUTO_START; CRU-26 recovery code merged but production supervisor inactive | `AVAILABLE_BUT_QUALITY_LIMITED`; reuse only; do not duplicate collector |
| `tx_vwap` | Session VWAP / TX Tick price+volume | Existing DW-2 session VWAP | LIVE derivation, DAY or NIGHT session only | Inherits TX time and quality; not a combined trade-date VWAP | Existing replay; on demand | `AVAILABLE_BUT_QUALITY_LIMITED`; reuse DW-2 |
| `tx_opening_range` | Frozen 08:45–09:00 DAY OR / TX Tick | Existing frozen T0/DW-2 OR | LIVE derivation, DAY only | Governed availableAt; inherits TX quality | Existing replay; on demand | `AVAILABLE_BUT_QUALITY_LIMITED`; definition unchanged |
| `tx_flow_prerequisite` | Future estimated flow/CVD / TX Tick | Raw TX Tick continuously collected | LIVE DAY+NIGHT | tick_type/inner-outer classification is estimated; real aggressor side unavailable; native sequence unavailable | Forward raw history accumulating | `RAW_EXISTS_DERIVATION_NOT_IMPLEMENTED`; keep raw, no CVD product now |
| `tx_order_book_prerequisite` | Future depth/spread/imbalance / TX BidAsk | Raw TX five-level BidAsk continuously collected | LIVE DAY+NIGHT | event/received timestamps; native sequence unavailable; quality limited | Forward raw history accumulating | `RAW_EXISTS_DERIVATION_NOT_IMPLEMENTED`; keep raw, no pressure product now |
| `mtx_tmf_context` | Cross-contract participation context / MTX+TMF Tick/BidAsk | Shioaji aliases resolved to `MXFH6`/`TMFH6` | LIVE DAY+NIGHT | Same timestamp/sequence limitations | AUTO_START; existing bridge | `AVAILABLE_BUT_QUALITY_LIMITED`; reuse only |
| `twse_breadth_eod` | Governed breadth / official TWSE/TPEX counts | Existing scheduled official batch | BATCH EOD; latest legal source date may precede capture time | Governed publication availability; must show EOD/delayed | Deep daily history; scheduled | `AVAILABLE_AND_USABLE_NOW` after legal availability |
| `twse_breadth_live_raw` | Intraday participation / IX0001 quote fields | Existing Shioaji `IX0001` raw payload contains `raise_count`, `fall_count`, `flat_count`, limit counts and no-trade count | LIVE DAY; latest inspected payload 2026-08-14 | event time + receivedAt retained; raw breadth coverage/constituent semantics not frozen; native sequence unavailable | Forward records already accumulating; AUTO_START | `RAW_EXISTS_DERIVATION_NOT_IMPLEMENTED`; no new collector, freeze contract only after audit |
| `foreign_cash` | Institutional participation | Existing TWSE institutional batch | BATCH EOD | sourceTradeDate and governed availability required | Deep daily history; scheduled | `AVAILABLE_AND_USABLE_NOW` after publication |
| `futures_oi_same_contract` | Futures positioning / same-contract OI | Existing TAIFEX batch and normalized OI pipeline | BATCH EOD | Some canonical rows lack row-level availableAt; use governed adapter only | Deep history; scheduled | `AVAILABLE_BUT_QUALITY_LIMITED`; no new collection |
| `basis` | Futures/cash relationship | Existing TAIFEX/TWSE batch derivation | BATCH EOD | sourceTradeDate/availableAt required | Daily history; scheduled | `AVAILABLE_BUT_QUALITY_LIMITED` |
| `options_oi_pcr_strikes` | Options context | Existing TAIFEX options EOD batch | BATCH EOD | Publication-time and row-level availableAt limitations must remain visible | Daily history; scheduled | `AVAILABLE_BUT_QUALITY_LIMITED` |
| `options_live_chain_raw` | Future intraday options conflict / TXO Tick+BidAsk | Existing Shioaji account capability probe found bounded two-sided quotes; no continuous ledger path | MANUAL probe only; no continuous session coverage | Contract/expiry/strike/right/BidAsk/eventTime/receivedAt required; OI only if provider really supplies it | No governed forward history; no autostart | `COLLECT_NOW_EXISTING_SOURCE`; repository contract ready, production activation requires Owner review and a bounded contract-selection plan |
| `options_intraday_iv_skew` | Future ATM IV / 25D skew | Existing Black-76 research code and EOD derivation; no validated continuous input | RESEARCH derivation only | Must align underlying and option quotes and record assumptions/version/coverage | EOD history only | `RAW_EXISTS_DERIVATION_NOT_IMPLEMENTED`; cannot precede live-chain quality gate |
| `provider_greeks` | Not required for V1 | Provider Greeks not verified | MISSING | Self-calculated Greeks are not provider Greeks | none | `FUTURE_NOT_REQUIRED` |
| `tsmc_price` | Dominant constituent context | Existing Shioaji 2330 Tick path | LIVE DAY | Raw price only; event/received time; native sequence unavailable | Forward records already accumulating; AUTO_START | `AVAILABLE_BUT_QUALITY_LIMITED`; price is not contribution |
| `top10_prices_membership_weights` | Index concentration conflict | Only 2330 is subscribed; no effective-date Top-10 membership/weight source | MISSING | Effective-date membership, weights, methodology/divisor evidence required | none | `SOURCE_GAP_OWNER_DECISION_REQUIRED`; do not select constituents by guess |
| `tsmc_top10_contribution` | Contribution points | Required raw prices and governed index inputs incomplete | MISSING derivation | 2330 return cannot be converted to points without governed semantics | none | `SOURCE_GAP_OWNER_DECISION_REQUIRED`; `CONTRIBUTION_NOT_YET_ELIGIBLE` |
| `sox_eod` | Semiconductor global context | Existing daily source | BATCH EOD/delayed | sourceTradeDate and availableAt label required | daily history; scheduled | `AVAILABLE_AND_USABLE_NOW` as delayed context |
| `ndx_proxy_eod` | US growth proxy | Existing `NDX_PROXY` daily source | BATCH EOD/delayed | Explicit `PROXY_ONLY`; never NQ | daily history; scheduled | `AVAILABLE_AND_USABLE_NOW` only as proxy |
| `true_nq_futures` | Taiwan-hours US futures conflict | No authorized NQ futures datasource or records found | MISSING | Real contract/expiry/front-contract/rollover/eventTime/receivedAt required | none | `SOURCE_GAP_OWNER_DECISION_REQUIRED`; NDX/QQQ/CFD may not substitute |
| `vix_eod` | Global risk context | Existing daily VIX source | BATCH EOD/delayed | sourceTradeDate/availableAt required | daily history; scheduled | `AVAILABLE_BUT_QUALITY_LIMITED` where availability contract is incomplete |
| `usdtwd_daily` | FX context | Existing Yahoo `USDTWD=X` daily fetch | BATCH daily, not intraday | Explicit daily/delayed semantics | daily history; scheduled | `AVAILABLE_AND_USABLE_NOW` as daily context only |
| `usdtwd_intraday` | Intraday FX conflict | No verified legal no-cost intraday source in repo/current provider | MISSING | Source identity, event/received/available time, holiday/stale semantics required | none | `SOURCE_GAP_OWNER_DECISION_REQUIRED`; no registration or vendor purchase performed |
| `data_trust` | Prevent false green | Existing Dashboard Data Health, bridge health, project-status | LIVE + BATCH | freshness, sourceTradeDate, availableAt, quality, collector state | existing | `AVAILABLE_AND_USABLE_NOW`, while each source keeps its own limitations |

## Existing collection reused

The formal Shioaji market-data-only bridge already uses one process and one append-only writer for TX Tick/BidAsk, MTX Tick/BidAsk, TMF Tick/BidAsk, 2330 Tick, and IX0001 Quote. The inspected runtime resolved futures to `TXFH6`, `MXFH6`, and `TMFH6`. This work does not create a second bridge, writer, TX collector, or 2330 collector.

The 2026-08-14 IX0001 payload proved that listed breadth fields are already retained in raw evidence. That changes the classification from “source missing” to “raw exists, governed derivation not implemented”; it does not make live breadth formal DW-4 evidence.

## Collect now candidates

| Candidate | Existing access | Repository readiness in this PR | Production state |
|---|---|---|---|
| IX0001 live breadth raw | Already continuously collected | Canonical raw and health requirements documented | Already collected by existing bridge; no new activation |
| TX/TX BidAsk/MTX/TMF/2330 | Already continuously collected | Preserve existing raw prerequisites | Already collected; no duplicate |
| TXO live chain | Existing Shioaji account probe demonstrated bounded quotes | Canonical raw contract and activation boundary are test-covered | **NOT ACTIVATED**; Owner must approve exact universe/session/autostart |

Top-10, intraday USD/TWD, and true NQ cannot start without an approved source/identity contract. They are source decisions, not engineering guesses.

## Canonical forward collection record

Every new raw record must retain: `source`, `sourceId`, `instrument`, `market`, `tradeDate`, `session`, `contract`, optional `expiry`, `eventTime`, `receivedAt`, `availableAt`, `nativeSequenceAvailability`, optional true provider `nativeSequence`, `rawPayloadHash`, `qualityStatus`, `qualityReasons`, `collectionRunId`, `collectorVersion`, `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, and `orderRoutesEnabled=false`.

If provider sequence is absent, `nativeSequenceAvailability=UNAVAILABLE` and the sequence stays null. A local ledger sequence must not be relabeled as provider sequence. If `receivedAt < eventTime`, the raw event may be preserved but must be marked `QUALITY_INSUFFICIENT / TIMESTAMP_LINEAGE_INSUFFICIENT`; it cannot be presented as clean.

## Data Health contract

Each source must expose one of `AVAILABLE`, `PARTIAL`, `STALE`, `MISSING`, `UNAVAILABLE`, `QUALITY_INSUFFICIENT`, or `UNKNOWN`, plus `lastSuccessfulRecord`, `latestEventTime`, `latestReceivedAt`, `latestAvailableAt`, `sessionCoverage`, `collectorState`, and evidence-supported `failureReason`.

No source is usable by DW-4 merely because a process or file exists. No request may start a collector, mutate the raw ledger, or repair old data.

## Source authorization and activation gate

Production activation is not part of this Draft PR. The following remain false: `productionActivationApproved`, `windowsStartupModified`, and `continuitySupervisorActivated`. Any new paid vendor, account, API key, broker permission, redistribution/license decision, or order route requires a separate Product Owner decision.

The candidate activation order is: existing-source identity review → collection universe/session freeze → isolated fixtures → off-hours activation approval → Windows integration → forward coverage audit. Historical backfill must not delay forward collection and cannot be fabricated.

## Promotion gate

Raw collection is not evidence promotion:

`RAW_COLLECTION → COVERAGE_AUDIT → QUALITY_AUDIT → AVAILABLE_AT_AUDIT → DETERMINISTIC_REPLAY → DESCRIPTIVE_VALIDATION → OWNER_REVIEW → DW4_EVIDENCE_CANDIDATE`

Until that gate completes, new data cannot emit `SUPPORTS_UP`, `SUPPORTS_DOWN`, Market State input, strategy signal, or risk veto.

## Explicit source gaps

1. Effective-date Top-10 membership, weights, and index methodology/divisor evidence.
2. A legally authorized intraday USD/TWD source.
3. A legally authorized true NQ futures source with contract and rollover semantics.
4. TXO continuous collection universe/session policy and production activation approval.

## Safety

This work changes no Windows Startup, starts no 8791 supervisor, activates no new production collector, modifies no Forward Shadow evidence, and changes no Market State or Frozen semantics. There is no broker route. `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, and `orderRoutesEnabled=false` remain fixed.
