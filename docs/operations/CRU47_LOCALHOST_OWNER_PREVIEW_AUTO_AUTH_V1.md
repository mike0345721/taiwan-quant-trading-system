# CRU-47 Localhost Owner Preview Auto-Auth V1

## Outcome and boundary

This package adds a separate Owner Preview entry path. It does not remove or
relax the normal password, session, CSRF, or cookie controls. It never enables
broker, order, position, risk, or execution capabilities.

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

The preview is off by default. It is effective only when the governed launcher
sets all CRU-47 gates and the server verifies the exact candidate commit,
explicit preview type, loopback bind, canonical origin, disabled proxy trust,
existing password hash, and isolated writable state.

## Authentication chain

1. The launcher verifies the clean CRU-47 branch, accepted merge base, exact
   candidate HEAD, unused preview port, governed read-only data paths, producer
   safety fields, and chart dependency.
2. It creates a random 256-bit one-use token and sends only its SHA-256 digest
   to the candidate server. The raw token is not written to logs or health.
3. The browser receives the token in a URL fragment. Fragments are not sent in
   HTTP requests. The UI copies it into function-local memory and immediately
   removes the fragment from the address/history before the exchange request.
4. A same-origin POST must match the actual socket peer/listener, exact Host,
   exact Origin, launch instance, candidate commit, 60-second lifetime, and
   capability digest. Forwarded headers are rejected. Consumption is atomic;
   at most one exchange succeeds.
5. The exchange creates an in-memory 30-minute session using
   an instance-specific `twchip_preview_<instance>` cookie. The formal `twchip_session` cookie and persisted
   formal session file are not read or overwritten. All later preview requests
   must still satisfy the loopback/Host boundary; state-changing requests also
   require exact Origin and the existing CSRF token.
6. Logout deletes only the preview session. Restarting or disabling the
   candidate loses the in-memory store and invalidates old preview cookies.

## Threat model

The controls are intended to reject LAN/remote clients, proxy/header spoofing,
DNS rebinding/Host confusion, cross-site bootstrap, missing or wrong
capabilities, expiry, replay, concurrent double exchange, wrong instance or
candidate, and cross-port cookie reuse. Health and UI expose only non-secret
mode, instance, identity, expiry, consumption, and session lifetime.

This does not claim to defend against malware or another process already
controlling the same Windows user or host. The fragment can briefly appear in a
local browser process argument and memory before immediate removal; the short
lifetime, single use, exact instance/origin binding, and non-persistence bound
that local residual risk. Session IDs, CSRF tokens, password hashes, and raw
capabilities must never appear in screenshots or remote reporting.

## State and data isolation

The launcher reads the accepted runtime's governed market data, CRU-34/44
projection, and chart dependency. It does not start, restart, stop, or write to
8787, 8790, the collector, scheduler, approved runtime, or normal desktop
shortcut. Cache, chart cache, session, journal, and logs are directed to the
candidate instance state root. `CacheStore` reads source data but writes only
to that state root.

The launcher starts `server.mjs` directly. It must not use `launcher.mjs`,
which can manage the quote bridge, and it must not invoke a CRU-34 producer
launcher.

## Owner Preview launcher

From a clean committed CRU-47 candidate worktree:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-cru47-owner-preview.ps1
```

The launcher opens the browser itself and does not print the secret-bearing
fragment. `-NoBrowser` is for controlled engineering verification only; it
returns redacted metadata and leaves L5 incomplete.

The exact-identity health gate allows a bounded 20 seconds per full governed
readiness calculation, for at most six attempts. It still refuses to open a
browser unless the one-minute capability remains effective.

## Delivery gates

- L0: scope and safety invariants remain frozen.
- L1: exact candidate tree, focused regression, security scan, and review.
- L2: dependencies, loopback config, candidate state, branch/base/HEAD.
- L3: existing governed producer/artifact/path truth, read-only attachment.
- L4: real candidate HTTP, session/CSRF, negative security matrix.
- L5: fresh browser profile, fragment removal, no password/cookie injection or
  interception, full Dashboard, no blocking console error, and lawful chart,
  volume, VWAP, Market Pulse, Observed Flow, and six-window state.

Only L0-L5 evidence tied to the same exact HEAD may be presented for Owner
review. Engineering PASS is not Owner acceptance, merge authorization, or
post-merge verification.
