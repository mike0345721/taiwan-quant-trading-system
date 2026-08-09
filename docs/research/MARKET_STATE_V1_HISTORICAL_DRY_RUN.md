# Market State V1 — Historical Premarket Dry Run

> Work package: CRU-14  
> Status: IMPLEMENTATION / RESEARCH ONLY  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Produce deterministic historical Premarket Market State records from the existing governed research database without changing T0, P0, Frozen Artifacts, broker routes, or live collection.

This work package tests whether the Market State semantics can be materialized consistently across the existing historical coverage. It does not certify predictive edge and does not authorize strategy filtering.

## Source-of-truth reuse

CRU-14 reuses the existing Phase A canonical feature layer instead of inventing a second historical-data interpretation.

The canonical layer remains responsible for prior-trading-day alignment, `decisionAt`, `availableAt` legality, option-contract selection, global-market source dating, source quality states, and past-only transforms.

## V0 evidence mapping

### Local Price

Uses five-observation TAIEX + TX return context from canonical Phase A transforms.

- both positive → `BULLISH`, `TREND_UP`
- both negative → `BEARISH`, `TREND_DOWN`
- disagreement → `NEUTRAL`, `UNCLEAR`

When local persistence is `UNCLEAR` and breadth is `NEUTRAL`, the top-level descriptive Trend can be `RANGE`. This rule was defined before any outcome/PnL linkage.

### Direction aggregation

Direction uses block-level votes from Local Price, Breadth, Futures Positioning, and Institutional evidence.

- at least two bullish blocks and no bearish block → `BULLISH`
- at least two bearish blocks and no bullish block → `BEARISH`
- at least one bullish and at least one bearish block → `CONFLICT`
- otherwise, with at least two usable blocks but insufficient directional conviction → `NEUTRAL`
- fewer than two usable directional blocks → `UNAVAILABLE`

`CONFLICT` is therefore reserved for genuine opposing bullish + bearish evidence. A lone directional block surrounded by neutral evidence is not conflict.

### Breadth

Uses canonical TWSE advance/decline balance. The draft +0.20/-0.20 balance cutoffs correspond to 60%/40% breadth-ratio context.

### Institutional

Foreign cash flow uses a distinct-source-date, past-only empirical percentile with up to 252 prior eligible observations, minimum 60 prior observations, and the current observation excluded.

### Futures Positioning

Uses descriptive price/OI context and existing rollover/contract-quality evidence. No price/OI label is treated as proof of participant identity. Contract-change / rollover rows do not receive an unqualified directional OI vote. Basis is descriptive only and has no direct directional vote in V0.

### Options

ATM IV and 25D Skew use past-only percentiles. ATM IV contributes to Volatility/Risk only; Skew contributes to Risk only. OI PCR and Volume PCR remain separate descriptive contexts. Call/Put OI totals are exposed raw; no new concentration score is invented.

### Global / FX

`NDX_PROXY` and SOX are collapsed into one correlated US-growth evidence item. USD/TWD is a separate FX-context item. VIX remains unavailable while `macro_observations` lacks a governed publication/retrieval timestamp.

## Output

Each daily record contains trade date, decision timestamp, five Market State axes, block evidence, raw input trace, source table/contract, source trade date, `availableAt`, unavailable reasons, conflicts, and research/execution boundary fields.

Default local output: `data/research/market-state-v1-historical-dry-run/v0/`.

Files: `records.json`, `summary.json`, `manifest.json`. The manifest exposes a deterministic `recordDigest`.

## Final corrected validation

Code-validated head: `201fc060075434f20bbe9addaf1ab0312126857b`

- targeted tests: 15/15 PASS
- records: 753 (2023-07-04..2026-08-07)
- `futureDataViolations=0`
- repeated record digest: `70ce30a7ab0fc055f0daddf4a3639e25af97418cbadd19facc7b758ad8a98836`
- deterministic replay: PASS
- Direction: BULLISH 231 / BEARISH 189 / NEUTRAL 116 / CONFLICT 216 / UNAVAILABLE 1
- `falseConflictCount=0`
- T0/P0/Frozen zero change
- `executionAuthorized=false`

The branch head may be newer because of documentation-only commits; those do not supersede the code validation unless evaluator/historical code changes.

## Explicitly deferred

- true NQ futures intraday;
- intraday USD/TWD;
- official TAIEX constituent weights and true TSMC/Top-10 contribution;
- forward TXO IV/Skew collector deployment;
- true aggressor CVD promotion;
- Strategy Permission / Risk Veto integration;
- live or automated execution.
