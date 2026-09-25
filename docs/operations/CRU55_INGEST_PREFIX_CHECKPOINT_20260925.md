# CRU55 targeted INGEST / complete-prefix publication checkpoint

Authority: PR73 Owner comment 5829790171 and CRU-55 latest approval. Baseline
`4f9867ade6ff349ad648fad8ab6452cbd95a846e`; prior capacity evidence and M4 remain
accepted only within their recorded scopes. No merge, production activation or UI change.

## Frozen candidate measurement contract (before capacity run)

- Explicit schedule `COMPLETE_RECORD_PREFIX_V1`, `maxRecords: 32768`. This is a
  per-publication ingest ceiling, **not** an increase to the formal 62,000-record /
  84.8 MB trial ceiling. Defaults stay off. A session boundary, captured tail or
  incomplete final record can close a round earlier. A cutoff is a durable,
  complete-record checkpoint; all remaining bytes remain backlog.
- Each round retains full original current/prior prefix verification, projection,
  durable artifact and guarded pointer ordering. No fsync, page revalidation,
  raw re-read, classification or M4 null protection is removed.
- Schedule/version is part of job and projection binding. New code requires new
  candidate output; old resolver/checkpoints are not relabelled. Future formal
  opt-in also requires a new versioned stream binding and existing Owner/main gate.
- Correctness: INDEXED versus FULL_SCAN at identical scheduled cutoffs; crash
  around ingest/public pointers, old-prefix tamper, partial tails and session
  boundaries. Existing unaffected M2/M3/M4 evidence is reused.
- One cold comparison, maximum 1,800 seconds including shutdown reserve (stop at
  1,795 seconds), preparation separately measured. Same original 2026-09-24
  private prefix: 1,500,000 records / 2,059,524,347 bytes,
  SHA256 `7b4b69fd190daf62341a91f360cb444fe107f5c3b553707543ab3f3e15d612b6`.
- A single below-normal managed writer, 8 pages / 8 MiB per cycle unchanged;
  RAM minimum 6 GiB, writer RSS maximum 2 GiB, free disk minimum 100 GiB,
  host CPU above 85% in two consecutive 30-second samples stops the run.
- Candidate uses one continuous normal managed process, avoiding repeated
  destruction of prefix leases. Previous baseline used 100-cycle normal exits;
  this supervision difference is disclosed, not treated as a pure CPU benchmark.
- Conditional warm replay only after **publication** reaches initial tail: original
  frozen suffix at 27 records/second, at most 10,562 records (~391.2 seconds),
  within the same overall deadline; no time extension. If initial tail is never
  published, warm latency is NOT_MEASURED. No natural-live/API claim without samples.
- Stop after this comparison and review even if it still cannot catch up.
  Larger storage/index/fsync architecture changes require another Owner decision.

## Preliminary bounded hotspot evidence

Eight unmodified normal managed cycles on the first 16,384 real records (22,489,876
bytes; prefix SHA256 `9e3d56ba06bcecbd1967ac8ec8207970de2f023414c66f41870389c7d91f4bc3`)
took 41.736 seconds wall / 17.875 seconds process CPU. 427 fsync calls took
20.324 seconds synchronous call latency. Two-millisecond sampled stacks attributed
6.144 seconds to native realpath, 2.310 seconds to exists, 1.399 seconds to lstat,
and ~2.275 seconds to stable serialization/sorting. These are sampled wall-stack
attribution and process I/O counters, not physical disk utilization or pure CPU
time by function. Config/manager timings remain separate in per-cycle output.

Only local redundant serialization/hash work is removed. The dominant durable
flush/path checks remain, so this is not evidence of full-day sustainability.
The initial profiling helper failed before writer startup because a wrapper did
not preserve `realpathSync.native`; that failure is retained and the wrapper was
removed before the successful bounded sample. No product workaround was made.

The bounded result and rollout delta follow below; no further capacity run is authorized by this receipt.

## Engineering verification

Runtime candidate: `e321c8748a742f5ebcd27d24e0a2299c6c46acff`.
The targeted run passed 41 tests; the final seven-test run includes two added
session/binding cases (43 distinct tests overall). The initial sandbox attempt
failed on Windows temp-parent realpath permission; tests passed using the existing
workspace test-temp root without changing product path guards. Secret scan passed.
GitHub `Verify repository` passed for this runtime commit.

Independent engineering review: PASS / APPROVE, B=0, S=0 after fixing pre-size
serialization and formal binding pass-through. One inaccurate test title was
corrected. The private supervisor additionally received REQUEST_CHANGES for
uncaught callback failures and unintended restart; both were fixed and reviewed
PASS before starting the sole capacity run. Review does not authorize deployment.

The same eight-cycle post-change smoke ingested exactly 8,192 records /
11,239,554 bytes, as before. Wall 39.376 s; CPU 17.673 s; 427 fsync calls / 18.494 s.
ReadFile calls fell 585 to 450; path/stat and durable-call counts stayed unchanged.
Uncontrolled flush/cache/load variation means the 5.65% wall reduction is not a
causal throughput claim. Sampled self serialization/sorting frames fell ~2.275 s
to ~1.808 s; whole-process CPU improved only ~1.13%.

Fine sampled stacks (before / after, inclusive and overlapping): raw exact reads
32.8 / 22.9 ms; canonical materialization 241.2 / 279.0 ms; classify/checkpoint
including quote lookup 1,994.4 / 2,093.4 ms; quote lookup 11.1 / 17.0 ms; page
validation including path/hash 1,341.8 / 1,383.6 ms; path checks 10,244.2 /
10,370.1 ms. Raw JSON parse is not separately resolved by this sample and remains
pipeline residual; no parse/classification shortcut was implemented. Config /
pipeline / manager cycle totals were 2.616 / 35.651 / 0.912 s before and
2.939 / 33.509 / 0.937 s after. Whole-process I/O operation counters were
3,425 reads / 436 writes before, 3,290 / 436 after; not disk-device counters.

Independent real-data comparison also read the existing baseline and candidate
artifacts at ordinal 31,324 (same original 42,906,025-byte prefix). All six
timeframes, values, windows, classification, quality, session and origin are
field-exact after separately excluding the four version-derived hash keys
`artifactHash`, `generationHash`, `projectionHash`, `rawChunkHash` (55 hash-only
differences). NIGHT / 2026-09-24 / TXFJ6, CVD 2, origin 283; buy/sell/unknown/total
252/250/12/514; QUALITY_INSUFFICIENT retained. This case has context CVD 2 and
last-trade cutoff 29,426 on both sides; it is not a rerun or replacement of the
accepted M4 null case. Original frozen artifacts were not changed.

## Bounded result: NOT_ESTABLISHED / no activation

2026-09-25 17:32:13.062–18:02:08.212 Asia/Taipei, 1,795.150 seconds;
preparation 126.877 seconds. Stop: MEASUREMENT_TIME_LIMIT, one process.
At 18:02:38.063 the private writer/supervisor count was verified zero. Interrupted
checkpoint/locks/logs remain preserved; the sixth round stopped in QUERY.

| Same 1,500,000-record / 2,059,524,347-byte input | Baseline 4f9867a | Candidate e321c87 |
|---|---:|---:|
| Durable ingested records | 371,292 | 195,164 |
| Durable ingested bytes | 509,723,045 | 267,575,193 |
| Completed publications | 1 | 5 |
| Latest published prefix records | 31,324 | 162,396 |
| Latest published prefix bytes | 42,906,025 | 222,565,129 |
| First publication seconds | 239.770 | 250.086 |
| Final unpublished records | 1,468,676 | 1,337,604 |
| Final unpublished bytes | 2,016,618,322 | 1,836,959,218 |
| Warm append | NOT_MEASURED | NOT_MEASURED |

Candidate publication elapsed seconds / cutoff: 250.086 / 31,324 (NIGHT),
554.167 / 64,092, 883.335 / 96,860, 1,218.638 / 129,628,
1,526.430 / 162,396 (latter four DAY, trade date 2026-09-24).
Completed intervals: 304.081, 329.168, 335.303, 307.792 seconds; longest 335.303.
Final unfinished interval 268.720 seconds is censored, not a successful latency
sample. Baseline had no second publication and a 1,555.534-second censored gap.
Candidate final ingestion backlog: 1,304,836 records / 1,791,949,154 bytes.
Static backlog declined but was not drained; there were **zero append samples**.
No append-to-publication/API percentiles, sustained-input slope or daily readiness
can be claimed. Less ingested work and later first publication are retained as
negative results; publication advancement is not total-throughput improvement.

922 completed cycles, phase-at-return pipeline seconds: INGEST 813.178,
PROJECT 273.476, QUERY 166.379, VERIFY 57.536, VERIFY_PRIOR 11.964.
Pipeline total 1,322.533 s, config 289.853 s, manager 114.837 s,
work 1,727.224 s, cycle CPU 719.862 s. Last interrupted cycle is excluded from
these totals. Sampled host CPU p50/p95/max 43/82/87%; the two-consecutive->85%
stop condition did not trigger. RSS peak 365,035,520 bytes; free RAM minimum
9,267,105,792 bytes. Last sampled process read/write 3,615,262,456 / 684,335,443
bytes; process CPU 736.547 s. These include cache/metadata and are not disk-device
traffic or proof of formal collector noninterference.

Final immutable reader: DAY cutoff 162,396 / prefix 222,565,129 bytes / current
observed-segment CVD 863; NIGHT cutoff 31,324 / prefix 42,906,025 bytes / CVD 2.
Both retain QUALITY_INSUFFICIENT / CLASSIFIED_COVERAGE_INCOMPLETE and historical
cutoff identity. Reader verification is not a new login/API/browser acceptance.
The observer's original `snapshot.views.*.publishedEndByteOffset` field reads the
shared source's latest pointer, so its NIGHT entry shows DAY coverage. Those logs
are retained unchanged; per-view bytes above come from immutable artifact
integrity, and aggregate backlog uses actual publication events. No product
fallback or cross-session rewrite was used to repair that observer field.

## Remaining bottleneck and update/rollback decision

**Do not enter same-day acceptance or formal whole-version activation yet.**
Local duplicate computation was removed, but measured durable flush/path costs
remain substantial. More publications add projection, full verification and
per-cycle configuration/manager cost. The present evidence does not establish
that a naturally growing same-day source can catch up; it also does not prove
that every from-zero daily run necessarily fails.

The smallest next proposal is a separately approved design for reducing durable
metadata/path I/O round trips and repeated configuration/manager work, with exact
crash-recovery and path-replacement proofs. A batch transaction or storage/index
packing change is outside this completed package: do not remove fsync, reuse
unverified raw bytes, raise budgets, tune indefinitely, or start A.2/Plan B/SSD.
No runtime-only setting is evidenced to solve this backlog. Owner approval is
required before such architecture work; no further experiment is started here.

The existing private UPDATE_AND_ROLLBACK package remains the operation authority:
whole-version Git update, matching Node/lock/native dependencies, CRU34 normal
entry recovery, approved binding/writer ownership, physical source/prefix guards,
and rollback to the retained e81c5259 whole version / previous no-binding state.
Only this delta is added: a future approved stream binding needs a **new**
outputVersion and explicit `publicationSchedule` above. It must not relabel or
resume the old resolver/checkpoint. Exact merge/main, Owner candidate presentation,
natural append compatibility and normal authenticated API/panel acceptance remain
gates. Formal 62,000 / 84.8 MB trial limits and original 5/10-second FAIL remain;
no 9/29 activation promise, fixed-history replacement, merge or 8787 switch.

Aggregate machine evidence: [bounded-evidence.json](../evidence/cru55-ingest-prefix/bounded-evidence.json).
Raw ledgers, profiles, configs and interrupted outputs remain local only.
