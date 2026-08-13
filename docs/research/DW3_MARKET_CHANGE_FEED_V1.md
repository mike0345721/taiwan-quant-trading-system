# DW-3 — Market Change Feed V1 Product Refit

## Purpose

Market Change Feed V1 turns governed, completed five-minute TX evidence into a deterministic read-only evidence timeline. It explains observable change; it is not a signal, strategy, entry rule, or execution permission.

## Observation contract

- Cadence: each legal completed 5m bar.
- Comparison: previous legal completed snapshot versus current legal completed snapshot.
- Identity must remain equal: `sessionTradeDate`, `session`, `sessionId`, and `actualContract`.
- Forming candles, future evidence, cross-session comparisons, rollover bridging, and unknown-value filling are prohibited.
- Observation lineage preserves `tradeDate`, `sessionTradeDate`, `session`, `actualContract`, `observedAt`, `availableAt`, `qualityStatus`, `qualityReasons`, and `derivationVersion`.

## Frozen V1 taxonomy

- `VWAP_CROSS_UP`, `VWAP_CROSS_DOWN`
- `OR_BREAK_UP`, `OR_BREAK_DOWN`
- `OR_REENTRY_FROM_ABOVE`, `OR_REENTRY_FROM_BELOW`
- `NEW_SESSION_HIGH`, `NEW_SESSION_LOW`
- `DATA_HEALTH_DEGRADED`, `DATA_HEALTH_RECOVERED`

Opening Range remains the frozen T0 DAY range, 08:45 inclusive to 09:00 exclusive. NIGHT has no Opening Range event. Session highs/lows are evidence structure changes, not breakout signals.

## Product semantics

- The feed is a market evidence layer. It describes what changed and never predicts direction or recommends a trade.
- `engineAvailability` (`AVAILABLE`, `INSUFFICIENT_EVIDENCE`, `UNAVAILABLE`) is separate from `dataTrust.status` (`PASS`, `QUALITY_INSUFFICIENT`, `STALE`, `MISSING`, `UNAVAILABLE`).
- A feed can be available while its data trust remains `QUALITY_INSUFFICIENT`.
- Events at the same completed-five-minute observation are grouped deterministically. Primary structure (VWAP/Opening Range), secondary structure (session high/low), and data trust remain factual categories; there is no importance, confidence, direction, or strategy score.
- UI copy is Chinese-first. Raw event codes and lineage remain in expandable technical detail.

## Single source of truth and marker boundary

The pure derivation returns canonical events and deterministic event groups. Workspace, evidence timeline, evidence detail, and 5m chart markers consume these same objects. Stable IDs and deterministic sorting suppress duplicates.

Chart markers are only valid on the 5m chart. The timeline and evidence detail remain visible while viewing another timeframe, but a completed-5m event is not mapped onto 15m, 30m, 1h, 4h, or 1D bars. The TX chart endpoint derives only the requested timeframe; it does not synchronously reload or rebuild the 5m Market Change Feed during timeframe switching.

## Data Health transition decision

`DATA_HEALTH_DEGRADED` and `DATA_HEALTH_RECOVERED` remain reserved contract event types. V1 does not emit them from current chart quality because that would fabricate a historical transition. They may only be emitted when both observations carry explicit governed, time-local, replay-safe Data Health evidence. Until that source exists, each factual price-structure event still carries its current `dataTrust.status` and reasons.

## Data quality and safety

The feed propagates governed chart quality. PR #19's `effectiveAvailableAt = max(receivedAt, exchangeTimestamp)` remains the availability rule, while `TIMESTAMP_LINEAGE_INSUFFICIENT`, `NATIVE_SEQUENCE_AVAILABLE=false`, and `TRUE_TX_TICK_LOSS=unknown` remain visible. Events based on otherwise legal completed OHLC/VWAP/OR evidence keep the quality warning visible.

Fixed boundaries:

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`

No BUY, SELL, LONG, SHORT, ENTRY, or EXIT event exists in this contract.

## Deferred

Estimated CVD, BidAsk pressure, large-trade detection, evidence-conflict scoring, Against My Trade, GPT decision advice, strategy routing, risk-engine integration, Paper Trading, and broker/order routes are outside this slice.
