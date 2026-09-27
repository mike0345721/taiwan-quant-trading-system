# CRU-55 guarded continuity integration — G1-A FAIL

Authority: PR73 Owner comments [5847637358](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5847637358) and [5850802275](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5850802275), CRU-55 conditional integration decision. This is the authorized isolated candidate, not formal policy or research admission.

## Exact implementation and engineering

Campaign runtime / Level3 reviewed HEAD: **ed537b4c48a73d035071530a27ebd80aed4cefd7**. Branch `codex/cru55-cvd-performance-v1`, PR73 draft/unmerged. Delivery after this runtime changes only a hermetic test fixture and evidence/documentation; no new product runtime or campaign retry.

`STREAM_PAGED_V3` explicitly binds `GUARDED_PREFIX_CONTINUITY_V1` to `stream-continuity-v1`. Pipeline, independent prior verification, real managed owner/native process creation-time liveness, per-request reader, candidate binding, and existing authenticated entry are connected. Process-local receipts cannot be revived from disk. Invalidation precedes checked guard release; same-file current/prior keep independent roles; restart/guard-loss requires full verification. Publications retain original availability, record actual publication separately, and remain research-ineligible. Formal FULL_PREFIX default and formal activation exclusion remain.

Level3: implementer plus independent correctness/safety contexts APPROVE, B=0/S=0 at the exact runtime. B1 (same-file transition/restart prior eligibility) and B2 (interleaved stale prior replacing newer selection/registry) were repaired and re-reviewed before campaign. Nine distinct integration cases plus 24 affected existing regressions passed across focused runs. Exact six-frame numerical/time/quality/null parity, same-file independent prior, true process exit/restart, invalidation/cleanup failure, guard loss, collector-compatible Node/CPython reopen/append and date-file rotation were covered. Decimal/unsafe-volume rejection remains identical to existing FULL_SCAN behavior; no numeric tolerance changed.

Small tests including preserved failures and final CI fixture correction: approximately **157.663 seconds / 1,800 seconds**. GitHub CI205 exposed a test setup assumption (candidate worktree vs CI ordinary checkout), not a product-runtime failure. Final fixture creates its own isolated Git metadata/checkout; focused test passed in 1.564 seconds. The failed CI is retained; final delivery CI is tracked on the delivery commit.

## Campaign result and complete population

**G1-A FAIL / NOT_MET.** Single candidate attempt. Preparation 32.506s; measured runtime 2026-09-27 09:14:35.033–09:34:47.808 +08. Initial 31,322-record / 42,903,318-byte prefix first published in 233.896s, authenticated API first seen in 233.935s. Flow began 253.594s after observer start.

Fixed plan: 198,016 normal records over 60min, then 12,914 records over 5min with one normal restart, then up to 5min drain. Actual flow stopped after **954.899s (15min54.899s)** with **51,133 appended records**, at `HOST_CPU_GATE`. Last two host samples were 91% and 91%, 32.735s apart. No restart or drain occurred. No unchanged rerun, second candidate, third round, prototype/M4/packed rerun, or 100ms calibration was performed.

| Population | Planned | Appended | API/UI observed | Appended unobserved | Unsent |
|---|---:|---:|---:|---:|---:|
| Normal | 198,016 | 51,133 | 45,420 | 5,713 | 146,883 |
| Restart | 12,914 | 0 | 0 | 0 | 12,914 |
| Combined | 210,930 | 51,133 | 45,420 | 5,713 | 159,797 |

**Full-population API/UI p95/p99 are not established (null), not PASS.** Per-record analysis retains all 51,133 actual arrivals and every missing result. For reference only, the 45,420 successful observations have API p95/p99 77.685/96.872s and UI p95/p99 130.302/138.906s, measured from actual append visibility. Planned-origin API p95/p99 77.698/96.888s, UI p95 130.316s. These subset figures cannot stand in for the full denominator or planned window.

UI stayed on original tab `1096308113`; it was not replaced or reloaded. Background sampling lost its active tool context; an attempted cancellation timed out/reset the CUA kernel. Enumeration IDs changed, but the same Chrome tab was recovered. All 23 sampler errors remain, alongside 140 valid DAY samples and 21 sampled unavailable states. Maximum successful DOM-evaluation gap: **163.557s**; maximum gap among valid DAY samples: **50.482s**; flow-to-first-valid-DAY observation: **139.446s**. The original/resumed clock bridges are retained. UI figures are first-observation latency including polling/interruption, not exact rendering time; continuous observation is not established. No gap was silently deleted or replaced by a new tab.

## Source, commit, publication and backlog

| Final state | Records | Bytes |
|---|---:|---:|
| Source | 82,455 | 112,884,302 |
| Committed | 78,576 | 107,570,586 |
| Published / selected DAY | 76,742 | 105,058,059 |
| Uncommitted backlog | 3,879 | 5,313,716 |
| Unpublished backlog | 5,713 | 7,826,243 |

Final selected immutable artifacts were hash-checked separately from first-observation coverage. NIGHT remains 31,322 records / 42,903,318 bytes. Warm snapshot publication backlog reached 5,713 records at stop; intermediate snapshots include recovery from 5,015 to 2,074 records, which does not establish sustained capacity. Initial cold backlog is separately reported.

The entire actual source is byte-for-byte equal to the original frozen prefix, including line count. SHA256: `d569f73dbc5a7e369954adacdd8145ed2df65a56a948d2ce09aca8ef6ed11db2`. The preparation verified the unchanged full frozen source: 1,510,562 records / 2,074,014,548 bytes, SHA256 `907e0722abde0214c2f5c1f4e370175f245f2f4f2b304d32c61980c0dd6db3f7`. This partial run is not mature full-source cold acceptance or a natural trading-day test.

Input precision remains unqualified: actual append lateness p99 587.558ms, max 1,090.481ms; original precision/bin failures are retained. No tool calibration, source filtering, deliberate slowdown, or tolerance change was used.

## Resources, cleanup and research isolation

Host instantaneous CPU samples: p95 85%, maximum 91%, 41 samples. Writer maximum sampled RSS 331,923,456 bytes (~316.5MiB). Writer interval CPU p95: 55.091% of one core / 4.591% of twelve-core theoretical capacity. These are different measurements from host instantaneous CPU; they do not prove CVD is the sole high-load cause. Writer sampled logical reads 1,932,726,189 bytes; not physical HDD throughput. Appender, observer and server statistics are separately retained. Runtime RAM/disk checks did not trigger, but per-sample free RAM/disk values were not persisted; no minimum series is claimed.

Last completed cycle's continuity totals: full raw reads 131,178,195 bytes; suffix reads 62,199,027 bytes; metadata chunks 25,047; completed verifications 72. These are bounded partial-run counters, not an end-to-end speedup comparison.

Original cleanup reported false: concurrent writer termination caused identity/absence races and blocked server cleanup. Original `result.json` and all errors remain untouched. The unmodified identity-checked controller was subsequently retried: server stopped at 09:35:19.138 +08; separate verification confirmed writer/appender/server and 3072 listener absent. Recovery receipt is separate; the original failed cleanup is not relabeled. Dead-owner reader refusal was also confirmed (`CRU55_PRODUCER_DEAD_OR_UNKNOWN`).

All **782 successful authenticated API samples** (766 DAY, 16 NIGHT) carried researchEligible=false and the continuity policy. Both selected artifacts remain QUARANTINED. No trusted baseline admission was implemented or granted: complete trusted-source comparison plus time/coverage/quality admission is still required. Rehashing this file is not admission. The accepted mapped-write limitation remains; later verification cannot retroactively establish intraday visibility or undo corrupted raw data.

Formal 8787 remained at `e81c5259b5e38db6ad573242e9cf1ee4f305207f`, with unchanged start time 2026-09-26T00:50:21.566Z. No merge, formal switch, collector/raw/SQLite/schedule/five-day mutation, model promotion or execution route. Safety remains 0/true/false/false.

## Delivery and remaining gates

[Machine-readable result](g1a-result.json), [local evidence hashes](g1a-evidence-hashes.json), and [core checkpoint](core-checkpoint.md). Private source, credentials, raw logs and per-record files stay local. Both independent reviewers rechecked the stop, population, UI gaps and research boundaries; they support FAIL, not release.

CRU-55 remains In Progress / G1-A STOPPED. CPU stop is not a root-caused product repair opportunity authorizing an automatic second run. G1-B complete eligible natural session/capacity and G1-C actual merged-main whole-version update/residency remain separate gates. No daily readiness, full research chain, or formal deployment is claimed.
