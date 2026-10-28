# Isolated Windows native lifecycle fixture

`NativeFixture.cs` compiles with the existing 64-bit .NET Framework C# compiler
to `native-fixture.exe` inside a newly approved OS-temp directory named
`cru21-native-fixture-20261028-<UUID>`. It accepts only `suite <root> full|short`
and fixed internal roles of that same executable. It cannot select an application,
executable, script, network target, service, PID attachment or product arguments.
The existing owner marker, source, executable and old receipts are never removed.
Each process holds its own verified canonical binary open with read-only sharing,
rejects hardlink/reparse ambiguity and verifies the suite's frozen SHA256.

The suite exclusively creates `native-authority`, its permanent guard and each
fixed test case. Files are created relative to held native directory handles via
`NtCreateFile`, reject reparse/hardlink ambiguity and use CreateNew/Flush(true).
Writers deny sharing until flush/close, so the driver cannot accept a partial
handoff file. It makes a final completed-receipt check before treating a writer
exit as a missing handshake.
This is an isolated native test authority, not integration of the Linux fixture
authority or proof of Windows power-loss durability.
Guardian arguments must exactly match the immutable pre-spawn intent, including
original start clocks and fixed budget; future or changed starts reject before
dummy creation. Its own CreateNew consumed marker prevents reusing an internal
guardian role for the same case. No new start time is reconstructed on retry.

The driver atomically places every test parent and guardian into its own unnamed
KILL_ON_JOB_CLOSE outer Job. The one-shot guardian alone holds a second unnamed
KILL_ON_JOB_CLOSE Job and atomically creates its fixed dummy in it using
PROC_THREAD_ATTRIBUTE_JOB_LIST. Unsupported creation fails closed; no
create-then-assign fallback exists. No Job handle is inherited by a dummy.

The monitored parent is explicitly a **logical monitored test parent**, not the
guardian's OS creator. Its original wait/query handle is explicitly inherited
through HANDLE_LIST and checked by creation time. The driver receives only a
wait/query duplicate of the dummy handle via its explicitly inherited limited
PROCESS_DUP_HANDLE handle. Numeric PIDs are evidence only, never reopened.
The actual dummy writes an exclusive acknowledgement of its fixed role, nonce,
binary hash and native creation time. Guardian and driver validate that complete
acknowledgement against the original process handle and require it still alive.
Normal deadline cases require EARLY_DEADLINE_STOP with no earlier dummy exit;
an acknowledged dummy deliberately exiting early must be rejected as
DUMMY_UNEXPECTED_EXIT. The unrelated dummy has its own fixed role and ack file.

The guardian uses the original pre-spawn GetTickCount64 and UTC budgets, stopping
early (1000ms for the configured 900000ms case; 500ms for short cases). Receipts
record observed stop/exit elapsed times; late observations cannot certify a
timely close. A full run is **900000ms configured budget with early stop**, not
a claim that a dummy survived a complete fifteen minutes. Wall-clock changes
are fixture offsets only; the OS clock is never changed.
Clock injection starts only after the actual dummy and observing driver are ready.
An independent guardian deadline thread starts before dummy creation and never
performs receipt I/O. The dummy is created suspended and atomically assigned to
the Job before any resume; stop/admission/the sole resume share one lock and a
permanent stopRequested flag. A slow native creation rechecks the original
budget and parent handle before any resume. There is no receipt I/O in that
critical section, but an unbounded native CreateProcess call remains outside
any claim of an unconditional hard deadline.
The driver also has a bounded one-shot failsafe (90s for short, 990s for full)
that terminates its own outer Job and exits on a stalled test. It is neither
persistent nor a proof against driver-wide suspension.

`full` runs the short cases plus the real configured-900000ms case. `short`
explicitly records that full case NOT_RUN. Expected negative cases include
parent interruption/suspension, guardian interruption, injected PID metadata
collision, consumed-ticket reuse, intent/terminal receipt failure and forward/
backward logical clocks. Actual OS PID recycling is not forced.

The guardian-suspension case deliberately demonstrates the remaining limitation:
Job objects provide no independent elapsed-time deadline while their sole
guardian is suspended. NtSuspendProcess targets only the original fixture
process handle, covering the whole guardian including its deadline thread;
unsupported suspension fails the test and is not replaced by PID/thread lookup.
The driver safely terminates only its original guardian
handle after observing that counterexample; closing the Job cleans its dummy.
This case is LIMITATION_CONFIRMED, not a successful hard-deadline proof.
OS sleep/resume and power-loss durability remain unverified.

The summary always states HOLD, hardDeadlineProven=false, runtimeAllowed=false
and nativeAuthorityIntegrated=false. Exit 2 means functional assertions passed
but native candidate qualification remains HOLD; exit 1 means a functional
failure. This fixture cannot open a real candidate, remove a runtime guard,
initialize AI state or authorize a previously refused operation.
