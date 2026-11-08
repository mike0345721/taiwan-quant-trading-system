# Existing daily writer: separate source and storage

This entry runs the existing 35-stage `v2/scripts/run-v3-daily-update.mjs` from a verified source checkout against the existing storage application root. It does not install a task, synchronize a checkout, start a dashboard/Producer/Bridge, or grant Owner acceptance. It has no consent/password/market-quality override.

## Binding and admission

Save a non-secret JSON binding outside the clean source checkout. Replace the placeholders with the reviewed deployment's **full** Git HEAD, tree and machine hostname. The following intentionally cannot pass preflight as written:

```json
{
  "schema": "daily-writer-binding-v1",
  "machine": "REPLACE_WITH_EXACT_HOSTNAME",
  "sourceRoot": "D:/Taiwan stock/owner-acceptance-runtime/306d29c",
  "storageAppRoot": "D:/Taiwan stock/standalone-v1",
  "expectedHead": "REPLACE_WITH_REVIEWED_40_HEX_HEAD",
  "expectedTree": "REPLACE_WITH_REVIEWED_40_HEX_TREE"
}
```

The proposed roots above were not accessed by this implementation task. The current dirty development checkout and old runtime HEAD are not deployable identities for this change. A later authorized Git deployment must put the reviewed code into the **same existing candidate source**; do not copy individual scripts into the primary or create another ETL/runtime.

Admission checks exact hostname, source top-level/HEAD/tree, clean tracked/untracked state, physical tracked blob bytes (ordinary Windows CRLF checkout allowed), local canonical paths, symlinks/junctions/hardlinks, source/storage non-overlap, existing storage directories and a nonempty DB file. Git checks disable optional locks and external fsmonitor; no network. Source files are read to verify their bytes. Storage checks read only filesystem metadata, not market records or SQLite tables, with a 250,000-entry ceiling; exceeding it fails closed. Before execution, a read-only SQLite check also requires the existing schema-migrations table and at least one market_daily row. Empty/missing databases are never bootstrapped by the bound entry.

`v2/data`, `v2/reports`, `v2/logs` and `data` must already exist. Existing history/live-events/intraday/forward/cache trees are checked for aliases; missing optional outputs remain missing during preflight. This is admission validation, not protection against a hostile process replacing paths after validation. Keep the deployment/source/binding stable while the writer runs.

Only the explicit OS environment names in `src/daily-storage-binding.mjs` are admitted by the Node entry. Unknown variables (including NODE_OPTIONS, GIT_* and application V1/V2/V3 path/date/batch overrides) fail with the variable name only. The parent entry rejects inherited DAILY_WRITER_BINDING_PATH; the entry supplies it to children after validation. Only the existing runner's exact bounded stage settings are accepted by child validation.

The Windows task host `scripts/run-bound-daily-update.ps1` explicitly constructs a system-only child environment instead of inheriting unrelated npm, browser, OneDrive or remote-launcher settings. It rejects nonempty Node/Git/V1/V2/V3/DAILY/DASHBOARD/CRU and process-policy overrides before launching; it does not delete or alter the caller's environment, registry, task principal, sandbox or execution policy. No environment values are logged, no `.env` is loaded, and no security-policy override is stripped to make execution pass. Preflight/dry-run create no logs or storage. Execute first verifies the bound plan and then streams this child only to fresh stdout/stderr files in the already-existing storage/v2/logs. Binding and CLI accept no additional fields/options.

## Commands for the coordinator

Use an absolute trusted Node executable and the source-root script. These are instructions only; no command below was run against deployment roots during implementation.

```powershell
& '<absolute-node.exe>' 'D:/Taiwan stock/owner-acceptance-runtime/306d29c/scripts/run-bound-daily-update.mjs' --binding '<absolute-binding.json>' --preflight
& '<absolute-node.exe>' 'D:/Taiwan stock/owner-acceptance-runtime/306d29c/scripts/run-bound-daily-update.mjs' --binding '<absolute-binding.json>' --dry-run
```

Both modes validate metadata/source identity, print the selected roots and runner, and return without creating directories, DBs, locks or reports, without running stages, and without network access. They do not assert that a writer is idle or that data quality passes. `--execute` calls the same original runner with source/v2 as its cwd. Cwd is never switched to storage to conceal code dependencies.

After separate deployment/task authorization and successful preflight, the coordinator changes **only the action** on the existing `TwChipDashboard-DailyUpdate`:

- First export its complete task XML and retain a hash plus the original action/arguments/working directory. Check the task still has its expected identity and single action.
- Preserve the entire trigger, principal and settings collections, including the existing weekday 08:30/21:15 triggers. Do not register another task, add triggers, change permissions or launch it as part of the edit.
- For an already explicitly constructed system-only environment, the direct Node action remains supported. For the normal Windows task environment use the standard Windows PowerShell executable with `-NoProfile -NonInteractive -WindowStyle Hidden -File "D:/Taiwan stock/owner-acceptance-runtime/306d29c/scripts/run-bound-daily-update.ps1" -BindingPath "<absolute-binding.json>" -Mode execute`. Working directory: the same source root, not storage. Do not add an execution-policy override. First run the same host with `-Mode preflight`, which creates no storage or logs.
- Read the task back and compare the exported XML excluding only Actions; triggers/principal/settings must be byte/semantically unchanged. Retain before/after evidence. If unexpected fields differ, stop and restore only the backed-up action under the coordinator's authority.
- Rollback restores that backed-up action. It does not rewind databases, ledgers, migrations, raw inputs or journal identities. Do not switch actions while a writer is active.

No `Set-ScheduledTask`, task installation, task execution or runtime control is performed by the source entry. The Windows task host only supplies the explicit environment and captures its child's output; it is not another ETL or scheduler. The original manual/unbound runner remains available with its prior defaults. Both manual and bound runners use storage's existing `v2/data/.v3-daily-update.lock` when they target that storage. Bound execution rejects any existing lock, including stale/unknown locks, without deleting it. A separate deliberate investigation is required before an operator can reclaim an abandoned lock.

## Routing and failure contract

| Consumer | Code/read-only specification | Mutable storage |
| --- | --- | --- |
| Runner | source/v2/scripts; source/config calendar | storage/v2/data lock; storage/v2/reports status; storage/v2/logs |
| v2Config stages | `config.root` = source/v2; migrations = source/v2/migrations | `config.dataRoot` = storage/v2; DB, caches, reports; storage/data/history and latest.json |
| V3 decisions/outcomes, V3.4 forward | source imports; source/v2/config/forward-v3.4.json | storage/v2/data/forward, DB and reports |
| Root forward/paper/live audits | source scripts and imported libraries | storage/v2/data/forward, storage/data/forward, storage/data/live-events and audits |
| Continuity | source audit implementation | storage DB, live-events, v2/reports |
| Intraday features/engineering | source algorithms and fixed definitions | storage/data/intraday/archive and research outputs |
| Replay PS1 and child build/audit | source/scripts; child imports from source | storage/data/intraday raw/archive/replay/status and storage DB |

Bound replay uses normal PowerShell policy: no `-ExecutionPolicy Bypass`. Policy errors flow through the existing stage exit/failure path; they are not retried using another shell or weaker policy. Preflight does not execute PowerShell, so policy availability remains an execution gate. Preserve the actual policy error and incomplete stage result.

The original 35 stages, order, timeouts, critical flags and failure handling remain. Noncritical failures remain in failures/gateSummary; critical failure aborts, sets failed, and never marks skipped stages completed. Quality debt and raw-ledger >64 MiB AUDIT_INCOMPLETE remain failures/unknown evidence. Successful binding is neither Owner final acceptance nor market-data PASS. No formal weight, execution authorization or broker capability changes.

## Validation scope

The tests use synthetic storage and a decoy, mocked child stages/Git admission responses, a real small SQLite fixture, source-byte comparisons, exact-spec/migration routing and existing bounded-ledger tests. They do not run a real 35-stage collection, read a production DB/ledger, or access deployment roots. Normal PowerShell source/parser checks are separate from actual policy execution. Independent review and later approved deployment/natural scheduled-writer verification remain required.
