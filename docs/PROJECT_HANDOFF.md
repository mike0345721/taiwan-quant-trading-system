# Project Handoff V1

> Captured at: 2026-08-13 (Asia/Taipei)
> Document role: a status and handoff checkpoint. It is not a roadmap and does not authorize development.

## Project identity

- Repository: `mike0345721/taiwan-quant-trading-system`
- Canonical local repository: `D:\Taiwan stock\standalone-v1`
- Scope authority: `ROADMAP.md`
- Final approval authority: Product Owner

`ROADMAP.md` is the scope authority. `PROJECT_HANDOFF.md` reports the observed project state at a checkpoint. `PROJECT_HANDOFF.md` does **not** authorize CURRENT, NEXT, FUTURE, implementation, research, promotion, paper trading, or execution work.

## Current main

- Product Owner identified the latest approved merge as PR #19, merge commit `c0a8c0f52e1fdd8894f0735beb1f8566ebb9eafc`.
- PR #19 preserves the governed TX chart under local timestamp skew by using `effectiveAvailableAt = max(receivedAt, exchangeTimestamp)` for chart availability.
- The underlying lineage warning remains visible: `QUALITY_INSUFFICIENT` and `TIMESTAMP_LINEAGE_INSUFFICIENT`. This is not a claim that timestamp lineage is repaired.
- GitHub was authenticated and `origin/main` was verified as `c0a8c0f52e1fdd8894f0735beb1f8566ebb9eafc` at this capture. Run `npm run project:status` after future authenticated fetches to verify the current local `origin/main` value rather than relying on this checkpoint.

## Local state

- Captured branch: `hotfix/dw2-timestamp-lineage-effective-available-at`
- Captured HEAD: `8e6c6c57837de20305fb31bef75a825cdc2360ca`
- Protected dirty path: `v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md`
- The protected report is Product Owner work in progress. Do not stash, restore, reset, overwrite, delete, or include it in another work package.

Local branch, HEAD, remote-tracking ref, ahead/behind counts, and dirty paths are transient. Re-run the read-only status tool for the current values:

```powershell
npm run project:status
npm run project:status -- --json
```

## Current capabilities

Only capabilities already present in approved code or governed runtime evidence are listed here:

- Chinese-first Decision Workspace with `NO_TRADE` as a first-class state and no execution authorization.
- Governed actual-contract TX candlestick chart for 1m, 5m, 15m, 30m, 1h, 4h, and Owner-frozen 1D NIGHT+DAY trade-date semantics.
- DAY Opening Range, session-only VWAP, prior DAY replay levels, quality lineage, and Data Health presentation.
- Read-only Shioaji market-data bridge on loopback port 8790 with no order routes.
- Local official/batch data, SQLite research store, append-only live-event ledgers, and bounded/auditable research tooling.
- Governed Forward Shadow runtime and daily status evidence. It remains research-only and does not authorize trading.
- Normal daily-use launcher for the formal local Dashboard on `127.0.0.1:8787`.

## Open work

- PR #18 — **DW-3: Market Change Feed V1**: Draft; Product Owner merge approval pending.
- PR #18 is not part of approved `main`. It still requires alignment with current main, regression verification, visual review, and an explicit Product Owner merge decision.
- PROJECT HANDOFF V1 must not merge, expand, or otherwise modify PR #18.

## Known issues and watch items

- Timestamp lineage: `receivedAt < exchangeTimestamp` is observed in local evidence. Chart availability uses the governed effective timestamp hotfix while retaining `TIMESTAMP_LINEAGE_INSUFFICIENT`.
- Native TX sequence: unavailable in the audited payload; true TX tick loss remains unknown and must not be guessed.
- DW-2 timeframe switching: **WATCH** — previously observed at roughly 5–10 seconds; the 2026-08-13 Product Owner retest materially improved. No optimization is currently authorized. Open a separate diagnosis only if repeated switching remains over five seconds, first load becomes abnormal, or production usability degrades.
- Older repository status documents may lag approved UI/runtime work. Code, immutable evidence, tests, Product Owner decisions, and `ROADMAP.md` retain their stated authority.

## Current authorized task

`PROJECT HANDOFF V1` only:

- establish this checkpoint document;
- add a fast, bounded, fail-closed, read-only local status command;
- add the minimum regression coverage for those two deliverables.

No trading feature, DW-2 performance hotfix, DW-3 expansion, Market State retuning, or Forward Shadow semantic change is authorized by this task.

## Next Owner decision

The next decision for this work package is Product Owner review of the PROJECT HANDOFF V1 Draft PR. PR #18 has its own separate review and merge decision; this handoff document cannot approve it.

## Status tool contract

`npm run project:status` observes, but never starts or repairs, local services and evidence. It reports:

- Git branch, HEAD, local `origin/main`, ahead/behind, and dirty paths without network fetch;
- Dashboard 8787 health using a response allowlist;
- Shioaji 8790 market-data-only health using a response allowlist, with governed expected safety shown separately from allowlisted observed runtime booleans; unsafe or missing values fail closed;
- latest live-event ledger metadata and a fixed-size tail scan for the latest usable actual-contract TX tick;
- SQLite existence/size and one read-only latest-date query when available;
- validated Forward Shadow manifest/approval plus the latest small daily-status record, never the full official ledger;
- bounded quality observations, returning `UNKNOWN` or `UNAVAILABLE` instead of inventing a pass.

The command never dumps credentials or arbitrary health responses. It does not fetch Git, start Dashboard/Shioaji, read an entire multi-gigabyte ledger, write Forward Shadow evidence, or mutate production data.

## Safety invariants

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`
- No broker/order route, BUY/SELL signal, automated trading, paper trading, Strategy Router promotion, or trading-grade Risk Engine.
- No raw append-only ledger mutation.
- Missing or inaccessible evidence remains `UNKNOWN` or `UNAVAILABLE`.

Survival > win rate > return.
