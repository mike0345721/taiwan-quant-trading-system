# GUARDED_PREFIX_CONTINUITY_V1 — Level 3 review

Reviewed implementation: `b35e492b16f4e4762e299ee55137f228ea3e0a71` (4 experiment/test files).
Root implementation review plus two independent contexts; neither independent reviewer ran tests or edited files. Native evidence was read from the root's two budgeted runs. Final documentation descendants must leave these four files unchanged.

| Check | Root | Independent safety | Independent correctness |
| --- | --- | --- | --- |
| No product imports/default/artifacts changed | PASS | PASS | PASS |
| Complete metadata/hash chain and exact raw bytes | PASS | PASS | PASS |
| New guard acquired and both checked before old release | PASS | PASS | PASS |
| Source/owner/resolver/session/cutoff binding and failure invalidation | PASS | PASS | PASS |
| Live receipt cannot be recovered from disk or another process | PASS | PASS | PASS |
| Fixed prior has independent identity/epoch/coverage | PASS | PASS | PASS |
| Real Windows write/append/conflict/exit counterexamples | PASS | PASS | PASS |
| Mapped-write bypass explicitly exposed, not hidden by PASS | PASS | PASS | PASS |

## Verdicts

- `/root/continuity_safety_review`: **APPROVE, B=0**, exact b35e492. Re-reviewed explicit frozen receipt context, child private-path restrictions, per-call measurements and real handle counts. Run 2 has 9/9 passing tests; cumulative dynamic time 6.605 seconds. Approval only for isolated prototype.
- `/root/continuity_correctness_review`: **APPROVE, B=0, S=0**, exact b35e492. Re-reviewed the same changes and 36 recorded verify calls. Three-step reads 917,504 vs 2,097,152 bytes, exact hash; steady handles 185/185/185, overlapping 187 then 185. Approval only for isolated prototype.
- Root: **APPROVE for PROTOTYPE_PROVEN_WITH_LIMITS**, B=0. No product integration, G1-A acceptance, Merge or runtime authority follows from review.

## Findings retained (N)

1. Mapped write really bypassed the lock. A zero-suffix reuse did not detect the mutation; a full read did. The guarantee is materially different from re-reading every publication. Kernel/privileged writes and silent storage damage are also outside the proof.
2. `liveGuardCount` and `peakGuardCount` are logical lease counts. Separate GetProcessHandleCount measurements support only the two tested expansions, not all-day absence of leaks. The reused native cleanup API does not check each cleanup return value; long-held resource stability remains unproven.
3. Owner/session/resolver values are caller-bound context in this prototype. Production owner liveness, lawful session resolution, collector rotation/backup compatibility and large-ledger restart costs remain integration requirements.
4. Timings include test hooks and warm/cold native setup; the full-read oracle has a different cost boundary. Raw read reduction does not establish disk I/O reduction or end-to-end latency improvement.

Run 1 (9/9, 2.410 s) is preserved. Run 2 (9/9, 4.195 s) was justified by added receipt fields, child restrictions and measurement coverage. No third dynamic run was started; no CVD campaign was started.
