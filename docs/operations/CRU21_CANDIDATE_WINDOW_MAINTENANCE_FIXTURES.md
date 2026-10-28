# CRU-21 normal candidate maintenance: isolated revision

This revision implements the original normal-guard, preparation and supervisor
contracts in an isolated, fixture-only package. It is not installed on MSI, and
does not change the previous private helpers or their historical receipts.

The fixed external product target is PR103
`f221ee21448987ea5c675e36d82573c65dbbe09b`, tree
`fae6e3c9fda81fd4632fa5f3900542ade257ea1d`. The maintenance branch has its own
commit/tree and test evidence; it does not incorporate the product changes into
its older source baseline. A synthetic target observation is not proof that a
live checkout contains this product. The earlier `9765c78` fixture revision and
its a4 pin remain historical artifacts; their tickets/receipts are not migrated,
reissued or reopened by this source update. Old and mixed head/tree observations
are rejected before fixture consumption.

Owner elected to skip this product's GitHub CI on 2026-10-28: remote CI remains
NOT_RUN. Its recorded focused product result is 124 PASS / 0 FAIL / 1 SKIP.
The separate f221 ancestor comparison resolved the standard ancestor rejection;
full default native path and normal Browser qualification are still unverified.
No product tests are rerun by this mechanism maintenance. Product CI335 belongs
to old a4 and validates neither f221 nor this maintenance.

## Revised components

- `scripts/cru21-normal-candidate/normal-guard.mjs` freezes the exact product,
  separate approved main, normal authentication, split source identities, private
  writes, helper hashes and executable identity. Synthetic observations are
  explicitly not Windows or live evidence.
- `prepare.mjs` isolates the preparation logic previously held in private
  `prepare-evening-qa.ps1`. Only temporary fixture roots and fixture approval IDs
  are accepted. Its immutable ticket and consumed intent precede any simulation;
  a permanent consumption tombstone in the fixed approval authority prevents
  rolling back a window directory to reuse its ticket. Old evidence is not
  overwritten. No PowerShell install/launch wrapper exists.
- `supervisor.mjs` exercises one child-handle lifecycle through an injected
  synthetic driver. There is no OS process, socket, PowerShell, application,
  vault, ACL or model adapter. Direct invocation refuses a real window.

All tickets say `ISOLATED_FIXTURE` and `runtimeAllowed=false`. The fixed canonical
authority is shared by its windows, not chosen anew by each window. A separate
temporary test authority is not a second live Owner authorization; no live
external approval registry has been implemented or claimed.

The 900000ms budget starts before the sole simulated spawn. Wall-clock forward
jumps and the original monotonic budget can end it; backward jumps, logins,
new directories and retries do not reset it. Failed or uncertain attempts remain
consumed. Unknown guards are never taken over. A lost handle never falls back to
a PID, port or process name. Unknown cleanup keeps the guard and does not produce
a successful close. A simulated dead parent does not write its own close record.
Stopping completion rechecks the clock; late exits and unknown timestamps cannot
be certified as a timely close.

This fixture revision deliberately never deletes or renames a guard. After a
verified synthetic child exit it can seal its own lease, while retaining the
global guard permanently. `CLOSED` describes that synthetic child, not authority
reuse: `guardRetained=true` and `liveReuseAllowed=false`. This stricter behavior
avoids claiming atomic compare-and-delete from ordinary path checks. Even a new
approval cannot reopen that used fixture authority; separate scratch fixtures
are separate experiments, not automatic acceptance windows.

## Evidence boundary

Tests use temporary files, fake clocks and in-memory child handles. Their passing
invariants demonstrate fixture lifecycle and storage behavior, not native Windows
handle ownership, process containment, hard wall-clock termination, filesystem
durability under a Windows crash, real HTTP/browser behavior or an acceptance URL.
No fixture spawns the real application or initializes its AI store.

The authority is Linux-only and anchors receipt operations to held temporary
directory descriptors through `/proc/self/fd`. Replacement of a pathname must
not redirect a write into another fixture source root. This does not establish
Windows junction/handle behavior; non-Linux authority construction rejects.

The lifecycle's `check()` is driven by the fixture. It is not a production timer
or a native hard deadline. Capability flags model fixture behavior and never
unlock a real adapter. A production adapter and Windows dynamic evidence are
absent; they must not be inferred from a fixture driver declaring capabilities.

## Remaining HOLD conditions

Real execution gates always reject. This authorization covers maintenance and
isolated tests only. It excludes real windows, formal services, Producer/Bridge,
deployment, merge, permission/credential/vault operations, OAuth, model calls,
receipt deletion, window extension and retrying refused operations.

The f221 product source separates automatic status from initialization/ACL writes,
as covered by its isolated tests and scoped reviews. Scoped Windows ancestor and
synthetic DPAPI evidence does not qualify a normal account or Browser window;
this pin update does not authorize or exercise those paths. Explicit setup/account/model
actions retain their separate boundaries and must not be triggered by a fixture.
The previous controller/health refusals and local listen/Chromium restrictions
remain in effect. Skipping remote CI does not relax a release or runtime gate.

This original JavaScript authority remains Linux-only. The separately authorized
Windows integration is in `scripts/cru21-normal-candidate/windows-candidate`,
with fixed application artifacts beside these modules. Its native code, source
checks and captured normal-application tests have distinct evidence classes;
neither the original dummy fixture nor Linux tests qualify that new Windows
host. Native compile/run must be reported separately, including any refusal.
The 900000ms maximum, permanent consumption and real-execution gates remain.

Before any further decision, report the maintenance commit/tree, actual fixture
PASS/FAIL/SKIP, non-author implementation review, and unavailable Windows dynamic
evidence separately. No real window has been opened and no URL is available.
