# CRU-31 Visible Surface Closeout Audit

Date: 2026-08-29

Base: `3ff0dc24188e74e29477ad400470955e824124de` (`main`, merged PR #40)

Scope: authenticated Trader Terminal / Dashboard production path at `#decision-workspace`. This is a UI inventory and closeout plan, not market evidence, research promotion, or execution authorization.

## Authority, method, and invariants

The audit follows Linear CRU-31 and the Product Owner temporary Product Lane override. It traces the mounted production shell (`public/trader-terminal-shell.js`), renderer (`public/app.js`), authenticated `/api/v1/dashboard`, `/api/v1/tx-chart`, and `/api/v1/index-leadership` paths, plus the existing Chrome-CDP production-DOM tests.

The CRU-30 final state was verified as Done and merged through PR #40. Its lawful data wiring, identity checks, freshness semantics, and 11px formal-text floor remain the baseline. Repository-scoped engineering guidance was explicitly read; catalog activation remains truthfully deferred:

- `SKILL_GUIDANCE_READ = PASS`
- `SKILL_ACTIVE_CATALOG = BLOCKED / DEFERRED`

All closeout work retains:

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`
- unknown is not zero; missing is not Neutral; delayed/EOD is not Live; stale is not Current
- no Trend, Breadth, Risk, Market State, Greeks, BUY/SELL, broker, order, position, or execution intelligence may be inferred for visual completeness

## Historical baseline inventory (mixed observations; not the final classification ledger)

The “current visible state” column describes the merged production renderer. `VALUE` means a value is shown only when its existing contract and identity/freshness checks qualify; otherwise the renderer must name the actual unavailable reason. Mixed shorthand in this historical table records alternative baseline outcomes and is not a taxonomy classification; the single-classification field ledger below is authoritative.

| Area / UI or DOM identity | Current visible value or state | Expected existing source and identity / freshness semantics | Historical observation (not taxonomy) | Proposed disposition | In CRU-31 implementation scope? |
| --- | --- | --- | --- | --- | --- |
| Top Bar market identity — `#tt-top-contract`, `#tt-top-price`, `#tt-top-change` | TX actual contract, last price, and signed change; previous-close absence is explicit | TX chart `actualContract`, `tradeDate`, `session`, `availableAt`, `levels.previousClose`; change requires a compatible available previous close | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain | No change |
| Top Bar context — `#tt-top-volume`, `#tt-top-oi`, `#tt-top-basis`, `#tt-top-session` | Chart volume; EOD OI/basis only when actual contract and trade dates qualify | TX chart plus `snapshot.futuresMarket`, `snapshot.marketOverview`, `snapshot.derived.market`; preserve contract, EOD, delayed/stale, and source context | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain fail-closed rendering | No change |
| Top Bar trust — `#tt-top-updated`, `#tt-top-trust`, descriptive-only / no-signal labels | Updated time, quality state, and safety labels | TX chart `availableAt` / `qualityStatus`; dashboard `globalStatus.dataHealth` fallback | `VALUE_OK` | Retain | No change |
| Market Summary — `#tt-summary-price`, `#tt-summary-vwap`, `#tt-summary-breadth`, `#tt-summary-flow`, `#tt-summary-risk` | Existing fact/value/availability/risk status | `currentMarketFactSummary`, chart VWAP, DW4 family availability, existing `decisionSummary.risk` | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain Decision First summary | No change |
| Market Summary trend — `#tt-summary-strength` | `RESEARCH_PENDING` | No approved Trend Strength contract | `RESEARCH_PENDING_OK` | Retain explicit pending state | No change |
| Market Pulse core — `#dw-pulse-price`, `#dw-pulse-vwap`, high/low, volume, change, `#tt-pulse-basis` | Governed chart values/fact and qualified basis, otherwise explicit unavailable | TX chart plus same qualified basis contract as Top Bar; chart identity and `availableAt` apply | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain | No change |
| Market Pulse RVOL — `#tt-pulse-rvol` | `UNAVAILABLE · DERIVATION_NOT_IMPLEMENTED` | No implemented RVOL derivation in the production contract | `UNAVAILABLE_REASON_OK` | Retain; do not derive | No change |
| Market Pulse decorative bars — `.tt-pulse-trend` | Empty, source-free mini bars next to otherwise valid metrics | No production series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Hide from the formal homepage; keep no inferred series | Yes |
| K-line / price structure — `#dw-chart-canvas`, toolbar, crosshair, levels, palette, `#tt-chart-expand` | Production Lightweight Charts canvas with TX OHLCV/VWAP, identity-aware levels and controls | `/api/v1/tx-chart`; `actualContract`, `tradeDate`, `session`, per-level availability/reason, `availableAt` | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain K-line as primary visual | Verification only |
| Trend card — `[data-terminal-card="trend"]`, `#tt-trend-*` | A full Tier-1 card whose main answer, direction, strength, change, price/VWAP/path and pullback quality are all `RESEARCH_PENDING`; breadth/futures show availability only | No promoted trend model; DW4 family availability may be stated but is not direction or score | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` with `RESEARCH_PENDING_OK` contents | Move the whole capability to progressive disclosure; preserve every explicit pending/not-requested state and roadmap visibility | Yes |
| Futures Flow governed values — `#tt-futures-main`, TX/VWAP/basis/positions/OI/OI change | Existing descriptive values or concrete unavailable reasons | DW4 `FUTURES_INSTITUTIONAL`, TX chart, futures EOD sources; preserve actual-contract compatibility, trade date, source freshness, EOD/delayed/stale semantics | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain | No change |
| Futures decorative bars — `.tt-futures-bars` | Empty, source-free bars below governed futures values | No approved series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Hide from formal homepage | Yes |
| Options Context — `#tt-options-main`, call/put wall, Max Pain, OI P/C and ring | Qualified EOD descriptive values or explicit options-source reason | DW4 `OPTIONS_CONTEXT`, `snapshot.options`, `optionsEod`; preserve options contract, trade date, EOD/freshness and no dealer-direction implication | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain; no Greeks/GEX/DEX promotion | No change |
| Breadth counts / participation — `#tt-breadth-main`, up/flat/down, ratio, participation bar | Direct governed counts and descriptive ratio; partial input fails closed | DW4 `PARTICIPATION_BREADTH`, `snapshot.breadth`; preserve source/trade date/health and valid observed zero | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain | No change |
| Breadth intelligence placeholders — `#tt-breadth-strength`, `.tt-breadth-series-block` | `RESEARCH_PENDING` plus an empty series occupying the homepage | No approved Breadth Strength or intraday participation-series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` with `RESEARCH_PENDING_OK` contents | Keep pending capability in detail/drawer; remove empty visual from main reading layer | Yes |
| Spot / Index Contribution — `#dw-leadership-*` | IX0001 descriptive contribution rows when available; otherwise explicit wait/quality state | `/api/v1/index-leadership`; DAY source trade date, last `availableAt`, quality, descriptive-only boundary | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain | No change |
| Contribution fallback — `.tt-contribution-placeholder`, `#tt-contribution-*` | Only constructed if the normal leadership DOM is absent; otherwise not in production normal path | No lawful synthetic net-contribution substitute | `UNAVAILABLE_REASON_OK` | Keep fallback out of normal path; never manufacture contribution | No change |
| Global Context values — `#tt-global-main`, visible `#tt-global-name-*`, price/change tiles | Existing latest descriptive global/FX context; unused tiles are hidden | DW4 `GLOBAL_FX`; EOD/delayed/research/proxy source modes and source trade date remain visible | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain latest-only context | No change |
| Global mini-series — `#tt-global-series-*` | Empty SVG baselines are rendered for each available latest-only tile even though no series exists | No governed time-series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Hide empty series; keep “LATEST VALUE ONLY” truth label | Yes |
| Data Health summary — `#tt-health-main`, ring, market/institutional/futures/options/global summaries | Overall state plus worst grouped source freshness or explicit missing-source reason | `globalStatus.dataHealth`, `snapshot.dataHealth.items`; grouped expected sources fail closed, retain `availableAt` and concrete source identities in accessible title | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain and keep visually prominent | No change |
| Data Health detail / drawer — `#dw-data-health-panel`, health-card “更多” | Existing source/runtime details cloned into the drawer | Existing dashboard data-health/runtime contract | `VALUE_OK` | Retain; add interaction/focus regression coverage | Verification only |
| Risk existing status — `#tt-risk-ring-value`, `#tt-risk-ring-state` | Existing `decisionSummary.risk` status only, explicitly labelled as existing status | Existing decision summary; not a new score or risk algorithm | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain compact status | Yes, presentation only |
| Risk component placeholders — `#tt-risk-volatility`, `#tt-risk-liquidity`, `#tt-risk-event`, `#tt-risk-breadth`, risk series | Four `UNAVAILABLE · BREAKDOWN_NOT_IMPLEMENTED` cells and an empty `RESEARCH_PENDING` series dominate the card | No approved component-risk or risk-series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` with `UNAVAILABLE_REASON_OK` / `RESEARCH_PENDING_OK` contents | Keep honest detail in drawer; remove placeholder grid/empty series from main visual layer | Yes |
| Ask GPT fake input shell — `.tt-gpt-visual`, `#tt-gpt-disabled-state`, disabled prompt chips/input | Large `UI SHELL · DISABLED` mock interaction even though direct GPT API is intentionally off | Product policy: no direct GPT API; only manual snapshot/question copy is lawful | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Replace homepage fake input with compact truthful copy-mode status | Yes |
| Copy question / snapshot — `#dw-ask-gpt`, `#dw-copy-gpt-prompt`, journal copy controls | Existing manual copy flow; no API call and no market-state mutation | `decisionWorkspace.chatGptCopy`; availability depends on loaded immutable snapshot/context | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Keep the real copy flow reachable and label `READY` only when copy context exists | Yes, presentation/state label only |
| Card drawers — `.tt-more`, `.tt-drawer`, scrim/close/Escape/Tab behavior | Implemented with sanitized clone, close controls, focus return and focus loop; not exercised by current Production DOM regression | Existing mounted DOM only | `VALUE_OK` with acceptance-coverage gap | Add open/close/Escape/focus-return/focus-loop Production DOM assertions | Yes |
| Progressive disclosure — `.tt-progressive` | Evidence details, market changes, data health and manual journal are grouped below the main hierarchy | Existing dashboard panels and contracts | `VALUE_OK` with acceptance-coverage gap | Retain; add open/close and contained-surface assertions | Yes |
| Secondary/detail surfaces — DW4 family details, change strip, health, journal | Values or named empty/unavailable states; no need to occupy the first visual layer | Existing dashboard contracts; each retains source/quality/promotion/snapshot semantics | `VALUE_OK` / `UNAVAILABLE_REASON_OK` | Retain inside progressive disclosure | Verification only |
| Initial loading shell — initial `—` in Top Bar, Trend, ring and compact metrics before renderer completes | Transient dashes can remain visible when authenticated dashboard load fails before `renderTerminalShell()` | Initial `/api/v1/dashboard` state; failure reason is known at `reportDashboardLoadError` | `WRONG_OR_AMBIGUOUS_STATE` | On load failure, convert formal terminal placeholders to a concrete dashboard-source unavailable state; no silent/ambiguous dash | Yes |
| Dashboard API failure — `[data-dashboard-load-error="true"]` | Visible red `Dashboard data unavailable` alert plus console error; dashboard is not misreported as logout | Authenticated `/api/v1/dashboard` failure and actual error message | `VALUE_OK`, but paired shell state is ambiguous | Retain fail-visible alert and additionally normalize terminal shell failure state | Yes |
| TX chart/API failure — chart empty state and `renderTxDecisionChart({status:'UNAVAILABLE', reason})` | Explicit chart unavailable reason with no fabricated bars | `/api/v1/tx-chart` failure | `UNAVAILABLE_REASON_OK` | Retain and include in browser acceptance | Verification only |
| Windows Production-DOM cleanup — temp Chrome profiles in `tests/trader-terminal-production-dom.test.mjs` | DOM assertions pass, but intermittent post-assertion `EPERM` during profile removal reports false test failures | Test-harness lifecycle only; not product data or UI | `RUNTIME_OR_RENDER_BUG` | Make browser shutdown/profile cleanup deterministic and regression-test the full file | Yes |

## Bounded implementation set

CRU-31 may implement only these audit dispositions:

1. Demote the full Trend card into existing progressive disclosure while preserving explicit `RESEARCH_PENDING` / `NOT_REQUESTED` truth.
2. Hide source-free decorative Pulse/Futures bars and empty Global/Breadth/Risk series from the main reading layer.
3. Reduce Risk homepage presentation to the existing governed status; keep unimplemented component reasons in detail/drawer.
4. Replace the disabled Ask GPT mock shell with a compact, truthful manual-copy state while retaining the existing Copy question/snapshot flow.
5. Make authenticated initial-dashboard failure replace formal shell dashes with an explicit dashboard-source unavailable reason.
6. Add Production DOM interaction coverage for drawer, progressive disclosure, truth states, and no visible meaningless dash.
7. Stabilize Windows Chrome profile cleanup so a passed DOM assertion cannot become a false failure.

No endpoint, collector, new source, Shioaji behavior, `index_components`, scanner/radar, model, score, Market State, research promotion, strategy, broker, order, position, risk algorithm, execution route, UI-2 implementation, framework rewrite, mobile, or personalization change is authorized.

## Authoritative field-level closeout ledger

This ledger is the authoritative classification for CRU-31. Where the baseline inventory above combines two lawful outcomes in one row or describes an acceptance gap, the individual entries below provide the single taxonomy classification used for closeout. A value is never promoted by this table: it is rendered only when its named existing contract, identity, and freshness checks pass.

| Visible field / DOM identity | Baseline visible state | Existing source and identity / availability semantics | Classification | CRU-31 disposition | In scope? |
| --- | --- | --- | --- | --- | --- |
| Market identity `#tt-top-contract` | Actual TX contract, or only the generic product label when contract was absent | TX chart `actualContract`; paired with `tradeDate` and `session` | `WRONG_OR_AMBIGUOUS_STATE` | Retain contract identity; otherwise `UNAVAILABLE · ACTUAL_CONTRACT_NOT_REPORTED` | Yes |
| Last / change `#tt-top-price`, `#tt-top-change` | Chart last; change required prior close and could expose a bare placeholder during failure | TX chart bars and `levels.previousClose`; chart `availableAt`; no missing-as-zero | `WRONG_OR_AMBIGUOUS_STATE` | Preserve qualified value; fail closed as `UNAVAILABLE · <actual reason>` | Yes |
| Volume / OI / basis `#tt-top-volume`, `#tt-top-oi`, `#tt-top-basis` | Intraday volume plus qualified EOD OI/basis | Chart volume; `futuresMarket.txDay.openInterest`; `derived.market.basis`; actual-contract and trade-date compatibility required | `VALUE_OK` | Retain; label EOD/delayed/stale from source health | No |
| Session / update / trust `#tt-top-session`, `#tt-top-updated`, `#tt-top-trust` | Session, `availableAt`, and chart/data-health trust | TX chart identity and quality; dashboard data health fallback | `VALUE_OK` | Retain; unknown mode is not Live | Yes |
| Top mode controls `.dw-mode-switch` | FOCUS/REVIEW controls were displaced when the terminal top bar mounted | Existing client-side presentation control; no market contract | `RUNTIME_OR_RENDER_BUG` | Preserve both controls in mounted top bar | Yes |
| Summary price / VWAP `#tt-summary-price`, `#tt-summary-vwap` | Qualified fact and chart VWAP | `currentMarketFactSummary`; chart VWAP with chart identity/freshness | `VALUE_OK` | Retain; explicit unavailable reason on missing input | Yes |
| Summary breadth / flow `#tt-summary-breadth`, `#tt-summary-flow` | DW4 family availability, not inferred direction | DW4 `PARTICIPATION_BREADTH`, `FUTURES_INSTITUTIONAL`; source identity and promotion state | `VALUE_OK` | Retain descriptive availability only | No |
| Summary risk `#tt-summary-risk` | Existing decision-summary risk state | Existing `decisionSummary.risk`; not a new score | `VALUE_OK` | Retain existing status only | No |
| Summary strength `#tt-summary-strength` | `RESEARCH_PENDING` | No promoted Trend Strength contract | `RESEARCH_PENDING_OK` | Retain pending | No |
| Forward shadow / decision / now summary `#dw-forward-status`, `#dw-forward-status-value`, `.dw-decision-bar`, `.dw-now-summary` | Existing governed narrative/status blocks | Dashboard workspace snapshot and its trade date/session/snapshot identity | `VALUE_OK` | Retain above evidence/detail hierarchy | No |
| Conflict / Against `.dw-conflict-monitor`, `.dw-against-panel` | Existing risk/conflict narrative, with named empty states | Dashboard decision workspace; snapshot identity applies | `UNAVAILABLE_REASON_OK` | Keep named truth states; never invent a conflict | No |
| Pulse price / VWAP `#dw-pulse-price`, `#dw-pulse-vwap` | Chart values or ambiguous transient loading | TX chart bars/VWAP, `actualContract`, `tradeDate`, `session`, `availableAt` | `WRONG_OR_AMBIGUOUS_STATE` | Explicit loading then value/unavailable reason | Yes |
| Pulse session / volume / change `#dw-pulse-session`, `#dw-pulse-volume`, `#dw-pulse-change` | Descriptive chart values; session is retained in detail rather than the primary pulse row | Same chart identity and availability contract | `VALUE_OK` | Retain | No |
| Pulse basis `#tt-pulse-basis` | Qualified basis | Same basis source and compatibility checks as Top Bar | `VALUE_OK` | Retain EOD/delayed/stale semantics | No |
| Pulse RVOL `#tt-pulse-rvol` | No implemented derivation | No production RVOL contract | `UNAVAILABLE_REASON_OK` | `UNAVAILABLE · DERIVATION_NOT_IMPLEMENTED` | No |
| Pulse decorative bars `.tt-pulse-trend` | Source-free bars | No series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Hide outside explicit fixture | Yes |
| K-line canvas `#dw-chart-canvas` | Lightweight Charts OHLCV/VWAP canvas | `/api/v1/tx-chart`; actual contract/date/session/availableAt/quality | `VALUE_OK` | Retain as primary visual; chart must mount | Verification |
| Chart status / empty state `#dw-chart-status`, `#dw-chart-empty` | Loading or explicit API/contract reason | TX chart response status and actual root cause | `UNAVAILABLE_REASON_OK` | Never show Ready without mounted content | Yes |
| Chart controls `#dw-chart-timeframes`, `#dw-chart-crosshair`, `#tt-level-toggle`, `#tt-chart-expand` | Timeframe, crosshair, level palette, expand/restore | Existing client controls and persisted presentation preferences | `VALUE_OK` | Retain and browser-test | Verification |
| Chart levels / identity `#dw-prior-levels`, `#dw-session-levels`, `#dw-or-state`, `#dw-vwap-state`, `#dw-rvol-state`, `#dw-chart-available-at`, `#dw-chart-quality` | Value when present; otherwise could be a bare placeholder | TX chart `levels`, per-level reason, actual contract/date/session/availableAt/quality | `WRONG_OR_AMBIGUOUS_STATE` | Render concrete unavailable reason | Yes |
| Trend main/direction/strength/path `#tt-trend-main`, `#tt-trend-direction`, `#tt-trend-price-track`, related fields | Full primary card of pending capability | No promoted Trend model | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Move card to progressive disclosure | Yes |
| Trend facts within detail `#tt-trend-breadth-track`, `#tt-trend-futures-track` | Source-family availability only | Existing DW4 family contracts, not direction/score | `VALUE_OK` | Preserve actual availability or explicit family-unavailable reason; never turn it into direction/score | Yes |
| Futures main / TX / VWAP / basis `#tt-futures-main`, `#tt-futures-tx`, `#tt-futures-vwap`, `#tt-futures-basis` | Existing descriptive fact/value or named unavailable | TX chart and DW4 futures family; contract/date/source health | `VALUE_OK` | Retain | No |
| Futures foreign/dealer/trust net `#tt-futures-foreign`, `#tt-futures-dealer`, `#tt-futures-trust-position` | EOD institutional net values when qualified | `futuresPositioning`; trade date, actual contract/instrument, availableAt/source health | `VALUE_OK` | Retain EOD/delayed/stale truth | No |
| Futures OI / OI change `#tt-futures-oi`, `#tt-futures-oi-change` | EOD OI and derived change only with compatible source | `futuresMarket.txDay`; actual contract and trade-date compatibility | `VALUE_OK` | Retain; no missing-as-zero | No |
| Futures decorative bars `.tt-futures-bars` | Source-free bars | No series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Hide outside fixture | Yes |
| Options main / walls / Max Pain / P-C `#tt-options-main`, `#tt-options-call`, `#tt-options-put`, `#tt-options-max-pain`, `#tt-options-oi` | Qualified EOD descriptive options context | DW4 `OPTIONS_CONTEXT`, `snapshot.options`, `optionsEod`; options contract/date/availableAt/source health | `VALUE_OK` | Retain EOD/delayed/stale semantics; no Greeks promotion | No |
| Breadth main / counts / ratio `#tt-breadth-main`, `#tt-breadth-up`, `#tt-breadth-flat`, `#tt-breadth-down`, `#tt-breadth-ratio` | Complete governed counts; valid observed zero preserved | DW4 breadth family and `snapshot.breadth`; partial input fails closed | `VALUE_OK` | Retain | No |
| Breadth strength `#tt-breadth-strength` | `RESEARCH_PENDING` | No promoted Breadth Strength model | `RESEARCH_PENDING_OK` | Keep in detail | Yes |
| Breadth series `.tt-breadth-series-block` | Empty source-free visual | No governed intraday breadth series | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Hide outside fixture | Yes |
| Contribution status/rows `#dw-leadership-state`, `#dw-leadership-mode`, `#dw-leadership-time`, `#dw-leadership-bars`, `#dw-leadership-positive`, `#dw-leadership-negative` | IX0001 descriptive rows or quality/wait reason | `/api/v1/index-leadership`; DAY source, trade date, availableAt, quality | `VALUE_OK` | Retain descriptive-only labels; API failure gets a concrete reason | Yes |
| Contribution fallback `.tt-contribution-placeholder`, `#tt-contribution-*` | A fallback could look like a normal computed contribution | No lawful synthetic substitute | `WRONG_OR_AMBIGUOUS_STATE` | Keep explicit unavailable fallback outside normal row path | Yes |
| Global state/value/change `#tt-global-main`, `#tt-global-name-*`, `#tt-global-price-*`, `#tt-global-change-*` | Latest descriptive global/FX values, unused tiles hidden | DW4 `GLOBAL_FX`; source trade date, availableAt, EOD/delayed/proxy/research source mode | `VALUE_OK` | Retain latest-value-only truth | No |
| Global mini-series `#tt-global-series-*` | Empty baseline suggesting history | No governed time-series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Hide outside fixture | Yes |
| Data Health summary `#tt-health-main`, `#tt-health-market`, `#tt-health-institutional`, `#tt-health-futures`, `#tt-health-options`, `#tt-health-global` | Worst grouped source freshness or concrete missing-source reason | `globalStatus.dataHealth` and `snapshot.dataHealth.items`; sourceId/readiness/freshness/availableAt | `VALUE_OK` | Retain prominently and fail closed on unreported source | No |
| Data Health detail `#dw-data-health-panel` | Source/runtime detail in progressive section and drawer | Existing dashboard health/runtime contract | `VALUE_OK` | Retain; browser-test drawer | Verification |
| Risk overall `#tt-risk-ring-value`, `#tt-risk-ring-state` | Existing risk status only | Existing `decisionSummary.risk`; no new algorithm | `VALUE_OK` | Retain compactly | No |
| Event / chase risk `#dw-event-risk-state` | Source-free `UNAVAILABLE` without a reason | No promoted Event Risk contract | `WRONG_OR_AMBIGUOUS_STATE` | Final state is `RESEARCH_PENDING`; no score is created | Yes |
| Risk components `#tt-risk-volatility`, `#tt-risk-liquidity`, `#tt-risk-event`, `#tt-risk-breadth` | Four unimplemented component placeholders in primary card | No component-risk contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Move explicit `BREAKDOWN_NOT_IMPLEMENTED` cells to detail/drawer | Yes |
| Risk series `#tt-risk-series`, `.tt-risk-series-block` | Empty pending visual | No governed risk-series contract | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Hide outside fixture | Yes |
| Ask GPT status `#tt-gpt-disabled-state` | Large disabled pseudo-input shell | Policy allows manual copy only; no direct GPT API | `LOW_VALUE_PLACEHOLDER_HIDE_OR_DEMOTE` | Compact `COPY SNAPSHOT · READY/UNAVAILABLE`; no API implication | Yes |
| Copy question / snapshot `#dw-copy-gpt-prompt`, `#dw-copy-chatgpt` | Copy action could stay enabled without copy context | `decisionWorkspace.chatGptCopy`; current loaded snapshot/context | `WRONG_OR_AMBIGUOUS_STATE` | Disable with `COPY_CONTEXT_UNAVAILABLE`; enable only with context | Yes |
| Drawer `.tt-more`, `.tt-drawer` | Detail clone with close/Escape behavior | Mounted visible DOM; no data mutation | `VALUE_OK` | Test open, forward/reverse focus loop, Escape, focus return | Verification |
| Progressive sections `.tt-progressive` | Evidence, changes, health, journal details | Existing dashboard DOM and contracts | `VALUE_OK` | Test closed content hidden and open detail readable | Verification |
| Evidence/change/journal/review/nav `[id^="dw-evidence-"]` (`#dw-evidence-timeline`, `#dw-evidence-cards`), change (`#dw-change-status`, `#dw-change-trust`, `#dw-change-contract`, `#dw-change-reasons`, `#dw-change-latest`), journal (`#dw-journal-form`, `#dw-journal-setup`, `#dw-journal-reason`, `#dw-journal-invalidation`, `#dw-journal-submit`, `#dw-journal-feedback`, `#dw-journal-history`), mode (`#dw-focus-mode`, `#dw-review-mode`, `.dw-mode-switch`), nav (`#side-nav`, `[data-dashboard-page]`) | Existing secondary descriptive surfaces and UI controls | Dashboard snapshot and local presentation state | `VALUE_OK` | Preserve in progressive detail; no roadmap deletion | Verification |
| Initial dashboard loading `#decision-workspace[data-dashboard-load-state]` | Meaningless dashes could survive a failed load | Authenticated dashboard request lifecycle | `WRONG_OR_AMBIGUOUS_STATE` | `LOADING` while pending; only dashboard success owns `READY` | Yes |
| Dashboard API/network failure `[data-dashboard-load-error="true"]` and formal value nodes | Alert visible, but stale values or later chart poll could repopulate/mark Ready | Actual dashboard error; no current trustworthy workspace | `RUNTIME_OR_RENDER_BUG` | Fail closed all formal values, disable copy, retain visible alert; chart poll cannot overwrite state | Yes |
| Post-login dashboard failure | Login succeeded but dashboard failure bypassed terminal failure normalization | Same dashboard request and actual failure reason | `RUNTIME_OR_RENDER_BUG` | Route through shared fail-visible renderer | Yes |
| Chrome test profile cleanup | Passing assertions could be reported failed by Windows EPERM cleanup | Test harness only | `RUNTIME_OR_RENDER_BUG` | Bounded retry cleanup; no product behavior change | Yes |

## Truth-state matrix

| Runtime condition | Required visible semantics | Forbidden presentation |
| --- | --- | --- |
| Request pending | `LOADING`; controls depending on absent context disabled | Prior-value `READY`, silent blank |
| Market/session closed | Existing source-provided `SESSION_CLOSED` or equivalent actual contract reason | `LIVE` merely because the page loaded |
| Source process unavailable | Actual `SOURCE_NOT_RUNNING` / source-specific unavailable reason when provided | Zero, Neutral, Current |
| Local governed artifact absent | `LOCAL_ARTIFACT_REQUIRED` when that is the actual contract reason | Fabricated fallback data |
| Source not collected | `UNAVAILABLE · SOURCE_NOT_COLLECTED` when supplied by the contract | Bare dash or blank card |
| Derivation absent | `UNAVAILABLE · DERIVATION_NOT_IMPLEMENTED` | Locally invented calculation |
| Capability not requested | `NOT_REQUESTED` | Failure styling or inferred result |
| Research not promoted | `RESEARCH_PENDING` | Score, direction, probability, BUY/SELL |
| EOD / delayed | Explicit EOD/delayed source semantics and `availableAt` | Live/current claim |
| Stale | Explicit stale state and last-known availability time where supplied | Current/live claim |
| Dashboard/API/network failure | Visible alert plus `UNAVAILABLE · DASHBOARD_API_UNAVAILABLE` or actual bounded reason; no stale formal values | Silent failure, Ready, repopulated stale values |
| TX chart failure | Chart unavailable reason and no fabricated bars | Black/empty canvas labelled Ready |
| Leadership pending/unavailable | Explicit wait, quality, source, or unavailable state | Synthetic contribution |

## Closeout verification map

The committed audit is completed by exact-SHA evidence in the Draft PR and Linear CRU-31. Fixture evidence proves render and interaction contracts; the separately labelled local real-runtime observation proves what available local data produces. Neither may be substituted for Product Owner browser acceptance.

- Deterministic production DOM: normal and expanded layouts at `1920x1080`, `1536x864`, and `1366x768`; duplicate IDs, horizontal overflow, core clipping, formal text under 11px, visible dash/bare-unavailable, canvas mount, navigation, chart expand/restore, drawer focus loop/return, progressive disclosure, initial failure, post-login failure, and success-to-refresh failure.
- Fixture-only decoration is explicitly marked and excluded from governed evidence copy.
- Real runtime: verify `MOCK_DATA=0`, route, viewport, time, runtime commit, source status, visible identity/freshness, and any honest unavailable limitation. A closed market or stopped local source is not converted to PASS or a value.
- Safety observation only: no broker/order/buy/sell/cancel/modify/flatten/reverse/authorization action is permitted during browser checks.

## Observed baseline-to-closeout resolution

The following observations were made on 2026-08-29 after the bounded implementation. The final exact commit is the commit containing this report; its full SHA and rerun commands are persisted in the Draft PR and Linear CRU-31. Product Owner acceptance remains pending.

### A. Deterministic fixture / governed DOM regression

| Acceptance area | Observed closeout result | Result |
| --- | --- | --- |
| Load lifecycle | `LOADING` is explicit; only dashboard success owns `READY`; initial and post-login dashboard failures fail closed | PASS |
| Refresh/poll race | A chart poll after dashboard failure cannot repopulate Top Bar or Market Pulse from stale workspace state | PASS |
| Truth text | No visible meaningless dash or bare `UNAVAILABLE`, including missing health and contribution branches | PASS |
| Governed values | TX, Futures EOD positioning/OI, Options EOD, Breadth counts including observed zero, Global, Data Health, existing Risk status retain source/identity/freshness semantics | PASS |
| Research boundary | Trend/Breadth Strength/Risk components and Event Risk remain `RESEARCH_PENDING` or named not-implemented states | PASS |
| Layout | Normal and expanded layouts at 1920×1080, 1536×864, and 1366×768; no document horizontal overflow or prioritized core clipping | PASS |
| Typography | Formal visible text below 11px: 0, including opened progressive and drawer detail | PASS |
| Interaction | Canvas mounted; nav, expand/restore cycles, drawer open/Escape/forward+reverse focus loop/focus return, progressive open/close | PASS |
| DOM/runtime errors | Duplicate IDs: 0; blocking console errors: 0 on normal fixture path; explicit failure tests intentionally produce exactly their governed error | PASS |
| Copy | Copy actions disabled when context is unavailable and enabled only when immutable copy context is ready | PASS |

### B. Local real-data production runtime

Automated Chrome-CDP observation used the normal authenticated `server.mjs` production path with `NODE_ENV=production`, `MOCK_DATA=0`, `COOKIE_SECURE=0` on loopback port 8789. Authentication used a process-local review password hash, not Owner credentials; the same production login endpoint and session mechanism were exercised. This does not replace Owner login/visual acceptance on the 8788 guide path.

| Evidence | Observation |
| --- | --- |
| Time / route / viewport | `2026-08-29T07:15:03.958Z`; `http://127.0.0.1:8789/`; 1536×864 |
| DOM gates | `READY`; alert none; blocking console errors 0; exceptions 0; duplicate IDs 0; horizontal overflow 0; prioritized core clipping 0; formal text under 11px 0; visible dash 0; bare unavailable 0; chart canvases 7 |
| Market identity | Session `NIGHT`; actual contract, TX Tick price, availableAt and quality were not supplied by the running local source, so the UI showed `ACTUAL_CONTRACT_NOT_REPORTED`, `TX_TICK_SOURCE_UNAVAILABLE`, `AVAILABLE_AT_NOT_REPORTED`, and `QUALITY_STATUS_UNAVAILABLE` |
| Futures | Existing EOD descriptive value visible (foreign futures net position); unavailable chart-relative fields retained explicit source/contract reasons |
| Options | Existing EOD OI P/C descriptive value visible |
| Breadth | Existing listed advance/decline/flat counts visible |
| Contribution | `UNAVAILABLE · INDEX_LEADERSHIP_UNAVAILABLE`; no synthetic contribution |
| Global | Existing latest VIX descriptive value visible; source-free mini-series hidden |
| Data Health | `UNAVAILABLE · DATA_HEALTH_UNAVAILABLE`; not mislabeled Live/Current |
| Risk / Trend | `UNAVAILABLE · RISK_STATUS_UNAVAILABLE`; Trend `RESEARCH_PENDING`; no algorithm or recommendation inferred |
| Ask GPT | `COPY SNAPSHOT · READY`; manual-copy-only and not-a-trading-signal labels visible |
| Safety | Read-only / not-a-trading-signal label visible; no broker/order action exercised |
| Screenshot | Local ignored artifact: `data/cru31-browser-evidence/real-runtime-1536x864.png` |

The absence of TX Tick/current contract in this market-closed/local-source condition is an honest runtime limitation, not a fabricated PASS. The result proves that available EOD/local fields render and unavailable fields remain explainable. Owner verification with the existing local password and their internal browser is still required.

## Baseline evidence and open acceptance work

- `node --test tests/trader-terminal-ui.test.mjs`: **10 PASS / 0 FAIL** on the base commit.
- A single isolated production-DOM mount test: **PASS**.
- Full base production-DOM run: product assertions for optional field fail-soft and authenticated navigation/chart layout passed; two cases were reported failed only by post-assertion Windows temp-profile `EPERM` cleanup. This harness defect must be fixed before final acceptance.
- Existing CRU-30 wiring regression covers governed Top Bar, Futures, Options, Breadth, Data Health and existing Risk status.
- Remaining stage gates are: commit the final tree, rerun and persist evidence against that exact SHA, push the branch, open the Draft PR, obtain CI PASS, persist the Linear update, and wait for GPT independent review plus Product Owner browser acceptance. The deterministic fixture, three target viewports, local production runtime, and owner-reproducible guide evidence above are completed observations and must not be restated as Owner acceptance.
