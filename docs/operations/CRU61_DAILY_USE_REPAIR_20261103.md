# CRU-61 / CRU-21 daily-use repair checkpoint — 2026-11-03

Status: **CANDIDATE SOURCE REPAIR / FORMAL NOT DELIVERED**.

The original sections below preserve the first checkpoint. The later same-day
recovery section supersedes its tool, push and CI blocker status; no historical
receipt or acceptance result was rewritten.

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

## Later same-day recovery and bounded safety repairs

The original Git and PowerShell commands succeeded through the tool's normal
authorization review using the existing credential mechanism and unchanged
Windows policy. Commit `ab312848ea1d922370f044ae924e620d5d505fae` was pushed to
Draft PR109. CI349/run41646417832 checked out that exact SHA and passed:
1816 pass, 0 fail, 10 skip. Its MSI focused tests passed69/69; isolated Chrome
row-time tests passed2/2. These results apply to that commit, not later edits.

Candidate CheckOnly verified the existing Bridge/Producer identities. The actual
ReaderOnly attempt stopped before spawning at NODE_CONFIGURATION_REJECTED.
After the Owner explicitly granted one diagnostic load, it returned only
DATABASE_OR_OPERATIONS_ROUTING_PRESENT. No values were disclosed. That permission
is consumed; the actual key/path remains unknown and the routing guard stays.

Two additional source defects were then repaired in this same candidate branch:

- ReaderOnly startup did not constrain the daily batch HTTP route. Opt-in
  DASHBOARD_CANDIDATE_READ_ONLY=1 now keeps authentication and CSRF, then refuses
  daily-update POST before any child spawn. The existing button stays visible
  and reports BLOCKED; GET preserves the actual batch result separately. The
  normal default is unchanged, and the independent Journal remains usable.
  Health reports the actual boolean so a launcher can reject an incompatible
  warm process. The separate local entry integration still needs MSI acceptance.
- The scheduled ledger audit failed with ERR_OUT_OF_RANGE when its synchronous
  whole-file read exceeded Node's length limit. The audit now applies the existing
  64MiB inline budget before opening, allocating or reading. Larger inputs return
  AUDIT_INCOMPLETE with unknown event/hash values and bytesRead0. Acceptance stays
  PENDING, or FAIL for independently known operational errors. Unknown counters
  never become zero. No prefix is accepted as a complete hash-chain audit.

These fixes have synthetic pre-fix failures and focused regressions. The local
recovery receipts bind final source bytes, commit and CI after integration. No
large real ledger replay or scheduled job was run to verify them.

At23:06, formal8787 still served4d825168; Bridge24156 and Producer27700 were the
same processes and their data clocks advanced. Candidate18723 remained offline.
The normal Chrome login session was reusable; the formal UI displayed nine
11/03 daily cards updated around23:07 and live TXFK6/11-04 NIGHT charts. These
formal observations are not candidate browser proof.

The existing21:15 daily batch ended21:28 FAILED. TAIFEX had already imported
futures/options before its300s timeout; its later substep is unknown. Other
failures include historical OI arithmetic discrepancies, the ledger read crash,
and bounded continuity evidence still incomplete. The18:10 FINAL cutoff and
later source arrivals remain separate; no schedule or receipt was backfilled.

Recovery evidence is local under `data/daily-use-recovery-20261103/`. Candidate
login, all-feature browser acceptance, cold/duplicate startup, recovery and
rollback remain BLOCKED/NOT RUN; REBOOT_NOT_RUN. The prepared local entry is
not installed. Formal merge/cutover remain explicitly excluded by the Owner.
