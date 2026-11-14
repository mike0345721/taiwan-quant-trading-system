# CRU-45 Runtime and Browser Acceptance

Date: 2026-09-08 (Asia/Taipei)

Baseline before this checkpoint: `8d36076854d1e1fd7376dc6df686f10d93482cc3`

Scope remains read-only market presentation. `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, and `orderRoutesEnabled=false`.

## Root cause and repair

The governed chart payload was valid, but the browser presentation treated a payload with bars as visible even when Lightweight Charts was absent or its v5 series API was incompatible. This allowed a READY label with no visible renderer. The repaired path derives valid candle data first and gates visible readiness on at least one valid candle, a successfully initialized v5 renderer (`createChart`, `CandlestickSeries`, `HistogramSeries`, and `LineSeries`), and successful series writes. Missing runtime, API mismatch, invalid bars, renderer initialization failure, or series-write failure now stays visibly unavailable instead of hiding the empty-state overlay.

Basis and open-interest compatibility now compare canonical `contractMonth` identities. The raw live `actualContract` remains required for lineage and must agree with the declared canonical month. Missing or contradictory identity fails closed with `CONTRACT_IDENTITY_INCOMPLETE`; a real month mismatch fails with `ACTUAL_CONTRACT_MISMATCH`. Chart and EOD trade dates must match, and EOD sources must report `READY` readiness plus `PASS` quality. Freshness labels remain visible.

## Audit evidence

| Check | Result |
| --- | --- |
| Lightweight Charts runtime | PASS, expected and installed 5.2.0, browser bundle present |
| 5m governed payload | PASS, READY, positive bars, no duplicate/non-increasing timestamps, invalid OHLC, or invalid volume |
| Canonical identity focused tests | PASS, 8/8 |
| CRU-45 focused suite | PASS, 22/22 |
| Production DOM | PASS, 5/5 plus 1 conditional skip |
| Security scan | PASS, no detected secret |
| Blocking browser console errors | 0 |

The current 5m payload used `TXFI6` as raw lineage and `202609` as canonical contract month. The browser correctly kept Basis and OI unavailable when the current dashboard snapshot did not provide a compatible `txDay` identity. A production-DOM governed fixture proves that compatible raw/canonical identity and matching dates render, while contradictory identity, date mismatch, and degraded source quality fail closed. No raw-symbol equality is used across the two sources.

## Timeframe visible-render acceptance

Acceptance required a visible candle or forming bar plus the volume panel, not merely an API status.

| Timeframe | Payload status | Visible chart | Volume | Result |
| --- | --- | --- | --- | --- |
| 1m | READY | visible | visible | PASS |
| 5m | READY | visible | visible | PASS |
| 15m | READY | visible | visible | PASS |
| 30m | READY | visible | visible | PASS |
| 1h | READY | visible | visible | PASS |
| 4h | READY | visible | visible | PASS |
| 1D | FORMING (`DAY_SESSION_MISSING`) | one forming bar visible | visible | PASS as forming, not promoted to READY |

The main chart also displayed current price, VWAP, session high/low, and the Chinese-first cursor summary. Full open/high/low/close detail remains present as secondary text.

Rapid sequential timeframe selection was also exercised. A monotonic request token plus a single-in-flight/latest-selection queue ensures that stale success or failure cannot overwrite the latest selection without creating a payload-request storm. After each selection, the selected control, rendered mode, visible canvas, and payload status were verified together.

## Responsive and adaptive browser acceptance

The browser was drag-resized through 1280, 1319, 1321, 1366, 1379, 1381, 1440, 1536, 1599, 1601, 1728, 1920, and 2048 CSS-pixel widths. Heights used representative desktop ratios, including the three fixed checkpoints.

| Acceptance item | Result |
| --- | --- |
| Fixed checkpoints 1366x768, 1536x864, 1920x1080 | PASS |
| Intermediate widths below, between, and above checkpoints | PASS |
| Breakpoint before/after checks at 1320, 1380, and 1600 | PASS |
| Horizontal page overflow | none |
| Core text clipping | none observed |
| Core controls visibility | timeframe, level toggle, and expand remained visible |
| Button overlap | none observed |
| Card overlap | none observed |
| Chart and volume resize | PASS; canvas dimensions tracked the container |
| Card reflow | PASS; primary grid stacked at narrower widths and reflowed to two columns above 1600px |

The 1600px transition intentionally changes the primary grid from stacked to two-column presentation. Checks immediately before and after the breakpoint showed no overflow, clipping, overlap, hidden core controls, or blank chart.

Fixed-checkpoint screenshots:

- [1366x768](dashboard-1366x768.png)
- [1536x864](dashboard-1536x864.png)
- [1920x1080](dashboard-1920x1080.png)

## RVOL descriptive readiness

The audit found 164 catalog day files, 164 audit-passed days, 164 complete 60-bar 5m day sessions, and 164 eligible candidate days. All 60 same-time buckets had sample min/median/max of 164 and there were no ineligible catalog files. Contract distribution spans `202601` through `202609`, with 8 observed contract transitions. Truly absent trading-day files remain `UNASSESSED` because no authoritative governed trading calendar is configured; the audit does not infer calendar completeness from the files that happen to exist.

The existing candidate remains the historical-replay definition: current 5m volume divided by the median volume at the same time across up to 20 prior eligible days. Readiness remains `RESEARCH_PENDING`. The audit does not define a minimum sample threshold, formal percentile, or volume-burst label. Before promotion, the project must explicitly freeze rollover inclusion/exclusion behavior and replace serialized timestamp substring matching with an explicit Asia/Taipei or session-relative bucket identity.

## Reproduction

From this worktree, install dependencies and start the dashboard with the local governed data roots:

```powershell
npm.cmd ci
$env:PORT='8791'
$env:NODE_ENV='development'
$env:TX_CHART_DATA_ROOT='D:\Taiwan stock\standalone-v1\data'
$env:TX_CHART_CACHE_ROOT='D:\Taiwan stock\standalone-v1\data\dashboard-chart-cache'
node server.mjs
```

Then open `http://127.0.0.1:8791/`. The development login accepts a local non-production review password. No provider, broker, order, execution, signal-promotion, or Market Control path is enabled by this checkpoint.

## Known issue

`npm.cmd run test:ci` has one Windows-checkout-only generated-document byte-comparison failure. Five pre-existing generated Markdown files are CRLF in the checkout while the generator emits LF; their contents are byte-identical after EOL normalization. None is changed by CRU-45. All CRU-45 focused, runtime DOM, and security checks pass. Shared GitHub CI is the authoritative clean-checkout retest after push.
