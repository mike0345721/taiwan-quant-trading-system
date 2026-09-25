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

Results, review, CI and rollout delta will be appended after the bounded run.
