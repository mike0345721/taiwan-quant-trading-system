# CRU-55 revision 2｜Validation

Source HEAD: `5ae0e6f885265b6e9f9cffbad9552bdbd3f4d33e`  
Previous preview: `0d5996707fbad7266753c41fba3ad832ee3919ca`  
Independent review: `/root/review_presentation`, APPROVE final exact HEAD; B=0/S=0. Engineering review only.

## Changed scope

Only five files changed in this revision:

- public/cru55-presentation.mjs
- public/cru55-preview.html
- public/cru55-preview.css
- public/cru55-preview.js
- tests/cru55-preview.test.mjs

The entire PR remains 10 additive CRU-55 files against accepted CRU-54. No change to producer/frozen semantics, server/importer, formal main/runtime, CRU-52/CRU-9/Scheduler, raw/SQLite/formal evidence roots. Approved main remains `d3702315b46a1a6c23384338ae40904b8bc589c2`. PR #68 is not merged into main; PR #69 retains its stacked CRU-54 base `66de7e9a416e9f2386eed1c9e8688afea1b804ab`.

## Results

- Final exact HEAD: **8/8 targeted tests PASS**, `node --test --test-reporter=tap tests/cru55-preview.test.mjs`.
- Syntax and diff checks PASS.
- Browser: 1920×1080, 1536×864, 1366×768, real DAY and explicit synthetic **PASS**; NIGHT at 1920 verifies missing latest price/Price Δ.
- Normal-operation blocking console errors=0, horizontal overflow=0, core text clipping=0, text below 11px=0, duplicate IDs=0.
- Core chart stack, six Fast Scan lights, force strips, Session and all six relationship rows fit all three specified viewports.
- 3 sources × 6 force-strip clicks: selected detail synchronized; CVD endpoints remain 295 / 5 / 2026.
- Fast Scan ↔ force strip ↔ relationship row state/code/tone consistency PASS.
- PARTIAL/WARMING/UNAVAILABLE strips and arrows suppress direction. Warming/unavailable mappings covered by unit fixtures, real data covers partial; unavailable also exercised with controlled server-stop.
- Original nine-cell pressure thresholds: abs ratio <.10=0, <.325=1, <.55=2, <.775=3, otherwise4 (valid range [-1,1]). UI geometry only, no score/classifier added.
- Price/flow palette separation tested in browser. Latest price/Price Δ use accepted Session Context endpoints; missing values are not replaced with Price Response.
- Path uses exact raw String(value); micro-bar uses the same fraction, no new descriptor or intelligence scale.
- Controlled failure: both newly added latest-price fields clear to price-neutral; endpoint null; force strips UNAVAILABLE/neutral; final Data Trust UNAVAILABLE. Server restarted successfully at same source HEAD, PID11996.
- Expected connection failure and 401 during deliberate restart are recorded as fault probes, excluded from normal console acceptance.
- All five lower product modules and selected-window drawer remain accessible.

The original 64-test frozen-contract suite and isolation review were completed at previous source HEAD. They are retained in [prior evidence](../VALIDATION.md), **not represented as rerun at this revision**. This revision leaves those producers/server paths unchanged and runs the affected UI/helper/server tests.

The first sandbox test run returned EPERM while resolving the existing Windows temp directory in the hardlink isolation test. Re-running under the normal Windows identity passed all8 without changing the test or isolation logic.

## Review cycle

| Check | Result |
|---|---|
| Original force display mapping / shared truth | PASS |
| Partial/warming/unavailable direction suppression | PASS |
| Exact Path and accepted price provenance | PASS |
| Palette separation | PASS |
| Fail-state neutral clearing | PASS after B1 fix |
| Responsive layout and typography | PASS in browser |

B1 at `b89985c`: failed refresh retained prior positive/negative price class. Fixed in final `5ae0e6f`; independently re-reviewed and tested with an actual isolated server-stop. No remaining blockers. Do not interpret APPROVE as Owner acceptance.

## Limits / Owner questions

Same real fragments, missing VWAP/full-session high-low/OI/adjacent Handoff, STALE/UNPROVEN, and independent dated lower background as previous evidence. Reference image supplies layout/colors only. Owner has asked to see the restored effect; visual acceptance remains pending. In particular, whether retaining both lamps and original strips is comfortable, and whether the right cards/table now match expectations.

All files here are new revision-2 evidence. Previous evidence manifest/screenshots are untouched. This evidence branch is not the runtime source.

`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`
