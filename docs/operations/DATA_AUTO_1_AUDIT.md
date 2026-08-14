# CRU-25 DATA-AUTO-1 — Collection Autostart & Data Health Audit

> Audit only. This document records observed runtime/data truth; it does not authorize implementation.
>
> Captured at: 2026-08-14 10:18 Asia/Taipei
>
> Approved implementation baseline inspected in the canonical runtime: `73c0f1548009648d2156dac6f906e6430ea91e9e`
>
> Latest fetched `origin/main` used for this document: `84fed987f469b06b87d6b4df49aa6ed4d8efc0cc`
> Safety: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`

## A. Executive summary

The system is usable every day **with explicit limitations**, but it is not yet safe to treat every green/fresh label as proof that collection is complete. Core TX/MTX/TMF Tick and BidAsk were live and writing at audit time, while the batch pipeline was only partially successful and had ended `FAILED` in four of the five most recent inspected runs. The greatest near-term risk is unrecoverable live-data loss after a bridge/network failure because the bridge exits on session-down and no continuously verified supervisor was observed to restart it during the same Windows login session.

## B. Owner data health matrix

Legend: AVAILABLE means current runtime/records support the claim; PARTIAL means the source exists but coverage, automation, lineage, or operational continuity is insufficient; MISSING means no actual records/runtime were found.

| Source | Reality | Automation | Coverage / latest evidence | Quality / owner meaning | Dashboard | Department readiness |
|---|---|---|---|---|---|---|
| TX executed Tick | PARTIAL | AUTO_START after Windows login; recovery PARTIAL | `TXFH6`; day and night events present; latest event current at audit | Live source exists, but native sequence is absent and timestamp lineage is insufficient; packet loss remains UNKNOWN | LIVE, chart QUALITY_INSUFFICIENT | USABLE_WITH_LIMITATIONS |
| TX five-level BidAsk | PARTIAL | AUTO_START after Windows login; recovery PARTIAL | `TXFH6`; current BidAsk events | Source exists and writes continuously; the same continuity caveats apply | LIVE | USABLE_WITH_LIMITATIONS |
| MTX Tick/BidAsk | PARTIAL | AUTO_START after Windows login; recovery PARTIAL | `MXFH6`; both kinds present | Same continuity and sequence limitations | LIVE | USABLE_WITH_LIMITATIONS |
| TMF Tick/BidAsk | PARTIAL | AUTO_START after Windows login; recovery PARTIAL | `TMFH6`; both kinds present | Same continuity and sequence limitations | LIVE | USABLE_WITH_LIMITATIONS |
| Actual contract | AVAILABLE | Derived at bridge login from `TXFR1/MXFR1/TMFR1` | `TXFH6/MXFH6/TMFH6` in actual events and readiness evidence | Contract identity is explicit; rollover still requires governed downstream handling | Exposed on chart/Data Health | READY_FOR_DAILY_USE |
| 2330 live price | PARTIAL | AUTO_START after Windows login | Current `stock_tick` records present | Price is available; it is **not** TSMC index-contribution points | Not a dedicated contribution card | USABLE_WITH_LIMITATIONS |
| IX0001 / TAIEX live quote | PARTIAL | AUTO_START after Windows login | Current `index_quote` records present after the open | Payload includes listed raise/fall counts, but the current intraday breadth product contract is not wired/frozen | EOD breadth shown instead | USABLE_WITH_LIMITATIONS |
| Weighted Top-10 constituents | MISSING | UNKNOWN | Only 2330 was subscribed; no Top-10 runtime set was found | Cannot calculate true constituent contribution | Not exposed | NOT_READY |
| True index contribution | MISSING | NONE | No effective-dated weights plus complete constituent price set | 2330 price must not be presented as contribution points | Not exposed | NOT_READY |
| TWSE/TPEX EOD breadth | AVAILABLE | SCHEDULED | 2026-08-13; official complete; available at 20:05 TPE | Suitable after official availability, not as live intraday breadth | STALE at audit time | READY_FOR_DAILY_USE |
| Institutional cash | AVAILABLE | SCHEDULED | Latest database trade date 2026-08-13 | EOD/batch context; not today-intraday evidence | STALE | READY_FOR_DAILY_USE |
| Futures OI / normalized near OI | AVAILABLE | SCHEDULED | 2026-08-13; 758 dates; near OI 92,571; scope `TX_MTX_TMF_EQUIVALENT` | Same-contract governed OI is clean; output report is mutable generated evidence | STALE/positioning | READY_FOR_DAILY_USE |
| Large trader futures | AVAILABLE | SCHEDULED | 2026-08-13; 758 distinct dates | EOD research context | Not separately exposed in Data Health | READY_FOR_DAILY_USE |
| Options EOD OI/PCR/strike/expiry | AVAILABLE | SCHEDULED | 2026-08-13; active weekly/monthly records present | Core tables have trade date but not a row-level `available_at`; use only under the governed EOD contract | FRESH label, but this reflects fetch time more than source trade date | READY_FOR_DAILY_USE after EOD |
| Options live chain/BidAsk | PARTIAL | MANUAL probe only | A 2026-07-30 bounded readiness probe found two-sided quotes; no continuous options events in the live ledger | Capability exists, daily live collection does not | Not exposed as live | RESEARCH_ONLY |
| Options IV / 25D skew | PARTIAL | SCHEDULED EOD derivation | 2026-08-13; calculated Black-76, `available_at=16:45` | Research-only calculated context; provider Greeks were not present | EOD options context | RESEARCH_ONLY |
| Provider Greeks / live Greeks inputs | MISSING | NONE | No provider Greeks and no continuous live chain | Library capability is not data availability | Not exposed | NOT_READY |
| SOX | AVAILABLE | SCHEDULED | EOD through 2026-08-13 | Overseas background only | Market overview/research | RESEARCH_ONLY |
| NDX proxy | AVAILABLE | SCHEDULED | EOD through 2026-08-13 | Explicit proxy; it is not NQ futures | Market overview/research | RESEARCH_ONLY |
| True NQ futures | MISSING | NONE | No NQ futures datasource or records found | NDX/QQQ/CFD must not be relabeled NQ | Not exposed | NOT_READY |
| US VIX | AVAILABLE | SCHEDULED | `market_daily.us_vix` through 2026-08-13 | EOD global background | Market overview | RESEARCH_ONLY |
| Taiwan VIX | AVAILABLE | SCHEDULED | 2026-08-13 | EOD TAIFEX volatility context | STALE at audit time | READY_FOR_DAILY_USE after EOD |
| USD/TWD | AVAILABLE | SCHEDULED | `global_market_daily` through 2026-08-14 | Daily context, not verified intraday FX | Market overview/research | RESEARCH_ONLY |
| Forward Shadow runtime truth | PARTIAL | STATE/OUTCOME tasks exist but old binding and `LastResult=1` | Latest official status remains 2026-08-12 MISSED | Observation only; task history was disabled, so historical invocation cause remains unknown | `READY_FOR_LAUNCH` plus runtime UNKNOWN / task status unavailable | NOT_READY as a green runtime indicator |

## C. Windows autostart map

```text
Windows boot
  └─ no verified boot service for Dashboard or Shioaji

Interactive user login
  └─ Startup\TwChipDashboard.lnk
      └─ scripts/start-dashboard-hidden.ps1
          ├─ startup recovery check for Daily Update
          ├─ start/reuse market-data-only Shioaji bridge (8790)
          └─ start formal Dashboard (8787)

Desktop double-click
  └─ 台股量化籌碼神器－正常使用.lnk
      └─ data/launchers/START_DAILY_USE.bat
          └─ scripts/start-daily-use.ps1
              ├─ reuse/start 8787
              ├─ reuse/start 8790
              ├─ read last batch status (does not run full Daily Update)
              └─ open 8787

Scheduled Tasks (interactive user context)
  ├─ TwChipDashboard-DailyUpdate 08:30 + 21:15
  │   ├─ StartWhenAvailable=true
  │   ├─ WakeToRun=false
  │   ├─ IgnoreNew
  │   └─ latest LastResult=1
  ├─ Forward Shadow STATE 08:25 (WakeToRun=true, old runtime binding, LastResult=1)
  ├─ Forward Shadow OUTCOME 14:00 (WakeToRun=true, old runtime binding, LastResult=1)
  ├─ P0 Forward Paper 08:35 (outside CRU-25; observed only)
  └─ V3.10 Frozen Forward 08:35 (outside CRU-25; observed only)
```

Task Scheduler Operational History was disabled, so `LastResult=1` cannot be assigned a precise historical root cause from event history.

### Machine-state behavior

| Situation | Detected | Recovered automatically | Visible to owner | Audit conclusion |
|---|---|---|---|---|
| Windows boot before login | PARTIAL | NO evidence | NO | Runtime starts at interactive login, not proven at boot |
| Late login | YES | Dashboard/bridge start then; scheduled task may run late | PARTIAL | StartWhenAvailable helps batch, but the market gap before login is permanent |
| PC sleep | PARTIAL | Forward tasks may wake; Daily Update will not wake PC | PARTIAL | Live stream cannot collect while suspended |
| PC wake | UNKNOWN | UNKNOWN | PARTIAL | No controlled current-session wake/reconnect evidence |
| Network/session loss | `session_down` recorded | Bridge exits; no persistent same-session watchdog observed | Health/log only | Manual launcher/restart is the known recovery path |
| Token/credential failure | YES at startup | NO automatic credential repair | Human launcher shows degraded/offline | Dashboard can remain usable from existing data |
| Bridge crash | Port/health loss detectable | NO continuous supervisor observed | PARTIAL | Potential permanent Tick/BidAsk gap |
| Dashboard crash | Health loss detectable | Manual daily launcher can restart | Human-visible only on use | No continuous dashboard watchdog observed |
| Writer error | Counter increments; writer continues | PARTIAL | Project status; not clearly surfaced in homepage Data Health | A failed write can permanently lose an event |
| Disk low/full | `lowDisk` exists in bridge health | NO evidence of automatic space recovery | Project status only | Low-disk warning is not first-class Dashboard truth |
| Duplicate process | YES | Prevented | Mostly hidden | Bridge mutex/port, launcher lock, and task `IgnoreNew` are positive controls |
| Night / cross-midnight | Data present; files rotate by local `receivedAt` calendar date | Downstream chart governs session trade date | Chart exposes session | Raw filename date is not itself the governed sessionTradeDate |

## D. Core TX runtime evidence

- At 10:18 TPE the bridge health endpoint was reachable on loopback 8790, `provider=shioaji`, `mode=market_data_only`, `executionAuthorized=false`, `orderRoutesEnabled=false`, `sessionDown=false`, and callback/writer/drop counters were zero.
- One Python bridge instance and one Dashboard instance were observed. The bridge owns a singleton port/mutex before login, which avoids consuming a second Shioaji connection.
- The live ledger was growing and already exceeded 600 MiB for 2026-08-14. A bounded 4 MiB tail, rather than a full-file scan, contained current TX/MTX/TMF Tick and BidAsk plus IX0001 and 2330.
- The preserved futures acceptance audit passed Tick+BidAsk for TX/MTX/TMF and a controlled restart/resubscribe exercise. This proves capability, not perpetual recovery for every future network event.
- On Shioaji session-down the current bridge records lifecycle evidence and exits with recovery guidance `restart_bridge_then_resubscribe`. Neither `launcher.mjs` nor the bridge starter continuously supervises and restarts that exited child.
- Ledger rotation is by local `receivedAt` calendar date. Governed DAY/NIGHT/cross-midnight identity is a downstream semantic and must not be inferred from the filename alone.
- The API payload exposed no native `sequence`, `seq`, or `tick_sn` in the inspected data. Therefore packet-loss certainty remains UNKNOWN; `sequenceGap=0` is not proof of no packet loss.

## E. EOD / batch actual state

`TwChipDashboard-DailyUpdate` runs at 08:30 and 21:15. The latest 08:30 run lasted about 13 minutes and finished `FAILED`, but 32 of 35 stages passed. Successful stages included institutions, futures positions/OI, large traders, options, breadth, global context, Taiwan VIX, normalized futures OI, volatility, basis, features, official validation, `available_at` audit, and ledger audit.

Latest failed stages:

1. `taifex`: 300.1-second timeout.
2. `quality`: exit/failure in 1.4 seconds.
3. `data_continuity_audit`: critical 300-second timeout; this set the overall run to failed.

This is a partial-success contract, not an all-or-nothing data result. The same continuity timeout appeared in the inspected 2026-08-13 morning/evening runs, while 2026-08-12 morning completed with warnings. There is no stage retry policy inside the inspected run; a later scheduled run or startup recovery is the next opportunity. Successful stage outputs persist even when a later critical stage fails.

At 10:18 on 2026-08-14, 2026-08-14 EOD data was not yet expected. Latest legal EOD date 2026-08-13 is therefore not itself a collection failure. The task failure and its failed stages remain an operational failure and must be shown separately from `NOT_YET_PUBLISHED`.

## F. Equity and contribution

- 2330 Tick and IX0001 quote sources were present live.
- The IX0001 payload includes listed raise/fall counts, but the current product uses EOD TWSE/TPEX breadth rather than a governed live-breadth contract.
- No Top-10/effective-weight datasource was observed.
- True index contribution is unavailable. A constituent's price move is not the constituent's contribution points.

## G. Options

- EOD contract totals, OI, volume PCR/OI PCR, strike structure, expiry, and Max Pain exist through 2026-08-13.
- EOD calculated ATM IV, 25D skew, and IV/RV spread exist with explicit `available_at=16:45` and research-only lineage.
- Continuous live options Tick/BidAsk were not found in the current ledger. The 2026-07-30 readiness probe demonstrated bounded quote access, not daily autostart.
- Provider Greeks were absent. No UI or contract may upgrade theoretical-library capability into AVAILABLE provider Greeks.

## H. Overseas

- SOX and NDX are daily overseas context. NDX is explicitly `NDX_PROXY` in Market State and is not true NQ futures.
- True NQ futures are MISSING.
- US VIX and USD/TWD are daily context. Intraday USD/TWD was not verified.

## I. Data quality and `availableAt`

| Dimension | Observed truth |
|---|---|
| event time | Present in normalized live-event evidence, although selected payload inspection showed the raw provider fields rather than a universal top-level field |
| receivedAt | Present for live events and used for ledger rotation |
| availableAt | Not a raw live-event field; the chart derives effective availability. Several EOD canonical tables have governed availability, while `market_daily`, options contract/strike, futures OI, and global daily rows do not all carry row-level `available_at` |
| timestamp lineage | `receivedAt < exchangeTimestamp` occurs frequently due host/provider clock skew; chart remains available through effective availability, while quality stays `QUALITY_INSUFFICIENT / TIMESTAMP_LINEAGE_INSUFFICIENT` |
| native sequence | UNAVAILABLE in inspected TX payloads |
| packet loss certainty | UNKNOWN; no native sequence means neither true loss nor no-loss can be proven |
| duplicates/hash failures | Zero in the current/preserved audited samples |
| contract rollover | Actual contracts are explicit; Market State OI uses same-contract guard and rollover skip |
| missing/stale | Must distinguish not-yet-published EOD from failed collection and from old-but-legal data |
| proxies | NDX is a proxy; it must not be relabeled NQ futures |

## J. Dashboard truth audit

### Correct

- Formal 8787 was reachable and explicitly read-only/no broker credentials.
- TX/MTX/TMF Tick and BidAsk were shown LIVE and matched current runtime evidence.
- Actual contracts matched runtime evidence.
- TX chart, DAY VWAP, and Opening Range were visible; chart quality remained `QUALITY_INSUFFICIENT`, correctly preserving timestamp-lineage uncertainty.
- Estimated CVD, order-book pressure, and RVOL correctly separate `SOURCE_AVAILABLE` from `DERIVATION_NOT_IMPLEMENTED` in technical detail.
- `NO_TRADE` remains first-class when decision evidence is unavailable.

### False green / ambiguous

- Batch `FRESH` is calculated from fetch time (`fetchedAt`) rather than consistently from source trade date plus governed publication time. Options/futures can therefore look fresh even though their legal EOD trade date is 2026-08-13.
- The header shows `READY_FOR_LAUNCH` while the same page reports Forward runtime UNKNOWN and task status unavailable. The launch manifest state is not equivalent to operational scheduler readiness.
- The page does not surface that the Daily Update task ended `FAILED` or name the three failed stages.

### Hidden or underexposed failures

- Writer errors, disk pressure, bridge process continuity, task `LastResult`, task history unavailability, and current Daily Update stage failures are not first-class Data Health rows.
- The live IX0001/2330 sources are not explicitly separated from missing contribution derivations.
- Data Health calls EOD sources READY without consistently explaining legal publication timing and current source trade date.

## Source Health Contract V1 design

Every source should expose one allowlisted read-only record. Unknowns stay null/UNKNOWN; no raw health payload or secret is copied.

```json
{
  "sourceId": "string",
  "sourceName": "human label",
  "category": "CORE_TX|TW_EOD|EQUITY|OPTIONS|OVERSEAS|OPERATIONS",
  "market": "TAIFEX|TWSE|TPEX|GLOBAL|null",
  "instrumentScope": "string|null",
  "collectionType": "LIVE|BATCH|REPLAY|MANUAL|UNKNOWN",
  "availability": "AVAILABLE|PARTIAL|MISSING|UNAVAILABLE|UNKNOWN",
  "startupMode": "AUTO_START|MANUAL|SCHEDULED|UNKNOWN",
  "reconnect": "AUTO_RECONNECT|MANUAL_RECOVERY|NONE|UNKNOWN",
  "sessionCoverage": "object|null",
  "tradeDateCoverage": "object|null",
  "latestRecord": "ISO timestamp/date|null",
  "latestSuccessfulTradeDate": "YYYY-MM-DD|null",
  "eventTimeSupport": "YES|NO|PARTIAL|UNKNOWN",
  "receivedAtSupport": "YES|NO|PARTIAL|UNKNOWN",
  "availableAtSupport": "YES|NO|PARTIAL|UNKNOWN",
  "sequenceSupport": "NATIVE|DERIVED|NONE|UNKNOWN",
  "qualityState": "PASS|QUALITY_INSUFFICIENT|STALE|UNAVAILABLE|UNKNOWN",
  "staleThreshold": "governed value or null",
  "knownFailureMode": ["bounded reason codes"],
  "currentRuntimeHealth": "PASS|DEGRADED|FAILED|UNAVAILABLE|UNKNOWN",
  "schedulerHealth": "PASS|DEGRADED|FAILED|NOT_APPLICABLE|UNKNOWN",
  "dashboardExposure": "FULL|PARTIAL|NONE",
  "forwardShadowDependency": "REQUIRED|NON_REQUIRED",
  "marketStateDependency": "CURRENT_RESEARCH_INPUT|FUTURE_CANDIDATE|NOT_USED",
  "researchOnly": true,
  "executionAuthorized": false
}
```

## K. Forward Shadow dependency

Forward Shadow remains OBSERVATION ONLY.

### Required for legal STATE

- Canonical SQLite and the exact previous governed official trade-date source row.
- TAIFEX governed calendar and previous-governed-date resolution.
- Frozen Market State feature specification, evaluator, hashes, manifest/approval/recovery binding.
- EOD canonical inputs consumed by the frozen Market State adapter: local price context, TWSE breadth, institutional cash, same-contract near OI and basis, options EOD/volatility, NDX/SOX proxy block, and USD/TWD, each under its frozen `availableAt` contract.
- Scheduler/runtime binding and premarket decision boundary observability.

### Non-required for legal premarket STATE

- Current-day live TX Tick/BidAsk, MTX/TMF, live options chain, CVD, order-book pressure, RVOL, Top-10 contribution, and true NQ futures.
- Daily Update stages unrelated to the frozen canonical inputs. Their failures remain operational debt but must not be invented as a blocker without dependency evidence.

Outcome collection has its own later legal source/window and cannot be written when no legal STATE exists. No backfill or manual STATE was performed in this audit.

## L. Market State dependency

Because Market State V1 has `formalWeight=0` and remains research-only, **none of these sources is a product-formal trading input**.

### CURRENT_RESEARCH_INPUT

- TAIEX/TX five-observation return persistence.
- TWSE breadth.
- Foreign cash flow.
- TX return plus same-contract `near_contract_oi` (`TX_MTX_TMF_EQUIVALENT`), rollover flags, and close basis.
- Options ATM IV, 25D skew, OI PCR, volume PCR, and call/put OI structure.
- NDX proxy plus SOX as one US-growth block.
- USD/TWD daily context.
- VIX remains blocked where frozen `availableAt` support is not legal; the audit does not promote it.

### FUTURE_CANDIDATE (no promotion authorized)

- Estimated CVD/aggressive-flow proxy, BidAsk pressure, live Top-10 contribution, intraday USD/TWD, true NQ futures, and intraday options IV/skew.

### NOT_USED in frozen V1

- Provider Greeks, GEX/DEX, dealer-position claims, strategies, broker/order state.

## M. Top five gaps

| Priority | Gap | Impact | Permanent loss risk | Dashboard | Market State | Forward Shadow | Cost |
|---|---|---|---|---|---|---|---|
| 1 | No continuously verified same-session supervisor for the Shioaji bridge after session-down/crash | TX/MTX/TMF/2330/IX data may stop silently until manual restart | YES | Chart/live evidence degrades | Historical V1 not immediately blocked | Not required for premarket STATE | MEDIUM |
| 2 | Daily Update repeatedly finishes failed; continuity audit times out and TAIFEX/quality stages also failed in latest run | Owner cannot tell which EOD sources are complete; future missing rows are possible | MEDIUM | Failure hidden | Can block later source freshness | Can block if a required canonical source is missing | MEDIUM |
| 3 | Data Health freshness conflates fetch time, source trade date, and legal publication time | False-green FRESH and misuse of prior-day EOD as today-intraday evidence | NO | YES | Evidence legality risk if reused incorrectly | Evidence legality risk | MEDIUM |
| 4 | No native sequence and persistent timestamp-lineage violations | Packet loss cannot be proven; chart quality stays insufficient | UNKNOWN | QUALITY_INSUFFICIENT | Not a frozen V1 source | Not required for premarket STATE | LARGE/Owner decision |
| 5 | Missing true NQ, Top-10 contribution, and continuous live options chain/Greeks | Planned context remains unavailable | YES for uncollected intraday history | Missing features | Future only | Non-required | LARGE |

## N. Top three implementation candidates

### 1. Core Market-Data Continuity & Recovery Hardening

- Purpose: prevent permanent live Tick/BidAsk loss after bridge/network/process failure.
- Scope: supervise only the existing market-data-only bridge; bounded restart/backoff; session-aware health; preserve singleton, exact subscriptions, and execution/order-route locks; surface recovery state.
- Why now: missed live data cannot be recreated tomorrow.
- Dependencies: existing bridge health/lifecycle ledger and Windows login/startup architecture.
- Risk: restart loops and duplicate Shioaji connections unless singleton and backoff are tested.
- Size: MEDIUM.
- Done: controlled disconnect/crash fixtures recover exactly one read-only bridge; no duplicate subscription/login; downtime and reason visible; no order route.

### 2. TAIFEX Daily Update Reliability & Stage Truth

- Purpose: make scheduled batch completion/retry/partial-success state dependable.
- Scope: diagnose the three observed failures, bound continuity audit runtime, define retry/idempotency, keep successful stages, expose per-stage truth.
- Why now: recent runs repeatedly finish failed despite most data succeeding.
- Dependencies: stage contracts, task logs, SQLite read-only validation, publication timing.
- Risk: an unsafe retry could duplicate or overwrite data if stage idempotency is not proven.
- Size: MEDIUM.
- Done: repeated scheduled runs complete or explicitly degrade; each source reports latest legal date, publication state, and failure reason.

### 3. Unified Source Health Contract & Dashboard Truth

- Purpose: remove false green and make source date/runtime/task failures understandable.
- Scope: implement the allowlisted contract above and map it into Data Health without changing decision semantics.
- Why now: current UI hides batch task failure and mixes fetch freshness with data freshness.
- Dependencies: source-specific stale/publication contracts and scheduler/bridge status adapters.
- Risk: misleading defaults if UNKNOWN is coerced to PASS.
- Size: MEDIUM.
- Done: source rows distinguish source availability, derivation readiness, legal publication, runtime health, and scheduler health; UNKNOWN stays unknown.

## O. Recommended next implementation — exactly one

**Core Market-Data Continuity & Recovery Hardening**.

This is first because the missing interval from a stopped live bridge is irrecoverable and affects every future intraday derivation. The package must not add sources or features; it only makes the already-approved market-data-only runtime single-instance, bounded-restart, and visibly supervised.

## P. Why not the other two first

- Daily Update reliability is second because successful EOD stages persist and official data can normally be rerun; it is serious but less irrecoverable than a lost live stream.
- Unified Data Health is third because observability is essential, but truthful red/yellow status does not itself prevent the underlying Tick loss. The recommended package should include only the minimum recovery-state visibility needed to validate continuity; the full unified contract remains separate.

## Q. Not now

No DW-4, CVD productization, BidAsk pressure, large-trade detector, evidence-conflict engine, Greeks/GEX/DEX, strategy/risk engine, paper trading, broker integration, automated trading, Market State retuning, Forward Shadow repair, or new collector is authorized by this audit.

## R. GitHub

This audit document is isolated on `codex/cru-25-data-auto-audit`. Draft PR only; merge is not authorized.

## S. Linear

The Linear connector was not available in the current Codex environment. CRU-25 was **not** updated, and no duplicate issue was created.

## T. Owner decision required

Product Owner decision requested: approve or reject **Core Market-Data Continuity & Recovery Hardening** as the next implementation package. No implementation starts from this document alone.
