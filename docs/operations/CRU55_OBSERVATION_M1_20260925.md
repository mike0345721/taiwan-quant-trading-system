# CRU-55 Observation V1 — M1 checkpoint, 2026-09-25

Implemented against the Owner's Linear Execution Start Packet (comment ec87d7b5-3be9-4d2d-bf48-2b87423c948d). Baseline: 6fc1fa4524b2049b3d4af8ac650bb05acc849d44; approved remote main: 1ad9ec7c1814e401f8352048638f0a398bcf74fe. Single lane: PR73 / codex/cru55-cvd-performance-v1. Exact delivery SHA is in the accompanying PR checkpoint (this document is part of that commit).

## Implementation

The existing Dashboard overview now has an always-expanded CVD Observation V1 card. It reuses accepted session cumulative CVD, selected-window delta, deterministic relationship and identity from the same verified response. An unproven session origin remains **observed accumulation**, never a full-session claim. Existing six window selectors drive this card as well as Fast Scan and Explain.

Visible fields: cumulative CVD; selected 1m/5m/15m/30m/1h/4h delta and partial/unavailable state; Price/CVD relationship; session/tradeDate/actualContract; accumulation origin/scope; physical cutoff ordinal and publication availableAt; last accepted trade source time and trade availableAt; observation age; classified coverage; CVD/window quality; continuity epoch and capture completeness. Classified coverage is not capture completeness.

Presentation age is max(now - last trade source time, now - last trade availableAt), **not** measured append-to-API or producer processing latency. Quote/publication tails do not reset this age. Missing, future or inverted trade clocks become UNAVAILABLE. <=10s is LIVE only for an already LIVE, governed, non-pinned, quality-READY source; this candidate's pinned source is HISTORICAL, never promoted. >10s through 30s is DEGRADED; >30s through 60s DELAYED; >60s STALE. Existing upstream stale/unavailable states cannot be promoted. Missing values remain unavailable; zero is preserved. A five-second visible-page timer ages the same payload even during pending requests, and visibility restoration immediately reassesses it. Read/selection failures clear the card.

No accumulator, relationship formula, API producer/reader contract, raw verification policy or persisted artifact semantics changed. The added model is a browser presentation contract. The original API freshness remains unchanged; the UI adds the stricter age classification. Original workspace HTML is byte-equivalent apart from its pre-existing formal mount additions. K-line/Volume/Market Pulse/Observed Flow/Data Quality code is unchanged.

## Verification actually completed

- 24 focused tests across cru55-observation, cru55-formal-entry, cru55-background-refresh and cru55-preview: PASS. The newly added background clock test was run with all seven background-refresh tests after the visibility change.
- 16 proportional regressions across dashboard-production-closure, dashboard-tx-chart-ui, cru55-context-cards and cru55-dynamic: PASS.
- node --check on changed runtime JS/MJS: PASS. Repository secret scan and git diff --check: PASS (final pre-push checks recorded with PR checkpoint).
- Chrome smoke used the real candidate formal-entry HTML/JS/CSS and local chart library, with explicitly SYNTHETIC fixture API data. Four panes, 19 fixture price bars, CVD +19 and 1m delta +6 rendered. Selecting 4h showed +19 / PARTIAL. Simulated NIGHT 503 cleared values to UNAVAILABLE; returning to DAY recovered STALE. Captured console errors: 0. Temporary server/tab cleaned up.
- Requested viewport override was 1366x768; measured CSS viewport was **1242x698** (browser zoom not verified). Horizontal overflow false. This is a render smoke, **not** three-size or production browser acceptance. Screenshot: [synthetic render](../evidence/cru55-m1/synthetic-smoke.png).
- Existing authenticated route tests still reject unauthenticated reads and writes, preserve fail-closed source errors and original workspace markup. Smoke server did not exercise actual login or production data.

Reproduce focused checks with node --test tests/cru55-observation.test.mjs tests/cru55-formal-entry.test.mjs tests/cru55-background-refresh.test.mjs tests/cru55-preview.test.mjs; regressions with node --test tests/dashboard-production-closure.test.mjs tests/dashboard-tx-chart-ui.test.mjs tests/cru55-context-cards.test.mjs tests/cru55-dynamic.test.mjs.

## Remaining and stop boundary

STOP after exact HEAD push and PR checkpoint; await GPT review. No ENGINEERING APPROVE or full L0→L5/Owner acceptance claim. Subsequent authorized work must establish the full ladder, real managed/authenticated candidate behavior, lawful source parity and browser acceptance at 1920/1536/1366. No new 30-minute performance campaign was run. Historical Plan A performance FAIL (API p95 114.250s, p99 126.632s) and natural full-day NOT_ESTABLISHED remain unchanged; Live V2 remains future work. No Plan A.2/Plan B, SSD, Ask GPT backend or Market State expansion.

PR73 remains Draft/unmerged. No formal8787 deployment, collector/raw/SQLite/scheduler/five-day state, PR72, execution or order-route change. Safety: formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false.

Governance: Owner's explicit M1 stop overrides the generic skill's full review/merge lifecycle. Implementation self-check completed; GPT/independent engineering review is pending at the requested checkpoint. Task class T1 presentation engineering with data-truth boundary checks; implementation model identity/reasoning setting not independently exposed by this session, no model override or subagent used.
