# Revision 4 Validation

Source HEAD: `c20068a7f05959fc8837f40880c3dd3e62811b5f`.
Compared with Revision3 `3f8b2edf33f3829f18581b2421f0d0cd46b63aaa`, changed only public/cru55-preview.html, public/cru55-preview.css, public/cru55-preview.js. Whole PR69 remains 10 additive isolated files on accepted CRU54 base66de7e9a416e9f2386eed1c9e8688afea1b804ab.

## Current evidence

- 10/10 targeted tests PASS, tests.tap on final HEAD. Includes signed delta, null/segment reset, fixed source cutoff, authenticated in-memory API, partial/warming/unavailable, observed percent semantics.
- 1920x1080,1536x864,1366x768: realDAY and explicit synthetic, six recorded audits/screenshots. Horizontal overflow0; visible core text clipping0; visible text under11px0; duplicateIDs0; scan/table state/code/tone consistencyPASS. Visually hidden accessibility labels excluded from visible clipping.
- Core stack including all four chart panes and six relationship rows within each viewport. Canvas pane ratios preserve K dominance. At1366 demo K202px / Volume31 / CVD80 / delta36, timeaxis28; at1920 K382/CVD152. Timeline/lower modules use normal vertical scrolling where needed.
- Actual 18 six-window clicks: DAY endpoint295, NIGHT5, demo2026 invariant at same cutoff. All scan/table consistent.
- Markers0 default; explicit disclosure+checkbox8; collapse0. Timeline evidence preserved.
- Path0.15 visible; raw0.1529051987767584 present in context drawer. No data rewrite/score.
- Unsupported TX10month and MTX clear price/contract/session/CVD/Path tooltip/markers/trust; switching back restores data. NIGHT price/observed% unavailable.
- Handoff drilldown reads accepted pairing and reason; actual observed sessions are not governed adjacent, no cross-gap arithmetic.
- Five lower modules each opened through actual UI. Historical real context remains independently dated; never mixed into synthetic/unavailable.
- Normal blocking console errors0, warnings0 after final reauthentication. Expected401 during isolated server restart is outside normal validation interval.

## Independent review

Review agent review_presentation: APPROVE final exact HEAD, B0/S0. Fixed B1 stale invalid text call / Kprice overwrite and B2 rawPath tooltip persistence. Handoff failure reason visibility also repaired. Reviewer checked directDOM IDs and failure probe; final CSS-only viewport repair separately re-reviewed. Engineering approval only, not Owner visual acceptance.

## Owner authority / sync

Linear Owner Decision ccf06d11-16b6-43c3-b9d6-e2b6be23eeac (11:06UTC) and f02fab6b-1387-4599-b0e8-c3b406219963 (11:09UTC),2026-09-15. Notion Final Dashboard UI Blueprint 3dc99762-8d46-81a7-8654-c7335e52fb8a already contains both approved decisions at11:09:26UTC; read back, no duplicate update.

## Limits and exclusions

RealDAY ~43s/oneKbar; NIGHT~22s/noKbar. STALE, captureUNPROVEN, observed accumulation, long-windowPARTIAL remain truthful. Volume55 chart subset vs observed773 retains accepted scopes. No invented VWAP/OI/fullsession/adjacenthandoff. Other products/months are preview choices without data; no new producer/catalog.

No frozen semantics/producer/server/importer change. Approvedmain/runtime d3702315b46a1a6c23384338ae40904b8bc589c2 remains untouched; CRU52 independent. Primary worktree preexisting modified v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md left untouched. Prior64-test projection run and prior evidence remain historical, not relabelled current. Earlier evidence revision1/2/3 immutable.

Unresolved Owner UI questions: consolidated controls comfortable? combinedlamp/bar meaning clear? first-screen Path precision sufficient? hidden markers discoverable? 1366 density and K/CVD balance acceptable? compact Handoff adequate?

PREMERGE_UI_V1_ISOLATED_PREVIEW_READY_FOR_OWNER_REVIEW
formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false
