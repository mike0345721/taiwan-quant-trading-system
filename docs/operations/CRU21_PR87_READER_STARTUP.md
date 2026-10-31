# PR87 P0 candidate reader startup contract

Scope: the isolated CRU21 reader on `127.0.0.1:18722` only. Source support is not runtime acceptance or permission to deploy formal8787. Do not start/restart Producer, Bridge, collectors, OS scheduled tasks or models. Do not change security permissions, cookies, authentication or paid-use settings.

## Contract and version identities

`server.mjs` constructs `cru21IdentityOptions` from actual Git identity and explicit environment bindings, then calls `validateCru21PreviewVersionTruth` before listening. The exact allowed PR87 branch is `codex/cru21-decision-quality-p0-20261016`; lookalike branches, declared/actual mismatches, dirty source, wrong/missing HEAD and base, non-LIVE mode or incompatible candidate boundaries still fail closed. Adding this branch does not mark the runtime SYNCED, complete or Owner accepted.

Two base identities must remain distinct:

- PR87 stack base: PR86 `3add90a17fbb7a50ffbd71971649d5ce7d526377`.
- `DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN`: the independently checked approved local `refs/heads/main` identity (currently `4d8251686bdb4abbdb469bc00ae798717c0fd583`), not the stack base.

`DASHBOARD_PREVIEW_EXPECTED_HEAD` must be the new reviewed PR87 commit, obtained from the delivery receipt and independently matched against remote and local HEAD. Never set it from arbitrary local HEAD merely to bypass a mismatch. This contract does not hardcode a moving candidate SHA in source.

## Non-sensitive binding checklist for the MSI task

Use the existing approved private candidate configuration and access boundaries. Do not copy or print its secrets. Verify these bindings without reading credentials:

| Binding | Required value / evidence |
| --- | --- |
| Worktree / actual and declared branch | Existing isolated PR87 worktree; exact PR87 branch above; clean tracked source |
| `DASHBOARD_PREVIEW_TYPE` | `CRU21_OWNER_PREVIEW` |
| `DASHBOARD_PREVIEW_BRANCH` | Exact PR87 branch, identical to actual Git branch |
| `DASHBOARD_PREVIEW_EXPECTED_HEAD` | Delivered reviewed new PR87 SHA, matching local and remote |
| `DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN` | Verified approved main SHA, not PR86 SHA |
| `HOST`, `PORT` | `127.0.0.1`, `18722` |
| `MOCK_DATA`, `DASHBOARD_PREVIEW_DATA_MODE` | `0`, `LIVE` |
| `ASK_GPT_INLINE_ENABLED` | Existing candidate value `1`; this enables routes, not a model request |
| `ASK_GPT_CANDIDATE_READ_ROOT` | Existing governed read-source root; distinct from candidate private writes |
| `TX_CHART_DATA_ROOT` | Existing governed chart products root |
| `TX_CHART_CACHE_ROOT` | Candidate-only cache under the isolated worktree, not formal/source products |
| `CRU34_LIVE_DATA_ROOT` | Existing Producer-declared data root; preserve exact root/alias contract |
| `CRU34_LIVE_SNAPSHOT_PATH`, `CRU34_LIVE_STATUS_PATH` | Existing Producer's snapshot/status pair; no materialization or Producer restart |
| `V2_RESEARCH_DATABASE_PATH`, `V2_BACKTEST_REPORT_PATH` | Existing approved read-only research products, if already bound |
| Candidate private writes | `config.dataDir` is this worktree's `data`; sessions, journal, AI receipts and default caches stay there |
| Incompatible modes | No `DASHBOARD_FORMAL_READ_ROOT`, CRU55 candidate/acceptance/runtime routing or new forward-shadow activation |

Preserve the approved password/session/CSRF/TLS configuration and existing app-owned authentication state. A missing or inaccessible required input is a blocker; do not request broader access or disable a guard to start the reader. Merely sharing a child directory does not prove that two declared data roots are identical.

## Reader-only operator sequence (Windows acceptance still required)

1. Fetch/reconcile the existing PR87 branch without force, verify delivered SHA, actual branch, clean source, approved main identity and the binding checklist. Check18722 for an existing listener and its process fingerprint. Reuse an already-correct reader; stop on unknown/mismatched listener. Do not kill by port or process name.
2. Update only the existing MSI candidate guard's obsolete exact branch/HEAD binding as described below. Run its preflight against the delivered SHA and the existing private configuration. Missing data, identity or security prerequisites must still reject before launch.
3. From the isolated PR87 worktree, launch only the installed Node executable with `--env-file=<existing approved private candidate env path>` and `server.mjs`, using candidate-only stdout/stderr paths. Keep the guard's validated per-process environment; Node environment variables override env-file values, so check both. Do not expose the env contents in logs or command-line arguments. `DASHBOARD_ENV_PATH` alone does not load an env file when invoking `server.mjs` directly.
4. Never use `launcher.mjs`, `scripts/start-dashboard-hidden.ps1`, `start-daily-use.ps1` or the bound startup chain for this task: those paths can start other data services. Direct `server.mjs` does not launch Producer/Bridge. Here reader-only means starting only the existing dashboard process, not a pure filesystem/offline process: it unconditionally performs its existing initial public upstream refresh (Yahoo/TWSE/TAIFEX etc.), reads already-running authorized data endpoints/products and saves its own candidate cache. The existing in-process refresh timer follows `REFRESH_INTERVAL_SECONDS` (default300 seconds); a value of0 disables the timer but does not suppress the initial fetch. Preserve the approved reader configuration. If the MSI scope requires zero public upstream requests, stop: that needs a separate runtime behavior change, not a branch-identity bypass in this repair.
5. Read candidate `/healthz`; verify exact runtime SHA and candidate identity, loopback18722, LIVE mode, expected binding/readiness reasons and unchanged safety flags. A200 response or identity PASS alone is not data readiness or product acceptance. Unavailable/stale data remains unavailable. Independently confirm formal8787 and Producer/Bridge PIDs, roots and configuration are unchanged.
6. Existing authenticated API, actual Windows reader and visible UI checks belong to the MSI acceptance task. No cloud contract-test result substitutes for them. Do not request OAuth/model inference or promote any acceptance gate merely because the reader starts.

## Precise local guard change to hand off

No tracked repository startup script pins `3add90a` as the PR87 candidate HEAD; the reported pin belongs to the MSI-local guard, whose file is not available in this cloud workspace. The MSI task must identify and preserve that actual file before editing. Replace only its candidate binding tuple (worktree, exact PR87 branch, reviewed new HEAD and tree hash if used), retaining the separate approved-main binding and all existing checks for clean source, listener fingerprint, loopback18722, read roots, private write/cache isolation, authentication and safety. Do not rename PR87 to impersonate a legacy branch or substitute PR86 as approved main. Do not broaden the allowlist, remove guard clauses, change ACLs/permissions or include any Producer/Bridge startup path. Re-run local negative preflights for wrong branch/HEAD, dirty source, occupied/wrong port and mismatched roots. Record the guard diff and Windows results separately; this document does not claim that local change has been performed or tested.

Cloud verification covers the production candidate validator and retained source-binding/authentication contracts. The Windows command path, local guard, real data bindings and real UI remain unexecuted here. Historical full-suite failures remain disclosed in PR87's prior receipt.
