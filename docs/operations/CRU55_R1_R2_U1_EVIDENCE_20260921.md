# CRU-55 / PR71 R1, R2, U1 candidate delivery — 2026-09-21

Authority: [GPT review 5748914291](https://github.com/mike0345721/taiwan-quant-trading-system/pull/71#issuecomment-5748914291), followed by Owner instruction to implement and push for review, with no Merge or formal deployment. Base: `06a716d57d01ab34954ed0c89b09f6f29d31ac42`. This document belongs to its containing commit; the PR continuation comment records the delivered exact SHA.

## Delivery status

| Finding | Actual result | Remaining boundary |
| --- | --- | --- |
| U1 | Manual refresh rereads background; independent 60-second TTL, in-flight dedupe, 10-second timeout and explicit failure state. Reauthentication discards old replies; CVD success cannot hide background 401. | Browser positive refresh uses explicitly synthetic background A/B; it does not prove a provider produced new market data. |
| R1 | New versioned scalar kernel plus immutable paged store, bounded resumable quote lookup, checkpoint/retry and separate resumable archive-chain audit. Real DAY/NIGHT archived and reconciled. | Partial implementation. No suffix-ingestion/window-job/API replacement is installed. Existing accepted projection still has its original caps. |
| R2 | Persistent source/output/reader binding proposal, exact main and tracked-clean activation checks, normal launcher preflight, startup binding hash in health, refusal to reuse different same-code routing. | No configuration installed, managed writer not implemented, Overview VWAP still unavailable, no deployment. |

`FULL_DAY_OPERATIONAL_ACCEPTANCE=NOT_READY`; `READY_FOR_OWNER_EXACT_MERGE_DECISION=NO`; `MERGE_AUTHORIZED=NO`. Safety remains `formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`.

## R1 implementation and bounded work

`cru55-stream-cvd-state-v1` is a new candidate checkpoint, not a truncated/resealed frozen checkpoint. It keeps the absolute physical ordinal/hash, original active segment origin, cumulative buy/sell/unknown totals, continuity/canonical terminal state, quote fence and last point. Complete immutable event/point/segment facts live in the page archive. Scalar `streamCurrent()` does not invent a frozen full-history `semanticHash`.

`createStreamStore()` writes records, facts and checkpoint into one content-addressed immutable page, fsyncs its temporary file, and atomically replaces one pointer. An unknown lock is never reclaimed. Missing pointer in an already used archive refuses initialization. Exact retry of the latest batch is `UNCHANGED`; overlap/regression, source/resolver drift and corrupted artifacts refuse advancement.

| Operation | Bound per invocation |
| --- | --- |
| Append input | 128 records / 512 KiB |
| Immutable page | 2 MiB |
| Quote scan | 32 pages / 8 MiB, stat checked before reading |
| Fixed append overhead | Current page up to 2 MiB; successful readback up to 2 MiB; cursor up to 128 KiB; bounded input/facts/hash work |
| Checkpoint | 64 KiB contract cap; observed real checkpoints 2,233 / 2,168 bytes |
| Archive audit | Up to 32 pages × 2 MiB plus current page; explicit continuation |

Quote scan exhaustion returns `STREAM_QUOTE_QUERY_PENDING` with a durable cursor tied to source, resolver, page head, checkpoint, batch and tick. Restart continues from that cursor; it never returns unknown lookup as `null`. Completed quote proofs are deduplicated in the bounded hashed cursor so replay does not reread unbudgeted historical pages. Oversized proofs fail closed. Late ticks can still query older physical quotes; no rolling-history deletion or new semantic segment is used to meet storage bounds.

`read()` labels its verification `CURRENT_PAGE_ONLY`. `auditHistory()` labels completed scope `ARCHIVE_CHAIN_AT_AUDIT` and **`originalRawPrefixVerified=false`**. This is an integrity-checked candidate archive, not a replacement claim for original source verification.

## Real-data oracle and persistence evidence

Command: `node scripts/verify-cru55-stream-real.mjs --archive day night`. This local-only tool reads the already accepted bounded prefixes and verifies their pinned byte hash; it writes only a new ignored candidate archive. Original source files and existing dynamic publications are not changed. Public output contains identities and derived summaries, not raw events, credentials or local paths.

| Existing accepted cutoff | CVD | Points | New archive | Max checkpoint bytes |
| --- | ---: | ---: | ---: | ---: |
| DAY ordinal 3800 | 400 | 205 | 30 pages / 3800 records | 2233 |
| NIGHT ordinal 1800 | -14 | 45 | 15 pages / 1800 records | 2168 |

Each batch was followed by a new store instance and an exact retry (`UNCHANGED`). Both archive audits completed; archive checkpoint hashes matched the one-record-at-a-time oracle. Re-execution processed **0** records with unchanged head-page/checkpoint hashes; see [sanitized machine receipt](CRU55_STREAM_ORACLE_20260921.json).

All six accepted window outputs, Session Context and **null-prior Handoff output** matched after reconstructing these complete finite histories from streamed facts. This is not evidence of positive real adjacent Handoff, and is not a new full-day window implementation.

## Browser evidence

Actual browser operated through Computer Use. Isolated port 3066 served the changed frontend/formal route and existing verified real artifacts. Background provider was a private, explicitly labelled `U1 SYNTHETIC A/B` test harness; test credentials/harness files stay ignored locally.

1. Initial background A showed index 111 alongside real DAY endpoint 400. Changing backend snapshot to B and pressing the normal **更新畫面** button showed 222 / `HISTORICAL · U1 SYNTHETIC B`, without reload or re-login; CVD stayed 400.
2. Background 503 displayed `UNAVAILABLE · 背景讀取失敗`, cleared the card values and kept CVD 400. CVD-only 503 cleared its endpoint to null while B/222 remained displayed. Recovery restored CVD 400.
3. The existing, clearly labelled synthetic multi-bar oracle displayed 121 one-minute bars, four panes, CVD 2026. Frame selection produced bar counts `121/25/9/5/3/1` and deltas `17/190/484/965/1502/2026` for `1m/5m/15m/30m/1h/4h`. Four-hour truth stayed PARTIAL. This verifies layout/interactions, not real market progression.
4. Actual CSS viewports `1920×1080`, `1536×864`, `1366×768` had no document horizontal overflow for both real single-bar and synthetic multi-bar views. No UI redesign was made. MTX followed by refresh retained unavailable product/background values and null endpoint.

## Tests and independent review

- 28/28 targeted tests passed: U1 (6), binding schema (1), persisted binding/real temporary Git repo (3), Windows launcher predicate (1; 9 cases), formal route (2), eight-hour stream/window oracle (1), existing daily-use bootstrap (10) and runtime identity (4).
- Stream kernel 6/6 passed: frozen per-cutoff equivalence, 1100 points, **actual 250002 physical records / 25001 quotes**, JSON restart, unknown, late, continuity and refusal cases. These counts are not durations or a full trading-day test.
- Stream store 10/10 passed: page rollover, 1100 persisted points, exact retry/restart, late quote, cursor continuation, actual page-read budgeting, corruption, foreign lock, orphan-page recovery and missing-pointer refusal.
- Existing dynamic-projection/reader tests 5/5 passed. Frozen caps and prior wiring remain unchanged.
- Secret scan, syntax checks and diff whitespace check passed. Windows-only predicate test is in the Windows lane; remote CI must be reported separately on the delivered SHA.
- Two independent reviewers plus parent reviewed the changed candidate. Initial findings: three R2 blockers (data-root split, stale running binding reuse, dirty tracked code), one R1 blocker (completed-proof reads omitted from budget). All four were fixed and repair-reviewed: final candidate patch **B0/S0**. This is not whole-package/full-day acceptance or Owner Merge approval.

Failures retained in the delivery record: initial Windows sandbox runs hit `EPERM realpath C:\Users\user` before relevant assertions; explicitly authorized reruns passed. The new eight-hour fixture initially omitted the accepted price adapter's `_product_family/_target_code` fields and had no bars; only the fixture was corrected, then the test passed. The isolated harness restart initially hit a PowerShell `Stop-Process` internal error and an `EADDRINUSE` launch failure; after verifying the test process identity, its replacement started successfully. No formal process was stopped.

## Concrete remaining work and integrity decision

The accepted `buildCvdRelationshipProjection()` still throws `RELATIONSHIP_PREPARATION_BUDGET` at **1025 CVD snapshots**; canonical-event cap remains 25000. Existing `prepareDynamicProjection()` still reads/parses the entire accepted prefix and the existing producer retains its 64 MiB prefix bound. The new page store has not been connected as a substitute, so these are still reproducible full-day blockers, not merely a wait for the market to open.

Minimum continuation within the same package: connect bounded source ingestion, add resumable six-window/price/context projection jobs over preserved archive facts, and introduce a separately versioned public reader contract with oracle/restart proof. Preserve original origin, `(t-W,t]` selection, physical predecessor delta, quote fence, event/available time separation, and multi-segment Session/Handoff refusal. Do not reseal a shortened history as the frozen semantic hash. This engineering work remains unfinished; it is not being presented as an external authorization blocker.

There is one specific source-integrity choice: existing materialization detects arbitrary older raw-byte rewrites by rereading the full prefix before publication. A suffix-only reader cannot guarantee that same immediate check without reading the older bytes or an independently enforced immutable source. A policy-preserving implementation can split full-prefix verification into bounded resumable jobs and keep output pending until verified, accepting growing total latency. Treating captured immutable pages as the authoritative history with a later raw-divergence audit changes that guarantee and needs an explicit Owner decision before formal adoption. This candidate makes neither change silently; the formal binding only accepts `FULL_PREFIX_EACH_BATCH / BOUNDED_ACCEPTED_V1` and refuses the new stream producer.

R2 normal binding is documented in [runtime binding candidate](CRU55_RUNTIME_BINDING_CANDIDATE_V1.md). Managed writer configuration/startup, complete full-day projection and Overview VWAP remain engineering work. Positive real adjacent Handoff, natural market event→disk→derived→API/UI LIVE, formal whole-version deployment and natural acceptance remain unverified this round. Existing PR70 preservation/operations evidence is carried forward, with no new natural PASS or five-day count assigned.
