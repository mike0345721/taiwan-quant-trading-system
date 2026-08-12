# DW-3 Slice 1 — Market Change Feed V1

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

## Single source of truth

The pure derivation returns canonical `changes[]`. Workspace What Changed, Evidence Timeline, Evidence Cards, and chart markers consume these same event objects. Stable IDs and deterministic sorting suppress duplicates.

## Data quality and safety

The feed propagates governed chart quality. `TIMESTAMP_LINEAGE_INSUFFICIENT`, `NATIVE_SEQUENCE_AVAILABLE=false`, and `TRUE_TX_TICK_LOSS=unknown` are not reinterpreted as clean data. Events based on otherwise legal completed OHLC/VWAP/OR evidence keep the quality warning visible.

Fixed boundaries:

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`

No BUY, SELL, LONG, SHORT, ENTRY, or EXIT event exists in this contract.

## Deferred

Estimated CVD, BidAsk pressure, large-trade detection, evidence-conflict scoring, Against My Trade, GPT decision advice, strategy routing, risk-engine integration, Paper Trading, and broker/order routes are outside this slice.

