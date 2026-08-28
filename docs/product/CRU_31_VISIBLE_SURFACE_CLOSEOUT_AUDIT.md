# CRU-31 Visible Surface Closeout Audit

Date: 2026-08-28

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

## Visible-surface inventory

The “current visible state” column describes the merged production renderer. `VALUE` means a value is shown only when its existing contract and identity/freshness checks qualify; otherwise the renderer must name the actual unavailable reason.

| Area / UI or DOM identity | Current visible value or state | Expected existing source and identity / freshness semantics | Classification | Proposed disposition | In CRU-31 implementation scope? |
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

## Baseline evidence and open acceptance work

- `node --test tests/trader-terminal-ui.test.mjs`: **10 PASS / 0 FAIL** on the base commit.
- A single isolated production-DOM mount test: **PASS**.
- Full base production-DOM run: product assertions for optional field fail-soft and authenticated navigation/chart layout passed; two cases were reported failed only by post-assertion Windows temp-profile `EPERM` cleanup. This harness defect must be fixed before final acceptance.
- Existing CRU-30 wiring regression covers governed Top Bar, Futures, Options, Breadth, Data Health and existing Risk status.
- CRU-31 final acceptance still requires deterministic fixture DOM evidence, normal local production-runtime evidence, three target viewports, owner-reproducible instructions, CI, Level 2 review, and the final Draft PR gate.
