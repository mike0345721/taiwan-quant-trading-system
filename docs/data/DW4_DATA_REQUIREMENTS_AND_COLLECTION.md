# DW-4 Data Requirements and Forward Collection

Status: **IMPLEMENTATION CANDIDATE — PRODUCTION TXO ACTIVATION NOT PERFORMED**

Production state: **NOT ACTIVATED**

Captured at: 2026-08-14 Asia/Taipei
Approved main observed: `6751b2d316cde66f091b8162f0ffd22cb287c59a`

## Data requirements matrix

| evidenceId | required source | actual state | session / time / quality | collection / eligibility |
|---|---|---|---|---|
| `tx_price_structure` | TX executed Tick | `AVAILABLE_BUT_QUALITY_LIMITED` | DAY+NIGHT; native sequence unavailable; `TIMESTAMP_LINEAGE_INSUFFICIENT` retained | Existing single bridge/writer; DW-2 remains source |
| `tx_flow_prerequisite` | TX Tick | `RAW_EXISTS_DERIVATION_NOT_IMPLEMENTED` | Tick type is estimated, real aggressor side unavailable | Existing raw continues; no CVD product |
| `tx_order_book_prerequisite` | TX BidAsk | `RAW_EXISTS_DERIVATION_NOT_IMPLEMENTED` | five-level depth, received/event time, native sequence unavailable | Existing raw continues; no pressure score |
| `mtx_tmf_context` | MTX/TMF Tick+BidAsk | `AVAILABLE_BUT_QUALITY_LIMITED` | DAY+NIGHT, same timestamp limits | Existing single bridge/writer |
| `twse_breadth_live_raw` | IX0001 `index_quote` | `RAW_VALIDATED_CANDIDATE` | TWSE 09:00–13:30 plus closing quote; quality limitations below | Existing subscription only; no duplicate collector; `RAW_ONLY` |
| `twse_breadth_eod` | official TWSE/TPEX batch | `AVAILABLE_AND_USABLE_NOW` after publication | EOD/delayed, governed source date | Existing scheduled batch |
| `foreign_cash` | TWSE institutional batch | `AVAILABLE_AND_USABLE_NOW` after publication | EOD | Existing batch |
| `futures_oi_same_contract` | TAIFEX OI | `AVAILABLE_BUT_QUALITY_LIMITED` | EOD/source-date semantics | Existing normalized pipeline |
| `basis` | governed cash/futures inputs | `AVAILABLE_BUT_QUALITY_LIMITED` | EOD/source-date semantics | Existing derivation |
| `options_oi_pcr_strikes` | TAIFEX options batch | `AVAILABLE_BUT_QUALITY_LIMITED` | EOD | Existing batch |
| `options_live_chain_raw` | Shioaji TXO Tick+BidAsk | `COLLECT_NOW_EXISTING_SOURCE / IMPLEMENTED_DEFAULT_OFF` | monthly TXO root; event/received/available lineage; no native sequence | Existing bridge/writer reused; production activation pending |
| `options_intraday_iv_skew` | synchronized live chain + TX underlying | `RAW_EXISTS_DERIVATION_NOT_IMPLEMENTED` | raw options are not IV/Skew | Not promoted |
| `provider_greeks` | provider-native Greeks | `FUTURE_NOT_REQUIRED` | probe exposed no provider Greek fields | no substitution with local model |
| `tsmc_price` | 2330 Tick | `AVAILABLE_BUT_QUALITY_LIMITED` | DAY; raw price only | Existing subscription |
| `top10_prices_membership_weights` | effective-date membership/weights/methodology | `SOURCE_GAP_OWNER_DECISION_REQUIRED` | repository has no governed effective-date source | no purchase/registration performed |
| `tsmc_top10_contribution` | governed prices + weights + divisor/methodology | `SOURCE_GAP_OWNER_DECISION_REQUIRED` | 2330 price is not contribution | `CONTRIBUTION_NOT_YET_ELIGIBLE` |
| `sox_eod` | existing daily source | `AVAILABLE_AND_USABLE_NOW` | EOD/delayed | explicit label |
| `ndx_proxy_eod` | existing NDX proxy | `AVAILABLE_AND_USABLE_NOW` as proxy | EOD/delayed, `NDX_PROXY / PROXY_ONLY` | never relabeled NQ |
| `true_nq_futures` | actual NQ contract/expiry/rollover | `SOURCE_GAP_OWNER_DECISION_REQUIRED` | no authorized source in repo/current access | NDX/QQQ/CFD forbidden substitutes |
| `vix_eod` | existing VIX daily | `AVAILABLE_BUT_QUALITY_LIMITED` | EOD/delayed | existing source |
| `usdtwd_daily` | existing Yahoo daily | `AVAILABLE_AND_USABLE_NOW` as daily | not intraday | explicit daily label |
| `usdtwd_intraday` | legal intraday FX feed | `SOURCE_GAP_OWNER_DECISION_REQUIRED` | no authorized no-cost intraday source found | no new account/vendor |

## IX0001 governed validation

The source is the existing `set_on_quote_idx_v1_callback` → `index_quote` → single append-only writer path. Required provider fields are `raise_count`, `fall_count`, `flat_count`, `limit_up_count`, `limit_down_count`, and `no_trade`. Price movement is never substituted for breadth.

The streaming audit of the 2026-08-14 ledger read one file sequentially without loading the 1.6 GiB ledger into RAM and without mutation:

- records: 3,242; first event 09:00:05; last exchange event 13:33:00 Asia/Taipei
- required-field failures: 0; invalid candidate lines: 0; future-data violations: 0
- clean records: 581; `TIMESTAMP_LINEAGE_INSUFFICIENT`: 2,661
- session coverage: `COMPLETE` for TWSE 09:00–13:30 plus closing quote
- deterministic replay hash: `01a38fdac62e6f987024199a0bff3d99289b1f1c5a917906c3cf03ce666a1177`
- night: `NOT_APPLICABLE`; pre/post-market records are not eligible
- reset semantics: each provider snapshot is scoped by its payload `tradeDate`; no cross-day monotonic-counter assumption

Result: `RAW_VALIDATED_CANDIDATE`, `RAW_ONLY`, `directionState=NOT_ELIGIBLE`. Quality warnings remain visible and promotion still requires descriptive validation and Owner review.

## TXO actual universe audit

At 2026-08-14 19:40 Asia/Taipei a bounded `subscribe_trade=false` probe performed no subscriptions, orders, ledger writes, or activation and immediately logged out.

- `TXO` root: 2,050 contracts, five monthly expiries
- 2026-08-19: 530 contracts / 265 strikes / 265 calls / 265 puts
- 2026-09-16: 554 / 277 strikes
- 2026-10-21: 384 / 192 strikes
- 2026-12-16: 324 / 162 strikes
- 2027-03-17: 258 / 129 strikes
- nearest ATM bounded quote probe: 10/10 contracts had two-sided quotes
- provider snapshot fields contained price/size/volume/time but no provider Greeks
- continuous quote rate, subscription limit, restoration duration, and measured storage rate were **not** obtained because production subscription is not authorized

The probe verified monthly `TXO`; weekly option roots were not verified in this root and cannot be silently merged or called available.

## TXO universe decision

| Option | Assessment |
|---|---|
| A — full relevant expiry | Rejected for V1: the nearest monthly expiry alone is 530 contracts / 1,060 Tick+BidAsk subscriptions, with no measured capacity evidence. |
| B — governed near-market liquid pairs | **Recommended**: nearest non-expired monthly TXO expiry; select nearest call/put strike pairs with valid two-sided snapshot quotes; require an Owner-approved even hard cap in the immutable activation artifact. |
| C — dynamically volume-ranked | Rejected until its selection snapshot and replay contract are frozen; otherwise membership changes are not auditable. |

Option B is deterministic given the frozen provider contract snapshot, underlying price, two-sided quote snapshot, and Owner-approved cap. The cap has no code default; missing approval/config fails closed. Expiry change is rebuilt from a new governed selection snapshot and never switches silently on settlement day.

## TXO architecture and health

Implementation extends the existing market-data-only bridge behind `DW4_TXO_COLLECTION_ENABLED=true` plus a validated activation artifact. Default is off. The bridge remains the sole Shioaji login, FOP callback owner, queue, and append-only writer. No second bridge, login, writer, or ledger exists.

The activation artifact must bind exact Owner approval hash, `NEAREST_MONTHLY`, selection method, and `ownerApprovedMaxContracts`. The same governed TAIFEX calendar resolves DAY/NIGHT trade date; out-of-session or uncovered dates fail closed.

Health allowlists expose enabled/state, subscription expected/restored counts, last quote, writer/queue/error/disk status, native-sequence unavailability, and packet-loss uncertainty. Process alive is not sufficient. Raw TXO events are `options_tick`/`options_bidask`; raw options do not produce IV, Skew, Greeks, or direction.

Because measured live quote rate and restoration/load capacity are not yet available, production activation readiness is `NOT_READY`. The next gate is an Owner-approved off-hours bounded activation/load validation; no production subscription was started in this PR.

## Canonical raw record and trust

New records preserve source/sourceId, instrument/market, governed tradeDate/session, contract/expiry/strike/callPut, eventTime/receivedAt/availableAt, Bid/Ask price and size, provider last/volume/OI only when actually present, underlying identity/time when available, raw hash, collection run/version, quality status/reasons, and fixed safety flags.

Provider sequence is fixed as `nativeSequenceAvailability=UNAVAILABLE`; packet-loss certainty remains `UNKNOWN_NO_NATIVE_SEQUENCE`. `receivedAt < eventTime` remains `TIMESTAMP_LINEAGE_INSUFFICIENT`. No historical ledger rewrite, missing-tick fabrication, or backfill is allowed.

## Source gaps and promotion gate

Top-10 effective-date weights/methodology, true intraday USD/TWD, true NQ futures, and verified weekly options require separate source/authorization decisions. Existing daily/proxy sources cannot impersonate them.

`RAW_COLLECTION → COVERAGE_AUDIT → QUALITY_AUDIT → AVAILABLE_AT_AUDIT → DETERMINISTIC_REPLAY → DESCRIPTIVE_VALIDATION → OWNER_REVIEW → DW4_EVIDENCE_CANDIDATE`

## Safety

Production TXO activation, Windows Startup changes, CRU-26 supervisor activation, Forward Shadow mutation, Market State retuning, strategy/risk promotion, and trading are not performed. There is no broker route. `productionActivationApproved=false`, `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`, and `market_data_only=true` remain fixed.
