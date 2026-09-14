# CRU-52 A.2b — Data Operations integration candidate

Approved engineering base: `342e4f480d4f06bed6153673e3d7d1700d3a9de0`.
Owner authorized candidate implementation on 2026-09-14. This document supersedes
the A.2a document's historical integration hold only for this bounded candidate.
No Merge, formal deployment, permanent task activation, or CRU-52 Done is authorized.

## Owner goal and dependency chain

Existing collectors/batch producers → A.1 daily acceptance → A.2a operational
profile/remediation/checkpoint → bounded acceptance job → immutable history →
session-protected GET → existing **07 資料品質**.

The page answers which date/checkpoint was assessed, what is missing/partial/unknown/
pending, why, affected capabilities, minimum next action, last automatic attempt,
last successful assessment write, last FINAL date, and acceptance job health.
Data Update (`POST /api/v2/daily-update`) remains independent and unchanged.
Update exit 0 never establishes Data Operations PASS.

## Input and artifact contract

`scripts/run-daily-data-operations-acceptance.mjs` wraps the existing A.2a guarded
writer. A.1/A.2a pure calculations, profiles and remediation semantics are unchanged.
The small shared `daily-data-operations-files.mjs` holds bounded reads and the
existing output-path/link protections. The API imports read helpers, not CLI jobs.

All paths must be explicit and absolute: `--data-root`, `--output-root`,
`--manifest`, `--evidence-root`, `--calendar`. Outputs remain strictly below
`dataRoot/quality/daily-data-operations`. Candidate scheduler mode additionally
requires this worktree's own `data` directory. No raw ledger/DB/projection writes.

The input index is a **path/identity selection contract**, not a new dataset registry:

```json
{
  "schemaVersion": "data-operations-input-index-v1",
  "governanceState": "GOVERNED",
  "governanceReference": "the reviewed local input binding",
  "evidenceRoot": "<dataRoot>/quality/daily-collection-acceptance/a2b",
  "calendarSha256": "<SHA-256 of the existing governed calendar bytes>",
  "selection": "BUILD_A1",
  "sourceBindings": {
    "ledgerDataRoot": "<absolute governed source data root>",
    "registryPath": "<absolute existing data-requirements-v1.json>",
    "registrySha256": "<SHA-256 of registry bytes>",
    "dailyStatusPath": "<absolute existing daily-update status path>",
    "databasePath": "<optional absolute governed readonly SQLite path>",
    "derivedArtifactPaths": [],
    "sessionsByCheckpoint": {
      "DAY_CHECKPOINT": ["DAY", "NIGHT"],
      "EOD_CHECKPOINT": ["DAY", "NIGHT"],
      "FINAL_TRADEDATE_CHECKPOINT": ["DAY", "NIGHT"]
    }
  }
}
```

`SCHEDULED` and `CANDIDATE_SCHEDULER_TEST` require `BUILD_A1`; a pre-created dated
pair is no longer a scheduler dependency. Inside the existing A.2a job guard,
the runner invokes the existing A.1 CLI with explicit governed bindings before
assessing A.2a. Calendar and registry bytes are hash-checked and copied into a
fresh per-run UUID directory below evidenceRoot. The resulting dated report and
replay-input pair are hash-pinned, replay-validated, and retained with that run's
identity. Later checkpoints build into new directories; prior pairs/history stay.
The child has a 10-minute bound; failure is `OPERATIONS_A1_BUILD_FAILED` within
the existing failed-job lifecycle, preserving lastSuccess/FINAL and latest history.

A.1's optional `--ledger-data-root` selects only read-only ledger/audit inputs;
its default remains dataRoot. All A.1 outputs remain under the candidate's own
dataRoot/quality/daily-collection-acceptance. No collector, daily-update invocation,
raw/DB/projection mutation or new A.1/A.2a calculation is introduced. Omit database
when unavailable; optional `batchEvidencePath` may replace it, never both. Derived
paths and per-checkpoint sessions must be explicit. Missing optional data retains
existing UNKNOWN semantics; malformed explicitly bound batch evidence fails A.1.
Governed non-trading dates build the existing lawful NOT_EXPECTED assessment even
without prior A.1 files. Due deadlines are not inferred from scheduler exit codes.

`MANUAL_REPLAY` may still use `DATED_A1_PAIR` to read the existing fixed dated pair,
or `PINNED_REQUESTS` below. Neither mode silently falls back to latest.json.

For frozen manual evidence use `selection: PINNED_REQUESTS` and `requests`,
with exactly one entry per tradeDate/checkpointType:

```json
{
  "tradeDate": "2026-09-11",
  "checkpointType": "FINAL_TRADEDATE_CHECKPOINT",
  "inputGeneratedAt": "<exact A.1 cutoff>",
  "report": { "file": "2026-09-11.json", "sha256": "<bytes hash>" },
  "acceptanceInputs": { "file": "2026-09-11.replay-inputs.json", "sha256": "<bytes hash>" }
}
```

Optional pinned `dueRules` references only already governed A.2a rules. No new due
rules or release times ship in this candidate. Index/calendars/inputs are bounded,
reject links and hardlinks, and bind the physical hashes. Ambiguous dates/entries,
roots, hash mismatches, checkpoint conflicts and replay inequality fail closed.
Governance strings/hashes do not themselves grant Owner approval.

`MANUAL_REPLAY` requires `--trade-date`. `CANDIDATE_SCHEDULER_TEST` also requires a
test trigger identity. `SCHEDULED` refuses a historical override and requests the
current Asia/Taipei calendar date from the governed calendar. It does not infer
the next futures session date. Each date's DAY/EOD/FINAL applies to the A.1
tradeDate contract (including its preceding NIGHT), and publication due still
depends on evidence. Calendar exceptions outside the pinned calendar fail closed.

The existing canonical layout is retained: immutable dated checkpoint revisions,
dated checkpoint views, `latest.json`, `job-health.json`, `runs/<runId>.json` and
failure receipts. Actual job health adds runMode, runtimeCommit, triggerIdentity,
inputResolutionIdentity and separate lastAutomaticAttemptAt/lastAutomaticSuccessAt.
Historical replay/test never advances the automatic fields. SUCCEEDED means
validated assessment saved, even when its data state is UNKNOWN/PARTIAL/FAIL.
FINAL can be UNKNOWN and is not PASS. Prior lastSuccess/lastFinalized survive failures.
Older input cutoffs or lower checkpoints cannot regress the materialized latest view.
Unknown guards are never taken over. Unwritable root/guard means nonzero exit and
no claim of persisted failure. Task Scheduler's result is then the external evidence.

## Scheduler contract

`install-daily-data-operations-automation.ps1` defaults to **Validate**, which does
not mutate Task Scheduler. All three times are mandatory, explicit HH:mm values:
`DayCheckpointTime`, `EodCheckpointTime`, `FinalCheckpointTime`. No production
times are chosen in this package. Times are Windows local time; formal activation
must verify Windows timezone is Asia/Taipei/Taipei Standard Time.

The hidden wrapper uses the existing PowerShell/Node pattern, exits with the Node
status, and writes only through the guarded acceptance writer. No daemon/watchdog.
Tasks use current interactive user, Limited privilege, 15-minute execution limit,
IgnoreNew, and exact action/path/arguments. Candidate prefix must match
`TWQuant-CRU52-A2B-Test-*`; candidate tasks have **no automatic trigger** and can
be manually run. Their evidence is labeled CANDIDATE_SCHEDULER_TEST.

Install rejects preexisting names. Remove preflights the complete set, verifies
exact ownership/action/principal, exports definition and last-result evidence,
and deletes only those tasks while not running. Capture its stdout as local
evidence before closeout. Never pass unrelated task names or use wildcard deletion.
Formal Install/Remove additionally requires `OwnerFormalActivationAuthorized` and
the fixed `TWQuant-DataOperations` prefix. That switch is a deliberate human gate,
not proof of authorization. Do not use it during candidate engineering.

## API / UI contract

`GET /api/v1/data-operations` is inside the existing session boundary: anonymous
401; authenticated 200, `Cache-Control: no-store`. No write/run/install/repair API.
Canonical validation and matching immutable revision are required. Terminal job
health must match its immutable run receipt. No valid assessment produces a
structured UNAVAILABLE / UNKNOWN with null counts, never an empty PASS.

The view preserves canonical state, date, checkpoint, required-and-due count,
rows, reasons, remediation, finalization and job health. Counts count canonical
in-checkpoint profile rows, including supporting/conditional/future; the count
scope is explicit and differs from the core required-and-due denominator. The
allowlisted projection excludes physical source paths and raw ledger content.
Lineage exposes hashes. History pointers identify the latest run and assessment;
the full immutable history remains local.

The existing source-health table/freshness/Data Trust stay present. The new layer
uses Chinese explanations with original reason codes and owner/action detail
expandable. UNKNOWN/PENDING use a waiting/unknown tone, not failure red.
The page labels the actual assessment date/cutoff and manual/candidate provenance,
so historical evidence cannot masquerade as today's collection success.

Refresh occurs on page entry/manual read and at most every 60 seconds while the
quality page is selected, authenticated and visible. Requests are single-flight,
15-second bounded. Older/conflicting date/checkpoint/generation/run responses do
not overwrite a newer view. Fetch failure explicitly marks displayed data not
updated. UI never recomputes an operational classification or source timestamp.

## Validation and later rollout gates

Candidate validation must report exact HEAD, test counts, real governed pipeline,
disposable scheduler read-back, real login/API and real browser L0–L5 separately.
Fixture/mock HTTP tests are not real-data L4/L5. CRU-49's existing 4h label compression
is PREEXISTING_UI_LIMITATION_NONBLOCKING; new observations follow LL-010 classification.

After GPT review and separate Owner authorization only:

1. Merge the reviewed tree; immediately read back CRU-52 and keep In Progress.
2. Fetch approved remote main; compare dirty paths to incoming paths, hash the
   preserved primary report, then non-destructively fast-forward primary main.
3. Sync formal runtime as a whole version. Verify remote main = primary main =
   approvedMainCommit = runtimeCommit, identity VERIFIED and SYNCED.
4. Run scoped L0–L5 on normal shortcut with the exact deployed version.
5. Freeze the BUILD_A1 governed source bindings, per-checkpoint sessions, Windows
   timezone, three explicit schedules and isolated A.1/A.2a output roots.
   Expected schedule and missed/overdue observability require explicit disposition
   before activation: an old SUCCEEDED/lastAutomaticAttemptAt cannot prove a task
   that never started is currently healthy. This remains an activation gate.
6. Separately authorize formal scheduler activation; inspect every persisted task.
7. Start the 5 applicable trading-day gate. Weekends/holidays/NOT_EXPECTED do not
   count; no historical replay counts. Failed applicable days remain evidence.

`5_DAY_OPERATIONAL_GATE = PENDING_POST_DEPLOYMENT`

Disable/rollback: preserve task XML/result and immutable history; after authorized
formal disable/remove, verify owned task identities first. Roll back the entire
runtime version through the existing controlled process, never individual files;
do not erase operation history, raw evidence or change approved source main to
hide a deployment failure. Candidate cleanup only removes its verified test tasks.

Safety remains `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`,
`orderRoutesEnabled=false`. CRU-49 runtime/bridge/producers, CRU-50 and CRU-53 are
outside this package. Candidate completion is not formal Product Ready or Done.
