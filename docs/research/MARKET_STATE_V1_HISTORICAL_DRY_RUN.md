# Market State V1 — Historical Premarket Dry Run

> Work package: CRU-14  
> Status: IMPLEMENTATION / RESEARCH ONLY  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Produce deterministic historical Premarket Market State records from the existing governed research database without changing T0, P0, Frozen Artifacts, broker routes, or live collection.

This work package tests whether the Market State semantics can be materialized consistently across the existing historical coverage. It does not certify predictive edge and does not authorize strategy filtering.

## Source-of-truth reuse

CRU-14 reuses the existing Phase A canonical feature layer instead of inventing a second historical-data interpretation.

The canonical layer remains responsible for:

- prior-trading-day alignment;
- `decisionAt`;
- `availableAt` legality;
- option-contract selection;
- global-market source dating;
- source quality states;
- past-only transforms.

The historical adapter opens `v2/data/research-v2.sqlite` read-only and reads the same source tables already used by Phase A.

## V0 evidence mapping

### Local Price

Uses five-observation TAIEX + TX return context from canonical Phase A transforms.

- both positive → `BULLISH`, `TREND_UP`
- both negative → `BEARISH`, `TREND_DOWN`
- disagreement → `NEUTRAL`, `UNCLEAR`

This is descriptive persistence context, not a forecast.

### Breadth

Uses canonical TWSE advance/decline balance.

The canonical balance is:

`(advancers - decliners) / (advancers + decliners)`

Therefore the product draft breadth-ratio cutoffs 60% / 40% are equivalent to balance +0.20 / -0.20.

### Institutional

Foreign cash flow uses a distinct-source-date, past-only empirical percentile:

- up to 252 prior eligible observations;
- minimum 60 prior observations;
- current observation excluded.

### Futures Positioning

Uses descriptive price/OI context and existing rollover/contract-quality evidence.

No price/OI label is treated as proof of participant identity. Contract-change / rollover rows must not receive an unqualified directional OI vote.

Basis is emitted as past-only relative context and has no direct directional vote in V0.

### Options

ATM IV and 25D Skew use past-only percentiles.

- ATM IV contributes to Volatility and Risk only.
- Skew contributes to Risk only.
- OI PCR and Volume PCR remain separate descriptive contexts.
- Call / Put OI totals are exposed raw; no new concentration score is invented.

### Global / FX

`NDX_PROXY` and SOX are collapsed into one correlated US-growth evidence item.

USD/TWD is a separate FX-context item.

VIX remains `UNAVAILABLE` in historical V0 while `macro_observations` lacks a governed publication/retrieval timestamp. Observation date alone is insufficient for legal premarket use.

## Output

Each daily record contains:

- trade date;
- decision timestamp;
- five Market State axes;
- block evidence;
- raw input trace;
- source table / source contract;
- source trade date;
- `availableAt`;
- unavailable reasons;
- conflicts;
- research/execution boundary fields.

Default local output:

`data/research/market-state-v1-historical-dry-run/v0/`

Files:

- `records.json`
- `summary.json`
- `manifest.json`

The manifest exposes a deterministic `recordDigest`.

## Acceptance gate

Before Owner Review:

1. targeted unit tests PASS;
2. local read-only dry run completes on the real `research-v2.sqlite`;
3. `futureDataViolations=0`;
4. repeated run produces the same `recordDigest`;
5. state / evidence coverage is reported honestly;
6. no T0/P0/Frozen changes;
7. no broker/order route or live collector changes;
8. no PnL tuning or state-threshold optimization.

## Explicitly deferred

- true NQ futures intraday;
- intraday USD/TWD;
- official TAIEX constituent weights and true TSMC/Top-10 contribution;
- forward TXO IV/Skew collector deployment;
- true aggressor CVD promotion;
- Strategy Permission / Risk Veto integration;
- live or automated execution.
