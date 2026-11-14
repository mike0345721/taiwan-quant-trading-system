# CRU-55 / PR #71 stream-chain evidence — 2026-09-22

Status: **DEVELOPMENT EVIDENCE / FINAL CANDIDATE ACCEPTANCE PENDING**.

This report preserves completed evidence from the continuation of GPT review [5754618020](https://github.com/mike0345721/taiwan-quant-trading-system/pull/71#issuecomment-5754618020). It is not approval to merge, deploy, promote market state, or declare full-day operation. U1 remains closed in the candidate and is carried forward without reopening its accepted UI work.

The receipts were produced with uncommitted work based on `6f7dd7c05ffe6fd36b09cbbe81400c13f48e96a6`, on `codex/cru55-formal-entry-recovery-v1`. They precede final managed-owner recovery and adjacent-source verification changes. Their immutable artifact, generation, projection, source, and cutoff hashes are retained in the [sanitized JSON companion](CRU55_STREAM_CHAIN_EVIDENCE_20260922.json). They must not be relabeled as tests of a later exact HEAD. The JSON contains derived numerical summaries and identity hashes, not raw records, credentials, local configuration, or absolute owner paths.

## Completed observations

| Evidence | Input | CVD snapshots | Final CVD | Display / price bars | Six-window status |
|---|---:|---:|---:|---|---|
| Synthetic threshold / process resume | 1,100 records; 655,543 bytes | 1,100 | +1,801 | 400 CVD display points; 367 price and VWAP points | All six complete |
| Synthetic representative night span | 30,001 records; 96,483,159 bytes | 30,001 | +49,091 | 454 CVD display points; 840 price and VWAP points | All six complete |
| Existing real historical ledger prefix | 60,000 records; 82,021,423 bytes | 1,432 | -53 | 514 CVD display points; 3 lawful price bars | 1m / 5m complete; longer windows partial |

Each publication states `FULL_PREFIX_BEFORE_PUBLICATION`, `originalRawPrefixVerified=true`, and `stableVerificationRequired=true`. The current window results share their publication's physical cutoff hash. Display reduction does not change the input snapshot count or CVD calculation.

| Window | Synthetic 1,100 ΔCVD | Synthetic night ΔCVD | Real prefix ΔCVD |
|---|---:|---:|---:|
| 1m | 6 | 60 | -7 |
| 5m | 28 | 296 | 45 |
| 15m | 76 | 880 | -53 (partial) |
| 30m | 150 | 1,756 | -53 (partial) |
| 1h | 298 | 3,510 | -53 (partial) |
| 4h | 1,182 | 14,034 | -53 (partial) |

### Threshold and process resume

The synthetic threshold case resumed in a separate process from `PENDING / PROJECT`, then published 1,100 snapshots. The receipt records two cycles and 1,592.5728 ms for that resumption segment only. Its final ingestion and publication backlogs were zero. This receipt does not prove a subsequent 1,100 → 1,300 append, a managed crash recovery, or final-version browser acceptance; those are separate pending evidence items.

### Representative night capacity

The synthetic source spans `2026-09-14T07:00:00.000Z` through `2026-09-14T20:59:30.000Z` (13h 59m 30s). It exceeds both 25,000 records and 64 MiB. The final publication covered the complete generated source, with zero ingestion and publication backlog.

The successful process after an `EPERM` metadata rename failure recorded 195 cycles, 250,410.087 ms elapsed, cycle p50 839.362 ms, p95 3,215.3901 ms, maximum 4,067.7637 ms, and peak observed RSS 448,299,008 bytes. **These timings cover only the successful resumption segment, not the original full catch-up.** The initial failed segment's timing was not retained by the receipt. Its `processResume:null` field does not negate the observed earlier failure; no prior completed receipt existed for that run. Other local validation ran concurrently, so these figures are not an isolated-host capacity ceiling or a market-ingress latency measurement.

This is a static synthetic capacity observation. It does not prove that original-prefix verification keeps up with a continuously appended production ledger, nor that an entire natural trading session passed operational acceptance.

### Real ledger prefix

The read-only historical source produced a bounded publication at ordinal 60,000: 1,432 CVD snapshots, CVD -53, and an 82,021,423-byte original prefix verified before publication. The three accepted price bars and incomplete longer windows are preserved; missing observations were not fabricated. The final accepted VWAP sample was 47,130.98039215686 with `availableAt=2026-09-18T00:50:03.498Z`.

The first receipt request selected NIGHT although the publication belonged to DAY. The API rejected that mismatched selection. Only the isolated test-output directory routing was corrected to DAY, and the already published artifact was read back without recalculating or changing the original ledger. The resulting receipt says `ALREADY_PUBLISHED_RECEIPT_READ`, `cycles=0`, and has null elapsed, latency, and RSS values. These are unavailable measurements, not zero-cost processing. This is historical-prefix evidence, not natural LIVE or whole-session evidence.

## Preserved development failures

1. An initial synthetic capacity run hit `STREAM_STORE_ARTIFACT_BUDGET`. The candidate learned a smaller batch through adaptive splitting; the artifact cap was not raised and records were not discarded. The failed run remains local.
2. A development run stopped when the loaded-code guard detected code changes. Its old output was retained, and later code used a separate evidence run.
3. The night-capacity run encountered `EPERM` while replacing ingest metadata. The same-code retry resumed its existing state and completed. The evidence does not establish the cause of the filesystem denial; no source or output reset was used to hide it.
4. The real-prefix API selection error above is retained as a failed acceptance step, followed by a routing-only correction and read-back.

## Outstanding final-candidate evidence

At this document's initial checkpoint, the parent delivery still needs to add or explicitly classify:

- Final exact-HEAD review and proportionate tests after the managed-owner and adjacent-source fixes.
- Final-version new-chain progression beyond 1,024 snapshots, subsequent append, six-window API/UI agreement, and restart continuation, including a browser read-back.
- Managed launch, reuse, interruption, stale-owner recovery, and formal source-alias compatibility evidence.
- A representative day-span run with complete initial catch-up timing, plus controlled growing-source measurements for latency, publication backlog, and verification restarts.
- A precise disposition of any remaining sustained-ingress limitation; `PUBLISHED` on a static source cannot substitute for this check.

Original raw integrity, frozen semantic contracts, accepted UI, and healthy collectors remain protected. No merge or formal deployment is included in this work. Natural LIVE / full-day operational acceptance remains **false / pending**, and CRU-52 historical failures and five-day counts are not changed.

Safety throughout this evidence: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`.

## Addendum: final working-code acceptance observations

The following later observations extend, rather than replace, the development history above. They were obtained from the final working-code candidate while the Git baseline was still `6f7dd7c05ffe6fd36b09cbbe81400c13f48e96a6`; the changes were uncommitted at measurement time. Exact commit identity, independent review, and CI disposition must be supplied by the final delivery. This addendum supersedes the earlier pending list only for the specific observations completed below.

### New-chain continuation, six windows, and browser

The final synthetic chain resumed `PENDING / PROJECT` in another process and published at 1,100 snapshots, CVD +1,801. A later process appended through 1,300 snapshots and published CVD +2,123 in 4 cycles / 3,135.4772 ms. A further invocation reverified the original prefix and returned `UNCHANGED`, retaining artifact `60e08dd3c1c83b8fbcf6a1b1410d636ed562afcdfb7eebfae506dc459be5c171` and zero backlog. The six current ΔCVD values at ordinal 1,300 were **0, 22, 72, 144, 292, 1,176** for 1m, 5m, 15m, 30m, 1h, and 4h; all were complete and carried cutoff hash `bd4762a2e29ab38ab83fd9f4fb8cec527c08041b8b7ca561f9c317e6d40525b8`.

The parent acceptance session directly observed the isolated, login-protected browser show +1,801 and then automatically update to +2,123 without reload or another login. Its artifact matched the 1,300 receipt above. All six frame selections retained endpoint +2,123; four panes, 434 price bars, and 434 VWAP points were present. The session reported zero console errors and no overflow. The UI identified the source as synthetic. This proves candidate browser/API propagation for that controlled append; it is not formal 8787 deployment or natural LIVE evidence.

### Complete representative day catch-up

A fresh synthetic day-span run processed **27,001 records / 86,781,157 bytes** over the generated interval `2026-09-14T00:45:00.000Z` to `2026-09-14T05:44:42.000Z`. The complete initial catch-up took **359,050.5436 ms / 230 cycles**. Cycle p50 was 943.5872 ms, p95 3,348.824 ms, maximum 5,617.2681 ms, and peak observed RSS 405,024,768 bytes. It ended at CVD +44,183, with 27,001 input snapshots, 454 display points, 300 price/VWAP points, and zero ingestion/publication backlog. All six windows were complete; ΔCVD was **151, 739, 2,212, 4,422, 8,850, 35,381**. The full original prefix was verified before publication.

Unlike the earlier night receipt, this timing covers a fresh complete catch-up. It remains a local synthetic throughput observation; it is not exchange-event-to-screen latency or proof of concurrent natural ingress capacity.

### Growing-source limitation measured, not waived

The controlled growing-source run appended once before each of six verification cycles. **All six remained `PENDING / VERIFY`**, and verification restarts increased from 1 to 6. Ingestion backlog rose from 596 to 3,576 bytes; publication backlog rose from 656,139 to 659,119 bytes. After appends stopped, a stable interval of **612.3288 ms** completed publication of the captured ordinal 1,100, leaving the six new records pending. A new round then published ordinal **1,106** with both backlogs at zero. The complete experiment lasted 19,843.4751 ms.

The integrity guarantee remains unchanged: publication requires a stable full-prefix verification interval. Continuous writes can repeatedly invalidate verification and prevent publication from advancing. **Sustained-ingress / full-day operational readiness is `NOT_READY` on this evidence.** Static capacity completion and eventual drain after writes stop do not remove that limitation.

### Managed launch and interruption recovery

The isolated managed fixture passed a fresh-shell launch (PID 14108), fresh-shell reuse of the same owner, targeted interruption, and a fresh-shell restart (PID 1976). At interruption, `pipeline.lock` was preserved and subsequently retired as evidence after owner validation. `storeLockPreserved=false`: that lock had already been released during the timing race, so this run **does not claim an actual interrupted store-lock recovery**. The resumed managed source advanced from ordinal 1,100 / CVD +1,801 to ordinal **1,600 / CVD +2,615**, with the full original prefix verified. Its receipt reports `PASS`; no production collector was the target.

### New working-code real-prefix measurements

The new real-source run used the same governed historical source identity `sha256:313e1df118d92a986c4d7ea6d44d2f295d59bbee568590d5468b0fdefc1bea22` and preserved original raw bytes. These are actual measured publication runs, distinct from the earlier read-back-only receipt.

| Cutoff | Verified prefix bytes | Snapshots / CVD | Elapsed / cycles | Cycle p95 / maximum | Peak observed RSS |
|---|---:|---|---|---|---:|
| 60,000 | 82,021,423 | 1,432 / -53 | 355,237.9843 ms / 177 | 5,969.7917 / 10,237.7184 ms | 374,444,032 bytes |
| 61,000 | 83,389,192 | 1,453 / -24 | 57,281.6505 ms / 121 | 739.6014 / 2,960.2897 ms | 364,150,784 bytes |

At ordinal 61,000, all six window results carried cutoff hash `5f14b6ccba6310a20ece4078837ce08edce6281204e68a1ee33c250820c33082`: ΔCVD **15, 79, -24, -24, -24, -24**. Only 1m and 5m were complete. Accepted price bars remained 3 and VWAP remained 47,130.98039215686; this unchanged price observation is not replaced with synthetic updates. The new artifact was `ecc3bb04fe2d8fa1b62e83f311c0de64e2797fccf7dc9d95493801f6e99fd72b`. A later 62,000 cutoff and real-source browser read-back are pending addition by the parent at this checkpoint.

### Proportionate validation and remaining disposition

The parent reported these candidate tests passing: first-pointer publication fault **1/1**; owner **3**, managed **6**, pipeline **5** (**14/14**); projection **9**, store **10**, formal entry **2**, runtime binding **1** (**22/22**). Prior-source verification **2/2** and Windows source-alias compatibility **1/1** are carried from the same work round. These counts describe the actual relevant suites; they do not constitute a full-day acceptance test or a new U1 review.

The `priceViolations` diagnostic is prefix-wide rather than limited to the displayed price segment. It is retained as a disclosed, nonblocking diagnostic-scope limitation; it must not be interpreted as a per-window count. Remaining delivery items are exact-commit review/CI, the next real-prefix/browser evidence, and final external read-backs. Natural LIVE, full-day operational readiness, formal deployment, and merge remain unaccepted/unperformed in this work.

## Final real-prefix browser and API read-back

The same original historical ledger continued in fresh processes through raw ordinals 60,000 → 61,000 → 62,000, with CVD -53 → -24 → -44 and 1,432 → 1,453 → 1,472 snapshots. The last verified prefix was 84,757,597 bytes. The last continuation took 50,564.7496 ms across 123 bounded cycles; this is suffix ingestion plus full historical projection and original-prefix verification, not market delivery latency.

The logged-in isolated browser showed -24 and then automatically -44 without page reload or another login. All six selected windows retained -44 and artifact 1efc04593e18d4a161e5c660bc8f442855b4db010ab546defc358834d837477d; their deltas were 3, -6, -44, -44, -44, -44. The three lawful VWAP points stayed unchanged because the accepted price subset did not advance. Session Context remained UNAVAILABLE and longer windows/relationship quality remained partial; no price or context was invented. Console errors were zero. A transient 503 during isolated server replacement is preserved as a failed setup step, followed by exact-owned-process recovery.

Six actual HTTP responses matched source, cutoff, projection, CVD and UI values; unauthenticated access returned 401. This uses a private fixture session callback around the actual formal-entry handler, not a new verification of the production password backend. Per-request raw reads were zero. The companion records timings and all identities.

## Operational disposition and next exact action

R1 new-chain threshold, continued historical progression, six-window API/UI and representative static capacity are demonstrated. R2 managed candidate startup/reuse/restart and J1 approved readonly alias are implemented and verified in isolation. The first immutable-page/pointer interruption now requires exact raw-reverified pending-batch reconstruction; arbitrary missing pointers and foreign locks remain blocked.

The measured full-prefix policy still requires a stable source interval. Six successive appends caused six verification restarts and withheld publication. This is a concrete sustained-ingress limitation: retain pending/stale truth, retain original verification, and do not certify full-day LIVE capacity. An alternative source snapshot/authority policy would need an explicit integrity decision; none is introduced here. Real positive adjacent-session Handoff, formal deployment, natural market progression and CRU-52 five-day acceptance remain unverified.

Normal startup reads the persistent runtime binding and starts/reuses the managed writer only for STREAM_PAGED_V2. Approved main, exact HEAD, clean tracked code, physical source identity and reader/output alignment are required before formal activation. No configuration was installed into the formal runtime in this task. Candidate fixture configuration lived only under ignored data; its production activation flag was false. No collector or schedule was restarted.

Next: submit the containing exact commit and source review record to GPT in PR71. No Merge or formal deployment. Validation is tied to the code blob hashes in the companion; CI and exact commit review results are reported in GitHub/Linear after push. Earlier accepted U1 and PR70/CRU52 evidence is carried forward, not rerun or overwritten.
