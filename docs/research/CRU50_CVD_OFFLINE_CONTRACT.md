# CRU-50 isolated offline CVD contract V1

Authority: [CRU-50](https://linear.app/cruise41319/issue/CRU-50) and [CVD Phase 0 / M1–M8 draft](https://app.notion.com/p/3d9997628d468103808cec1d789dddb1).
Base `8756efabe3a54e49154ed2fe6a705a354607c69b`; branch `codex/cru-50-cvd-offline-core-v1`.
This is an offline engineering candidate, not promoted data or a live capability.

## Sources and meaning

Dataset references: `tx_actual_trade`, `tx_best_quote` and the existing
`derived_pressure_response_efficiency` dependency family in `config/data-requirements-v1.json`.
No new registry, collector, provider mapping or TradingDay definition.
`materializeTxCanonicalObservations` and `buildExecutedPressureWindow` are imported unchanged.
Each new tick is passed to Pressure with physically prior quotes: existing volume/price precedence,
finite-positive validation, provider mapping and quote conflict semantics remain authoritative.
No shared module or additive export is necessary. Quote classification never replaces provider direction.

CVD = cumulative valid BUY_PROXY contracts minus SELL_PROXY contracts. UNKNOWN accumulates separately.
No valid/classified volume means `value=null`. Partial classified evidence retains its value with
QUALITY_INSUFFICIENT, without a direction/signal/neutral claim. Invalid price/volume/identity/lineage
poisons the segment value until the next identity/continuity segment. Valid counters and invalidTickCount
remain auditable; they must not be mistaken for complete segment volume. Classification coverage is not
capture completeness. Overflow refuses the calculation instead of serializing Infinity as null.

## Physical order and continuation

Read an unfiltered byte-zero / ordinal-one / GENESIS prefix. Every record's previousHash and body SHA256
are verified. Non-TX, duplicate, simtrade and continuity records all reach canonical processing;
never filter then renumber. Do not sort eventTime/receivedAt or deduplicate timestamps.
Distinct ordinals remain distinct observations. Canonical duplicate/simtrade exclusion occurs only
after physical lineage handling. Later data cannot rewrite earlier output points.

Segments use actualContract, tradeDate, session, continuityEpoch. Every segment states OBSERVED_FRAGMENT
and sessionStartProven=false: ledger beginning is not proof of exchange/session completeness.
No idle or Path30s reset. Consumers must not join lines between segments. Late ticks append in physical
order. Retain prior quotes within the bounded prefix because a late tick may require an older eligible quote.

Private checkpoint contains ordinal, terminalHash, complete canonical terminalState, quotes, segments,
series, schema/source/resolver identities and checksum. It is incompatible with formal/CRU-49 checkpoints.
The checksum detects accidental corruption, not deliberate tampering with recomputed checksums.
Source/prefix/offset/schema/resolver mismatches reject continuation rather than silently resetting.
Empty append is unchanged. Resume rereads/verifies a bounded prefix but calculates only its suffix;
this is not an efficient all-day live implementation. Future incompatible changes require a new version.

## Time, prefix and publication

Pin N complete newline-terminated physical records, byte length/hash, file identity and cutoff record hash.
Ignore later appended bytes; re-read pinned bytes before publication. Truncation, replacement or edits
reject publication. These are two observations of the prefix, not an adversarial filesystem snapshot guarantee.
An incomplete last line is never accepted.

Physical cutoff and last tick availableAt differ: a quote/status-only tail advances the former, not the latter.
Point availableAt remains durable receivedAt. generatedAt is metadata excluded from semanticHash.
Artifacts always say HISTORICAL_OFFLINE. Source envelope preserves byte-prefix hash/length and cutoff;
semanticHash includes logical source identity and cutoff hash. Whitespace edits can retain the logical
semantic hash but still reject byte-prefix resume and immutable reuse.

Unique temp → fsync → no-clobber hard link publishes artifacts. Equivalent concurrent writers reuse
the existing file. Incompatible content fails; the old valid artifact is never removed. Cleanup and
error-sink faults cannot replace the primary error. No retries, service or polling worker.
Private-root checks reject ordinary wrong paths and symlink/junction ancestors; they do not promise
protection against hostile concurrent path replacement. Raw records in private quotes remain local.

## Limits and commands

One explicit file/run; at most 16 MiB read buffer, 10,000 physical records, 30s cooperative calculation
deadline and 64 MiB serialized artifact. Prefix verification may read pinned bytes again; 16 MiB is not
a total I/O claim. Quote matching may be quadratic within this bound. `--max-old-space-size=512` limits
V8 old-space, not process RSS. A deadline cannot interrupt an already-blocked OS call.
The history verifier runs two separately bounded calculations on the same in-memory prefix.

Private outputs are only this worktree's ignored `data/cru50-private/`.

```powershell
node --max-old-space-size=512 scripts/cvd-offline.mjs <source.ndjson> <cutoff>
node --max-old-space-size=512 scripts/cvd-offline.mjs <same-source.ndjson> <later-cutoff> <private-artifact.json>
node --max-old-space-size=512 scripts/cvd-validate-history.mjs <source.ndjson> <cutoff> NIGHT
```

Normal CLI uses explicit source identity fields. History verifier additionally reuses the approved
calendar loader and chart session classifier, fingerprinting source modules and calendar. It does not
guess identity. History artifacts cannot resume with the explicit-only CLI; use the same fingerprinted
resolver through the exported runner API. New tests enter existing default CI; no exclusions or skips.

## Compatibility / rollback

Rollback here means stop invoking the offline entry and retain private evidence. No production installation
or data migration occurred; no formal process needs restart or data rollback. Approved code does not
consume this schema. Do not feed CVD checkpoints to old live runners, delete ledger files, copy individual
JS files to production or refresh restored timestamps into LIVE. Git revert is not data recovery.

Stop at GPT independent receipt. Merge, deployment, UI/live wiring, RVOL and basis require other gates.
formalWeight=0; researchOnly=true; executionAuthorized=false; orderRoutesEnabled=false.
