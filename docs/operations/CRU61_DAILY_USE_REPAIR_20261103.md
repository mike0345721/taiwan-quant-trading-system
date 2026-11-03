# CRU-61 / CRU-21 daily-use repair checkpoint — 2026-11-03

Status: **CANDIDATE SOURCE REPAIR / FORMAL NOT DELIVERED**.

Branch: `codex/cru61-daily-use-repair-20261103`, based on PR108 at
`87127e40be39d00dac1fe6b90d4e684cb11253f4`. The existing product chain remains
PR108 → PR107 → PR86 → main. This change does not merge that chain, include the
separate PR106 Bridge branch, or deploy a runtime.

## Reproduced defects and bounded fixes

1. A missing browser receipt produced chart-library, hidden-status and missing-Flow
   errors even while the authenticated MSI browser rendered live charts and Flow.
   Readiness now distinguishes missing, incompatible-schema and previous-process
   proof from actual failures in matching proof. Readiness stays false without
   valid proof. Counts/dimensions must be finite numeric values; normalization no
   longer turns strings, booleans or arrays into valid measurements.
2. The same scheduler policy checked out with LF versus CRLF had different raw
   hashes. The candidate reader rejected today's three genuine on-time receipts.
   Reading accepts only the alternate uniform newline spelling; writers retain
   the exact local hash. Existing receipt/index/start hashes and bytes stay intact.
   Policy content, JSON formatting, mixed endings and mismatched start pins remain
   invalid. No checkpoint time or schedule changes.
3. Data Operations discarded per-source clocks. The bounded projection/UI now
   retain data date, availability, observation, receipt bounds and batch-stage
   evidence. A requested date without a validated same-date artifact is displayed
   as unknown with a separate target date. Batch/acceptance completion does not
   become a fabricated per-source last-success time.
4. At the observed 831px viewport, a 64px terminal rail inherited the shared
   navigation's minimum 130px grid tracks. A button's centre hit the workspace;
   keyboard activation worked. The terminal now owns a single vertical track.
   The mobile collapsed selector also gets the specificity needed for its existing
   full-width row. JavaScript navigation handlers are unchanged.

Each defect has a pre-fix assertion failure and focused post-fix tests. CSS tests
model the relevant actual stylesheet order, media rules and class specificity;
they do not assert real browser geometry. Browser cases remain in a separate
test file for the existing CI lane. Exact-commit results are recorded in the local
verification receipt after commit, not inferred from pre-commit runs.

## MSI evidence and limits

- Formal 8787 remains `4d8251686bdb4abbdb469bc00ae798717c0fd583`.
  Normal Owner login succeeded. Three authenticated API/DOM samples over
  93.254 seconds matched price/time/contract/trading date/night session; seven
  chart periods rendered. Copy succeeded, and one explicitly labelled NO_TRADE
  acceptance journal entry was saved and read back from its separate store.
- Three backend samples over approximately 120.6 seconds showed Bridge written
  counters, Producer ordinals and projection clocks advancing. This is bounded
  observation, not a full-session reliability or completeness claim.
- At 21:24 Taiwan time, 8787 remained HTTP200, VERIFIED/SYNCED but runtimeReady=false;
  chart was READY at 21:24:12.508. Producer PID27700 was AVAILABLE/LIVE. Bridge8790
  PID24156 was HEALTHY with receipt time21:24:12.883; dropped/callback/writer errors0.
  Native sequence remained UNAVAILABLE and timestamp lineage QUALITY_INSUFFICIENT.
- Candidate18723 remained ECONNREFUSED. Its last retained log contains normal
  startup only; no exit receipt proves crash, reboot or expiry. It has no proved
  automatic boot entry. Do not attribute its exit to a timer.
- The installed research entry forces official snapshot refresh to0. A separate,
  uninstalled local patch restores300 seconds and adds ReaderOnly prerequisites;
  its PowerShell fixture was rejected before execution (0 cases run). That patch
  is not a validated or installed launcher and does not restart Bridge/Producer.
- Today's DAY13:55, EOD16:10 and FINAL18:10 receipts all show on-time execution.
  FINAL's four core EOD sources remain unqualified. The existing SQLite batch
  started21:15 independently; sampled tables gained today's rows after FINAL.
  A TAIFEX stage timed out while the batch continued. Dashboard official-source
  JSON cache updates independently of that SQLite pipeline.
- The batch metadata acquisition/cutoff ordering and missing governed
  `availableAt` evidence remain open. Never backdate an observation or replace
  frozen18:10 evidence with later rows to manufacture availability.

## Unfinished acceptance and restrictions

Formal pointer navigation still has the old CSS defect. Full-opening VWAP/extreme
warning from PR108 is still not deployed. Five-level depth, Review, candidate
browser, full desktop/mobile geometry, logout/relogin, cold/duplicate startup,
recovery and rollback are not accepted. **REBOOT_NOT_RUN**. Conflict Monitor and
some quality summaries remain unavailable; longer Flow windows retain their
actual quality limitations. AI remains **DISABLED_BY_OWNER**.

Windows denied scheduled-task metadata, limited event-log metadata, launcher
fixture execution, synthetic Chrome starts and Git credential-helper startup.
Computer Use also stopped because it could not confidently verify the current
Windows browser URL. Those paths were stopped without changing policy/trust,
permissions, launch flags or tools. One attempted test-name exclusion accidentally
reran the two already-blocked browser cases; it is recorded as failed, and the
cases were then separated so Node-only verification cannot launch them.

Local Git/CLI remote authentication is blocked; no new remote PR or same-head
hosted CI is claimed. Existing PR86 CI348 belongs only to54a1abe1. Local focused
tests, source review, real formal-browser evidence and hosted CI are separate gates.

## Resume packet

Local evidence directory: `D:/Taiwan stock/standalone-v1/data/daily-use-repair-20261103/`.
Key receipts: `checkpoint.md`, `exact-head-verification.json`,
`acceptance-matrix.md`, `browser-observations.json`, `service-observations.json`,
`final-service-check.json`, `daily-binding-diagnosis.json`, `startup-audit.md`,
`row-times-and-navigation-repair-receipt.md`, independent review receipts.
These local sanitized receipts are not represented as hosted artifacts.

Next gates: restore the existing authorized Git authentication path and push this
exact candidate for CI; resolve the original Windows/browser restrictions through
the authorized mechanism before repeating the affected operations; validate the
candidate's safe reader-only start with reviewed pins, normal login, API/DOM and
rollback. Formal merge/deployment/service control still requires effective Owner
authorization covering the exact revision and operation. Do not retry the rejected
launcher through an alternate evaluator or weaken TLS/security requirements.

Safety remains `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`,
`orderRoutesEnabled=false`. No strategy, source, collector, third runtime, raw
ledger rewrite, SQLite mutation, official schedule change, AI activation, security
policy change or formal service restart was performed. The pre-existing modified
primary-worktree research report was preserved.
