# Cross-Market Capability Gap Matrix V1

> Work package: CRU-37
> Baseline: `223b24d3bfc9f2249ce3b0153f794ae520823f2c`
> Status: OWNER DECISION INPUT / NO IMPLEMENTATION AUTHORITY

## 1. Auditable capability matrix

Priority describes evidence-foundation value and irrecoverable forward-history risk. It is not implementation authorization. `TARGET` is a future acceptance description, never automatic work approval.

| Capability | CURRENT | TARGET | SOURCE | QUALITY | TIMESTAMP | LICENSE | HISTORY | LIVE | REPLAY | NEXT ACTION | PRIORITY |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TWN | `MISSING` | Actual SGX TWN contract Tick/quote or governed 1m with expiry/roll | SGX direct or licensed vendor `UNKNOWN` | No audit | event/receive/normalize/available absent | `UNKNOWN`; SGX NDU required | None | None | No | Owner source/license/cost decision | G0 |
| NQ/MNQ | `MISSING`; NDX proxy only | Explicit actual CME NQ or selected MNQ contracts | CME-authorized feed `UNKNOWN` | No audit | Session/DST/availability absent | `UNKNOWN` | None | None | No | Owner product/vendor decision | G0 |
| SOX | Daily `AVAILABLE`; intraday `SOURCE_PENDING` | Preserve daily or separately govern licensed intraday | Yahoo daily now; future Nasdaq-authorized source unknown | Daily payload hash/run lineage; row availability partial | Daily trade date/run fetch only | Current machine/retention status `NOT_VERIFIED`; intraday `UNKNOWN` | 2023-06-01–2026-09-03 local | No governed live | Daily values reproducible, historical as-of not proven | Decide if intraday adds independent value | G1 |
| USD/TWD | Daily `AVAILABLE`; intraday `MISSING` | Explicit TWD-per-USD price type with bid/ask/hours | Yahoo daily; intraday vendor unknown | Daily run hash; intraday none | Daily date/fetch only; no intraday timestamps | Daily machine-use `NOT_VERIFIED`; intraday `UNKNOWN` | 2023-06-01–2026-09-04 local | None governed | Historical as-of not proven | Choose spot/indicative/fixing/futures object first | G0 |
| TSMC effective weights | `MISSING` | Effective-date 2330 weight/divisor/methodology | Official/licensed index source unknown | None | Effective/publication times absent | `UNKNOWN` | None | None | No | Owner methodology source decision | G1 |
| Top-10 weights | `MISSING` | Effective-date membership/weights/divisor/corporate actions | Official/licensed index source unknown | None | Effective/publication times absent | `UNKNOWN` | None | None | No | Owner methodology source decision | G1 |
| ES | `MISSING` | Actual CME ES contracts if non-duplicative research value approved | CME-authorized feed unknown | None | Session/DST/availability absent | `UNKNOWN` | None | None | No | Product relevance before vendor selection | G1 |
| VIX | `PARTIAL` | Explicit source/cadence: daily close or governed intraday | FRED/Cboe daily; separate delayed context | Daily observations/run hash; revisions possible | Observation date/fetch; no universal row availability | Copyright/attribution applies; intraday/redistribution `UNKNOWN` | 2023-06-01–2026-09-02 FRED local | No governed live | Daily as-of not fully proven | Select use case and source contract | G1 |
| TSM ADR | `MISSING` | Actual NYSE TSM ADR with ratio/currency/session | US equity feed unknown | None | US session/availability absent | `UNKNOWN` | None | None | No | Product relevance and source decision | G1 |
| TX raw | `PARTIAL` | Keep existing single bridge; eligible synchronized comparison | Shioaji market-data-only | Timestamp lineage limited; no native sequence | Event/receive present; governed session logic | Existing local entitlement only; no SGX implication | Forward raw exists | Yes, source-dependent | Deterministic ledger order; packet-loss certainty unknown | No CRU-37 change; preserve current path | G0 dependency |
| 2330 raw | `PARTIAL` | Price input only; never contribution by itself | Existing Shioaji subscription | Existing live limitations | Taiwan DAY/event/receive | Existing local entitlement only | Forward raw exists | Yes | Source-dependent | Keep separate from TSM ADR/contribution | G1 dependency |
| `global_market_daily` | `PARTIAL` | Future bitemporal row/revision lineage | Yahoo daily importer | Run hash/source; current-row provenance | No row event/receive/available | Machine/retention status `NOT_VERIFIED` | NDX/SOX/USDTWD and commodities | No | Values reproducible; historical decision legality not proven | Separate future schema design; no guessed retrofit | G0 |
| Market State promotion | `NOT_AUTHORIZED` | Only after source, replay and descriptive validation | Current frozen global block only | New evidence unvalidated | Strict past-only required | Per-source approval required | Existing frozen scope only | None from CRU-37 | No new replay | Separate future Owner gate | G2 |
| Dashboard UI | `NOT_AUTHORIZED` | Contract-compliant evidence view | No implementation source | Not applicable | Must expose all three times | Must suppress ungoverned data | Not applicable | Not applicable | Replay-aware view required | Separate UI work package after data gates | G2 |

## 2. Capability disposition

| Capability | Keep now | Add now | Hide / unavailable rule |
|---|---|---|---|
| SOX daily | Keep as daily research context | No | Show cadence/source; do not imply intraday |
| NDX daily | Keep only as `NDX_PROXY` | No | Always pair with `TRUE_NQ_UNAVAILABLE` when NQ is requested |
| USD/TWD daily | Keep as daily context | No | Do not emit intraday returns |
| FRED VIXCLS | Keep as daily close where legal availability passes | No | Preserve copyright/attribution and revisions |
| TX raw | Keep existing single bridge/writer | No CRU-37 collector | Preserve timestamp/native-sequence limitations |
| 2330 raw | Keep as Taiwan share price | No contribution derivation | Contribution remains unavailable |
| TWN/NQ/MNQ/ES/TSM ADR | None | No | `SOURCE_NOT_GOVERNED` / `UNAVAILABLE` |
| Top-10 weights/contribution | None | No | `METHODOLOGY_SOURCE_MISSING` |

## 3. Decision queue

### D1 — TWN source

Select whether to pursue SGX direct, an official named data vendor, or a broker API. Require a written non-display research-use determination, total cost, API fields, history, retention and audit obligations. Current recommendation: decide this first because future TWN intraday history is irrecoverable if not collected.

### D2 — US futures bundle

Decide whether NQ, MNQ, ES or a subset is required. NQ and MNQ are separate products; choosing MNQ for cost/liquidity/API reasons must remain explicit. Avoid paying for correlated feeds without a predeclared research question.

### D3 — Intraday FX

Choose the economic object first: interbank indicative spot, executable broker quote, official fixing, or futures. These are not interchangeable. Define pair convention, hours, holiday, bid/ask and stale semantics before vendor selection.

### D4 — Leadership methodology

Choose an effective-date TWSE/TAIEX index constituent/weight/divisor source whose historical and machine-use rights are clear. No contribution work begins from today’s weights applied backward.

### D5 — Storage and retention

Before any high-volume feed, approve local raw retention, expected daily volume, disk alerts, append-only partitions, hash manifests, corrections, backup and license-driven deletion obligations.

## 4. Dependency order

```text
OWNER_SOURCE_DECISION
→ LICENSE_AND_COST_EVIDENCE
→ IDENTITY / SESSION / ROLLOVER CONTRACT
→ RAW SCHEMA AND RECOVERY DESIGN
→ BOUNDED OFF-HOURS CONNECTIVITY TEST
→ FORWARD RAW COLLECTION
→ COVERAGE / QUALITY / AVAILABLE_AT AUDITS
→ DETERMINISTIC REPLAY
→ DESCRIPTIVE VALIDATION
→ OWNER PRODUCT REVIEW
```

No step may be skipped by backfilling a missed forward interval or treating a delayed webpage as a governed machine feed.

## 5. CRU-37 completion boundary

CRU-37 can be review-complete when the capability truth, source candidates, canonical time/identity contract, TWN–TX protocol, dashboard contract and this gap matrix have zero Level-2 blocking findings. That does not approve collection, source purchase, CRU-13 promotion, Market State changes, runtime sync, or trading.

Fixed safety boundary: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`.
