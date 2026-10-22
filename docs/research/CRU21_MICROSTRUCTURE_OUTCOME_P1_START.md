# CRU-21 P1 Phase 1｜BidAsk L5 + Outcome Event Contract

Status: **RESEARCH CANDIDATE / NOT EXECUTION / NOT FORMAL / NOT YET ENTIRE-CORPUS-ELIGIBLE**.

This independent research branch is based on PR87 exact `cf3d179b0d6d7d1a3a778a24bc51bfed294db41d`. PR89 official night cash-close remains a distinct Draft. No bridge, producer, source ledger, official 8787 or broker order changes.

## 2026-10-22 actual MSI read-only corpus audit

Source: approved runtime private immutable `live-events/YYYY-MM-DD.ndjson`, containing `futures_bidask` TX alongside MTX/TMF and ticks. Audit read only from existing source with 3 bounded 12 MiB blocks (head / middle / tail) per date, preserving partial-line boundaries.

| File date | Approx file size at sample | TX BidAsk sampled | Complete bid/ask price and volume arrays length 5 | Source/receipt time fields |
| --- | ---: | ---: | ---: | ---: |
| 2026-10-21 | 2,345,815,715 bytes | 5,950 | 5,950 | 5,950 |
| 2026-10-22 | 656,765,129 bytes (growing) | 3,668 | 3,668 | 3,668 |

The six blocks had 0 JSON parse errors in sampled complete lines. All sampled TX quote events had `bid_price`, `bid_volume`, `ask_price`, `ask_volume`, `diff_bid_vol`, `diff_ask_vol` length five, both top-of-book prices positive with Ask1>Bid1, `datetime`, `_received_at`, `actualContract` and `productFamily`. Envelope also records `exchangeTimestamp`, `receivedAt`, `sequence`, `sequenceGap`, `duplicate`, `clockSkewMs`, record hash, and order disabled flags.

Separate 8 MiB tail sample on 2026-10-22: 871 TX BidAsk events; all 871 passed the **candidate event-level gate** (not corpus eligibility). Spread histogram in ticks with tickSize=1: 2→104, 3→210, 4→219, 5→325, 6→13; 0 observed duplicates, sequence-gap flags, simtrade true or >5 sec clock skew in this sample. This doesn't prove a continuous order book in unsampled intervals.

**Material limitation:** raw TX BidAsk payload does **not** itself include authoritative `tradeDate` / `session` fields; they must come from separately verified governed session/calendar classification. This first project exposes only a projection that **requires** those arguments; it is not currently wired to live UI or forward trading. Also perform full ledger continuity, order-of-events, reconnect/sequence gaps, timestamps, missing quotes, rollover and as-of joins to Tick/price before OOS. Sampling must never become 100% historical coverage claim.

Existing CRU34 pressure projection intentionally copies only Bid1/Ask1 in some joins; that **does not** mean raw full L5 is absent.

## New P1 source module

`src/microstructure-outcome-research-v1.mjs`: `projectGovernedL5` reads exactly the existing governed `futures_bidask` envelope; validates TX+contract+as-of received/exchange times and clock skew, no simtrade/duplicate/sequenceGap, all five price/volume levels, strictly ordered sides, tick-size aligned uncrossed spread and nonzero total depth. Outputs only `spreadTicks`, L1/L5 displayed depth and `imbalance5` from same data. No buy/sell direction label, no order signal. Invalid or missing inputs fail closed to null, not zero.

`freezeOutcomeCandidate`: independent immutable observation with `eventId`, `observationKind`, contract, trading date, session, `asOfAvailableAt`, `lastSourceAvailableAt`, reference price and frozen rules SHA256. It refuses future-available sources and invalid dates. All after-event results are initially null (MFE, MAE, time-to extrema, netPoints, EV). **No trade PnL is claimed** until a separate outcome table, frozen executable rules, approved slippage/fee conventions, complete price path and OOS tests exist.

Seven targeted tests exercise projection, bad data, future leakage and frozen outcome; **7 PASS / 0 FAIL** after a real test caught and fixed illegal calendar date acceptance.

## Subsequent packages (not yet delivered)

1. Whole-corpus day/night acquisition coverage and quote-to-trade as-of joins; no instrument/session/contract contamination.
2. Frozen Pressure × Price Response candidates followed by separate forward outcome labels (continuation / blocked / reversal); do not name institutional absorption from observations.
3. Add L1/L5 Liquidity / Spread / Imbalance and quantify incremental OOS benefit relative to Flow-only. Prioritize NO_CHASE and data-quality abstention.
4. `TREND_CANDIDATE` / `RANGE_CANDIDATE` / `UNCERTAIN` Market State from **only contemporaneously known data**; No-Trade gates optimize tail risk and cost-adjusted EV with retained coverage.
5. Persist MFE/MAE, time to extrema, first-touch ambiguity and net costs only after separate outcomes mature; stress tests, purged chronological OOS and walk-forward before paper trading.

All research outputs retain `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`. No production cutover.
## 2026-10-22 P1 independent review remediation (before any model use)

CI #302 first attempt failed from an existing real-Chromium test timing out after 12,000 ms; unchanged-head second attempt passed, **both attempt records are retained**. Independent Codex reviewed initial `e37c06a` and found six P1 issues in this isolated research candidate:

1. Real `sequenceGap` is a numeric count; reject positive counts, booleans, null, malformed input.
2. Source exchange timestamps without offset are interpreted with governed **Asia/Taipei +08:00**, not runner-local timezone; receipt/as-of require explicit offset.
3. Use `classifyTxChartSession` with the approved TAIFEX calendar to derive/verify session, trading day and sessionId rather than trusting caller labels. Frozen Outcome also requires eventExchangeTimestamp and calendar.
4. Prices must be scalar positive finite values; each displayed volume must be scalar nonnegative safe integer; booleans/arrays/whitespace/fractional quantities refused.
5. Gregorian timestamp dates and clock components are parsed strictly, including Feb 30, hour 25, invalid timezone offsets; no Date.parse normalization.
6. Event ID, contract, frozen-rules hash are primitive validated strings, so Object.freeze cannot retain caller-owned mutable identity objects.

New unit tests exercise these production-shaped negative controls and genuine calendar fixture; no live deployment. Re-read 2026-10-22 private ledger 8MiB tail after fixes: **771/771** TX quote sample events passed event-level eligibility using validated calendar/sequence/strict source-time semantics; spread tick histogram 1:6, 2:75, 3:161, 4:306, 5:209, 6:14. Still **not** continuous full-corpus/OOS evidence.

Next: frozen Flow × price-response candidate and as-of Market State/No-Trade exploratory gates, with separate future-outcome labels; remain entirely research-only with no trading weights.
