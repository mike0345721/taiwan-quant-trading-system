# DW-2 Governed Multi-Timeframe TX Decision Chart

Status: implementation candidate for Product Owner review. This document does not authorize strategy, paper, broker, or execution use.

## Frozen chart bar contract

`CHART_BAR_CONTRACT_V1` uses the executed Tick stream of one actual TX contract as its only price and volume source. The canonical base bar is 1 minute. Every larger supported bar is deterministically aggregated from those governed 1-minute bars; it is not independently fetched or resampled from a continuous contract.

Each bar preserves:

- `time`, `tradeDate`, `sessionTradeDate`, `session`, and `sessionId`
- `actualContract` and `contractMonth`
- `open`, `high`, `low`, `close`, and executed TX `volume`
- `firstEventTime`, `lastEventTime`, and `availableAt`
- `qualityStatus`, `eventCount`, and `sequenceGapCount`

Missing executed volume is not replaced with zero. Bars never mix actual contracts or sessions.

## Timeframe status

| Timeframe | Status | Fixed anchor |
|---|---|---|
| 1m | IMPLEMENTED | PP-1 session start |
| 5m | IMPLEMENTED | PP-1 session start |
| 15m | IMPLEMENTED | PP-1 session start |
| 30m | IMPLEMENTED | PP-1 session start |
| 1h | IMPLEMENTED | PP-1 session start |
| 4h | IMPLEMENTED | PP-1 session start |
| 1D | OWNER_DECISION_REQUIRED | unresolved: `DAY_ONLY` or `NIGHT_PLUS_DAY_TRADE_DATE` |

The 1D control remains visible but fails closed. No daily semantics are guessed.

## Session and contract governance

- DAY is 08:45–13:45 Asia/Taipei and uses that official `tradeDate`.
- NIGHT is 15:00–05:00 Asia/Taipei. It preserves its start calendar date and maps to the next official TAIFEX `sessionTradeDate`, including cross-midnight records.
- Official trading dates come from the governed TAIFEX calendar and fail closed outside its coverage.
- Rollover is explicit. Different actual contracts are isolated and never combined into one bar, VWAP, OR, or level.
- Continuous contracts, MTX, and TMF are not chart price or volume substitutes.

## Overlay governance

- VWAP is exact session VWAP from legal executed Tick price and volume of the same actual TX contract. All timeframes sample the same underlying session VWAP facts.
- DAY Opening Range is the frozen T0 window 08:45 inclusive to 09:00 exclusive. It is `FORMING` before 09:00 and never becomes an ORB signal.
- NIGHT Opening Range is `NOT_APPLICABLE` because no Night OR definition is frozen.
- Key levels carry source, trade date, session, event time, available time, actual contract, and quality lineage. A prior-day level with a contract mismatch stays unavailable.
- Future event markers are empty display slots only. DW-2 does not implement their detection logic.

## Live and replay

LIVE and REPLAY call the same state-free aggregation functions. `asOf` filters both exchange time and received/available time. Realtime presentation updates only the active candle and overlays after the initial history load. A timeframe switch fetches only chart data and does not recompute Decision Summary, Market State, or Data Health.

The mixed live-event ledger can be gigabytes per day. The source adapter therefore maintains an append-only, hash-verified, git-ignored TX-only derived cache. The cache never replaces the raw ledger, is not official Forward evidence, and is rebuilt from raw input if its source offset, byte size, row count, or hash is invalid.

## Chart engine

- Package: `lightweight-charts` 5.2.0, exact version.
- License: Apache-2.0.
- Integration: local standalone browser bundle with native HTML/CSS/JavaScript; no React, Vue, Vite, or proprietary TradingView Charting Library.
- Attribution: the library attribution logo remains enabled and the chart includes a visible “Charts by TradingView” link as required by the project license/notice guidance.

## Test architecture

- Hermetic tests use synthetic Tick fixtures and require no git-ignored artifact.
- Local artifact integration uses `DW2_LOCAL_ARTIFACT_ROOT`. If the governed local Tick ledger is absent, the test reports `LOCAL_ARTIFACT_REQUIRED`; it must not be misreported as a code failure.
- Full-suite failures caused solely by absent git-ignored Frozen/research artifacts are reported separately from true code regressions.

## Fixed safety boundary

`formalWeight=0`, `researchOnly=true`, and `executionAuthorized=false`. DW-2 does not promote a factor, create a BUY/SELL marker, modify Forward Shadow, or add broker/order routes.
