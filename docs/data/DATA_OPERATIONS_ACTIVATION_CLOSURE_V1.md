# CRU-52 activation observability closure

Candidate base: `db476b81f4908c16cc72a5376655943a3e220ab6`.
Owner authorized this bounded pre-activation patch on 2026-09-14. A new exact HEAD
requires separate Owner Merge authorization. No formal deployment or task install
is performed by candidate validation.

## Single scheduler policy

`config/data-operations-scheduler-policy-v1.json` is the frozen machine-readable
policy: Asia/Taipei / Taipei Standard Time, DAY 13:55, EOD 16:10, FINAL 18:10,
grace 15 minutes, prefix TWQuant-DataOperations. These are CHECK times, never
dataset publication dueAt. The API and formal installer read the same file;
the UI renders the API projection. Explicit installer time arguments must match
the policy and Windows timezone must match; the installer never changes OS time.
Candidate task validation retains isolated explicit test times.

## Evidence and bounded reads

Within the existing A.2a single-writer guard, scheduled runs add requestedTradeDate
and policy SHA to terminal receipts. Requested date survives input-resolution
failure even when inputTradeDate is unknown. Existing immutable receipt names
and A.1/A.2a calculations remain unchanged.

After receipt persistence, `automatic-checkpoints/YYYY-MM-DD/day|eod|final.json`
stores latest and lastSuccess pointers only. Pointers bind run ID, state and byte
SHA to an actual immutable receipt. Later checkpoints cannot overwrite earlier
checkpoint evidence; older attempts do not regress a pointer. Failure preserves
prior success; replay/candidate modes never update these indexes. Same-time
different-run conflicts fail closed. Broken indexes are not silently rebuilt by
scanning history; preserve evidence and investigate the index/receipt mismatch.

The read-only API reads exactly today's three index paths and at most two bounded
receipt references per index. No filesystem enumeration or whole-history scan.
Legacy unindexed receipts are not backfilled as current scheduled success.
SCHEDULED plus exact task identity is the existing runner provenance contract;
receipts alone do not prove a natural Windows trigger. Do not manually invoke a
production task and count it toward the later five-day gate.

## Current-day projection and UI

`GET /api/v1/data-operations` adds schedulerHealth with observedAt, Taipei date,
governed calendar identity, policy identity, applicability, expectedCheckpoint,
and all three checkpoint states/reasons/actions/receipt identities:

- before check time: NOT_DUE;
- check time through grace inclusive: WAITING_FOR_RUN;
- after grace without valid applicable terminal receipt: OVERDUE_NO_RECEIPT;
- valid same-date/checkpoint scheduled success: SUCCEEDED;
- valid same-date/checkpoint failed receipt: ACCEPTANCE_JOB_FAILED.

Early/future attempts cannot establish an expected run. EOD cannot satisfy FINAL;
yesterday cannot satisfy today. Governed non-trading dates have NOT_EXPECTED
applicability and NOT_DUE checkpoints. Uncovered/invalid calendar stays UNKNOWN.
Unverified receipt/index evidence remains explicit; absent valid evidence does
not prove a task never ran. A stuck/crashed runner without a terminal receipt can
therefore become OVERDUE_NO_RECEIPT, not a fabricated data failure.

The existing Data Quality page shows 今日進度 first. If no current-day assessment
exists it says today's collection completeness is unknown and labels older data
最近一次資料營運評估. Existing feed states, source-health table, reasons, research
impacts and remediation remain canonical. Scheduler observedAt advances only the
operational observation time, never source timestamps. Refresh rejects older
scheduler observations, including while no valid data artifact exists.

## Gates and rollback

Candidate L0–L5 uses isolated outputs/runtime and test-only receipts; no natural
scheduled-day success is claimed. After future exact-head Merge authorization,
follow LL-009 whole-version synchronization, protect the dirty report with hashes
and dirty/incoming intersection, verify version identity and formal L0–L5, freeze
physical BUILD_A1 bindings, validate timezone and installer, then install/read back
exactly three tasks only under Owner authorization. No single-file deployment.

Start the five-day gate on a future applicable trading day only when all natural
triggers were active before DAY. Holidays/weekends do not count. Failed days stay
in immutable evidence. Disable only verified owned tasks; preserve all receipts
and roll back a whole approved version. CRU-52 stays In Progress.

`5_DAY_OPERATIONAL_GATE = PENDING_POST_DEPLOYMENT`
`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`
