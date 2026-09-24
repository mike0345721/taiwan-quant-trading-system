# CRU-55 Plan A implementation checkpoint — 2026-09-24

Status: CURRENT / acceptance pending. Same Draft PR73 and original worktree; no merge or formal rollout. Owner authorization: https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5792634365 . Starting HEAD `08f3d24eb68773003f896a4183335376a95fd8e4`; remote approved main `1ad9ec7c1814e401f8352048638f0a398bcf74fe`. The previous delivery B/FAIL and private evidence remain historical evidence, not a current wait-for-merge gate.

## Implemented state and exactness

The existing full-scan reducer remains available through `projectionMode: FULL_SCAN`. The default indexed reducer stores immutable ordinal forest pages and a sealed derived checkpoint bound to the source, resolver, archive terminal/page, cutoff and completed projection. New compatible cutoffs normalize/reduce only appended archive pages. One resumable traversal answers all six current/prior windows, context and 200 display bins in physical order; final Relationship/Session/Handoff processing retains actual prior/publication dependencies.

Window membership uses exact event/availability/ordinal bounds. Leaf contributions retain physical predecessor semantics while path bridges use selected predecessors. OHLC uses existing exchange/availability/event-ID ordering; minute price/volume sums append in their original order. Existing final VWAP fold remains unchanged. Display bins are recomputed from the current ordinal span, not cached from the preceding cutoff.

Safe integer bounds permit exact aggregate folds. Fractional or unsafe sums descend to ordered leaves; there is no new tolerance. Consequently this is **not** an unconditional O(delta) claim: historical query leaf applications may be O(history), and full current/prior raw validation remains O(prefix). `processedRecords/newRecords/historicalReplayRecords` describe archive reduction. `historicalOrderedLeaves` counts query–leaf applications (not distinct records); `unsafeHistoricalLeaves` counts locally unsafe historical leaves only. A fractional accumulated prefix can also force traversal of otherwise safe leaves. `rangeNodes`, `aggregateNodes`, `orderedLeaves`, `rangeQueries` and `rawVerificationBytes` disclose other work.

Initial construction, incompatible source/resolver/schema, identity/continuity changes, clock regression or newly eligible historical availability have explicit rebuild reasons. Corrupt stored data fails closed. Index reads, including durable collision verification after interruption, share the original cycle byte/page budget. A page's projection, roots and counters are committed together only after index durability succeeds. Derived index persistence is explicitly not a raw-prefix proof; publication still follows original full current/prior verification and atomic checks.

## Verified before long measurement

- Five different cutoffs 300/319/356/357/488: full immutable artifacts (all products, hashes and publication history) exactly equal FULL_SCAN. New records processed 300/19/37/1/131; historical archive replay 0; all 213 queries complete; entire current raw byte count verified each time. Includes a quote-only cutoff.
- New range tests: 4 PASS, including integral/fractional/late exact folds, simultaneous mixed-window/display query interruptions with serialized cursor, and content tampering.
- Existing projection tests: 9 PASS with added indexed-versus-full projection/hash comparison, including physical predecessor, quote/unrelated tails, boundaries, continuity, invalid price clocks, long NIGHT, late OHLC/VWAP and prior/publication dependencies.
- Existing pipeline tests: 10/11 initially passed; the read-count assertion omitted new index pages. After adding index reads to the measured denominator, that focused budget test passed. All other tests retain their original requirements. Earlier sandbox-path failures and interrupted slow initial query implementation are not acceptance passes.
- Added durable-index-before-job interruption test: PASS; resumed product exact with full scan, including collision reads within page/byte accounting.
- Secret scan: PASS. Independent initial review found index collision reads missing budget accounting; fixed and source-reviewed. Exact-HEAD reviews remain required.

## Remaining work / next exact action

Commit the tested candidate, then run normal managed launcher and real login on the frozen private 62,000-record source. Record cold latency, 30-minute 27/s growth plus 54/s burst, original same-page samples, interruption recovery and lawful representative load. Do not change tracked runtime/HEAD during a measurement. Compare to the prior runtime with host/cache differences disclosed. Preserve all failures, 503s and unpublished samples. The observer adds bounded non-atomic diagnostic snapshots separately from existing latency samples; apply the same observer to paired runs.

The original gates remain: cold DAY latest API <=180s; append/API p95<=5s and p99<=10s; same-page visible p95<=10s; no unexplained >30s gap; burst recovery <=120s. Browser target loss and API503 are separate investigations; a replacement tab cannot repair the original same-page result. Exact independent review, commit/push, CI and GitHub/Linear/Owner readback remain incomplete at this checkpoint.

Formal8787, collector/raw/SQLite/scheduler, PR72, immutable evidence and unrelated changes remain untouched. `formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`.
