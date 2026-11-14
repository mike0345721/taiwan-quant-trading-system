# Owner local acceptance HTTP v1 — review candidate

This is a separate, default-off proposal on the original product server. It is not Owner acceptance, deployment approval, HTTPS/native qualification or formal delivery. This development worktree must not be used as a runtime. No real service was started during implementation.

## Manual entry after independent review and runtime verification

The coordinator must first verify an independent runtime checkout containing this reviewed change, its clean branch/HEAD/tree/main identity, local machine name, and the existing read/producer roots. This iteration does not create or update that checkout or its binding. A worktree (`.git` file or a path under `worktrees`) is rejected. Git ownership errors remain errors; the entry never adds `safe.directory`.

Create a non-secret binding outside Git using actual verified values. The following is a **non-launchable schema example**, not an approved binding:

```json
{
  "schema": "owner-local-acceptance-binding-v1",
  "machineName": "VERIFIED_MSI_MACHINE_NAME",
  "sourceRoot": "D:\\VERIFIED_RUNTIME_CHECKOUT",
  "readDataRoot": "D:\\VERIFIED_EXISTING_READ_ROOT",
  "producerDataRoot": "D:\\VERIFIED_EXISTING_PRODUCER_ROOT",
  "branch": "codex/cru61-smc-cvd-profile-v1",
  "expectedHead": "VERIFIED_40_HEX_HEAD",
  "expectedTree": "VERIFIED_40_HEX_TREE",
  "expectedBaseMain": "VERIFIED_40_HEX_MAIN"
}
```

From the Owner's interactive MSI desktop, use this exact argument order and quoted absolute paths (replace placeholders). Invoke the standard Windows PowerShell executable:

```powershell
powershell.exe -NoProfile -STA -File "D:\VERIFIED_RUNTIME_CHECKOUT\scripts\start-owner-local-acceptance.ps1" -BindingPath "D:\VERIFIED_PRIVATE_LOCATION\owner-binding.json"
```

There is no `-Accept`, unattended launch, ExecutionPolicy override, HTTP fallback, receipt-based resume, alternate port, browser automation or unattended browser launch. The Node entry checks that its parent is the standard PowerShell process in the same interactive session with the documented command line. Failure to inspect that parent is a refusal, not a reason to bypass Windows policy. Running the script by dot-sourcing or from an existing generic PowerShell command prompt is intentionally not an admitted invocation.

The dialog starts unchecked and requires two matching entries of a new password of at least 12 characters. Closing/cancelling it before acceptance starts no child, opens no binding/source/private/auth store and creates no listener. Only after the checkbox and password are submitted does Node verify the parent and bindings. Password bytes travel through redirected stdin only; the existing scrypt hash remains in process memory. No password/hash or consent receipt is written. Managed strings may remain in memory until garbage collection; this is not a memory-erasure guarantee.

Only after the Owner submits consent/password and this candidate reports listening, the launcher asks the standard system browser to open the fixed origin once. No browser automation or credential entry is performed. The Owner may also manually open `http://localhost:18723/`. The listener is only `127.0.0.1:18723`; an occupied port fails without stopping or contacting its existing service. `127.0.0.1` as a browser Host is intentionally refused. Only exact `localhost:18723` and, when supplied, exact `http://localhost:18723` Origin are accepted. APIs additionally require browser same-origin Fetch Metadata; POST requires exact Origin. Same-origin GET can omit Origin/Referer, because the existing product sets `no-referrer`. Cross-site/same-site requests, duplicate security headers and forwarded/proxy headers are rejected before source/auth handling. This does not authenticate arbitrary native clients or defend against malicious same-user software.

## Isolation and lifecycle

- Mode: `OWNER_LOCAL_ACCEPTANCE_HTTP_V1`; preview: `OWNER_LOCAL_ACCEPTANCE_HTTP`.
- Original HTML/app, calculation worker and normal request handlers are reused. The page and version show HTTP, not production, not LIVE qualified. Aggregated readiness remains unqualified; HTTP cannot submit the existing HTTPS/native browser proof.
- Original password verification, rate limit, Session, CSRF, `Secure`, `HttpOnly` and `SameSite=Strict` remain. Dedicated cookie: `twchip_owner_local_http_v1`; cookies are not isolated by port.
- Each accepted launch gets a new private `sourceRoot/data/owner-local-acceptance/<random-run-id>/` containing Session, `decision-workspace/journal.ndjson`, outcomes and required private chart cache only. Previous sessions are not loaded on a new launch. The private journals remain available on disk for review; a new launch starts a new journal namespace.
- Existing source/read/producer roots must be distinct, local and alias-free. Per-request private namespace checks reuse the market candidate checks. These are point-in-time checks; the old native persistent namespace lock guarantee is **not** claimed.
- Collection, upstream refresh, AI/account/setup, broker, formal data mutation and scheduled updates remain disabled. Existing producers are not restarted or repaired. Missing/stale data retains the original labels and worker/Copy quality thresholds.
- Stop or close the dialog to send `STOP` and close stdin. EOF also stops Node. Shutdown closes this server and its worker; the existing shutdown timeout exits only this child. The dialog holds a Process object and, if normal shutdown takes over 11 seconds, terminates that same child. It never finds/kills a process by port/name or stops formal services.
- There is no unconditional 15-minute lifetime contract. OS suspension, same-user/admin modification or forced host termination are outside these guarantees. No TLS trust, ACL, policy, sandbox or Chrome profile is changed.

## Verification and outstanding checks

Implementation evidence is in `E/owner-console-entry-20261108/`. Tests execute the current full server in a closed synthetic VM and the original request handler with real Session/scrypt/static HTML/Journal/Outcome code on synthetic private files. They do not start a listener, real market runtime or browser, and do not create an Owner approval receipt.

Two existing native symlink fixture tests failed with Windows `EPERM`. They were not retried, changed to pass or treated as verified. The first legacy test invocation used its default system Temp; its fixtures were removed by test cleanup. Subsequent legacy fixture runs route process-local TEMP/TMP to E. This is an execution limitation/deviation, not a successful alias filesystem test.

**NOT RUN:** MSI dialog interaction, real parent-process observation, actual candidate listener/occupied-port behavior, real shutdown/forced-parent-close behavior, independent runtime binding qualification, and the Owner browser's Secure-cookie behavior on localhost HTTP. Static PowerShell parsing and injected lifecycle tests do not establish those results. If the browser rejects the Secure cookie, stop and report the failure; do not remove `Secure`, retry Chrome automation or silently downgrade another mode.

The reported producer absence/stale binding from the task remains unresolved and unverified by this implementation round. No claim of restored LIVE/Flow or an accepted entry is made. Independent review must inspect the diff and evidence before deployment; actual Owner interaction remains the launch gate.
