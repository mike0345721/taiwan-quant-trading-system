# Must-preserve audit

Candidate `9f1bedd0e6036ead82b55a225edb6533fef38d7b` compared with approved main `d3702315b46a1a6c23384338ae40904b8bc589c2` and Visual Gate 1 `181e78d07dc5e3509c5ba769252b427ecfa7abb8`.

## Source proof

[source-audit.json](source-audit.json) contains exact changed-file lists: 15 integration files relative to Visual Gate 1; 80 complete candidate files relative to main (includes accepted CRU-54 and prior CRU-55 history). No conflict markers or uncommitted source changes.

Original main `public/index.html`, `public/app.js`, `public/styles.css`, `src/dashboard-flow-refresh.mjs`, `src/dashboard-observed-flow.mjs` have identical Git blobs. Frozen CRU-54 src/cvd-*, tests/cvd-* and matching scripts have zero diff against accepted `66de7e9a416e9f2386eed1c9e8688afea1b804ab`.

| Must preserve | Integration method | Actual evidence |
|---|---|---|
| Approved core K / Volume / cumulative CVD / signed ΔCVD | Visual Gate 1 components, accepted bundle and one cutoff | Real + demo three-size screenshots; 18 browser/API combinations |
| Fast Scan / Relationship / Session / Path | Same accepted projection, enum, quality and numeric values | timeframe-browser.json; focused tests |
| Null/segment reset / Handoff boundaries | No producer or projection change | CVD passing semantic tests; frozen source identity; truthful nonadjacent Handoff |
| Main live chart / VWAP / observed Flow | Original UI/API via futures workspace; separate from pinned CVD | workspace-futures screenshots, producer-readonly-audit.json, API200 |
| Main history replay / date / OHLCV / RVOL | Original intraday page routed through futures/research | replay-interaction.json reset 1/60 → next 2/60 → all 60/60 |
| Spot / breadth / margin / futures background | Original market fragments routed without deletion | browser-audit.json; spot and futures screenshots |
| Options OI chart / contract / Dealer Map / Smart Radar / research | Original options page and listeners | two selector evidence files, options screenshots |
| Global NDX/SOX/USDTWD | Formal read-only V2 service, actual per-market source dates | global screenshots; API source dates; NDX explicit proxy on Overview |
| Research / backtests / Forward Shadow | Original pages retained; absent report explicit UNAVAILABLE | research screenshot and expected V2_BACKTEST_NOT_READY |
| Quality/Data Operations | Original authenticated API and refresh | API check + quality screenshot |
| Snapshot / manual journal | Original page/API; journal redirected to candidate-private directory | Read endpoint200, CSRF refusal, source review; no test journal entry inserted |
| Main auth/CSRF/logout | Same implementation with isolated cookie name | 37-check HTTP report; 4 security tests |
| Formal runtime, CRU52, schedulers, raw/SQLite/evidence | Read-only formal dependencies; all candidate writes per-run private | Isolation independent APPROVE and producer path audit |

## Scope limits

Overview source is intentionally a pinned real fragment, never promoted to Live. Current main price/VWAP/Flow remains a separate complete original surface in the same candidate process; live prices are not spliced into stale CVD. Main default startup is untouched; this opt-in candidate is not a production launcher or rollout plan.

No original main page ID/listener was removed. Overview sidebar removal is the latest Owner IA decision, not deletion of underlying capabilities. The current-main capability pages retain their existing longer layouts; they are not a second redesign of the accepted Cockpit.
