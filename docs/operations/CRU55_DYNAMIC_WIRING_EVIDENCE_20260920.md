# CRU-55 / PR71 dynamic wiring candidate — 2026-09-20

Status: implemented bounded real-ledger wiring; Draft, not production acceptance.
Continuation authority: PR71 comment 5747630437 and CRU-55 continuation c6ead823-d59f-4e56-b5ca-5efaab3a46a6.
Baseline: 0894e2a4ea1b22fbd6953754aceaf338979f455e. Code version: the commit containing this report; final exact HEAD and independent review dispositions are recorded on PR71.

## Delivered

- A separate candidate materializer calls the unchanged accepted CVD core with finite suffix batches, physical-prefix/hash/source/resolver validation, immutable generations and atomic pointers. Restart preserves cumulative state. No collector subscription or production writer was added.
- Producer-side projection calls the accepted chart, Relationship, Session Context and Handoff functions for all six windows. Active contract/trade-date/session price filtering and continuity-separated CVD traces prevent mixed identities. Synthetic source classification is case-insensitive on Windows.
- `/api/v1/cvd-overview` uses existing Dashboard session authentication, GET only, validated queries and no-store. It reads bounded verified public artifacts, not raw ledgers; corrupt, lagging or blocked publication fails closed. Private source paths and checkpoints are not returned.
- The accepted Overview renders K/Volume/CVD/delta, six-window Fast Scan, Relationship, Session Context and Handoff. Five-second serialized reads have a ten-second timeout. Changed identity/failure clears old evidence; changed artifact closes pinned detail/Ask drawers. Source month is actual contract, not fixed September.
- `watch-cru55-dynamic.mjs` repeats finite child invocations under a private lifecycle lock, with timeout and atomic persisted READY/BLOCKED status. It stops on failure without resetting state, deleting another owner's lock or increasing accepted limits.

## Real ledger progression (historical, not LIVE)

These are genuine append-only ledger prefixes; no raw records, credentials, SQLite, private checkpoint or launcher is uploaded.

| Ledger / source identity | Cutoff ordinal | CVD / 1m delta | Result |
| --- | ---: | ---: | --- |
| 2026-09-11 / `sha256:36143d4d5214c2fc939911749c62a349c09299a199b1b922213425f5e7c30365` | 400 | -11 / -11 | Published |
| same | 800 | -13 / -13 | 400 new physical records; same-prefix restart processed 0 and retained generation/artifact |
| same | 1800 | -14 / -14 | 1000 new records through revised lifecycle writer |
| 2026-09-14 / `sha256:c1b2b1dd6dc5a614ae0d6506fd569f94fbfe243216dbeec492935ff27c5a1865` | 800 | null / null | Before lawful active DAY context; API refused incompatible session |
| same | 1800 | 421 / 421 | Active DAY observed segment |
| same | 2800 | 410 / 410 | Lifecycle cycle 1, 1000 new records |
| same | 3800 | 400 / 400 | Lifecycle cycle 2, 1000 new records; browser automatically updated |

Final DAY generation: `9a6ac456bae0fe6bae1a723c0b7ea71cb050c553c6c3f5217e5ad5667704608c`.
Final DAY public artifact: `834b3281b03f2d0591e543e315ce01d3b3af56c2644be6532123701455c369d6`.
DAY's previous artifact `f719a795f7b8acc0930811098e4138edc9d4c073d935efdf98b49f6289c9e3bf` changed when its explicitly selected prior NIGHT generation advanced. DAY source, generation and CVD did not change; Handoff's prior provenance did. A further new-process run with both inputs unchanged processed 0 and retained the final artifact exactly.

Final NIGHT generation: `bf01e667baaf1c265f93fa7176e3f681d402cd8f20100e751d76c2397f34eccb`.
Final NIGHT artifact: `72827a8ca53755f2723d79cef08df7c1d9f21e5ef444307cc8f34ad37f974d43`.
Exact cutoff record/prefix hashes and all twelve authenticated API comparisons are in `CRU55_DYNAMIC_HTTP_EVIDENCE_20260920.json`.

DAY 3800: TXFI6 / 2026-09-14 / DAY / TX:2; 205 snapshots, observed volume 673, buy proxy 533, sell proxy 133, unknown 7; 533 - 133 = 400. Classification coverage 98.96%, quality insufficient, capture completeness UNPROVEN. One accepted price bar; displayed latest price 45568. No complete-session or full-window inference.
NIGHT 800: 25 price ticks violated accepted available-at/exchange-time ordering; K/Volume were unavailable while CVD remained -13. Preserved exclusion, no timestamp repair or invented price. The later NIGHT 1800 is a distinct publication.

## Validation and limits of evidence

- Targeted Node tests: 8/8 PASS. Includes append/replay identity, physical-prefix mutation refusal, source-kind casing, legitimate synthetic Handoff pairing, nonadjacent refusal, active price identity, artifact cache binding, blocked reader, auth/query/method behavior and formal workspace preservation. A first limit-test harness failed before its assertion because its accepted fixture helper itself raises the same budget error; moved the assertion around the helper, preserving the expected failure rather than changing a limit.
- HTTP: unauthenticated 401; twelve logged-in day/night x six-window artifact/API comparisons PASS; invalid query 400; no-store; no sourceBinding/checkpoint/private path in public response. Reproducible verifier requires a local test password via environment and refuses any destination other than isolated loopback port 3065.
- Browser: isolated 3065 server, existing login, genuine ledger artifacts. Base server uses mock background only; mock data is rejected by `/api/lower` and is not evidence for market background. CVD endpoint independently reads genuine ledger projections.
- Browser DAY 3800 displayed CVD/delta 400 with matching artifact; NIGHT 800 displayed -13 with matching artifact. Four panes / 19 canvas elements; DAY one K bar, NIGHT no lawful price bar. 1m/5m switching, stale/partial/unknown explanations, Handoff refusal and quality drawer inspected. Actual CSS viewports 1920x1080, 1536x864 and 1366x768: document horizontal overflow false. Layout/styles were not redesigned.
- No PR70 preservation, production recovery or prior natural scheduler acceptance was repeated. Existing production remains PR70 merge e81c5259b5e38db6ad573242e9cf1ee4f305207f. No formal deployment, scheduler changes, collector interruption or five-day counter edits.
- Browser negative path: preserved candidate lifecycle status, temporarily injected BLOCKED only in candidate derived status, observed 503 `CRU55_PRODUCER_BLOCKED`, closed drawer, cleared artifact/delta/head, endpoint null and zero canvases. Restored preserved candidate status. This is an explicit fault-injection test, not a natural operational failure.
- Post-commit isolated restart used the persisted local launcher and retained DAY artifact/CVD 400; browser reported code HEAD 1b7d5b1160a8ddd12f9aa43d26af92fa66709b1e. Unsupported MTX selection exposed one stale contract label, fixed by clearing the contract selector on every unavailable/loading path. Browser confirmed unavailable contract, null endpoint and zero canvases, then restored TX. This final display-only correction does not alter prior calculation/API evidence.

## Concrete remaining engineering limitation

Calling the accepted Relationship projection with 1025 CVD snapshots raises `RELATIONSHIP_PREPARATION_BUDGET` (`src/cvd-relationship-projection.mjs`, accepted maximum 1024). The targeted fixture reproduces it. Also retained: canonical-event 25000, chart prefix 64 MiB and all existing core budgets. Therefore this candidate supports verified bounded progression, not unattended full-day operation. Exceeding a bound leaves evidence and returns unavailable; it does not rotate/reset cumulative CVD or relabel stale data LIVE.

Minimum extension: a separately reviewed candidate incremental projection that stores each segment's cumulative origin plus bounded window queues and immutable segment history; prove equivalent results against the accepted functions for six windows, late/unknown events and continuity breaks before widening supported duration. Do not edit frozen functions or increase their caps. The current branch-bound producer is deliberately candidate-only; a later approved whole-version deployment must provide an explicit production binding and persistent launcher/service configuration. Merely merging this code does not connect 8787.

Handoff code is connected: real selected inputs refuse `SESSIONS_NOT_GOVERNED_ADJACENT` / `SESSION_SIDE_MISSING`; the lawful adjacent synthetic pair passes COMPARABLE but is not real Handoff evidence. Minimum real-data follow-up is an eligible adjacent-session pair with lawful boundaries, not fabricated pairing.

Market-only pending: newly arriving natural events -> continued physical writes -> derived publication -> authenticated API/UI progression in an applicable session. Today's historical replay, READY lifecycle status and successful login do not prove this. Natural scheduler success from earlier preserved records is unchanged, not a new LIVE acceptance.

## Candidate reproduction / persistence

Run only in branch `codex/cru55-formal-entry-recovery-v1` worktree. Input allowlist is the primary repository's direct `data/live-events/*.ndjson` or candidate-private fixtures. Outputs stay under candidate `data/cru55-dynamic/output/<runId>`; HTTP roots contain `day` and `night` runs.

```text
node scripts/run-cru55-dynamic.mjs <absolute-allowlisted-source> day <stopOrdinal> night
node scripts/watch-cru55-dynamic.mjs <absolute-allowlisted-source> day night 2
```

The optional final lifecycle argument runs 1–100 cycles for bounded acceptance; omitted means repeat until stop/fault, still subject to every budget. This is not an installation command. Candidate `CRU55_DYNAMIC_ROOT` and exact runtime commit are persisted in an ignored local launcher; fresh child processes read durable checkpoint/artifacts, not parent-shell memory. Formal persistent deployment remains unperformed.

Safety: formalWeight=0; researchOnly=true; executionAuthorized=false; orderRoutesEnabled=false. No merge authorization is inferred from engineering review.
