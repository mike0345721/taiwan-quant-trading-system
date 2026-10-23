# Research UI, fixed-event Outcome and paired OOS replay

Base: PR95 `df38282b98d8e9cd96ad127dbf5020cd8fc5ada2`. Separate candidate branch; no change to PR93/94 UI branch, runtime, collector, raw ledger, credentials or frozen research. `researchOnly=true`, `formalWeight=0`, `executionAuthorized=false`, `orderRoutesEnabled=false` throughout.

## Delivered engineering interfaces

- Dashboard Flow card links to `/research.html`. `/api/v1/research-evidence` uses the existing normal session requirement and no-store response. Public HTML contains no private data. No new login flow or bypass.
- Latest TX BidAsk is read from at most 1 MiB of today's existing ledger, with its descriptor closed immediately and its original record hash verified. No collector is started. Source/receipt/as-of order uses nanoseconds; source age must be <=5 seconds. Five levels, actual contract, calendar/session, simtrade, duplicate and sequence checks remain mandatory.
- Flow and price response use the existing governed projection. Each component must be ready, fresh and same current calendar session. Flow additionally needs 100% classified coverage. Missing/stale values become unavailable, never zero. Browser checks age locally every second and refreshes every four seconds only while visible and a successful session response exists; request failure clears prior values.
- `resolveResearchOutcome` computes full captured-horizon gross MFE/MAE and timestamps, separate excursions until rule exit, endpoint and rule-exit P&L after costs, and mechanical failure tags. `realizedPnl=null`: these are hypothetical replay fills, never broker fills or causal explanations.
- `compareResearchVariants` compares baseline, depth-only gate, no-trade-only gate and both gates on exactly the same predeclared dates. Skipped eligible trades contribute zero P&L and no cost; missing evidence blocks the entire comparison. The depth factor is a predeclared directional-imbalance filter, not a trained prediction model.

## Scope and evidence limits

Only TX futures are supported (TXF actual contracts, TWD 200/point). No claim is made for stocks, MTX, TMF or options. The existing project brand does not make a TX rule applicable to equities.

Capture quality, preregistration time, prior access to a holdout and the provenance of an external audit cannot be authenticated by a self-supplied JSON flag or SHA. The caller must supply independently checked, immutable source/capture and preregistration receipts. Content hashes bind the supplied records and detect edits; they are not signatures or proof of exchange-complete capture. A successful replay always retains `positiveEvProven=false` and `freshForwardHoldoutVerified=false`. Engineering fixtures explicitly simulate these contracts and are never real research evidence.

No complete qualified fixed-signal corpus is bundled. The template is deliberately blocked. Older PR90 sampled lower-bound outcomes cannot be relabelled as complete paths. Current original data may be useful for exploratory reconstruction, but previously examined history cannot become an untouched holdout.

## Outcome convention

Signal and rules are fixed before observation of future outcomes. Entry is the first observed tick strictly after the signal. Extrema are measured from that entry reference through the fixed signal horizon; MFE and MAE are nonnegative magnitudes, **before costs**. The first tick reaching stop/target triggers an assumed exit at that tick price, including adverse gap-through, plus frozen adverse slippage. Otherwise exit is the last observed price at or before the horizon. The next bounding tick verifies time coverage but is excluded from horizon extrema and endpoint price. Same-session capture must bound both sides with no >frozen max-gap interval. This is captured-path completeness conditional on the external capture audit, not a market-wide completeness proof.

The separate rule-exit and endpoint net P&L both deduct two fees, adverse slippage on both sides and tax on each slipped notional. All costs are explicit frozen inputs; no user's negotiated commission is guessed. Conservative per-side tax rounding is `CEIL_TWD_PER_SIDE`, not a claim about broker bill reconciliation.

`maxNetLiquidationPoints` / `minNetLiquidationPoints` separately report the best/worst signed net mark if liquidated at each observed horizon tick under the same frozen costs. These are not clamped to zero and can both be negative. Currency amounts always represent one TX contract (`sizeContracts=1`).

Official sources checked 2026-10-23: [TX contract value](https://www.taifex.com.tw/cht/2/tX?menuid1=12), [TAIFEX fee/tax schedule](https://www.taifex.com.tw/cht/4/feeSchedules?menuid1=12), [Ministry of Finance tax rate](https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-saving-manual/national/future-transaction-tax/12B2ODn). TX point value is TWD 200; stock-index futures tax is 0.00002 of contract amount per side. This implementation is versioned for that convention; different dates/rules need a new reviewed convention.

Mechanical failure tags: `STOP_HIT`, `COST_ERASED_GROSS_GAIN`, `ADVERSE_OR_FLAT_EXIT`, `TARGET_NOT_REACHED_WITHIN_HORIZON`. They describe observed rule outcomes, not why a market moved. Actual fills and causal attribution remain unavailable.

## Frozen input contract

`digest` is SHA256 of JSON with recursively sorted object keys; array order is preserved. `seal(body) = {...body, sha256:digest(body)}`. Keep receipt files immutable and versioned separately.

Top-level input: `rules`, `protocol`, `events`.

`rules` is sealed and includes:

- `schemaVersion=tx-replay-rules-v1`, `frozenAt` (explicit time zone), `horizonMs` (1s..1h), `maxGapMs` (1..5000).
- Positive `stopPoints`, `targetPoints`, `feeTwdPerSide`; `pointValueTwd=200`, integer `slippageTicksPerSide>=1`, `tickSize=1`, `taxRatePerSide=0.00002`, `taxRounding=CEIL_TWD_PER_SIDE`, nonempty documented `costSource`.

Each event has `foldId`, `signal`, `tape`, `coverage`.

`signal`: unique `eventId`, actual `actualContract`, `tradeDate`, `session`, `side=LONG|SHORT`, `signalAvailableAt`, `featureAvailableAt`, `rulesSha256`, safety flags. Features must be available before the signal and <=5s old. `features` includes `quality=READY`, `classifiedCoverage=1`, `actualContract`, `tradeDate`, `session`, `availableAt`, `imbalance5`, `spreadTicks`, `bidDepth5`, `askDepth5`, `realizedVolPoints`. They require a separate genuine as-of join and source audit; future outcomes must not be written into them.

`tape`: ordered captured ticks with `actualContract`, `exchangeTimestamp`, `availableAt`, unique original `recordHash`, positive on-tick `price`, `simtrade=false`, `duplicate=false`, `sequenceGap=0`. Include a boundary tick at/before the signal and at/after the horizon; no interpolation or fabricated fill rows. Source ordering, receipt ordering, submillisecond precision, session continuity and completeness are checked.

`coverage`: sealed `schemaVersion=tx-captured-path-audit-v1`, `sourceMode=REAL_CAPTURE`, `captureStatus=COMPLETE_VERIFIED`, `timestampViolations=0`, `sequenceGaps=0`, `droppedEvents=0`, `hashFailures=0`, `sourceSha256`, `auditReceiptSha256`, `calendarSha256`, `tapeSha256=digest(tape)`, `signalSha256=digest(signal)`, `rulesSha256`, `startAt`, `endAt`. Do not set these flags to true/zero merely to pass. The original source hash and external receipt must be independently verified first.

`protocol`: sealed `schemaVersion=tx-incremental-protocol-v1`, `frozenAt`, exact `outcomeRulesSha256`, matching `horizonMs`, `oosDates` (>=24 unique predeclared trading dates, exactly one fixed event per date), `blockLength=5`, `bootstrapDraws=5000`, >=3 disjoint chronological `folds`.

Each fold has unique `id`, `trainEndAt`, `trainOutcomeAvailableAt`, `frozenAt`, `testStartAt`, `testEndAt`, `embargoMs>=horizonMs`, and frozen `gates`: `minDirectionalImbalance` (0..1), positive `maxSpreadTicks`, nonnegative `minDepth5`, positive `maxRealizedVolPoints`. All training labels must be available before freeze; training labels plus embargo must end strictly before test. Full outcomes must be available by fold end. Each fold needs >=2 dates. Threshold selection uses training only; this runner does not select or tune using OOS.

## Risk, reward and uncertainty

Reports include net total/mean points, per-trade and per-eligible-day mean, retained count/coverage, peak-to-trough additive drawdown, worst day, worst 5% mean and daily standard deviation. No return % or annualized Sharpe without a predeclared capital denominator/exposure convention.

Five preplanned paired contrasts use a deterministic circular moving block bootstrap over chronological trading dates (5-date blocks, 5000 draws). 99% intervals per contrast give nominal Bonferroni 95% family coverage, conditional on block/stationarity assumptions. This is not certainty; serial dependence across blocks, few effective blocks and regime changes limit interpretation. <60 dates is explicitly LOW_SMALL_SAMPLE. Positive lower bounds are replay differences requiring fresh forward confirmation, never a promotion criterion. Risk changes and retention must be reviewed alongside mean changes.

## Re-run

Run from the isolated candidate, not the formal data root:

```powershell
New-Item -ItemType Directory -Force data/research-validation
Copy-Item research/outcome-oos-input-template.json data/research-validation/input.json
node scripts/run-research-outcome-oos.mjs data/research-validation/input.json data/research-validation/result.json
```

The untouched template intentionally exits 2 / BLOCKED with null metrics. Once genuine audited input exists, populate a new input file and use a new output filename; the CLI refuses overwrite (`wx`) and rejects paths outside the isolated real data root. `/research.html` reads the specifically reviewed `data/research-validation/result.json`. Keep all earlier result files and receipts; do not overwrite frozen evidence to improve a result.

Original-ledger inventory (read-only, bounded by file size at open, no output writes):

```powershell
node scripts/audit-research-ledger-stream.mjs 'D:/Taiwan stock/standalone-v1/data/live-events/2026-10-22.ndjson'
```

It checks the hash chain and counts timing/quality failures. Inter-event gaps include legitimate session breaks and low activity; do not infer every gap is data loss. This inventory deliberately never certifies full session capture. Collector drop/sequence telemetry, required session boundaries, correct contract/roll mapping and as-of Flow joins are still necessary.

Targeted tests: `node --test tests/research-*.test.mjs tests/dashboard-research-evidence.test.mjs tests/microstructure-outcome-research-v1.test.mjs tests/cru49-flow-http.test.mjs`. Browser tests use a fresh headless profile and synthetic transport; they do not substitute for normal-session live acceptance.

## Remaining acceptance

1. Obtain complete captured periods with zero unresolved time/sequence/drop defects and audited as-of features; retain all excluded periods/reasons.
2. Bind the actual fixed signals, entry/horizon/exit, commission/slippage and fold thresholds to immutable pre-outcome receipts. No actual signal/cost specification has been invented in this delivery.
3. Build a new genuine >=24-date, >=3-fold corpus, keep all predeclared dates, run net-cost comparisons and inspect uncertainty. Obtain genuinely new forward holdout after historical exploration.
4. Integrate this isolated candidate with the independently owned UI/calendar branch, then perform fresh normal-login Producer → API → browser acceptance. Current engineering HTML tests and stale real probe do not satisfy that gate.
5. Owner approval remains necessary for merge/deployment. Rollback is removal of this isolated candidate or return to exact base; no runtime switch happened.
