# CRU-21 Producer snapshot publication repair

Scope: CRU34 `latest.json` publication only. Baseline PR #82 HEAD:
`41a9122e637f92aeb48a66a971de12e9e78f01ca`.
This is a candidate repair, not a production deployment or full CRU-21 acceptance.

## Observed failure and limits

On 2026-10-13, fresh Windows observations showed the existing producer alive and
reporting repeated `EPERM` while replacing `latest.json`. At 16:02 Taipei, three
samples showed snapshot ordinal 402666 unchanged while checkpoint ordinals
advanced 925729 → 925810 → 925864. Snapshot last-write was 10:24:23.146 Taipei;
its byte SHA256 was
`EE4E70AFC2749F0660EF77FDED33E2929D88760AA4AB4F6C663D98CAD9B6D465`.
More than 4,434 failed temporary snapshots had accumulated. None were deleted.

Windows Restart Manager identified Desktop Commander's Node process as a holder
of this exact snapshot. Separate non-mutating `CreateFileW` probes could obtain
read-attributes, DELETE and write access. Thus this was not evidence of a missing
DELETE permission or a reader refusing delete sharing.

On the same machine, an isolated Node v24.18.0 experiment reproduced `EPERM`
merely by keeping a normal `fs.openSync(target, 'r')` handle open across
`fs.renameSync(temp, target)`. Closing that handle allowed the same rename.
This reproduces the Windows open-target replacement mechanism and is consistent
with the observed holder; the formal holder was not terminated and the formal
file was not experimentally replaced. The exact prior tool call that opened
the formal handle is not established. Do not attribute this to antivirus, clock
settings or an ACL change.

The original worker also had an independent, directly verified recovery defect:
it committed its checkpoint before publishing the snapshot. A failed publication
could therefore consume the suffix; a subsequent idle poll would not republish it.

## Candidate behavior

`cru34-snapshot-rename.mjs` uses Windows `SetFileInformationByHandle`,
`FileRenameInfoEx`, with REPLACE_IF_EXISTS and POSIX_SEMANTICS. A reader that
permits delete sharing keeps its old open file; new opens see the complete new
file. The operation stays in the same directory. It does not ignore readonly
attributes, change ACLs, close another process's handles or copy/truncate the
target. Other platforms retain normal rename. Unsupported Windows information
classes fall back to ordinary rename, which may still fail safely.

`cru34-snapshot-publisher.mjs` writes a unique exclusive temporary file, fsyncs and
closes it before replacement. Only replacement errors EPERM/EBUSY/EACCES retry,
at most six attempts with delays 25/50/100/200/400 ms (775 ms total requested
sleep, not a wall-clock deadline). Exhaustion preserves the old snapshot and
cleans only this attempt's owned temporary file. The error retains operation,
code, attempts, delays and cleanup result. There is no delete-before-rename or
in-place write fallback. Directory fsync retains the prior platform policy.

The worker now commits the next checkpoint only after successful snapshot
publication. Failure replays the verified suffix even without a new ledger
append. If the process stops after snapshot publication but before checkpoint
commit, restart replays that suffix without appending or altering ledger data.
Readers validate the complete snapshot's existing hashes; no timestamp, quality,
identity, available-at, calculation or trading-safety contract is relaxed.

## Validation and evidence boundary

Focused regression covers failed publication preserving old snapshot/checkpoint,
recovery without a new append, restart after checkpoint-commit failure, and
successive synthetic ledger publication. Publisher tests cover bounded retries,
permanent failure, cleanup and concurrent whole-document reads. Windows cases
use real isolated file handles; synthetic documents are not market evidence.

The Windows v24.18.0 focused run passed 68/68 tests, without skips: 150 publications
were concurrently read 10,705 times across 151 generations, with zero partial or
hash failures; a held ordinary Node reader reproduced baseline EPERM and allowed
25 successive native publications while retaining its old bytes. A no-delete-share
reader exhausted six attempts with EBUSY, preserved the old snapshot, then allowed
publication after release. A readonly target remained protected. The worker test
also published 51 successive synthetic-ledger updates with matching identities.

The initial sandbox run also denied rename on newly created disposable files in
existing unrelated tests. That failed run is not evidence of the production
cause. Verification must use the normal Windows user as well as the actual
runtime's Node version. Exact counts, reviewed SHA and evidence hashes belong in
the matching PR/Linear checkpoint, not inferred from this document.

Local evidence is retained under
`D:/Taiwan stock/standalone-v1/data/cru21-publication-evidence-20261013/`.
Neither local evidence nor the original raw ledger is uploaded with the source.

The existing production producer, 8787, Bridge, candidate service, research,
authentication, Windows clock configuration and model usage are unchanged.
Production recovery/deployment remains subject to the existing acceptance gates;
isolated tests do not establish formal service recovery. Historic checkpoints
already advanced by the old worker are not rewritten by this patch.

## Primary references

- [Microsoft FILE_RENAME_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)
- [Microsoft FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info)
- [Microsoft FILE_INFO_BY_HANDLE_CLASS](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ne-minwinbase-file_info_by_handle_class)
- [libuv Windows filesystem implementation](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c)
