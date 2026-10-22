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

## 2026-10-22 P1 Phase 2–3 provisional executable research contracts

Added `src/pressure-response-market-state-research-v1.mjs` and `src/outcome-observed-path-research-v1.mjs` (all **pure, read-only**). No production wires, model requests, broker calls, charts, database migrations, forward execution or order routes.

**Pressure × Price Response:** `sealResearchThresholds` requires a complete, explicit, hashed, immutable scenario-threshold object (never default/automatically tuned). `describeFlowPriceResponse` requires source/price response READY, contract/date/session agreement, governed official calendar, contemporaneous timestamps and 100% classified pressure coverage; labels are `BUY_PROGRESS_CANDIDATE`, `SELL_PROGRESS_CANDIDATE`, `BUY_PRESSURE_BLOCKED_CANDIDATE`, `SELL_PRESSURE_BLOCKED_CANDIDATE`, `PRESSURE_PRICE_MISMATCH_CANDIDATE`, low-pressure high-efficiency candidates and `UNCERTAIN`. They are **descriptive hypotheses**, NOT market-control/absorption claims or evidence of forward returns.

**Market State / No-Chase:** `describeMarketStateNoTrade` requires an identically frozen as-of event, quality-valid market RV/path efficiency and fresh five-level quote projection with same calendar/contract/session. Outputs `TREND_CANDIDATE` / `RANGE_CANDIDATE` / `UNCERTAIN` and separate `NO_CHASE_LIQUIDITY_CANDIDATE` / `HIGH_VOLATILITY_SKIP_CANDIDATE` / `NONE_PROPOSED`. Missing/off-time/mismatched sources => `UNAVAILABLE`, never “no risk.” Thresholds in synthetic tests are **demonstration values only**, not calibrated or deployed.

**Outcome path:** `observePostEventPricePath` writes a **separate** future-evidence record from sorted later ticks, with verified contract/calendar/safe clock and gap rejection. Maximum favorable/adverse excursions are explicitly `mfeLowerBoundPoints` / `maeLowerBoundPoints`; they are **lower bounds from observed samples**, not complete-horizon MFE/MAE, fills, stops, net R, EV or a diagnosed failure cause. Without continuously audited historical ticks and frozen fill/fee/stop/target rules, `pathCoverage='UNVERIFIED'`, `futureLabelCertified=false`, `netPoints/netR/ev/tradeFailureCause=null`. No future outcomes are written into immutable as-of features.

### Live source qualification (13:04 Taiwan, 2026-10-22)

A read-only parse of the existing approved CRU34 producer snapshot reports LIVE, TXFK6, 2026-10-22 DAY. The six windows show classified coverage:
- 1m **0.953125**
- 5m **0.9674952198852772**
- 15m **0.9716494845360825**
- 30m **0.9736537348002317**
- 1h **0.9779947537161178**
- 4h **WARMING_UP / no comparable ratio**

Price response and efficiency are READY in five shorter windows but their pressure is `QUALITY_INSUFFICIENT` due to `PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE`. The new Flow × Response gate **must refuse** declaring directional confirmation from these actual inputs. This is a concrete barrier to an OOS positive-EV claim, and will not be silently overridden.

Research next before strategy: build full-day immutable BidAsk/tick continuity and as-of joins; source-resolved Flow classifications with timestamps; chronological future-label corpus (session cutoff/gaps/simtrade/rollover), frozen costs/entry/stop/target; validation/OOS/walk-forward; measure incremental improvement of L5 against Flow-only, then forward paper. `formalWeight=0`, `executionAuthorized=false` remain.

## 2026-10-22 P1 exact-head independent review and as-of join audit

CI #304 on `d5692028e1a618fb6ef6a21c685891a4bff0540c` passed **1,453 tests, 0 failures, 9 existing skips**, but an independent review surfaced three material time/window defects in newly authored research-only modules. They were not waived:

- A source exchange timestamp after its receipt was previously accepted when its difference was below `maxAgeMs`: strict chronology now requires `exchangeTime <= receivedAt <= decisionAsOf`.
- Pressure and Price Response now **must** declare matching `windowMs`, `windowStartAt`, `windowEndAt`, and the same positive `cutoffLedgerOrdinal`; window length and end-before-as-of are verified and the matched window identity is retained in the candidate.
- Higher-resolution ticks may legitimately share a millisecond. The separate lower-bound path observer now preserves submillisecond precision; identical exact source timestamps are allowed only with distinct ledger IDs in chronological receipt order. Missing IDs or duplicate IDs fail closed. This still does NOT certify full-horizon MFE/MAE or PnL.

New deterministic tests cover future-source/old-receipt, 1-minute-vs-4-hour false alignment, distinct sub-ms ticks / tied exact timestamps, and reference/identity tampering. Synthetic thresholds remain uncalibrated and cannot be promoted.

**Bounded original-ledger as-of join audit** on the 2026-10-22 TX DAY original immutable `live-events` (sample time 13:08 Taiwan): three disjoint **12 MiB** head/middle/tail regions, 3,882 eligible TX BidAsk quote events and **800 sampled TX ticks**. Within these windows all **800/800 ticks** were joined to a preceding eligible same-contract/same-governed-session quote by append order, receipt `quote.availableAt <= tick.receivedAt` and quote age <=5 seconds; 0 observed missing-prefix/stale/future quote/cross-session/gap flags. Quote age median by window 5ms / 101ms / 121ms, P95 135ms / 135ms / 251ms. Private immutable audit report SHA256 `16520cd1f42ae745abfa683cb68c2730f8ff6b281f8b746e5de9e13a76aab2a6`, private gitignored path `data/research-microstructure-outcome-20261022-p1-evidence/bounded-l5-tick-asof-alignment.json`.

**Interpretation:** Samples show L5 fields and as-of quote→tick joins are technically feasible *without a new collector*. They do **not** establish unsampled gaps, a full session capture, alignment to historical `Flow` aggregate windows, statistical forecast gains, slippage costs, EV or external execution rights. The actual 13:04 CRU34 flow still had classified coverage <100%, so source qualification and forward corpus collection remain prerequisites.
