# Project Handoff V1

> Captured at: 2026-08-13T23:44:43+08:00 (Asia/Taipei)
> Document role: durable status and handoff checkpoint. It is not a roadmap and does not authorize development.

## Project identity

- Repository: `mike0345721/taiwan-quant-trading-system`
- Canonical local repository: `D:\Taiwan stock\standalone-v1`
- Scope authority recorded by this checkpoint: `ROADMAP.md`
- Final approval authority: Product Owner

`ROADMAP.md` defines the repository's CURRENT / NEXT / FUTURE scope at this checkpoint. `PROJECT_HANDOFF.md` records what was actually observed. `npm run project:status` observes transient local state. None of these documents or tools independently authorize implementation, research promotion, paper trading, or execution.

## Current approved main

- `origin/main`: `8588c94af4f6ac8aa0dfa3b25607fd2f271f9ba6`
- Latest approved merge: PR #18, **DW-3: Market Change Feed V1**
- PR #18 state at capture: `CLOSED`, `MERGED`, merge commit `8588c94af4f6ac8aa0dfa3b25607fd2f271f9ba6`
- PR #20 supplies the bounded, read-only Project Handoff status foundation.
- PR #19 preserves the governed TX chart under local timestamp skew with `effectiveAvailableAt = max(receivedAt, exchangeTimestamp)` for chart availability. It does not repair the underlying timestamp lineage.

Run `git fetch origin` and `npm run project:status` before relying on these captured identifiers in a future session.

## Local state

- Checkpoint branch: `codex/post-dw3-checkpoint-reconciliation`
- Checkpoint HEAD: `8588c94af4f6ac8aa0dfa3b25607fd2f271f9ba6`
- Captured `origin/main`: `8588c94af4f6ac8aa0dfa3b25607fd2f271f9ba6`
- Checkpoint worktree dirty paths before this document update: `NONE`
- Canonical checkout branch: `hotfix/dw2-timestamp-lineage-effective-available-at`
- Canonical checkout HEAD: `8e6c6c57837de20305fb31bef75a825cdc2360ca`
- Canonical checkout relation to `origin/main`: ahead `0`, behind `9`
- Protected canonical dirty path: `v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md`

The protected report belongs to the Product Owner. Do not stash, restore, reset, overwrite, delete, or include it in another work package.

Captured Git state is not permanent runtime truth. Re-run:

```powershell
npm run project:status
npm run project:status -- --json
```

## Current formal capabilities

Only merged code or governed runtime evidence is listed as a current capability.

### Decision workspace

- Chinese-first Decision Workspace with `NO_TRADE` as a first-class state.
- Result -> Evidence -> Detail information hierarchy, Data Health, contrary-evidence presentation, immutable decision snapshot support, and manual journal workflow.
- No broker/order route and no execution authorization.

### Governed TX chart

- Actual-contract TX candlestick chart for 1m, 5m, 15m, 30m, 1h, 4h, and Owner-frozen 1D NIGHT+DAY trade-date semantics.
- DAY Opening Range, session-only VWAP, previous DAY replay levels, contract isolation, deterministic replay, and quality lineage display.

### DW-3 Market Change Feed V1

- Merged as a **market evidence layer**, not a trading signal.
- Emits only completed, legally available 5-minute evidence.
- Covers VWAP, Opening Range, and session-structure events.
- Separates Evidence Engine Availability from Data Trust.
- Does not fabricate historical Data Health transitions.
- Uses grouped evidence and 5-minute-only chart markers.
- Preserves Chinese-first Result -> Evidence -> Detail presentation.
- Validated with `futureDataViolations=0` in its governed tests.
- Does not authorize direction, entry, BUY/SELL, strategy, paper, or execution behavior.

### Data and operations

- Read-only Shioaji market-data bridge on loopback port 8790 in `market_data_only` mode.
- Local official/batch data, SQLite research store, append-only live-event ledgers, and bounded read-only status inspection.
- Normal daily-use launcher for the formal local Dashboard at `127.0.0.1:8787`.
- Governed Forward Shadow manifests and append-only official status evidence, research-only and non-executable.

## Runtime observation at capture

- Dashboard 8787: `AVAILABLE`, health `PASS`.
- Shioaji 8790: `AVAILABLE`, provider `shioaji`, mode `market_data_only`, observed `executionAuthorized=false`, observed `orderRoutesEnabled=false`, safety `PASS`.
- Local market data: latest ledger date `2026-08-13`; latest bounded-tail TX contract `TXFH6`; no full-ledger scan was performed.
- Research SQLite: `AVAILABLE`; latest observed data date `2026-08-13`.
- Data trust: `QUALITY_INSUFFICIENT`; native sequence `UNAVAILABLE`; timestamp lineage reason `TIMESTAMP_LINEAGE_INSUFFICIENT`.
- Bounded ledger-tail timestamp-lineage violations: `61`. This is an observation, not a repair or a complete-history count.
- Forward Shadow latest official daily status: trade date `2026-08-12`, record type `SESSION_STATUS`, quality `MISSED`, `officialEvidenceWritten=true`.
- Expected Forward Shadow Scheduled Tasks were not present at this capture. No backfill, rerun, repair, or evidence mutation was performed.

Runtime values above are time-stamped observations. They may change and must not be treated as permanent facts.

## Known issues and watch items

- Timestamp lineage remains insufficient even though the chart remains usable through the governed effective-availability rule.
- Native TX sequence is unavailable in audited payloads; true TX tick loss remains `UNKNOWN` and must not be guessed.
- Forward Shadow is governed and evidence-bearing, but its current operational loop is not healthy: the latest official session is `MISSED`, no later daily status was found, and both expected Scheduled Tasks were absent at capture.
- DW-2 timeframe switching: **WATCH**. It was previously observed at roughly 5-10 seconds; the 2026-08-13 Product Owner retest materially improved. No optimization is authorized unless the issue becomes repeatable again.
- `ROADMAP.md` materially predates DW-1, DW-2, Market State / Forward Shadow, Daily Use, Project Handoff, and merged DW-3. Its CURRENT / NEXT / FUTURE classification requires a dedicated Product Owner-approved governance rebase before it is used to authorize another implementation package.
- Repository governance text is not fully aligned: `AGENTS.md` assigns live CURRENT / NEXT execution state to Linear, while `ROADMAP.md` calls itself the sole scope authority. Product Owner resolution is required; this checkpoint does not silently choose or rewrite either rule.

## Open work

- PR #18 is no longer open work; it is merged into approved `main`.
- No new feature, research, strategy, or execution work is authorized by this checkpoint.
- The only active package represented here is `POST-DW3 CHECKPOINT + ROADMAP RECONCILIATION`.

## Current authorized task

`POST-DW3 CHECKPOINT + ROADMAP RECONCILIATION` only:

- verify the PR #18 merge and current runtime truth;
- update this durable checkpoint;
- compare `ROADMAP.md` with approved main;
- identify capability and governance gaps;
- propose, but do not start, up to three next-stage candidates.

No DW-4, Estimated CVD, BidAsk Pressure, Large Trade, Evidence Conflict, Market State retuning, Strategy Engine, Risk Engine, Paper Trading, broker/order integration, or automated trading is authorized.

## Next Owner decision

Decide whether to authorize a documentation-only **ROADMAP REBASE / GOVERNANCE UPDATE** work package. Its purpose would be to reconcile the stale CURRENT / NEXT / FUTURE map with approved main and resolve the ROADMAP-versus-Linear authority wording. This recommendation does not itself authorize that work or any feature implementation.

## Status tool contract

`npm run project:status` observes but never starts or repairs services or evidence. It reports:

- Git branch, HEAD, local `origin/main`, ahead/behind, and dirty paths without fetching;
- Dashboard 8787 health through an allowlist;
- Shioaji 8790 health through an allowlist, separating governed expected policy from observed runtime booleans;
- latest live-event ledger metadata and a bounded tail scan, never a full multi-gigabyte load;
- SQLite existence/size and one bounded read-only latest-date query;
- validated Forward Shadow manifest/approval and the latest small daily-status record, never a write or backfill;
- bounded Data Health observations, returning `UNKNOWN` or `UNAVAILABLE` rather than inventing a pass.

The tool does not dump credentials or arbitrary health payloads, fetch Git, start services, mutate production data, or write official evidence.

## Safety invariants

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`
- No broker/order route, BUY/SELL signal, automated trading, paper trading, Strategy Router promotion, or trading-grade Risk Engine.
- No raw append-only ledger, SQLite, or Forward Shadow evidence mutation.
- Missing or inaccessible evidence remains `UNKNOWN`, `UNAVAILABLE`, or `QUALITY_INSUFFICIENT`.

Survival > win rate > return.
