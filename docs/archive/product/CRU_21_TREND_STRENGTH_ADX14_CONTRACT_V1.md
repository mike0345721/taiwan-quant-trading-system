# CRU-21 Trend Strength: ADX(14) V1

Status: newly Owner-authorized descriptive indicator; engineering implementation is not runtime acceptance.

The Owner explicitly requested defining Trend Strength as a new scope. This supersedes the former `RESEARCH_PENDING` placeholder only for the indicator specified here. It does not authorize a strategy, research-performance claim, model promotion, new data source, order route, or automatic trading decision. Existing CRU-30/31 historical records remain unchanged.

## Meaning and interface

ADX describes the strength of directional price movement, independently of whether prices rise or fall. It is neither win probability nor expected return. V1 does not introduce strong/medium/weak thresholds, traffic-light classifications, buy/sell signals, crossovers as recommendations, or a combined score with Flow/VWAP/leadership.

`src/trend-strength-adx.mjs` exports two pure functions:

```js
calculateAdx14(bars)             // HLC mathematics; fixed period 14
buildChartTrendStrength(chart)  // existing governed chart + source-time adapter
```

Neither function reads files, the network, the environment, wall-clock time, raw ledger records, or a database. Maximum input length is 10,000 bars; an oversized array returns `ADX_INPUT_LIMIT_EXCEEDED`. The adapter is attached to the final existing chart result after its original source-time and partial-source qualification. There is no additional market read or collection process.

The public object uses `schemaVersion: trend-strength-adx14-v1` and includes:

- `indicator: ADX`, `period: 14`, `seedMethod: TA_LIB_WILDER_14_UNSTABLE_0`;
- `state`, `value`, `plusDI`, `minusDI`, `deltaADX`, `direction`;
- `timeframe`, `mode`, `identity.actualContract/tradeDate/session/sessionId`;
- `asOf`, `sourceAvailableAt`, `calculationAvailableAt`, `firstUsedBarAt`, `lastClosedBarAt`;
- `closedBarCount`, `requiredClosedBars: 28`, `maxSessionClosedBars`, `excludedFormingBarCount`, `resetCount`;
- `source: EXISTING_CHART_CLOSED_OHLC`, `closureBasis`, `reasonCodes`, `limitations`;
- flattened `formalWeight: 0`, `researchOnly: true`, `executionAuthorized: false`, `orderRoutesEnabled: false`.

`direction` is only `PLUS_DI_DOMINANT`, `MINUS_DI_DOMINANT`, `EQUAL_DI`, or null. It describes DI ordering, not an authorized trading direction. `deltaADX` compares adjacent computed ADX values from the same initialization segment; it is null at the first ADX. No value is substituted for missing input.

## Formula and reproducible initialization

Primary sources read on 2026-11-04:

1. [TradingView official ADX explanation](https://www.tradingview.com/support/solutions/43000589099-average-directional-index-adx/): DM/TR, Wilder smoothing, DX, and ADX recurrence.
2. [TA-Lib official ADX specification](https://ta-lib.org/functions/adx.html): HLC inputs, period 14, non-directional ADX and unrounded Wilder calculation.
3. Its linked [TA-Lib native C implementation](https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_ADX.c): read successfully as GitHub HTML through the official link. This was mutable `main`; no exact external commit was returned. Direct raw-file and a v0.6.4 page request were unavailable. No library binary was installed or executed, and no exact-release/bitwise parity is claimed.

For each consecutive bar pair, use positive UpMove only when it exceeds DownMove; use positive DownMove only when it exceeds UpMove. Ties contribute zero to both DM sides. TR is the maximum of high-minus-low and the absolute high/low distances from the previous close. DI is each smoothed DM divided by smoothed TR, multiplied by 100. DX is 100 times the absolute DI difference divided by their sum.

The local initialization is explicitly frozen:

1. Bar 0 is the preceding HLC observation. Sum DM and TR transitions for indices 1 through 13.
2. At indices 14 through 27, update each sum as `previous - previous / 14 + current`, collecting 14 DX values.
3. The first ADX at index 27 is their arithmetic mean. Therefore 28 closed bars are needed, not 14.
4. At later bars, use `(previousADX * 13 + currentDX) / 14`.

The additional unstable period is explicitly zero. This is a seed convention, not a statement that the first 28-bar result has converged. Different initial history can produce different smoothed values; the UI must retain the selected period, sample count and initialization range.

Numerical conventions: smoothed TR must be greater than zero before dividing. DI-sum magnitudes below `1e-8` are treated as a zero directional denominator. Such positions contribute zero during initial DX accumulation; after initialization they retain the preceding ADX. A completely observed flat path legitimately yields ADX/+DI/-DI zero. Missing/malformed HLC does not. No integer rounding is used. A tiny floating-point boundary tolerance only constrains numerical outputs to 0–100; nonfinite sums/results fail closed.

## Actual chart contract

The adapter consumes `governed-tx-decision-chart-v2` / `chart-bar-contract-v2` with the existing executed-TX-Tick source. It accepts source statuses `READY`, `FORMING`, and `QUALITY_INSUFFICIENT`; retained bars under `UNAVAILABLE`, `STALE`, missing or unknown statuses do not yield an available indicator.

Existing intraday charts are restricted to one actual contract, trade date, session and sessionId. They already contain OHLC, bar/session boundaries, event times, availability and quality fields. Existing daily charts contain one `NIGHT_PLUS_DAY` bar for the selected trade date; they do not contain 28 historical daily observations. V1 does not manufacture or fetch additional history.

All input identity fields must match the chart. Conflicting/duplicated/non-increasing bar timestamps, invalid OHLC and inconsistent session bounds fail closed. Source and bar timestamps must be valid zoned timestamps. The chart's latest event and availability cannot exceed `chart.asOf`, and each observed bar's last event / availability cannot exceed the corresponding chart watermark.

`chart.asOf` is the only calculation cutoff, including replay. A wall clock passing a boundary does not close a bar. For intraday timeframes, nominal end is bar start plus timeframe width; the source must have observed an event at or after that end, within the cutoff. A final session bucket shorter than the timeframe is not used as a full bar. Daily end uses the existing `sessionEnd`; `FORMING` daily bars are excluded. Future tail rows are excluded before reading their unfinished OHLC. A past row carrying availability ahead of the chart watermark is a contradiction, not a usable as-of observation.

The current source-time structure audit provides per-bar completion/capture evidence only for its existing 5m live scope. This implementation does not expand that audit or treat its absence on 1m/15m/etc. as proof. A numerical result from those otherwise valid closed OHLC observations remains `QUALITY_INSUFFICIENT` with `CLOSED_BAR_CAPTURE_EVIDENCE_UNVERIFIED`. Where present, completion event/availability witnesses must also fit inside the chart watermarks.

Native sequence absence does not erase all observed OHLC or prohibit every descriptive calculation. Every result retains `FEED_COMPLETENESS_NOT_CERTIFIED`; absence of continuityEpoch is also explicitly disclosed. `READY` is not complete-market-history, research, chronology, Flow or execution certification.

## Discontinuities, partial input and capacity

Bars are not sorted or filled to repair a gap. A missing interval, explicit epoch change, known capture interruption, or positive bar sequence gap starts a new initialization segment. Affected capture bars are excluded. Only the latest contiguous remaining segment is used; old smoothed state is not carried across the boundary. A known old interruption can age out once a new adequate segment exists. Reset reasons remain visible in `limitations`.

Partial source catchup or qualified OHLC with unresolved quality may retain a numerical observation, but state stays `QUALITY_INSUFFICIENT`. Missing per-bar capture proof likewise remains limited. Existing chart/bar quality reason codes, including timestamp-lineage restrictions, are preserved alongside general reasons; only bounded uppercase code strings are accepted, with at most 32 output codes of at most 120 characters. No raw path/error text is copied into the result.

Maximum potential closed bars come from the supplied, consistent session start/end and selected width, rounded down. Without those boundaries, capacity is unknown and the adapter returns `SESSION_CAPACITY_UNVERIFIED`. For the current one-trade-date 1D payload the capacity is one.

For the existing normal session boundaries, the consequences are:

| Timeframe | DAY 5 hours | NIGHT 14 hours | Can reach the first ADX within that session? |
|---|---:|---:|---|
| 1m | 300 | 840 | Yes, subject to actual eligible observations |
| 5m | 60 | 168 | Yes, subject to actual eligible observations |
| 15m | 20 | 56 | NIGHT only |
| 30m | 10 | 28 | NIGHT only, near its end and with an observed close witness |
| 1h | 5 | 14 | No |
| 4h | 1 | 3 | No |
| 1D current trade-date payload | 1 | 1 | No historical daily series supplied |

These numbers describe existing code-supplied session bounds, not a new calendar rule or a claim that all expected bars were captured. When capacity is below 28, return `UNAVAILABLE / SESSION_CAPACITY_BELOW_REQUIRED_BARS`, not perpetual warmup. A session with adequate theoretical capacity but insufficient actual continuous closed bars returns `WARMING_UP / INSUFFICIENT_CLOSED_BARS`. Do not combine sessions, dates or contracts to hide this limit.

## State and UI acceptance

| State | Numeric fields | Required presentation |
|---|---|---|
| READY | Available | ADX(14), selected timeframe, sample/range and descriptive limitations |
| QUALITY_INSUFFICIENT | May be available | Observed subset / limited evidence; exact source reasons, never a qualified score or signal |
| WARMING_UP | All null | Actual count / 28 and boundary-reset reason where applicable |
| UNAVAILABLE | All null | Concrete source, identity, input, or session-capacity reason |

The frontend independently checks current wall-clock freshness, market-operation state, selected timeframe versus displayed snapshot, transport failure and replay mode. It must not present retained numbers as live or use the indicator to alter Flow, watch eligibility, R:R, strategy, risk, AI, or execution gates. Source time is not replaced with render time.

## Verification

`tests/trend-strength-adx.test.mjs` contains fixed mixed-path golden observations at indices 27/28/35/40/47. They were independently derived with exact BigInt rational normalized-average recurrence and frozen as constants, not generated by the implementation under test. This verifies the specified mathematical convention; it is not an executed TA-Lib binary comparison.

Additional isolated cases cover minimal initialization, reflection (same strength/opposite DI), positive scale/translation invariance, flat/tied movement, null/nonfinite/coercible values, numerical/input budgets, unchanged input, forming/future bars, actual close witnesses, as-of replay, identity/order/source-watermark errors, gaps, capture loss, explicit epochs, partial quality, missing capture proof, unavailable source states and day/night capacity.

Before/after test logs and exact physical source hashes are stored in the current recovery evidence directory. Source tests/CI do not establish current-market availability or product acceptance. Actual same-version API/DOM comparison, period changes, stale/recovery display and normal user operation remain separate runtime gates.
