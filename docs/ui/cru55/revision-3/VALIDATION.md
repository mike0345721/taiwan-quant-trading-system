# CRU-55 revision3｜Validation

Exact sourceHEAD `3f8b2edf33f3829f18581b2421f0d0cd46b63aaa`; previous source `5ae0e6f885265b6e9f9cffbad9552bdbd3f4d33e`.

## Scope

Same five presentation/test files: public/cru55-presentation.mjs, public/cru55-preview.html, public/cru55-preview.css, public/cru55-preview.js, tests/cru55-preview.test.mjs. Whole Draft PR69 remains10 additive CRU55 files, stacked on acceptedCRU54 `66de7e9a416e9f2386eed1c9e8688afea1b804ab`. No server/importer/producer/frozen-semantic changes. Main/runtime baseline `d3702315b46a1a6c23384338ae40904b8bc589c2`, CRU52/CRU9/Scheduler/formalraw/SQLite/evidence untouched.

## Current-head evidence

- 10/10 targeted tests PASS; syntax and diff checks PASS. Command: `node --test --test-reporter=tap tests/cru55-preview.test.mjs`.
- RealDAY and SYNTHETIC at1920×1080/1536×864/1366×768 PASS.
- Normal blocking console0, horizontal overflow0, coretextclipping0, visible text<11px0, duplicateIDs0.
- Chart stack and six relationship rows fit all3 viewports; numericstrip removed; Path is the5th metric with exact raw value.
- FastScan / forcewindow / relationship table share accepted state/code/tone; partial windows neutral.
- Percentage is priceDelta / accepted firstPrice ×100, only with valid first/last/delta and positive denominator. NoPriceResponse fallback. DAY+0.15%, synthetic+0.24%, NIGHT unavailable.
- Relationship explanations map existing enums; summary uses existing cumulativeCVD/scope/freshness only. No new signal, rating, score or full-session claim.
- Actual dropdown test: two unavailable months andMTX/TMF clear prices, CVD, endpoints, contextsummary, trust and windows. ReturnTX2026-09 restores the accepted view. Productname matchesselection.
- Independent actual load-function VM race probe: an olderTX response cannot overwrite newerMTX unavailability; unavailable selection makes0APIrequests.
- Lower modules remain in DOM and previously verified accessible. Unavailable selection suppresses their historical market values.
- Missing-month and realNIGHT truth captured in browser-audit.json.
- Existing CVD/null/reset/signedbar/servermemory/isolation checks included in10tests. Previous broader64-test suite is retained at its originalHEAD, not claimed as rerun here.

## Independent review

Reviewer `/root/review_presentation`: **APPROVE final exactHEAD**, B0/S0.

| Check | Result |
|---|---|
| Selected product matches identity | PASS afterB1 |
| Stale chart-empty reason clears | PASS afterS1 |
| Race / unsupported selection gating | PASS |
| Observed% and missingness | PASS |
| Deterministic summary / annotation / exactPath | PASS |
| UniqueIDs / typography / responsive | PASS |
| Server/producer/isolation boundary | PASS |

B1 at1be9d5d: top eyebrow remainedTX whenMTX/TMF selected. Fixed with selectedProductname at load entry. S1: prior emptychart reason survived failure; fixed by clearing/hiding it in fail(). Re-review3f8b2edf confirmed bothresolved. Engineering approval is notOwner acceptance.

## Limits

Same shortSTALE DAY/NIGHT realfragments, captureUNPROVEN, no fullsession/VWAP/OI/adjacentHandoff. UI choice list is a preview selection surface, not an exchange contract catalog or source availability claim. Only TX2026-09 has accepted data; no raw data added. Owner requested to see effect and has notaccepted theproduct. Original and revision2 evidence remain immutable; this is a newrevision3 directory on evidence-onlybranch.

`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`
