# PR #71: protected-prefix continuous publication candidate

Responds to [GPT checkpoint 5772406115](https://github.com/mike0345721/taiwan-quant-trading-system/pull/71#issuecomment-5772406115). Owner authorized isolated implementation and review submission, retaining the completed stream chain and UI. Baseline: `b4ca3755ef81c2975213dea6021f53b2f609aaa4`; approved main remains `e81c5259b5e38db6ad573242e9cf1ee4f305207f`. No merge or production deployment.

The [numerical receipt](CRU55_PREFIX_CONTINUOUS_EVIDENCE_20260922.json) contains measurement-time code SHA-256s, publication identities, timings and browser observations. Measurements used working code on the baseline above; the containing commit and PR review supply final exact-HEAD identity. The fixture login was subsequently changed from a public test constant to a generated one-use value to satisfy the secret scanner; this does not change the measured pipeline. Prior evidence and failed runs remain preserved.

## Change and integrity contract

The old verifier captured a cutoff but restarted its complete scan whenever the whole source size/mtime/ctime changed. Windows now protects the complete-record prefix `[0,N)` before beginning raw verification and retains the protection through pointer publication:

1. A read handle shares READ and WRITE, but not DELETE, preserving source identity while allowing the existing writer to open and append.
2. A shared `LockFileEx` range denies ordinary writes into `[0,N)` while allowing reads and suffix writes.
3. A read-only file-mapping section and view prevent truncation while the guard exists. Only one byte of virtual address space is mapped and it is not read; this is not a copy of the source or an alternative authority.
4. Every original raw chunk is still read and hashed against the ingestion chunk chain. Both current and referenced prior must complete their whole-prefix scans before publication. Archive hashes alone are never enough. Physical identity and guarded handles are checked again before visibility.

The lock, mapping and publication live in the same Node process via pinned Koffi `3.3.1`. There is no detached lock-helper liveness gap. Process-local UUIDs bind persisted verification cursors to live guards. Missing guards after restart force full re-verification from byte zero; durable ingestion, projection, raw cutoff and page identities remain. Normal append does not invalidate the protected prefix. Hard errors release guards; normal pending cycles retain them; publication releases them. OS process termination releases remaining handles. Non-Windows retains the conservative whole-file-stamp implementation. Native failures do not silently fall back to a weaker method.

Source/resolver identity also includes the dependency lockfile. Old output cannot silently be relabeled as this resolver version. An upgrade needs a new candidate output root under the existing version guard; same-version restarts resume existing output.

The guarantee is scoped to **local NTFS and the reviewed ordinary WriteFile/CRT writer path**. The real `broker/live_event_ledger.py` uses `os.open(O_APPEND | O_CREAT | O_WRONLY)`, `os.write`, `os.close`; it does not use writable mapped I/O. It creates the next dated ledger rather than truncating/renaming the old file. Writable mappings, privileged filesystem alteration, network filesystems and unreviewed writer implementations are not covered. This is not a claim of protection against arbitrary hostile writers. No formal source was locked in this task.

Microsoft documents both the [shared-lock semantics and mapped-I/O exception](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex), and the requirement to release mappings before [SetEndOfFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setendoffile). These references informed the design; the project compatibility claims below come from isolated execution.

## Feasibility and negative evidence

The initial lock-only experiment allowed Node append and rejected overwrite/rename, **but truncate succeeded and reduced the fixture to zero bytes**. That design was rejected. The combined guard subsequently allowed CPython's exact append flags and rejected overwrite, replacement, rename and truncation. Tests include a writable handle opened before guard acquisition and truncate lengths 0, 1, 8, 9 and 17 on an initially 9-byte prefix. Source bytes remained intact; releasing the guard allowed fixture truncation again.

Current and prior tests verify that appending after each bounded verification step does not restart the scan. After guard loss, changing an already-scanned original byte rejects the resumed scan even though archive pages and persisted cursors remain intact. Existing raw-tamper, source binding, immutable page interruption, budget, prior Handoff and session-boundary tests remain applicable. The legacy STAMP test explicitly selects that implementation; it still proves its conservative restart behavior rather than asserting it for the new protected mode.

## Continuous writer / API / UI / process restart

Command: `node scripts/verify-cru55-prefix-continuous.mjs continuous-r1`, on Windows x64 / local NTFS. The fixture imported the actual `LiveEventLedger` class without changing its I/O. Only its market clock and payload were synthetic. After a 1,100-record seed, it appended one record every approximately 100 ms in its own process. Verification ran in a different process with deliberately small **2-page** cycles; HTTP/UI ran independently.

During **175.895 seconds**, the writer reached **2,809 records**, with **zero writer errors**. There were **18 publications**, strictly increasing from cutoff **1,102 to 2,618**, while the writer kept running. All publication cutoff hashes matched the corresponding writer record hashes; CVD equaled the expected ordinal, proving no double counting or skipped accepted trades in this all-buy fixture. All 18 publications passed six real protected HTTP responses (**108 responses**); artifact, cutoff, endpoint CVD and chart/relationship projection agreed, and per-request raw reads were zero.

After two publications, the verifier process was killed during VERIFY at ingestion ordinal **1,236**, verify index 2. Its replacement process resumed ingestion at **1,236**, reset the invalid verification cursor, and published 1,236 before continuing. Exactly **one current verification restart** was attributable to process/guard loss; append-induced current restarts were **zero**. Prior append/restart behavior is covered by a separate bounded Windows test, not by this current-only continuous receipt. The existing `verificationRestarts` metric counts current verification only.

The real Overview was opened and logged into the private fixture session once. It showed four chart panes, valid VWAP and synthetic/STALE/descriptive labels. Browser observations include +1,752, then +2,042 across selected 5m/15m/30m/1h/4h windows, then **automatic +2,498 on the same 4h page without reload or another login**. API checks include all six frames at each publication. Browser artifact IDs matched the recorded publications. Console errors were zero and horizontal overflow false. Initial 401 before login and 503 for the unavailable DAY selection were expected and retained. This uses the existing formal-entry handler with a private fixture session callback; it is not a new acceptance of the production password backend. UI source, layout, computation and polling code were not edited.

## Measured latency and backlog

These are local fixture measurements, not exchange delivery latency or production SLOs. Ingestion time is the first observed completed cycle covering that publication's cutoff, so it is a sampled upper bound. UI time is a DOM observation, not an instrumented first-render timestamp. Percentiles in the receipt use the lower empirical rank.

| Measurement | p50 | p95 | Maximum |
|---|---:|---:|---:|
| Source write → observed ingestion, 18 publication endpoints | 0.611 s | 1.756 s | 4.675 s |
| Observed ingestion → publication | 8.390 s | 11.612 s | 12.568 s |
| Source write → publication | 9.219 s | 12.315 s | 13.131 s |
| Bounded cycle, 349 samples | 0.322 s | 0.817 s | 1.693 s |
| Actual writer append call, 1,709 post-seed samples | 0.332 ms | 0.552 ms | 463.759 ms |

The largest observed writer gap was 564.249 ms. There were no lock/write failures or deliberate pauses, but these measurements do not claim zero scheduling/I/O latency impact. The final automatic UI sample observed publication +2,498 after **4.575 s** and its source write after **16.793 s**; those are upper bounds. Other UI samples and their separate timestamps are retained in the JSON.

Peak observed **projection-worker RSS was 294,490,112 bytes**; this excludes the writer, HTTP process and browser. At the last measured cycle, ingestion backlog was **42,840 bytes** and publication backlog **141,525 bytes**. At the last publication, publication backlog was **97,155 bytes**. The writer was stopped only after measurements were finalized; no post-stop drain is reported as sustained-ingress success. Full historical projection/verification cost still grows with prefix size. This proves repeated publication despite append, not a full-session throughput bound or ability to keep up with arbitrary market rates.

## Managed path and validation

The candidate branch guard now accepts this exact isolated branch as well as PR71's original branch; fixture, worktree, commit and formal activation gates remain. The actual PowerShell managed launcher was run with explicit ProjectRoot, synthetic-only binding, `-Candidate -CandidateCycles 2`: verified process startup, PUBLISHED → UNCHANGED at ordinal 3, clean owner-lock exit and empty stderr. This is a small managed wiring check, separate from the above continuous verifier-process restart and previous PR71 managed-recovery evidence.

Preserved setup failures: existing Windows PowerShell default ProjectRoot evaluation was empty when omitted; passing its explicit supported parameter resolved invocation. Sandbox WMI denial interrupted the first managed attempt before owner identity was written; the unknown lock correctly blocked reuse. That failed output/config was retained, and a separate candidate run succeeded with the required execution permission. No unknown lock was deleted or treated as recovered.

Focused regression: initial **36/36 PASS** across Windows guard, pipeline, prior, managed plan, store and projection. Final affected regression **19/19 PASS** (guard 3, pipeline 6, prior 2, managed plan 6, formal entry 2). Exact-HEAD review results are recorded on PR71. Secret scan and diff check passed after generating the fixture login value instead of storing a fixed test password. Windows tests are assigned to the explicit Windows lane, separate from remote hermetic CI.

## Delivery / resume boundary

WORK_ITEM: CRU-55 / PR71. Branch: `codex/cru55-growing-prefix-v1`, isolated worktree under `data/worktrees/`. Deliver the new commit onto PR71's existing review branch by ordinary fast-forward push after confirming the remote is still the baseline; no force push. Required review: Level 3, current agent and two independent reviewers. The PR records their exact-HEAD dispositions. Accepted U1, source chain, UI and unrelated main work remain unchanged.

`CONTINUOUS_APPEND_CANDIDATE_PUBLICATION = VERIFIED_FOR_THIS_FIXTURE`.
`FULL_DAY_OPERATIONAL_ACCEPTANCE = NOT_READY`.
`NATURAL_LIVE_ACCEPTANCE = NOT_VERIFIED`.
`MERGE_AUTHORIZED = NO`.
`FORMAL_DEPLOYMENT = NOT_PERFORMED`.

Safety: `formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`. No formal collector, schedule, raw/SQLite, past failure evidence or CRU52 five-day count was changed. No full-day claim, real positive adjacent Handoff acceptance, source-authority change, order route or strategy feature is included.
