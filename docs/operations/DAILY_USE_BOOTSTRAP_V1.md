# Daily Use Bootstrap V1

`台股量化籌碼神器－正常使用` is the machine-local Windows shortcut for the
normal, local dashboard environment.  It targets a small ignored wrapper in
`data/launchers/START_DAILY_USE.bat`, which invokes the tracked generic
launcher `scripts/start-daily-use.ps1`.

## Fixed operational boundary

- Opens only `http://127.0.0.1:8787`.
- Resolves runtime identity from the approved project root, independent of the
  caller's current directory.
- Wires and verifies the root-local CRU34 live producer before dashboard
  readiness. Reuse requires matching schema, worker instance, paths, heartbeat,
  and read-only safety invariants; a verified mismatched worker is restarted by
  exact PID, while an unverifiable incumbent is a hard blocker.
- Reuses a healthy formal dashboard, starts `launcher.mjs` once, or replaces an
  identity-mismatched formal dashboard only after verifying the exact loopback
  listener is Node and its runtime evidence belongs to this project root.
- Reuses a healthy `market_data_only` Shioaji bridge or invokes the existing
  read-only bridge starter when port 8790 is unused.
- Lets the existing dashboard refresh its official-source snapshot at startup
  and its configured interval.  It does **not** invoke the V3 daily pipeline,
  historical rebuilding, research runners, or any Forward Shadow lifecycle.
- Does not execute Git commands, start preview ports, start Cloudflare, change
  branches, write Forward Shadow evidence, or create broker/order routes.
- A local lock prevents concurrent double-click startup.  It never terminates
  a generic Node, Python, browser, or Cloudflare process.

## Degraded operation

An unavailable or warning-only read-only quote bridge is reported in plain
language, but does not block the dashboard when the formal dashboard health
check passes.  A listener already occupying 8787 without passing `/healthz` is
a hard blocker: the launcher will not replace or terminate it.

## Install / update the local shortcut

Run the following from the approved local project version:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-daily-use-shortcut.ps1
```

The installer resolves the Windows Shell Desktop known folder, so it supports a
legitimate redirected or OneDrive Desktop. It can retarget a same-name shortcut
only when its previous target is a recognized `DAILY_USE_BOOTSTRAP_V1` wrapper;
it refuses to overwrite any unrecognized shortcut or wrapper. The generated
`.lnk`, wrapper, PID lock, and logs are local runtime artifacts under ignored
locations.

`executionAuthorized=false` and `orderRoutesEnabled=false` are invariant.
