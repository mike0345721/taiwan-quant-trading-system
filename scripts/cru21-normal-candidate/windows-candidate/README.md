# Fixed Windows normal-application integration host

This is a separate, fixed integration artifact. It does not modify the older
Linux authority or frozen native dummy fixture. The product is PR104 4ae16de,
tree ac2d522e6d42934dbb563599a04df61f56fc9145.

Only these public commands exist:

    candidate-host.exe prepare-isolated <approved-root>
    candidate-host.exe run-isolated <approved-root> <window-uuid>
    candidate-host.exe suite-host-death <approved-root> <window-uuid>
    candidate-host.exe plan-normal <approved-root> <window-uuid>
    candidate-host.exe run-normal <approved-root> <window-uuid>
    candidate-host.exe live-gate

The root must be an existing direct OS-temp child named
"cru21-candidate-integration-20261028-<UUID>", containing the host itself as
"candidate-host.exe", a fixed "integration-manifest.json", and three reviewed
files under artifacts: application-runner.mjs, application-isolation.mjs,
and product-bundle.json. There are no arbitrary executable/script/argument,
PID selector, environment-file, URL, service, ACL or credential parameters.
The internal inherited-handle role only runs this same fixed application.

The manifest has exactly these fields:

    {
      "schema": "cru21-candidate-integration-manifest-v1",
      "mode": "ISOLATED_NORMAL_APPLICATION",
      "runtimeAllowed": false,
      "productHead": "4ae16de9a5af0166744626d44a49cb5bcebed675",
      "productTree": "ac2d522e6d42934dbb563599a04df61f56fc9145",
      "windowId": "<UUID>",
      "nonce": "<64 lowercase hex>",
      "durationMs": 10000,
      "nodeSha256": "<actual existing fixed Node binary SHA256>",
      "runnerSha256": "<compiled expected runner SHA256>",
      "isolationSha256": "<compiled expected isolation SHA256>",
      "bundleSha256": "<compiled expected bundle SHA256>"
    }

Placeholder values do not work. The three application hashes are also compiled
constants, so replacing a manifest cannot choose arbitrary Node code. The only
Node path is C:\Program Files\nodejs\node.exe; its existing bytes are checked
against the ticketed hash. Parent directories, the host image, Node image and
all application artifacts remain held without DELETE sharing, and code files
deny write sharing, through the original child exit. No ACLs are changed.
The product bundle contains individually frozen real application source bytes,
plus explicitly synthetic dependencies in the application adapter.

Isolated preparation creates one authority/windows UUID and an immutable ticket
binding the manifest and native host hashes. Application Session/cache state is
entirely synthetic memory. No private application directories or files are
created, read or written by the Node test application.

Run permanently creates guard.json, consumed.json and the launch intent
before a Node child can be created. All native authority writes are relative
to held directories through NtCreateFile, use CreateNew, flush to disk and
retain their original handles. Unknown failures stay consumed. No receipt,
guard, old directory or ticket is deleted or reset.

The child is created suspended and atomically assigned to an unnamed
KILL_ON_JOB_CLOSE Job through PROC_THREAD_ATTRIBUTE_JOB_LIST. Original monotonic
and UTC budgets are checked again before the sole resume. The child receives a
minimal fixed environment, a virtual private LOCALAPPDATA, no preload variables,
no Job handle, and an explicit HANDLE_LIST. A host-only anonymous stdin writer
delivers the hash-verified runner, the one helper as a data URL, immutable intent
bytes and product bundle bytes, then closes EOF. The only helper import literal
must be replaced exactly once. No Temp script pathname or application data path
is loaded by Node. The writer starts after the sole resume, outside the admission
lock; deadline handling never waits for pipe I/O. Child cwd is the fixed existing
Node directory, whose actual held-handle namespace security is checked.
Standard error is a fixed NUL device. Only that original child inherits the
anonymous stdout pipe writer.
The host reads a size/time-bounded one-line handshake from that pipe, checks the
original process handle PID/creation/liveness, exact source identity, all eleven
real normal-handler HTTP observations, Session/CSRF rejection and zero prohibited
effects, then writes the handshake receipt itself. A preexisting path receipt
cannot authenticate a writer and causes a CreateNew failure instead.

The app executes hash-frozen PR104 server.mjs and normal authentication through a
captured HTTP callback, with no socket or browser. Market, Git, chart/flow and
credential-inspector dependencies are explicitly synthetic. It is a real Node
application integration, not the prior dummy; it does not prove real credentials,
full native vault reads, actual market data, rendered UI or a normal candidate
listener. It remains alive for exact Job/handle cleanup.

suite-host-death atomically starts only this same host in an outer Job. The
child host sends a duplicated wait/query handle for its authenticated Node child
through a second private anonymous pipe. The driver stops only its original host
handle, then observes that original Node handle signal when the sole inner Job
owner dies. Numeric PIDs are evidence, never reopened. Ordinary tool/PowerShell
parent death is not claimed as immediate Node cleanup when the host itself
survives; its original deadline continues.

The monitor thread contains no receipt I/O. Normal isolated expiry stops 100ms
early, observes exit against the original budget and records CLOSED or UNKNOWN.
A failed receipt or cleanup never permits restart. A failed TerminateJobObject
request is never blindly repeated; the original Job is closed and the original
child handle is observed, otherwise cleanup remains UNKNOWN. Retaining a guard permanently
is intentional. Native power-loss durability and OS sleep/resume are not proven.
Guardian-wide suspension still cannot provide an unconditional elapsed deadline,
so live-gate always refuses with HARD_DEADLINE_FAULT_MODEL_UNRESOLVED.
nativeAuthorityIntegrated=true in an isolated receipt does not set
hardDeadlineProven=true or runtimeAllowed=true.

Compile only inside an authorized dedicated test root with the existing x64
.NET Framework compiler and /r:System.Web.Extensions.dll. Linux source/build
contract checks are not Windows compile/run evidence. No native execution was
performed by authoring this artifact.

The fixed normal bootstrap is a separate application-normal-entry.mjs artifact.
plan-normal verifies its separately frozen hash and emits only the fixed stdin
code transport/Node/root/UUID/nonce plan. It does not read a real site ticket,
import the normal server or open a listener.

The normal pipeline is wired in source after its closed gate:

    Main.run-normal
      -> compiled NormalGateAllows (currently false, before all site I/O)
      -> Configure normal-request.json and exact Owner approval binding
      -> PrepareNormalAuthority with frozen-source preflight/private roots
      -> shared Run consume/intent/permanent private-root consumption
      -> immutable normal-ticket.json from request + original intent hash
      -> fixed Node suspended in original Job
      -> BuildNormalAdmission + NormalProgram, before sole resume
      -> original stdin code + original stdout listening handshake
      -> shared original-budget Job/handle cleanup

normal-request.json uses the normal ticket's exact data fields, but schema is
cru21-normal-entry-request-v1, it omits intentHash and adds authorityRoot and
ownerApproval. The approval object has exactly schema, approvalId, requestSHA256,
notBeforeUtcTicks, expiresUtcTicks and operationPlanSHA256. Its schema is
cru21-normal-window-owner-approval-v1. requestSHA256 covers recursive sorted JSON
of the request without ownerApproval. operationPlanSHA256 binds the retained
normal-operation-plan.json bytes. The approval itself must match a compiled
ExpectedNormalOwnerApprovalSHA256, currently NOT_APPROVED. No manifest flag,
new UUID, copied Temp directory, login or retry grants a normal window.

The approved operation-plan JSON must explicitly contain this fixed scope:

    "candidateListenerProbe": {
      "mode": "BIND_ONLY", "host": "127.0.0.1", "port": 18722,
      "exclusiveAddressUse": true, "listen": false, "connect": false,
      "maxAttempts": 1
    }

Only normal mode, after the original child exits, may create an IPv4 socket,
set ExclusiveAddressUse, bind that single literal loopback port and immediately
dispose it. There is no Listen, Connect, port scan, PID lookup or takeover. Any
bind/dispose uncertainty is UNKNOWN/CANDIDATE_LISTENER_UNVERIFIED with no retry.
Both original clocks are sampled after disposal before CLOSED can be certified.
portFreeAtCloseObservation is point-in-time evidence only, never a continuing
claim that another process cannot later acquire the port. This source path has
not run; isolated mode never calls it and no Linux EPERM is retried.

Normal preparation verifies the complete pinned source before private directory
creation. It creates only the approved sourceRoot/data private namespaces, and
permanent .cru21-normal-window-consumed.json under that fixed private root prevents
reusing the same authority through a second Temp control directory. Any failed
or uncertain attempt keeps all guards and evidence. The original approved absolute
UTC interval cannot exceed 900000ms; a late start receives only its remaining
budget. No expiry is recomputed or extended.

BuildNormalAdmission actually reads/hashes and retains native leases for all 356
frozen source files, the exact reviewed four-package vendor closure and all its
actual files, Node/Git executables and helper bytes. It compares package versions
and lock integrity with the frozen package-lock, rejects vendor extra/missing
files, and checks actual code namespace owner/DACL using GetSecurityInfo on held
handles. Unknown/callback ACEs reject. Other principals may have only read/execute
on actual code namespace directories and files; only already-existing outer
ancestors additionally allow ADD_SUBDIRECTORY=4. WRITE_ATTRIBUTES, delete,
delete-child, ACL/owner changes and unknown writes are not permitted. Privileged
current-user/SYSTEM/Administrators/exact TrustedInstaller OS-servicing principals
are trusted for code. No ACL setter or global write lock is used.

All roots and executables must be local drive-absolute paths on DriveType.Fixed;
UNC, device, mapped-network, drive-relative and removable paths reject before
source/ACL reads. Chart/Producer directories are held for identity only; their
live contents are not preflight-read or leased against Producer file rotation.
The generated admission binds exact request/ticket/root/source/vendor/helper
digests, original Node PID/creation-time string and source volume/file ID. Normal
code is also delivered on original stdin, with a fixed explicit bootstrap footer.
The same shared native deadline and original handle/Job closure enforce cleanup.
Normal auth is only existing process DASHBOARD_PASSWORD_HASH forwarded after
the normal gate; no new credential or vault setup exists. Listening/configuration
does not certify Owner login, account access, Browser or G7/G8 acceptance.

run-normal still refuses before reading any manifest, so runtimeAllowed=true in
a self-written file cannot unlock it. The Node bootstrap has its own closed live
gate. Actual normal code-source leases, real configuration, dynamic import and
listening handshake remain NOT_RUN, as do native compile/API/kernel tests.

The caller's first host-image launch needs a safe qualified code namespace too;
the host cannot retroactively secure bytes already executed by an unsafe caller.
Self-host-death tests also check the complete executable namespace and fail closed
on unsafe Temp ACLs. This is not permission to move to a new path, alter ACLs or
bypass an execution refusal. A fault-model decision, exact site configuration and
Owner window authorization cannot be replaced by flipping a fixture flag.


PR104 source binding (2026-10-30)
--------------------------------

This maintenance branch pins product HEAD
4ae16de9a5af0166744626d44a49cb5bcebed675, tree
ac2d522e6d42934dbb563599a04df61f56fc9145 and branch
codex/cru21-repository-closeout-20261029. The main pin remains
4d8251686bdb4abbdb469bc00ae798717c0fd583; a GitHub ref observation does not
prove any MSI-loaded identity. This update changes pins and their hash chain,
not lifecycle, authorization, deadlines or cleanup. All native compile/run and
real candidate/browser checks for this repin remain NOT_RUN.

The 356-file normal source inventory hashes to
b1391d7e3a971d72741053c159ea95acf772ca2a9d8f3970a4af098408fa947a.
It includes the changed decision journal and public inline JavaScript bytes.
Inventory/hash verification does not execute those behaviors. The separate VM
bundle still has exactly 12 files, including the two updated preview contracts;
it excludes src/decision-journal.mjs and public/ask-gpt-inline.js. Its UTF-8
JSON.stringify(bundle) plus LF bytes hash to
44cef1c049569d38508c9b3e0abbcfd824c0b8278cc42f7c85f2b4805ad74961
(210729 bytes). The synthetic-memory, captured-handler VM tests do not qualify
full V1 journal behavior, browser UI, genuine credential reads or a real listener.

Local tests may select a raw-byte product snapshot with
CRU21_APPLICATION_SOURCE_ROOT and CRU21_PRODUCT_SOURCE_ROOT. These are test
fixture selectors, not runtime root overrides or fabricated Git identities.
Mixed-version negative tests additionally use CRU21_PREVIOUS_APPLICATION_SOURCE_ROOT
and check every selected previous file against its known f221 hash before use.
The source snapshot is not modified, given a .git directory or reported as a
checked-out HEAD by these tests. The normal launch gates remain closed.
