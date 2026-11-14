# CRU-21 dashboard rollout / rollback V2

`scripts/cru21-dashboard-rollout.ps1` is a guarded operator helper, not a delivery verdict or an automatic deployment scheduler. Tests use synthetic files and intercepted process operations; passing them does not demonstrate recovery of the real service.

## Fresh private plan

Keep the plan, backups and receipts under a private, gitignored directory. Do not commit `.env`, authentication state, real market data or raw process records. V1 plans are explicitly rejected. A new `cru21-rollout-plan-v2` plan must bind:

- `primary`, `formal`: existing, distinct runtime roots; `base`: running baseline SHA; `head`: reviewed candidate SHA; `tree`: reviewed candidate tree hash.
- `formalPid`: currently verified dashboard PID; `producerPid`: existing authorized producer PID.
- `oldProcess`: original dashboard fingerprint (`pid`, `creationDate` in UTC ISO format, `executable`, `commandLine`) from the freshly verified OS process. Confirm its source/auth root is `primary`; a generic launcher command alone is insufficient. Rechecked immediately before stopping.
- `primaryEnvHash`, `formalEnvHash`, `targetEnvHash`: SHA-256 of private `primary-original.env`, `formal-original.env`, `formal-target.env` beside the plan.
- `dirtyReportPath`, `dirtyReportHash`: preserved primary report path and SHA-256, with identical backup `primary-dirty-report.md`.

Regenerate the plan when source, process identity, settings or the preserved report changes. Check the target configuration without starting services. A plan from an earlier HEAD or another session is not reusable.

## Gates and state

Before `Deploy`, private `hard-gates.json` must refer to `candidateHead` and contain verified `candidateModelContentPassed`, `windowsPassed`, `ciPassed`, `independentReviewPassed`, `runtimeAcceptancePassed`, `rollbackReviewed`. These are attestations whose exact-SHA evidence must be reviewed separately. They must never be set merely to make this helper proceed. Owner model-use and conditional production authorization still apply.

`ExpectedMain` is the exact merged commit. Its tree must equal the reviewed tree. Preserve all receipts and the deployment state. A failure does not authorize retries or unrelated service changes.

## Rollback protection

Rollback verifies backup hashes, both source roots, dirty files and environment hashes before stopping anything. It checks the recorded process PID, creation time, executable and command line even when the process has no listening socket. A reused PID or another listener is never stopped. Source and files are checked again before restoration. The preserved report and primary environment remain byte-identical.

Both launch paths start `server.mjs` directly with the selected `.env`, hidden, at loopback port 8787. They do not call the old launcher that can start a bridge after a health timeout. No producer, broker, TXO or CVD start is part of this helper.

After any launch, independently verify health, exact runtime identity, authentication, readiness and relevant L0–L5 evidence. A launch receipt is not successful deployment or recovery. An identity-pending launch, unexpected process, missing backup, dirty source or incompatible source baseline requires investigation; do not weaken the checks.

## Replay

Run the Windows lane on a separate D-drive checkout at the exact reviewed SHA. `tests/cru21-rollout-windows.test.mjs` covers a live recorded process without a listener, dirty source, tampered backup, foreign listener, PID reuse and rejection of historical plans. It does not contact 8787 or terminate real processes. Production guards are unchanged; synthetic CVD tests do not activate CVD.

## V3 formal-only adaptation for the split-root installation

The existing entry also accepts a new, explicit `cru21-rollout-plan-v3-formal-only`
plan. V2 remains a legacy topology, not a fallback when V3 refuses. Never relabel
an old plan or reset the development checkout just to satisfy either schema.

### Source and data ownership

- `formal` is the existing running Dashboard source and authentication/session root.
  Deploy and Rollback both use this root, its `.env` and direct `server.mjs` entry.
  Only this checkout is switched; rollback restores `base` in **formal**, not primary.
- `primary` is the shared read-source/development checkout. It may remain on its
  existing non-main branch. Bind `primaryHead` and `primaryBranch` to observed values;
  the helper checks them but never switches, merges, resets or cleans this checkout.
- `candidate` identifies the distinct reviewed checkout. Before deployment its HEAD,
  tree and clean status must match `head`/`tree`. `oldRuntimeRoot` must equal `formal`.
- `readDataRoot` must be `primary/data`; `producerDataRoot` must be `formal/data`.
  Producer status must report the same data root and snapshot/status pair. This does
  not authorize starting or stopping Producer/Bridge, moving data, or changing locks.
- Root directories must exist, be absolute local paths and not be root reparse points.
  Formal and primary must have different normalized names and cannot lexically contain each other. Existing governed child data
  aliases are not reclassified as equivalent whole roots by this check.
- The old recorded command must explicitly reference the quoted formal `server.mjs`
  and `--env-file="<formal>/.env"`. A launcher or an ambiguous inherited configuration
  is not silently converted to this topology. All PID/creation/executable/command-line
  and health identity checks remain in force.

The existing report, its backup and all original/target environment hashes remain
required. `dirtyReportPath` stays `v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md`; only that
recorded development report may be dirty. The source adaptation does not create a
real plan, copy credentials or grant permission to read a real configuration file.

### Target configuration and release gates

`check-cru21-rollout-target-env.mjs` uses Node's `util.parseEnv` without importing the
application or loading values into `process.env`. Use an installed Node supporting
that parser (tested on Node 24.18.0); a missing parser fails before cutover. The check
prints only PASS or REJECTED, never values. It verifies the formal loopback port,
LIVE/production mode, existing password hash and authentication settings, secure
cookies, explicit shared read/cache/Producer paths, and rejects preview/guest,
account-root redirection, Node preloads and TLS relaxation. Unrelated configuration
values, including research and provider settings, must remain equal to the baseline.
This is validation, not permission to initialize an AI account or send inference.

Keep all six V2 hard gates, including `candidateModelContentPassed`. V3 additionally
requires actual JSON booleans (not strings), `ownerDeploymentApproved=true`, and
`hard-gates.json.expectedMain` equal to the explicitly approved merged SHA. The
candidate HEAD and merged tree must match their reviewed identities. Never populate
these fields from passing fixture tests or from a no-anomaly UI response alone.

A Windows-session-local named mutex serializes invocations for the same normalized
formal root. An abandoned mutex is an explicit reconciliation failure. This is not
a cross-user/cross-session deployment orchestrator; maintain a single authorized
operator. The persisted deployment-state blocks blind retries after a partial run,
including launch failures, and binds rollback to the same plan-file SHA256. V3
rechecks source/backups before stopping and before mutation; if the old process
still exists after the bounded wait, no checkout is switched.

In a V3 launch, inherited preview and Node flags are cleared only in the operator's
process before starting the direct server. There is no execution-policy, global
Windows environment or ACL change. The caller must use a supported approved command
path; the helper is not a means to retry a prior explicitly denied operation.

### Validation and limits

`tests/cru21-rollout-formal-root.test.mjs` runs the complete helper with disposable
fixture files. OS process lifecycle, network requests, Git actions and configuration
copying are intercepted. It covers formal-to-formal deploy/rollback, development
preservation, source/Owner version mismatch, corrupt backup, missing or string gates,
foreign/reused PIDs, owned processes without listeners, stop/launch failure, saved
plan drift, and refusal to blindly retry a partial deployment. No real 8787/8790
request, real process termination, raw ledger, account store or credentials are used.
`tests/cru21-rollout-target-env.test.mjs` exercises the same parser on synthetic text.
Legacy V2 rollback/fingerprint/history refusals remain separately tested.

These tests do **not** establish production backup suitability, full-chain native
credential-store safety, real model-content acceptance, authenticated mobile UI,
production cutover, persistence across reboot, or actual rollback. Prepare and review
the private real plan and exact-version evidence separately before any production
operation. A launch receipt still requires independent health/auth/data checks.

Root validation above is lexical plus a check on each root directory itself; it is
not a held-handle/full-ancestor namespace proof. Before any real deployment, the
operator must independently verify ancestor aliases, ownership and the actual shared
read/source layout. This source change must not be reported as proving those properties.

## Explicit secure-cookie migration (source support, not runtime approval)

An existing `COOKIE_SECURE=0` baseline used to be impossible to migrate: leaving it
unchanged violated `SECURE_COOKIE_REQUIRED`, while setting it to `1` violated the
blanket authentication-equality check. The target checker now distinguishes an
immutable original backup from an explicitly reviewed, secure-only target change.

The unchanged secure baseline (`1` to `1`) needs no migration object. A `0` to `1`
transition requires `plan.cookieMigration` with all of the following:

| Field | Required value |
| --- | --- |
| `schema` | `cru21-secure-cookie-migration-v1` |
| `candidateHead` | The same full 40-character SHA as `plan.head` |
| `from`, `to` | Exact strings `0`, `1` |
| `ownerApproved` | Boolean `true`, supported by an actual Owner decision |
| `httpsOrigin` | Canonical HTTPS origin only, without credentials, path, query or fragment |
| `transportEvidenceSha256` | 64 lowercase hexadecimal characters identifying reviewed transport/login evidence |

This is an **attestation contract**, like the existing hard-gate file, not a network
probe, proof signature, or automatic verification of the Owner. Before an operator
uses it, independently inspect the referenced evidence for the declared HTTPS
origin, correct application/version, authenticated cookie round-trip and transport
configuration. A fabricated hash or fixture approval is not evidence. The parser
performs no network request and will not build, initialize or approve this object.
A plain HTTP 200 on `127.0.0.1:8787` is not proof of an HTTPS client entry point.
Do not toggle the production cookie flag just because the source checker supports it.

The exception is limited to `COOKIE_SECURE=0` -> `1`. Downgrades, implicit upgrades,
wrong-version approvals, stale approvals attached to an unchanged configuration and
missing transport evidence remain refused. Password, proxy trust, session lifetime,
account root, source routing and other unrelated values must remain unchanged. The
plan/backups' existing SHA256 checks and final Owner exact-version deployment gate
remain mandatory. Rollback still restores the original bytes at the original formal
root; it is recovery to the explicitly recorded baseline, not a secure-upgrade PASS.

Environment names are compared case-insensitively for the Windows target. Differently
cased aliases are refused, and lower-case Node/TLS/account-root keys cannot hide from
the same safety checks. Parsing still never loads values into `process.env`.

Validation includes the real checker invoked by the complete intercepted Windows
fixture: approved upgrade, refusal before process mutation without approval, and
restoration of the original cookie policy on rollback. These are dummy configurations;
no real secret file, transport endpoint, service, ACL or browser login is changed.

Code-merge readiness and production readiness are separate. Passing this regression
can support review/merge of the source change; it does not supply real HTTPS evidence,
Owner deployment approval, model-content acceptance, native-account positive-path
coverage, or production cutover/rollback receipts. Previously accepted unchanged UI
code need not be retested merely because this operator-only checker changed.

Primary references: RFC6265 section 4.1.2.5
(https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1.2.5), and Node.js process.env
Windows semantics (https://nodejs.org/api/process.html#processenv).
