# CRU-54 Phase A — current-main CVD observation slice

Owner authorized the isolated Phase A on 2026-09-14. Linear CRU-54 description and
READY_FOR_CODEX_START checkpoint are the scope authority. This is a candidate
derivation/checkpoint deliverable, not an API, chart, Owner Preview, or production rollout.
Stop at `CRU54_PHASE_A_CURRENT_MAIN_CVD_SLICE_READY_FOR_GPT_REVIEW` after engineering
evidence and required Level-3 review, or report a concrete blocker. Do not start Phase B.

## Baseline and actual scope

Fresh branch `codex/cru-54-cvd-current-main-v1` from exact approved main
`d3702315b46a1a6c23384338ae40904b8bc589c2`.
Worktree: `D:/Taiwan stock/standalone-v1/data/worktrees/cru54-cvd-current-main-v1`.
The ten-file allowlist and unchanged dependencies are machine-readable in
`CRU54_PHASE_A_SCOPE.json`; `node scripts/audit-cru54-scope.mjs` checks them against
that baseline with an explicit Git working directory. All files are additive.

Formal input: explicitly named files directly inside
`D:/Taiwan stock/standalone-v1/data/live-events/`, opened read-only. Calendar and
canonical/Pressure implementations come from this exact current-main tree.
No directory-wide market-data scan, SQLite read/write or automatic file switching.
The source generation uses the same CRU34 genesis identity hash; path/device/inode/
creation-time plus a fixed byte-prefix SHA additionally bind a CRU54 checkpoint.

All writes: this worktree's ignored `data/cru54-private/` tree. `output/<runId>`
holds immutable generations and one latest pointer; `fixtures` holds synthetic
engineering inputs; `evidence` holds bounded validation receipts. `cache` and
`checkpoints` directories are reserved, with no formal binding. Checkpoint state is
inside each immutable generation, not separately published in the reserved directory.
Formal runtime/CRU52/CRU9/raw/evidence roots and Windows Tasks are never mutated.
Port 3054 is the candidate choice (no listener observed at preflight); Phase A does
not bind it. Recheck occupancy before any separately requested API phase.

## Producer chain and selective reuse

Existing formal collector -> append-only physical ledger (READ ONLY)
-> unchanged `materializeTxCanonicalObservations`
-> unchanged `buildExecutedPressureWindow` for each newly observed tick
-> CRU54 accumulator -> isolated generation with checkpoint/snapshot/full history.

The existing CRU34/CRU49 live worker, status publisher and lock are a separate failure
domain. CRU44 1m/5m/15m/30m/1h/4h states and current Dashboard remain unchanged.
Neither live snapshots nor legacy aggregated CVD feed this accumulator. There is
no new producer binding into CRU52 Data Operations and no second formal ledger.

Accepted CRU50 reference is `6c8f35ba1b5e9d8bb91a63760da2e79b45f32cfc` (PR63 remains
Draft/unmerged). Selectively reused: physical-record canonical calls, one-tick
Pressure classification, BUY minus SELL arithmetic, UNKNOWN conservation, invalid
segment propagation, prior-quote cross-check and relevant pure tests. Continuation,
hash verification and immutable no-clobber concepts are retained. New: versioned
CRU54 schemas, current-main generation identity, true bounded suffix reading, guarded
worktree/output paths, coherent checkpoint/history publication and explicit boundary
invalidation. No PR63 cherry-pick/rebase/merge; old reader, private envelope, manifest,
CLI, output layout and historical acceptance receipts are not imported or re-certified.

## CVD truth

`CVD = cumulative BUY_PROXY volume - cumulative SELL_PROXY volume`.
UNKNOWN volume is independent. Quote evidence only cross-checks provider direction;
it never replaces it. `total_volume` and overlapping window snapshots are never added.
Physical ordinal and hash chain are authoritative; no timestamp sort or timestamp
dedup. Equal-time identical content at different lawful physical ordinals counts
twice; a marked duplicate or simtrade does not. Replaying an old suffix is rejected.

No lawful trade/all UNKNOWN/invalid price-volume-lineage -> null value, never a
fabricated zero/Neutral. Legitimate balanced classified volume can equal zero.
Classified coverage is classified volume / observed valid executed volume; it is
not capture completeness or classification accuracy. Capture completeness remains
UNPROVEN, native missing count null, sessionStartProven false, scope OBSERVED_FRAGMENT.

DAY and NIGHT have separate observed origins. Contract, trade date, session and
continuity changes create separate segments, including quote-only identity changes.
Terminal reconnect or poisoned physical availability invalidates current value until
the proper new segment exists. Invalid explicit session identity is rejected against
the existing governed resolver, without changing canonical or calendar semantics.
No interpolation across market closure and no cross-session continuous path. A new
physical ledger file starts another independently verified fragment; this version
does not assert continuity across files/midnight. A long interval alone is not proof
of a collector interruption and does not arbitrarily reset accumulated volume.

The accumulator has no timeframe parameter: changing chart timeframe cannot reset
its origin, history, checkpoint, or same-cutoff final CVD. Comparison windows and
chart/API aggregation are future Phase B/C consumers, not six independent sums.

## Snapshot/history/checkpoint contract

`cru54-cvd-generation-v1` includes the source binding, consumed byte cutoff and prefix
SHA, `cutoffReceivedAt`, sealed `cru54-cvd-observation-state-v1` checkpoint and sealed
`cru54-cvd-observation-snapshot-v1` semantic result. Checkpoint persists canonical
terminal state, physically prior quotes, cumulative segments and full physical-order
series. History points retain recordHash, ordinal, raw eventTime/availableAt, segment
index, cumulative quantities, coverage, quality, reason and quote conflicts.
Previously published generations/points are never rewritten by a late event.

`sourceMode=ISOLATED_READ_ONLY_LEDGER`, `status=OBSERVATION_CANDIDATE` do not assert LIVE
or fresh market data. Semantic `availableAt` follows the physical input needed to
determine current snapshot state (including a trailing reconnect); invalid physical
availability is null. `lastTradeAvailableAt` preserves trade freshness separately
from raw `cutoffReceivedAt`; a quote/heartbeat is not evidence of a fresh trade.
Phase B must use trade time and current observation/boundary state appropriately.
Missing file/invalid checkpoint/hash/identity/resource errors are explicit failures;
an old immutable generation remains historical evidence, not a successful new update.

One invocation consumes at most 8 MiB / 25,000 complete physical rows after the saved
byte offset. Partial tail rows wait without advancing; oversized records are rejected.
CRLF and UTF-8 byte offsets are preserved. Old prefix verification streams 1 MiB
buffers and never recounts or recanonicalizes old trades. The persisted prefix and
new bytes are checked again before publication. This is incremental calculation,
with O(consumed prefix) integrity-read cost, not an O(suffix)-only IO performance claim.

Budgets: 250,000 total physical records, 25,000 retained same-segment quotes, 128 MiB
artifact, 30-second cooperative batch deadline. Exceeding any budget fails before
advancing publication; no silent quote pruning, history loss or origin reset. Full
state copy/hash/history has bounded but growing cost. These are Phase A engineering
limits, not demonstrated all-day live capacity; polling/rolling storage/paging and
cross-file continuation are not certified here. Raw input size need not fit a batch.

Publication uses a flushed temp file, atomic no-clobber hard link to a content-named
generation, then flushed temp + rename for a single latest pointer. Read-back verifies
the generation, complete checkpoint, semantic parity and safety. A pointer failure
leaves the prior cutoff usable; retry deterministically reuses the immutable generation
and counts the suffix once. No directory scan selects orphan files. One atomic mkdir
writer lock protects a run. A killed writer's lock stays blocked pending investigation;
there is no automatic stale-lock takeover. This is process-crash consistency, not a
claim about physical power-loss durability on every filesystem.

## Focused verification and operation

```powershell
node --test tests/cvd-observation-core.test.mjs tests/cvd-observation-materializer.test.mjs
node scripts/audit-cru54-scope.mjs
node scripts/materialize-cvd-observation.mjs <absolute-allowlisted-source.ndjson> <run-id> [stop-ordinal]
node --max-old-space-size=768 scripts/validate-cvd-observation.mjs <absolute-source.ndjson> 10000 DAY
```

The history verifier uses independent full-size and at-most-4,000-record persisted-suffix
runs at the same explicit cutoff, comparing the entire generation/checkpoint/history
and hashes. DAY/NIGHT samples are bounded historical engineering evidence, not full
session capture, live API or browser validation. V8 old-space is not an RSS hard cap.
For small prefixes the resume batch is half the requested records, ensuring at least
two persisted batches; a single-record request cannot certify continuation and is rejected.
Source bytes, full checkpoints and private fixtures never go to GitHub. Sanitized
results, actual commands and Level-3 exact-HEAD review are published in the Draft PR
and linked from the CRU54 factual checkpoint with read-back.

Default CI runs pure tests and executes the identical I/O suite in a freshly created
real worktree from its shallow checkout; no test-lane exclusion or isolation bypass.
Local I/O tests require the actual authorized candidate worktree. Phase B/API/UI,
Change Bar/Handoff/Relationship, Options, Absorption/Exhaustion/Market Control,
Strategy, execution/order, deployment and Merge are out of scope.

`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`.
Engineering test PASS is not Owner acceptance. `LOCAL_ONLY_RESULT = NOT_COMPLETE`.
