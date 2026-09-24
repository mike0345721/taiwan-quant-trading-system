# CRU-55 Plan A delivery — 2026-09-24

**Plan A is implemented and engineering-reviewed; performance acceptance is FAIL.** New compatible cutoffs reduce only appended archive records and recompute the six windows, session products and chart bins through an exact resumable index. This is an implementation delivery, not a source-only merge wait or a proposal to increment later. The original full current/prior raw-prefix validation remains in force. The candidate does not meet the all-day timely-use goal and is not authorized for merge or formal rollout.

Owner authority: [Plan A instruction](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5792634365), and the latest CRU-55 description. Same worktree `data/worktrees/cru55-cvd-performance-v1`, branch `codex/cru55-cvd-performance-v1`, Draft PR73. Starting HEAD `08f3d24eb68773003f896a4183335376a95fd8e4`; measured final runtime `aae9e527651033e27eb38037fcc5527ccc6db985`. Approved remote main remains `1ad9ec7c1814e401f8352048638f0a398bcf74fe`. Final delivery commit/readback is recorded in the PR conversation to avoid a self-referential hash in this file.

## Implemented behavior and exactness

`cru55-indexed-projection.mjs` appends projection state and ordinal range roots to a sealed derived checkpoint. `cru55-projection-range-index.mjs` stores immutable content-addressed range pages and answers all 213 current/prior/context/display queries in one resumable traversal. `cru55-stream-pipeline.mjs` applies the existing read budgets and publication fencing. The original full-scan reducer remains the oracle through `projectionMode: FULL_SCAN`.

The checkpoint binds source, resolver, cutoff, terminal/archive page and completed projection. It is explicitly `DERIVED_INDEX_ONLY_NOT_RAW_PREFIX_PROOF`. The indexed selector uses explicit rebuild reasons for incompatible source/resolver/schema state, active-segment change, cutoff/clock regression and historical availability reevaluation; the outer pipeline's source/resolver binding mismatch still fails closed and does not authorize an in-place source change. Corruption fails closed. Index persistence precedes committing its projection state/counters; collision reads after interruption consume the same byte/page budget. Oversized index metadata is rejected before budget consumption/content reads, including recovery collisions.

Physical predecessor, selected-path bridge, event/availability/ordinal window membership, OHLC ordering, minute sums, final VWAP folding, missing values, continuity, prior publication and Handoff semantics are retained. Exact integer-safe aggregates may skip subtrees; fractional/unsafe sums descend to leaves in physical order. No numerical tolerance was added.

This is **not an unconditional O(delta) whole-chain claim**. Archive normalization/reduction is incremental for compatible cutoffs, while historical query leaf applications may still grow with history; the full current/prior raw validation is intentionally unchanged. Counters distinguish archive `processedRecords/newRecords/historicalReplayRecords`, index nodes, aggregated nodes, ordered leaves and raw verification bytes. `historicalOrderedLeaves` counts query-leaf applications, not unique records; `unsafeHistoricalLeaves` only identifies locally unsafe leaves, not every leaf visited due to accumulated fractional state.

## Verification before long acceptance

| Cutoff | Indexed new records processed | Historical archive replay | Full-scan records processed | Result |
| ---: | ---: | ---: | ---: | --- |
| 300 | 300 | 0 | 300 | Full immutable artifacts exact |
| 319 | 19 | 0 | 319 | Full immutable artifacts exact |
| 356 | 37 | 0 | 356 | Full immutable artifacts exact |
| 357 | 1 | 0 | 357 | Quote-only cutoff; full artifacts exact |
| 488 | 131 | 0 | 488 | Full immutable artifacts exact |

Each cutoff executes all 213 queries and retains full current-prefix byte verification. Comparisons include all products, hashes and publication history, not only CVD or the same-cutoff cache.

- Four range-index tests PASS: integral/fractional/late folds, simultaneous queries, serialized budget resume and tampering.
- Nine existing projection tests PASS with full indexed/oracle job and hash comparisons: physical predecessors, quotes/unrelated tails, boundaries, continuity, invalid price clocks, long NIGHT, late OHLC/VWAP and prior dependencies.
- Existing pipeline suite initially 10/11 PASS; its budget assertion omitted newly introduced index-page reads. The denominator was corrected, and the affected test passed without increasing budgets. Other requirements were retained.
- Three indexed-pipeline and seven state-transition tests PASS on final runtime. They cover successive cutoffs, late records, clock regression, quote-only tails, continuity/contract switch, newly eligible historical prices, schema/source/ordinal fallback, durable-index-before-job interruption, exact resumed products, and oversized QUERY/collision rejection with zero content reads/no publication pointer.
- Independent reviews found two blocking defects: uncharged collision reads, then oversized metadata checked after budget exhaustion. Both were fixed and reviewed on exact `aae9e527...`; both reviewers returned engineering APPROVE/B0/S0. This does not approve performance or deployment. Runtime CI182/run35940010158 SUCCESS; initial runtime CI181/run35939123351 SUCCESS. Secret scan PASS.

Earlier sandbox-path failures, interrupted slow initial query implementation, failed baseline managed launch and all prior delivery failures remain preserved; none are counted as passes.

## Normal managed and original-page results

All runs used the normal isolated managed launcher and real session login on port3066, not formal8787. Source is the same frozen lawful 62,000-record / 84,757,597-byte private fragment, SHA256 `71a3bfb12e0270963d602c1818764b4a57eb05aa53b06272a34e446f4450a3e2`, with original bytes/order/clocks. Copy/hash preparation warms the filesystem cache; host/cache load is uncontrolled. Historical prior-runtime comparisons are descriptive, not a fresh randomized paired speedup experiment.

| Metric | Previous runtime0342 (runtime source same as08f3) | Plan A final runtimeaae9 | Original gate |
| --- | ---: | ---: | --- |
| Normal launcher to authenticated latest DAY62000 | 324.779 / 409.631 s | 486.336 s | <=180 s: FAIL |
| 30min growth: published / total batches | 1800 / 1800 | 1800 / 1800 | Final unpublished0 |
| Append to API p95 / p99 | 154.644 / 177.891 s | 114.250 / 126.632 s | <=5 / 10 s: FAIL |
| Original-page visible p95 / p99 | Incomplete; original tab lost | 118.752 / 129.980 s | p95<=10 s: FAIL |
| Burst recovery to preburst backlog | 151.564 s | 40.219 s | <=120 s: PASS |
| Maximum advancing API gap | 98.354 s | 67.082 s | <=30 s: FAIL |

Initial Plan A runtime8af3 cold run also failed at458.698s; it is retained separately from the repaired runtime. Final aae9 cold has12 API/artifact checks PASS, no API exceptions, and1,127 initial-view503 responses (NIGHT275, DAY852); none follows that view's first valid200. Initial8af3 cold retains1,044 initial-view503 responses. Previous approved-main cold measurements480.144/495.371s and prior failed/unpublished baseline evidence remain in the 2026-09-23 delivery; they are not silently replaced. No stable cold or direct-pipeline speedup is established by this round.

Steady acceptance (`candidate-perf-plana-steady-v1`) starts from10,000 records, appends27/s for30min with54/s for60s at minute10, and allows3min drain. Warm clock1790210911769; final60220. All1,800 batches/50,220 appended events eventually publish; **all1,800 exceed10s**, max API133.101s. Preburst backlog864 records. No API exceptions and no verification restarts during this interval. The earlier12.8min partial snapshot retains36 not-yet-published batches; final publication does not rewrite it.

The same original Chrome tab1096307382 remained present throughout30min+drain, without reload or replacement. It initially displayed NIGHT and switched to DAY when available. The final audited summary has1,378 in-interval DOM attempts:1,377 successful reads plus1 failed read; maximum observation gap43.256s. An attempted background sampler failed with an observer execution-context error while the tab remained alive, then awaited sampling resumed on that same tab. Five metadata events and62 outside-interval samples are separately counted. The earlier summary's1,377/24 counts are retained as superseded snapshot evidence. Independent review caught the failed read being classified as metadata; the offline summary now retains failed observer events and prohibits stale artifacts on failed reads from satisfying coverage. Its regression test PASS. DOM latency is the first observed covering artifact and a conservative upper bound; sampling gaps are not continuous1Hz proof. All1,800 batches have DOM coverage, but the visible-latency gate fails. This does not explain or erase the previous run's target loss at27.5min. Browser target loss and HTTP503 are separate evidence classes.

Steady DAY/NIGHT x six-frame real-login API/artifact parity:12 PASS. Postrestart12 PASS; original-page six buttons, finalartifact/CVD and overflow check recorded. No UI/login/updater redesign. Mid/final console warning/error collections are empty; final collection is marked after intentional server shutdown rather than treated as in-interval monitoring.

Per-request diagnostics retain1,044 HTTP503 responses: before warm, NIGHT121 and DAY121 were `PROJECTION_NOT_AVAILABLE`; after warm but before the first DAY200, DAY had802 `STREAM_SELECTION_INVALID` responses. All802 bounded postresponse snapshots show DAY absent from selection and missing from managed state. First valid DAY200 occurs warm+473.758s. Neither view has a503 after its own first valid200. Thus these responses are initial-view availability failures, not evidence of a lost tab or an established view regressing; their substantial DAY delay is not excused. The postresponse snapshots are non-atomic and cannot prove transaction-level causality. API exceptions0.

## Controlled interruption and representative load

After the steady interval, the remaining1,780 original records were appended as1,009 immediately, ten72-record batches and one51-record batch. These rates derive from the frozen fragment's observed active-second maximum1,009/p9572. This is compressed arrival stress, **not a natural peak or full-day proof**. Combined peak+restart finished in145.662s,12/12 batches published, no API exceptions. It does not isolate peak-only latency because a controlled restart occurred during the same experiment.

The writer was interrupted inside partial verification after identity/creation/command/HEAD checks and restarted through the normal managed entry. Recovery observer reached latest62000 in26.772s with verificationRestarts1 and complete current/prior raw validation. Final artifact `e55d1e2d09b2878017fbd1360fb676316738e872940c63102e7aa3f76b522ef5`, CVD-44. All products exactly match uninterrupted finish from the same sealed projection and same previous/adjacent references. This recovery comparison alone is not an independent full-scan construction proof.

An independent offline full-scan reconstruction after measurement processed all517 archive pages/62,000 records. It verified every archive-page/chunk hash, all84,757,597 original raw bytes against the frozen SHA256, and parsed original-raw equality for every archive record. The entire sealed projection/job hash, all finished products and final artifact hash match exactly, with no identifier normalization and zero float tolerance. Job hash `899946e953aaaf0f8576fefbb5a1a04b7244c85e5af07f4520e149e7f759cd83`. Limits: the oracle consumes archived semantic classification facts rather than rederiving them; previous/adjacent products are hash-verified and raw-prefix-bound, not independently reconstructed. This23s offline semantic audit is not a runtime/performance benchmark.

Lawful representative coverage is62,000 records, DAY/NIGHT, increasing compatible cutoffs, a compressed peak and restart. The available extra dated fragment has1,800 records and a nonadjacent date; it cannot establish adjacent-trading-day handoff or a larger full-day corpus. Larger natural full-day load, adjacent-date rollover and sustained live peak acceptance remain NOT_ESTABLISHED. Existing exact semantic tests cover their specified boundary/fallback cases; they do not substitute for missing natural data.

## Remaining cost and minimal alternative decision

Managed stdout lacks a per-cycle return wall clock, so exact whole-window phase totals cannot honestly be reconstructed. A conservative subset includes only complete contiguous jobs whose first-cycle work lower bound is after warm and whose following job starts before the end of30min+drain. It includes63 jobs/1,721 cycles, excludes2 boundary groups/45 cycles and12 outside groups/241 cycles, and excludes the restart log. Phase names are return states and may include transitions; these are not pure-function CPU measurements.

Within this bounded subset: pipeline1,141.211s, config452.996s, manager223.353s, work1,817.559s. QUERY-return cycles contribute531.792s pipeline (46.60% of subset pipeline) and973.352s work; config+manager together consume37.21% of subset work. QUERY-return includes9,000 archive/index page reads plus46 raw-range reads across mixed phase boundaries; the page counter must not all be labeled index-only. VERIFY-return pipeline258.251s and VERIFY_PRIOR-return80.874s remain material; ingestion/projection account for the rest. This identifies material index-query/management costs without claiming exclusive causal attribution or that full raw validation is the sole bottleneck.

Completed-job counters are counted once per job, not re-summed per cycle:50,220 new records plus21,124 historical archive reductions from one `ACTIVE_SEGMENT_CHANGED` rebuild, total71,344 processed. Normal compatible jobs avoid historical archive reduction; the explicit session-transition rebuild does not. Historical query-leaf applications7,938 and rangeNodes32,416 remain separate costs (the historical-leaf field is present in61 jobs and absent in2; other counters cover63). Zero historical archive reduction is not a claim of zero historical quote lookup or index reads.

Steady process counters over the recorded API measurement span: writer CPU871.828s, read6,314,795,637 bytes, write479,294,242 bytes, peak RSS357,335,040; server CPU189.688s, read3,220,981,984 bytes, peak RSS323,772,416. These are cached process I/O counters, not physical-disk traffic. Sampled host CPU p5050%,p9573%,max97%; no controlled capacity extrapolation.

Plan A removes repeated archive reduction for compatible cutoffs but this representation still revisits many small index pages and pays repeated config/manager work. Full raw/prior validation also remains a material cost. The evidence does not justify claiming that weakening raw verification alone is necessary or sufficient for5s.

The smallest next engineering decision is **one bounded index packing/locality and manager/config-cost experiment**, retaining the same full-prefix contract and exact oracle, with an explicit before/after read/node/cycle budget and stop condition. This would be a further performance design, not claiming this failed acceptance passed. Do not keep tuning indefinitely or treat source-only merge as a prerequisite. If Owner instead chooses immutable raw segments/checkpoints (Plan B), approve that integrity contract separately before implementation: specify modification/replacement/truncation/rollback threats, durable manifest/tail validation, crash recovery, audit freshness and fail-closed behavior, plus additive migration and rollback to current full-prefix verification. Hashes alone do not make a mutable raw source immutable. No such contract change was implemented here.

## Evidence, cleanup and resume

`CRU55_PLAN_A_EVIDENCE_20260924.json` binds retained private receipt names/lengths/SHA256 values, not publicly reproducible market data. Raw records, sessions, credentials, SQLite, mutable runtime selection and full private logs are not uploaded. Previous49-file evidence index and frozen artifacts remain unchanged.

Reproduction uses committed `prepare-cru55-performance.mjs`, `launch-cru55-performance.mjs`, `observe-cru55-performance.mjs`, `check-cru55-performance-api.mjs` and offline `summarize-cru55-performance.mjs`, with the frozen manifest-listed private input. Private orchestration helpers and measurements are retained under`data/perf` and`data/cru55-dynamic/acceptance/candidate-perf-plana-*`; do not reuse run IDs or overwrite receipts. The additive API diagnostics sidecar does bounded post503 non-atomic snapshots and adds observation I/O; its sampling scope is disclosed and it should be held constant in paired runs.

Attempting a fresh normal-managed baseline in a detached exact08f3 checkout failed the existing candidate-branch allowlist before launching writer/server (`CRU55_CANDIDATE_WORKTREE_REQUIRED`). The guard was not weakened. This leaves no fresh paired managed baseline; use historical comparisons with that limitation. The read-only baseline checkout and failed receipt are preserved.

All owned test writer/server processes were stopped with identity checks; the original browser tab was explicitly closed after evidence capture. Final cold cleanup is recorded separately. PR72, formal8787, collector/raw/SQLite/scheduler, five-day counters and unrelated main-workspace changes were not modified. `formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`.

Resume packet: CRU55 CURRENT/In Progress; same Draft PR73, no merge/deployment. Completed Plan A implementation, fixes, targeted tests, normal managed/real-login/API/original-page long acceptance, peak/restart, independent review and evidence delivery. Performance FAIL; natural full-day acceptance NOT_ESTABLISHED. Next action is the bounded alternative decision above, not redoing UI/login/updater or waiting for oldrun2/source-only merge. Engineering review and CI do not change these acceptance conclusions. Final exact delivery commit, both review verdicts, CI, GitHub/Linear/Owner-overview readbacks are in the PR delivery receipt.
