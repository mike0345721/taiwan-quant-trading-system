# Cross-Market Capability Audit V1

> Work package: CRU-37
> Baseline: `223b24d3bfc9f2249ce3b0153f794ae520823f2c`
> Audit date: 2026-09-04 Asia/Taipei
> Status: RESEARCH / DESIGN ONLY

## 1. Verdict

The repository has a useful daily global-context seed, but it does not yet have a governed cross-market intraday foundation. `SOX`, `NDX` and `USDTWD` daily rows exist; `NDX` is explicitly a cash-index proxy and must never be called NQ. There is no canonical TWN, NQ/MNQ, ES, or TSM ADR series. The existing daily schema records import time and payload hash at run level, but not row-level `eventTime`, `receivedAt`, or `availableAt`.

No source was activated, no account was opened, no data was downloaded, and no historical gap was backfilled in this audit.

## 2. Evidence method

The classification vocabulary is intentionally limited to:

- `AVAILABLE`: the named identity exists locally and is usable for its explicitly limited cadence and role.
- `PARTIAL`: some raw data, lineage, cadence, or semantics exist, but at least one required contract dimension is absent.
- `MISSING`: no governed local data source or canonical records were found.
- `DEPRECATED_NOT_GOVERNED`: an artifact exists but is not an approved source for this contract.

Tracked-code search, schema inspection, provider implementation, existing governance audits, and a read-only query of local `v2/data/research-v2.sqlite` were used together. File modified time was not treated as proof of observation or availability.

`AVAILABLE` in this repository audit means locally present under the existing research role. It does not establish that a source may be newly redistributed, repurposed, retained under a different product, or used for automated non-display processing beyond already governed scope. Those license dimensions are reported separately and remain `NOT_VERIFIED` where no persisted agreement was found.

## 3. Current capability matrix

| Capability | Status | Source / frequency | Local evidence | Timestamp / session truth | History / live | Quality / replay / formal eligibility |
|---|---|---|---|---|---|---|
| SGX FTSE Taiwan Index Futures (`TWN`) | `MISSING` | No integrated provider | No tracked TWN/SGX identifier and no canonical rows | No event, receive, availability, SGX T/T+1, expiry, or rollover contract | None | Licensing and source entitlement not verified; not replayable; formal use prohibited |
| TAIFEX TAIEX Futures (`TX`) | `PARTIAL` | Shioaji Tick/BidAsk, live DAY+NIGHT | Existing single market-data-only bridge and append-only ledger | `eventTime`/`receivedAt` present in normalized evidence; no native sequence; timestamp-lineage failures are known; governed DAY/NIGHT trade-date logic exists | Forward raw exists; audited history is source-dependent | Raw descriptive research only where quality permits; no independent vote created by CRU-37 |
| CME E-mini / Micro E-mini Nasdaq-100 (`NQ` / `MNQ`) | `MISSING` | No integrated CME or licensed vendor feed | No contract/expiry/rollover records | No CME session or availability contract | None | `NDX` is not a substitute; not replayable or formally eligible |
| Nasdaq-100 cash index proxy (`NDX`) | `AVAILABLE` | Yahoo historical chart, daily | `global_market_daily`; local rows 2023-06-01 through 2026-09-03 | Provider exchange date only; import `fetched_at` and payload hash exist; no row-level availability | Historical daily, not live | `PROXY_ONLY`; research context; cannot be renamed NQ |
| PHLX Semiconductor Index (`SOX`) | `AVAILABLE` | Yahoo historical chart, daily | `global_market_daily`; local rows 2023-06-01 through 2026-09-03 | Same daily limitations as NDX | Historical daily, not live | Research context only; index-data entitlement for a replacement feed would need separate verification |
| USD/TWD daily | `AVAILABLE` | Yahoo historical chart, daily | `global_market_daily`; local rows 2023-06-01 through 2026-09-04 | Provider exchange date; run-level fetch/hash only | Historical daily | Daily research context only; not an intraday FX quote |
| USD/TWD intraday | `MISSING` | No authorized integrated source | No canonical intraday FX records | Bid/ask, source time, receive time, hours and stale policy absent | None | Not eligible |
| E-mini S&P 500 (`ES`) | `MISSING` | No integrated source | No canonical records or identity | No CME session, expiry or rollover contract | None | Not eligible |
| VIX daily / delayed | `PARTIAL` | FRED `VIXCLS` daily close; dashboard may also expose a delayed provider quote | Local FRED rows 2023-06-01 through 2026-09-02 | FRED observation date and import fetch/hash exist; no universal row-level publication/availability timestamp | Daily historical plus separate delayed display context | Sources/cadences must remain distinct; copyrighted series attribution applies; no intraday feed is governed |
| TSM ADR (`TSM`) | `MISSING` | No integrated US equity feed | No canonical ADR series | No US session or availability contract | None | Must remain distinct from Taiwan `2330` |
| Taiwan Semiconductor (`2330`) raw price | `PARTIAL` | Existing Shioaji stock Tick | Existing live subscription evidence | Taiwan DAY only; existing live timestamp-quality limits apply | Forward raw | Price is not index contribution and is not ADR evidence |
| Top-10 membership / weights | `MISSING` | No governed effective-date source | Existing audits identify a source gap | Effective dates, corporate actions and methodology absent | None | No contribution computation is eligible |
| TSMC / Top-10 index contribution | `MISSING` | Requires governed prices, effective weights and index methodology | No canonical output | Divisor and effective-time semantics absent | None | A price return must not be presented as contribution points |
| `global_market_daily` storage | `PARTIAL` | Yahoo daily ingestion | Symbols: COPPER, GOLD, NDX, SOX, USDTWD | `trade_date`, run `fetched_at`, source and payload hash exist; no row `eventTime`/`receivedAt`/`availableAt` | Historical daily | Deterministic values can be rebuilt from retained payloads, but historical decision-time eligibility is not proven by fetch time alone |
| Market State global evidence | `PARTIAL` | NDX proxy + SOX + USD/TWD; VIX availability separately constrained | Existing frozen/global block treats correlated inputs as one block | Strict past-only rules exist, but each source still needs legal `availableAt` evidence | Historical research | No CRU-37 promotion, weight change, strategy permission, or execution authority |

## 4. Read-only local database snapshot

Observed on 2026-09-04 from the runtime SQLite opened with `mode=ro`:

| Series | Rows | First source date | Last source date | Distinct source runs referenced by current rows |
|---|---:|---|---|---:|
| COPPER | 826 | 2023-06-01 | 2026-09-03 | 6 |
| GOLD | 825 | 2023-06-01 | 2026-09-03 | 6 |
| NDX | 818 | 2023-06-01 | 2026-09-03 | 1 |
| SOX | 818 | 2023-06-01 | 2026-09-03 | 1 |
| USDTWD | 848 | 2023-06-01 | 2026-09-04 | 2 |
| FRED VIXCLS | 850 | 2023-06-01 | 2026-09-02 | 1 |
| Taiwan VIX | 107 | 2026-04-01 | 2026-09-03 | 6 |

The run table had 87 Yahoo import attempts **per symbol** for NDX, SOX and USDTWD (261 across those three symbols), yet the current upserted NDX/SOX rows reference one source run each. This is valid current-row provenance, but it is not a complete bitemporal history of what each earlier decision knew.

Read-only snapshot evidence:

```text
database: D:\Taiwan stock\standalone-v1\v2\data\research-v2.sqlite
observedAt: 2026-09-04T20:41:00.1963860+08:00
sizeBytes: 631033856
sha256: 834F051949E24467ACA6615866AA3691E3D581BE9904ECDDDDC8124DCBA6D328
open mode: SQLite URI mode=ro
query family: grouped COUNT/MIN/MAX/COUNT(DISTINCT source_run_id)
tables: global_market_daily, global_import_runs, macro_observations, volatility_relative_daily
```

The database hash identifies this observed local snapshot; it is not added to Git and does not freeze or modify the runtime database.

## 5. Provider inventory

| Provider / source | Present | Governed role | Important limitation |
|---|---|---|---|
| Shioaji | Yes | Taiwan market-data-only raw collection | Current scope does not prove SGX/CME/US equity or FX entitlements; no broker/order use is authorized |
| Yahoo historical chart | Yes | Daily overseas research context | Non-official daily source; no row-level legal availability; not a true futures feed |
| FRED | Yes | Daily/monthly macro observations | Publication revisions and per-series copyright/attribution remain source-specific |
| TAIFEX official batch/calendar | Yes | Taiwan derivatives reference/EOD and governed calendar | Does not supply SGX TWN or CME NQ |
| SGX direct or licensed vendor | No | Candidate only | Entitlement, non-display license, API, cost and retention are unverified |
| CME direct or licensed vendor | No | Candidate only | Entitlement, contract identity, session and rollover are unimplemented |
| US equity/index licensed feed | No | Candidate only | TSM ADR, intraday SOX and ES/VIX feed identities are unimplemented |

## 6. Evidence anchors

- Repository schema and importer: `v2/migrations/005_global_market_context.sql`, `v2/migrations/006_macro_environment.sql`, `v2/src/global-context.mjs`, `v2/src/macro-environment.mjs`.
- Existing source-gap truth: `docs/data/DW4_DATA_REQUIREMENTS_AND_COLLECTION.md`, `docs/operations/DATA_AUTO_1_AUDIT.md`, `docs/research/MARKET_STATE_V1_PREMARKET.md`, `docs/research/MARKET_STATE_V1_DATA_COLLECTION.md`.
- SGX identifies TWN as an SGX FTSE Taiwan Index Futures contract with T and T+1 sessions: [SGX product page](https://www.sgx.com/derivatives/products/twnfc?cc=MTWN).
- SGX states that automated and quantitative use of real-time market data is non-display usage subject to declaration, licensing and applicable fees: [SGX Market Data Policy, effective 1 July 2026](https://cdn.databp.com/tenants/sgx/documents/2ae33c20-3d4c-11f1-9fd6-43b28f5cb868/Singapore%20Exchange%20Limited%20(SGX)%20Market%20Data%20Policy%20(Effective%201%20July%202026).pdf).
- CME distinguishes MNQ and NQ as futures products with different multipliers: [CME Nasdaq-100 futures](https://www.cmegroup.com/markets/equities/nasdaq/nasdaq-futures.html).
- Nasdaq identifies SOX as a 30-component modified market-capitalization-weighted index and marks its data entitlement: [Nasdaq SOX overview](https://indexes.nasdaq.com/Index/Overview/SOX).
- FRED labels VIXCLS as a copyrighted Cboe daily close series: [FRED VIXCLS](https://fred.stlouisfed.org/series/VIXCLS).

## 7. Safety conclusion

`formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, and `orderRoutesEnabled=false` are mandatory for every CRU-37 artifact. This audit does not alter T0, P0, Frozen Market State, any strategy parameter, any live ledger, or any runtime collector.
