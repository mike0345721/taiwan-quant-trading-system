# CRU-49 Flow refresh / V2 dependency delta

Scope: PR #62, following review design comment 5642055943 and Linear handoff
82c8739b-8490-4405-9cd5-7211f23e36e1. Draft candidate only, not deployment authorization.

## Runtime contract

- GET `/api/v1/observed-flow` uses the existing session boundary and bounded
  CRU34 adapter plus existing producer heartbeat/instance/path validation.
  It does not rebuild chart, read the ledger, query research or start a collector.
- `delivery.servedAt` and runtime/worker identity are transport metadata, never
  replacements for source availableAt/observedAt/validUntil.
- Visible authenticated pages poll with a 5-second target after completion,
  one request in flight, an 8-second abort timeout and no immediate retry loop.
  Hidden pages stop requests; restoring visibility evaluates age before polling.
  Source freshness is not guaranteed by the polling interval.
- One Flow merge channel handles polls and dashboard responses. Session generation,
  request ordering, identity-scoped ordinal/time watermarks and retired identity
  rejection prevent rollback, including after unavailable responses.
- The presentation clock checks the existing validUntil without modifying source
  times or values. Expired evidence is STALE. Unverified clocks, transport failure,
  unsafe/missing producer, or chart identity mismatch cannot appear LIVE.
- Existing pressure formula, coverage gate, Path 30s and all six windows remain
  unchanged. Refresh never fits/clears the chart or changes selected timeframe.

## V2 disposition and wiring

Actual 2026-09-12 bounded checks: candidate DB and latest-backtest are absent;
service reasons are V2_DATABASE_NOT_READY / V2_BACKTEST_NOT_READY (503).
The approved-runtime SQLite is readable and queryable; approved latest-backtest
is absent. This is missing candidate wiring/report, not a reproduced schema or
permission error. The old preserve-worktree report is not an approved substitute.

Required `v2Research.decisionSupport()` remains on the main snapshot/dashboard
path. `/api/v2/research` and `/api/v2/backtests` serve research AND options pages;
they load on page entry, outside workspace startup/Flow refresh. Errors remain
visible in their own UI and console. Only the two known non-sensitive 503 reason
codes pass through HTTP; unexpected internal errors stay redacted.

Optional explicit process configuration (defaults remain the appRoot paths):

```text
V2_RESEARCH_DATABASE_PATH=<approved governed v2/data/research-v2.sqlite>
V2_BACKTEST_REPORT_PATH=<approved governed v2/reports/latest-backtest.json>
```

SQLite opens readOnly/query_only. The report path also selects its existing sibling
research reports and forward-ledger root; use a complete governed V2 root, never
an arbitrary old report. Missing accepted artifacts remain unavailable; no rebuild,
migration, daily update or implicit fallback is performed.

## Candidate validation / evidence

F1–F5: `tests/cru49-flow-refresh.test.mjs` (clock/lifecycle/ordering) and
`tests/cru49-flow-route.test.mjs` (bounded file adapter/semantic equality).
F3/F6: `tests/cru49-flow-http.test.mjs` exercises normal login, protected GET,
CSRF/logout and exact 503 bodies in a disposable MOCK server, not real L4/L5.
Retain original producer/lock/auth regressions and their original SHA/time evidence.

After the final candidate is fixed, capture a 3-minute bounded real candidate
observation: exact SHA, roots, process instance, source times, ordinal, six-window
states, failures, chart identity and API latency. No new raw events means no claim
of real-time advancement. Actual cross-session observation remains PENDING.
Record L0–L5 separately. No fixture, API count or old video proves new L5.

## Whole-version rollout / rollback (separate Owner gate)

1. GPT independently reviews the exact pushed candidate and evidence; Owner
   separately decides Merge and formal rollout. Do not mark Owner Accepted/Done.
2. Before approved rollout, record resulting main SHA, previous runtime SHA,
   configuration paths, process identities and checkpoint/log locations.
3. Synchronize the whole governed version via Git, not single-file copying or old
   updater. Keep producer runner/starter same version; preserve raw ledger and
   checkpoints. Configure only verified readonly V2 inputs and existing CRU34 paths.
4. Restart only verified owned processes as required by the approved rollout;
   verify auth, dependency, truthful API/browser, selector and runtime observation
   through the normal shortcut. Do not imply untested cross-session acceptance.
5. On failure stop only verified new instances, restore the recorded prior whole
   version/configuration, resume its preserved checkpoint, and verify shortcut,
   safety, API/browser. Preserve failed-version logs. Rollback does not eliminate
   the original producer defect in an older version.

Safety remains formalWeight=0, researchOnly=true, executionAuthorized=false,
orderRoutesEnabled=false. Formal8787/8790, normal shortcut, raw data, healthy
collector and CRU-47/48 are outside this candidate operation.
