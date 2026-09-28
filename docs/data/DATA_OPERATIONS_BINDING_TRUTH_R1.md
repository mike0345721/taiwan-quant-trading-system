# CRU-52 Phase R1 — Binding & Truth Repair

Owner authorized this candidate on 2026-09-28, following the completed 9/27
inventory (Linear comment 353d91ef). Base: approved remote main
`1ad9ec7c1814e401f8352048638f0a398bcf74fe`. No merge or formal rollout is authorized.

## Contract

The API process data directory is not necessarily the acceptance writer data
directory. `DATA_OPERATIONS_MANIFEST_PATH` explicitly selects the same new input
index passed to the acceptance runner's `--manifest`. Its `operationsBinding`
contains schemaVersion `data-operations-binding-v1`, absolute `dataRoot`,
`outputRoot`, and `calendarPath`. The existing index retains `evidenceRoot`,
`calendarSha256`, sourceBindings and selection. Reader and writer share validation:

- outputRoot remains inside that binding's dataRoot/quality/daily-data-operations;
- A.1 evidence remains under dataRoot/quality/daily-collection-acceptance;
- CLI roots must match the binding; a conflicting API output override is rejected;
- calendar bytes must match the existing governed calendar hash;
- BUILD_A1 binds SQLite and status together to explicit `sourceBindings.activeAppRoot`:
  `v2/data/research-v2.sqlite` and `v2/reports/v3-daily-update-status.json`;
- existing link, bounded-read, collision and immutable-history checks remain;
- API exposes binding/calendar hashes only, not local source paths. Invalid
  bindings return authenticated 503/no-store, never a fallback-root empty success.

Without the explicit manifest env, existing deployments retain their previous
behavior. This preserves compatibility, **not** proof that a legacy deployment
has correct bindings. Formal rollout must configure the new manifest explicitly.
Historical indexes remain readable without adding fields or rewriting bytes.
An old receipt's input manifest hash identifies its historical configuration;
the current reader binding hash is a separate identity, not a retrospective repair.

`prepare-data-operations-binding.mjs` creates a new file exclusively (wx). It
uses an explicitly provided existing BUILD_A1 manifest, active app root, acceptance
roots, calendar and governance reference. It retains existing ledger/derived/
registry/session selections. Preparation does not activate the configuration or
grant Owner approval. No automatic source discovery or newest-file selection.

## Date applicability

Daily update market-row inspection first resolves the requested Taipei date
against the existing governed calendar. 9/25–9/28 are NOT_EXPECTED/MARKET_CLOSED;
it does not query missing market rows on those dates or substitute 9/24 as today.
Uncovered/unverified calendar or unavailable DB stays UNKNOWN. On an applicable
date a verified absent row stays MISSING. Quality debt, TAIFEX stage failures and
continuity failures retain their independent reasons/severity. No change to
collector, raw files, SQLite data, source publication times, or stage execution.

## Candidate verification

Run focused binding, operations integration, scheduler, operations core and
operational-integrity tests. Verify authentic 9/24 and 9/27 fixed A.1 inputs through
new MANUAL_REPLAY writer receipts, immutable revisions, pure reader, real server
login/authenticated HTTP and the existing Data Quality page. Hash the original
receipts/reports/input pairs before and after. Read the active 9/24 DB using the
existing read-only batch reader; do not promote its unknown lineage. A separate
BUILD_A1 manual run checks the corrected active binding on a closed date.
New observations are not backfills of the old scheduled reports, do not count as
natural scheduler evidence, and do not advance the five-day gate.

## Later Owner rollout gate (not executed by R1)

After GPT review and exact-head Owner approval only: whole-version merge/sync;
prepare and review a **new** local binding manifest; point both API environment
and the three task definitions at that exact file. Retain the existing formal
acceptance data/output/history root; use the checkpoint-proven active primary
app root for SQLite/status. Preserve the original input index and all old history.
Verify exact manifest hash, task arguments, API binding hash and receipt/report
identity before allowing any natural 9/29 verification credit. Do not change
schedules, timezone, grace, source due semantics, or trigger manual formal runs.
Rollback restores the prior whole version and configuration selection, preserving
every new/old receipt. Neither prepare nor tests installs or edits Windows tasks.

## Deferred R2 / safety

EOD publication/available_at lineage, 28 institutional OI mismatches and three
AUDIT_INCOMPLETE dates remain bounded R2. CVD, strategy and execution are excluded.
Missing != 0; job SUCCEEDED != Data PASS; FINAL != Data PASS; MARKET_CLOSED is not
an applicable trading-day success. `formalWeight=0`, `researchOnly=true`,
`executionAuthorized=false`, `orderRoutesEnabled=false` remain unchanged.
