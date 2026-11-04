# CRU-61 calendar tail drain V1

Candidate engineering only. Baseline: PR109 `356d49500229410e826039672e16b0a36e2a0edf`.
No source process, ledger, existing checkpoint, schedule, environment, database,
TLS material or formal service was changed by this work.

## Corrected behavior

The existing Producer previously chose today's calendar file on every poll.
An append made after its last pre-midnight poll could therefore remain forever
beyond yesterday's verified checkpoint. The same existing singleton runner now
persists a bounded `calendar-cursor.json` in its projection directory. It drains
the active file through the unchanged verified batch worker before moving to a
new file. Each poll consumes at most the existing byte/record batch limit.

The cursor is hash checked, capped at 4096 bytes, written with file fsync,
atomic rename and readback. A transition commits only after old-file checkpoint
publication succeeds, its offset equals the physical file size, metadata is
unchanged during the poll, and a later calendar ledger physically exists.
Only seven derived calendar paths can be inspected per transition. Missing
weekend/holiday files are skipped only when they were never observed and have no
checkpoint; an observed file disappearing fails closed. Longer interruptions
require explicit reconciliation rather than an unbounded directory scan.

Existing snapshot-before-checkpoint ordering and hash/anchor validation remain
unchanged. Cursor failure before a new-source run cannot skip the old suffix.
Partial terminal lines stay pending and are never treated as completed EOF.
An unexpected newer checkpoint or snapshot blocks old-source publication.
The immediately closed file's exact size, nanosecond mtime and inode are fenced
on subsequent polls; changed/missing metadata stops publication pending
reconciliation. Windows inode values use bigint strings, avoiding precision loss.

This is byte-progress evidence, **not capture completeness**. A new file witnesses
calendar rotation, not market continuity or native-sequence completeness. The
fence retains one prior file; it is not an audit of all historical files.

## Migration and deliberate limits

First installation adopts the current calendar date and preserves its existing
checkpoint. It never replays a previous date over a possibly newer `latest.json`.
`adoption=CURRENT_DATE_NO_RETROACTIVE_RECOVERY` is exposed with rollover state.
Pre-existing skipped tails still need a separate bounded historical recovery;
this patch does not repair old receipts or claim those gaps were processed.

Each daily file still has its own GENESIS, source identity and local ordinals.
Same-night midnight warmup therefore remains single-ledger; the transition emits
`NEW_LEDGER_GENESIS_NOT_PROOF_OF_NEW_MARKET_SESSION`. Preserving multi-file CVD or
Flow warmup requires a separately reviewed multi-source lineage contract, not
renumbering old events or substituting source identities. Genuine contract,
session, reconnect and trade-date resets retain existing behavior.

If an active partial tail, corrupt anchor, missing observed ledger, backward
clock, cursor corruption, newer snapshot conflict or closed-file mutation is
detected, the runner exposes an explicit reason and does not weaken quality or
skip affected bytes. It starts no additional collector or runtime.

## Validation and remaining daily failures

`node --test tests/cru34-calendar-rollover.test.mjs tests/cru34-live-projection.test.mjs tests/cru49-producer-reliability.test.mjs`
tests synthetic tiny real hash chains, bounded final appends, restart, partial
line completion, missing files, corruption, snapshot/cursor publication failures,
migration, midnight timezone, preserved new-source warmup reset, and unchanged
raw bytes. These are fixture evidence, not a real midnight/LIVE observation.

Final local result: **48 PASS, 0 FAIL, 0 SKIP**, native Windows, same command
through normal tool permission review (tool chunk `133481`, exit 0). Earlier
restricted sandbox run produced **17 PASS / 31 FAIL**, with EPERM/EACCES on
temporary-file rename in both unchanged and new suites; that failure is retained
separately, not called a product PASS. No command flags, paths, temporary-directory
variables or implementation guards were changed to obtain the reviewed run.
The original two-file 30-test run passed before the last three edge cases; it is
not used as final-version acceptance. `git diff --check` passed.

The 2026-11-04 morning batch receipt remains historical FAILED evidence with OI
arithmetic/continuity issues. No daily dataset or quality rule was modified to
make it pass. New deployment, native entry/TLS gates and real-session acceptance
remain separate; no old CI or browser PASS is carried to this new patch.

Safety remains `formalWeight=0`, `researchOnly=true`,
`executionAuthorized=false`, `orderRoutesEnabled=false`; AI stays disabled.
