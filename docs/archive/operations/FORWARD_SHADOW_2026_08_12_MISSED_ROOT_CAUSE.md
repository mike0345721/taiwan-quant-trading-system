# Forward Shadow 2026-08-12 MISSED Root-Cause Record

> Captured: 2026-08-13 Asia/Taipei
> Scope: evidence-preserving diagnosis, forward-only defect repair and operational observability.
> This record does not authorize backfill, research promotion or execution.

## Official disposition

- Forward trade date: `2026-08-12`
- Governed session identity: `2026-08-12-DAY`
- Official status: `MISSED`
- Official reason: `NO_LEGAL_PREMARKET_SNAPSHOT`
- Scheduled STATE time: `2026-08-12T08:25:00+08:00`
- Official administrative record time: `2026-08-12T00:27:15.177Z` (`08:27:15.177 Asia/Taipei`)
- OUTCOME: `NOT_WRITTEN`
- DAILY_COMPLETE: `false`
- Backfill performed: `false`

The date is the governed Forward Shadow `tradeDate` / DAY `sessionTradeDate`. It is not the physical ledger filename date and not the prior NIGHT-session start date.

## Evidence chain

| Evidence | SHA-256 / governed hash | Finding |
|---|---|---|
| Runtime launch manifest (physical bytes) | `454197228984c576b179e7f1065a4a00f5cb1907a831159a0b25d1fdee65b560` | Immutable recovery runtime, official start `2026-08-11`, recovery effective `2026-08-12` |
| Runtime manifestHash | `81e561900563c5fa371560be12a55ab57dfb596fff4726dfc6b9a120a9292198` | Governed manifest identity |
| Owner recovery approval (physical bytes) | `234f2425c83d897520adefe43fed28fd2f3c66fedd16fffe8ad6bd4317687942` | `APPROVED` |
| 2026-08-12 official daily STATE status | `ad813beb26fa3ef5a4e338c098e7309acb63030522d2b6382952286f39cb4a76` | Lifecycle stopped at input availability and appended `SESSION_STATUS` |
| 2026-08-12 official record | `b51f15f6ce8f2bb060149f446043357e727c0fc85c961cea0f6839901923eadf` | `MISSED / NO_LEGAL_PREMARKET_SNAPSHOT` |
| Official ledger | `a4e94806a2d8cbf3d71a2fb196a8b1354534aa25753370c0c131ff0f4f3c0eb8` | Contains the same immutable administrative record |

The operational second copy contains byte-identical evidence. No 2026-08-12 Outcome or DAILY_COMPLETE evidence exists. These artifacts are read only and were not changed by this work package.

## Root cause

Classification: `DATE_MAPPING_DEFECT / PREMARKET_DECISION_DATE_NOT_MATERIALIZED`.

The Forward collector asked the historical canonical adapter for a row whose `decisionTradeDate` equalled the current governed trade date. The canonical builder derives its decision-date universe only from `market_daily.trade_date`. At `08:25`, the current trade date's end-of-day `market_daily` row cannot legally exist yet, even though every input used for the premarket decision comes from the previous governed trade date. Consequently no current-day canonical record was materialized, and the observer correctly failed closed with `NO_LEGAL_PREMARKET_SNAPSHOT`.

The forward-only repair now obtains the immediately previous governed TAIFEX trading date and materializes the current decision-date identity in memory. It does not write SQLite, alter historical Market State semantics, skip to an older source date, or backfill official evidence. The observer also waits for the existing canonical `08:30 Asia/Taipei` decision boundary before it can freeze a state, while retaining the approved scheduler start at `08:25` and the `08:45` observation deadline.

## Scheduler evidence boundary

An early restricted-context query could not read either task, and Task Scheduler Operational history was disabled. A later elevated, read-only recheck on 2026-08-13 found both tasks present, enabled and `Ready` under Windows user `user`. STATE last ran at `08:35:09` with result `1` and was next due at `2026-08-14 08:25`; OUTCOME last ran at `14:00:00` with result `1` and was next due at `2026-08-14 14:00`. Both target the governed wrapper in the canonical repository and the recovery manifest/approval paths.

Neither the present task definitions nor the current last-result values establish what invoked the observer on 2026-08-12. The official record proves that the governed observer path executed at 08:27; the historical invocation mechanism (Scheduled Task versus manual invocation) remains `UNKNOWN_INSUFFICIENT_EVIDENCE`.

The canonical checkout currently remains on `hotfix/dw2-timestamp-lineage-effective-available-at` at `8e6c6c57837de20305fb31bef75a825cdc2360ca`, nine commits behind `origin/main` `8588c94af4f6ac8aa0dfa3b25607fd2f271f9ba6`. The immutable runtime remains bound to `0a85ab873b3a5a05080a3937679b48ada2ce41d6`. This proves current `LOCAL_RUNTIME_VERSION_DRIFT`; without a matching Owner-approved runtime recovery binding it can make future task runs fail closed. No retained 8/12 log ties this current drift to the 8/12 MISSED, so it is not the historical primary root cause.

The installer now verifies that both registered tasks persist, are enabled, have one governed action, use the exact working directory, and remain bound to the exact manifest and approval artifact. Installation, rebinding or activation is not performed by this Draft PR.

## Dashboard / operations interpretation

The official 2026-08-12 explanation is:

- status: `MISSED`
- reasonCode: `NO_LEGAL_PREMARKET_SNAPSHOT`
- human summary: `盤前合法 Market State 快照未建立`
- last successful stage: `TRADING_DAY_CHECK`
- failed stage: `INPUT_AVAILABILITY_CHECK`
- evidence source: `OFFICIAL_APPEND_ONLY_LEDGER`
- historical scheduler state: `UNKNOWN`

Unknown or malformed evidence must render `UNKNOWN_INSUFFICIENT_EVIDENCE`; it must not be converted to a guessed failure reason.

## Safety boundary

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`
- No 2026-08-12 STATE or OUTCOME was recreated.
- No official ledger, manifest, backup, raw market evidence, Market State semantics, Forward Gate, T0, P0, broker or order route was modified.
