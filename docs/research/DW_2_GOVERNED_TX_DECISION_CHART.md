# DW-2 Governed Multi-Timeframe TX Decision Chart

Status: implementation candidate for Product Owner review. This document does not authorize strategy, paper, broker, or execution use.

## Frozen chart bar contract

`CHART_BAR_CONTRACT_V2` uses the executed Tick stream of one actual TX contract as its only price and volume source. The canonical base bar is 1 minute. Every larger supported bar is deterministically aggregated from those governed 1-minute bars; it is not independently fetched or resampled from a continuous contract.

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
| 1D | IMPLEMENTED | governed `sessionTradeDate` at Asia/Taipei 00:00 |

The Owner-frozen 1D semantics are `NIGHT_PLUS_DAY_TRADE_DATE`. A daily bar combines the previous official trading day's NIGHT session (15:00 to the next day 05:00) and the governed trade date's DAY session (08:45 to 13:45). Both sides must map to the same `sessionTradeDate` and use exactly the same actual TX contract. The chart identity is `<sessionTradeDate>-TRADE_DATE`; `firstEventTime` and `lastEventTime` preserve the real sequence.

Before the DAY close, `windowState=FORMING` and `status=FORMING`. After close, only complete NIGHT and DAY coverage, a matching actual contract, no future-data violation, and legal quality can produce `status=READY`. Missing NIGHT data preserves a visible partial DAY bar with `NIGHT_SESSION_MISSING` and `QUALITY_INSUFFICIENT`. A contract mismatch returns `bars=[]` and fails closed.

## Session and contract governance

- DAY is 08:45–13:45 Asia/Taipei and uses that official `tradeDate`.
- NIGHT is 15:00–05:00 Asia/Taipei. It preserves its start calendar date and maps to the next official TAIFEX `sessionTradeDate`, including cross-midnight records.
- Official trading dates come from the governed TAIFEX calendar and fail closed outside its coverage.
- Rollover is explicit. Different actual contracts are isolated and never combined into one bar, VWAP, OR, or level.
- Continuous contracts, MTX, and TMF are not chart price or volume substitutes.

## Overlay governance

- VWAP is exact session VWAP from legal executed Tick price and volume of the same actual TX contract. All timeframes sample the same underlying session VWAP facts. The 1D view shows `NIGHT VWAP` until DAY data exists and then `DAY VWAP`; it never constructs a combined NIGHT+DAY VWAP.
- DAY Opening Range is the frozen T0 window 08:45 inclusive to 09:00 exclusive. It is `FORMING` before 09:00 and never becomes an ORB signal.
- NIGHT Opening Range is `NOT_APPLICABLE` because no Night OR definition is frozen.
- Key levels carry source, trade date, session, event time, available time, actual contract, and quality lineage. A prior-day level with a contract mismatch stays unavailable.
- Future event markers are empty display slots only. DW-2 does not implement their detection logic.
- Existing PP-1 DAY replay levels are labelled `前一日盤高`, `前一日盤低`, and `前一日盤收`. Those labels deliberately do not claim to be combined NIGHT+DAY daily levels.

## Sequence and timestamp quality audit

The read-only audit of the 2026-08-11 and 2026-08-12 ledgers scanned 2,454,035 records and 82,220 TXFH6 executed ticks. The payloads and governed ledger records contain no `sequence`, `seq`, `tick_sn`, or equivalent native sequence value. `sequenceGapEventCount=0` and `sequenceGapSize=0`. Therefore the only defensible sequence decision is `UNKNOWN_NO_NATIVE_SEQUENCE`; it does not prove either the presence or absence of TX tick loss.

The observed quality warning is timestamp lineage, not a sequence gap. There are 53,543 TXFH6 rows where `receivedAt < exchangeTimestamp`, spanning 2026-08-11 00:00:01.775 through 2026-08-12 12:41:19.919 Asia/Taipei. The delta distribution is -483ms minimum, -84ms median, -10ms p95, and -1ms maximum. Nearby records include TX, MTX, and TMF Tick/BidAsk kinds, but this does not establish a mixed-stream sequence false positive because no sequence exists. DW-2 therefore reports `TIMESTAMP_LINEAGE_INSUFFICIENT`, never `TX_TICK_GAP`, for this evidence. Raw ledgers and Collector behavior remain unchanged.

## Frozen public preview

The public preview is a default-off, loopback-only adapter on `127.0.0.1:8798`. A one-time builder chooses the latest governed data by coverage only (never by Outcome or performance), reconstructs an explicit allowlist payload for all seven timeframes, and writes a git-ignored immutable snapshot and manifest. The adapter verifies schema, byte size, file hash, content hash, and governance flags before listening.

Public requests can only read `/`, required static assets, `/healthz`, `/api/public-preview/workspace`, and `/api/public-preview/tx-chart` with an allowlisted timeframe. Every mutation returns `405 READ_ONLY_PREVIEW`; all private APIs and raw/file/database routes return 404. The frontend makes no formal Dashboard API request and offers no Journal, refresh, daily-update, Forward Shadow, Collector, SQLite, or raw-ledger access. `Copy for ChatGPT` is a browser clipboard operation only.

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
