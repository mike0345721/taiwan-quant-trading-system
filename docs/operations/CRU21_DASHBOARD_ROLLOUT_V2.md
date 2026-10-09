# CRU-21 dashboard rollout / rollback V2

`scripts/cru21-dashboard-rollout.ps1` is a guarded operator helper, not a delivery verdict or an automatic deployment scheduler. Tests use synthetic files and intercepted process operations; passing them does not demonstrate recovery of the real service.

## Fresh private plan

Keep the plan, backups and receipts under a private, gitignored directory. Do not commit `.env`, authentication state, real market data or raw process records. V1 plans are explicitly rejected. A new `cru21-rollout-plan-v2` plan must bind:

- `primary`, `formal`: existing, distinct runtime roots; `base`: running baseline SHA; `head`: reviewed candidate SHA; `tree`: reviewed candidate tree hash.
- `formalPid`: currently verified dashboard PID; `producerPid`: existing authorized producer PID.
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
