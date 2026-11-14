# CRU-30 Visible Information Coverage Audit

Date: 2026-08-28
Scope: Trader Terminal production DOM (`#decision-workspace`) on PR #40. This is an implementation inventory, not market evidence and not a promotion decision.

## Method and invariants

The inventory was traced through the mounted DOM (`public/trader-terminal-shell.js`), its production renderer (`public/app.js`), and the authenticated existing API paths `/api/v1/dashboard` and `/api/v1/tx-chart`. The dashboard endpoint already returns the existing snapshot, decision-workspace contract, and governed TX-chart payload.

All values retain their supplied availability, trade date / actual contract / session, and `availableAt` semantics. No absent field may be represented as `0`, Neutral, current, live, or promoted. The classifications below use the CRU-30 allow-list only.

## Inventory

| Visible area and DOM / UI identity | Expected existing source and governed identity | Current display | Classification | Phase 2 disposition |
| --- | --- | --- | --- | --- |
| Top Bar — `#tt-top-contract`, `#tt-top-price`, `#tt-top-volume`, `#tt-top-session`, `#tt-top-updated`, `#tt-top-trust` | `tx-chart.actualContract`, `lastPrice`, last bar volume, `tradeDate`, `session`, `availableAt`, `qualityStatus` | Values or explicit unavailable state | `NOT_APPLICABLE` | Retain; already wired. |
| Top Bar — `#tt-top-change` | `tx-chart.lastPrice` + compatible `levels.previousClose` | Hard-coded `UNAVAILABLE` | `DATA_EXISTS_NOT_WIRED` | Render a signed change only when the previous close is `AVAILABLE`; otherwise name its reason. |
| Top Bar — `#tt-top-oi`, `#tt-top-basis` | `snapshot.futuresMarket.data.txDay.openInterest` / `snapshot.derived.market.basis`, returned by `/api/v1/dashboard`; snapshot trade date and source freshness apply | Hard-coded `UNAVAILABLE` | `DATA_EXISTS_NOT_WIRED` | Wire values with the snapshot's own status; no live implication. |
| Market Summary — `#tt-summary-price`, `#tt-summary-vwap`, `#tt-summary-breadth`, `#tt-summary-flow`, `#tt-summary-risk` | `currentMarketFactSummary`, chart VWAP, DW4 family availability, `decisionSummary.risk` | Existing source-backed status / fact | `NOT_APPLICABLE` | Retain. |
| Market Summary — `#tt-summary-strength` | No approved trend-strength contract | `RESEARCH_PENDING` | `RESEARCH_NOT_PROMOTED` | Retain explicit status. |
| Market Pulse — price / VWAP / high-low / volume / change (`#dw-pulse-*`) | Governed TX-chart payload; price uses `actualContract`, session, chart `availableAt` | Existing value or explicit unavailable reason | `NOT_APPLICABLE` | Retain. |
| Market Pulse — RVOL / basis (`#tt-pulse-rvol`, `#tt-pulse-basis`) | RVOL derivation is absent; basis exists at `snapshot.derived.market.basis` | Both hard-coded `UNAVAILABLE` | `RUNTIME_OR_RENDER_BUG` (RVOL) / `DATA_EXISTS_NOT_WIRED` (basis) | Keep RVOL with derivation-not-implemented reason; wire basis. |
| Trend Strength — main, direction, strength, change and price/VWAP/path tracks (`#tt-trend-*`) | No promoted trend model; chart facts must not be silently converted into a score | Mix of dashes and fixed placeholders | `RESEARCH_NOT_PROMOTED` | Replace ambiguous dashes with explicit `RESEARCH_PENDING` / not-promoted explanation. |
| Trend Strength — breadth and futures tracks | Existing DW4 family availability only | Availability state | `NOT_APPLICABLE` | Retain as state, not direction. |
| Futures Flow card main and descriptive rows (`#tt-futures-main`, `#tt-futures-values`) | DW4 `FUTURES_INSTITUTIONAL`; EOD source and its data-health `availableAt` / freshness | Existing descriptive values or status | `NOT_APPLICABLE` | Retain. |
| Futures Flow detail — `#tt-futures-tx`, `#tt-futures-vwap`, `#tt-futures-basis`, `#tt-futures-foreign`, `#tt-futures-dealer`, `#tt-futures-trust-position`, `#tt-futures-oi`, `#tt-futures-oi-change` | Existing TX chart; snapshot derived basis, institutional EOD positions, current OI and its comparable-history delta | Only TX is wired; remaining items are blank / hard-coded unavailable | `DATA_EXISTS_NOT_WIRED` | Wire values independently and expose unavailable/comparison reasons where source does not qualify. |
| Options Context card main and descriptive rows (`#tt-options-main`, `#tt-options-values`) | DW4 `OPTIONS_CONTEXT`, EOD options source / raw-chain status | Existing descriptive values or status | `NOT_APPLICABLE` | Retain. |
| Options detail — `#tt-options-call`, `#tt-options-put`, `#tt-options-max-pain`, `#tt-options-oi`, `#tt-options-ring-value` | Existing EOD call/put walls, Max Pain, OI P/C ratio; contract and fetch time from snapshot | Unbound placeholders | `DATA_EXISTS_NOT_WIRED` | Wire descriptive EOD values; raw live chain remains `RAW_ONLY` and not promoted. |
| Breadth card main and descriptive rows (`#tt-breadth-main`, `#tt-breadth-values`) | DW4 `PARTICIPATION_BREADTH`; live raw or EOD-context state with source trade date | Existing descriptive values or status | `NOT_APPLICABLE` | Retain. |
| Breadth detail — `#tt-breadth-up`, `#tt-breadth-flat`, `#tt-breadth-down`, `#tt-breadth-ratio`, `#tt-breadth-strength`, participation bar / series | Existing direct listed/OTC counts when legally available; no approved intraday strength or time series | Unbound placeholders | `DATA_EXISTS_NOT_WIRED` (counts / ratio) and `RESEARCH_NOT_PROMOTED` (strength / series) | Wire counts and calculate only the descriptive up/down ratio; show explicit not-promoted reasons for strength / series. |
| Spot / Index Contribution — existing `#dw-leadership-positive`, `#dw-leadership-negative` | Existing IX0001 leadership API; source trade date, descriptive-only and not-promoted labels | Renderer-owned rows | `NOT_APPLICABLE` | Retain. |
| Contribution fallback `#tt-contribution-*`, `#tt-contribution-net` | Only created if normal leadership DOM is absent | Placeholder fallback | `NOT_APPLICABLE` | Keep out of normal path; do not manufacture net contribution. |
| Global Context — main / tiles `#tt-global-main`, `#tt-global-name-*`, `#tt-global-price-*`, `#tt-global-change-*` | DW4 `GLOBAL_FX`: EOD, delayed, research context and proxy labels | Existing latest descriptive values; sparklines marked unavailable | `NOT_APPLICABLE` | Retain latest-only semantics and no synthetic series. |
| Data Health — `#tt-health-main`, `#tt-health-trust` | `globalStatus.dataHealth` | Existing value | `NOT_APPLICABLE` | Retain. |
| Data Health detail — `#tt-health-ring-value`, `#tt-health-market`, `#tt-health-institutional`, `#tt-health-futures`, `#tt-health-options`, `#tt-health-global` | Existing data-health contract item freshness / quality and reasons | Unbound placeholders | `RUNTIME_OR_RENDER_BUG` | Wire explicit health state / reason summary; do not collapse missing to healthy. |
| Risk / Conflict — added `#tt-risk-ring-value`, `#tt-risk-ring-state`, `#tt-risk-volatility`, `#tt-risk-liquidity`, `#tt-risk-event`, `#tt-risk-breadth`, risk series | Existing decision risk / conflict status for state only; no approved risk trend series | Unbound placeholders | `RUNTIME_OR_RENDER_BUG` / `RESEARCH_NOT_PROMOTED` (series) | Wire only existing statuses and show no-series / not-promoted reason. |
| Ask GPT — `#tt-gpt-disabled-state`, disabled prompts / input | Product policy: direct GPT API is disabled; discussion copy is separate | `UI SHELL · DISABLED` | `DEFAULT_OFF` | Retain explicit disabled state. |

## Bounded repair set

The eligible fixes are presentation-only render paths using fields already returned by the existing dashboard / chart endpoints. They must add a reusable status formatter so unavailable values carry a concrete reason, and add focused renderer coverage. No endpoint, collector, Market State, research promotion, strategy, risk algorithm, broker, order, position, or execution behavior is in scope.

## Typography findings for Phase 3

Formal information is currently rendered at 7–10px in multiple Terminal rules, including top-bar metadata, chart metadata / legend, card details, pulse metadata, tracks, series labels, ring captions, and health / risk details. These are not decorative-only in normal use and therefore violate the CRU-30 11px minimum. Phase 3 must lift them to the typography contract and verify desktop plus narrow-desktop layout without clipping or horizontal overflow.
