# Market State V1 — State Health Check

> Work package: CRU-15  
> Status: RESEARCH DIAGNOSTIC  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Before linking Market State to any future market outcome, validate that the state machine itself is structurally usable and explainable.

This gate is deliberately outcome-blind. It must not consume next-day return, opening gap, large-move labels, downside-tail labels, Trend-Day / Range-Day outcome labels, first-60m persistence, or strategy PnL. No threshold may be changed because a downstream outcome looks better or worse.

## Inputs

CRU-15 consumes only the historical Market State records produced by CRU-14. The health checker does not query SQLite directly.

## Checks

### Reachability
For each axis, report observed and unobserved states. An unobserved state is evidence about the current evidence set; it is not automatically a bug and must not be fabricated.

### Transition matrix
For each axis report from-state → to-state counts, stay/change counts and rates.

### Run length
For each axis report number of runs, longest run, 1/2/3/4/5+ buckets, and per-state mean run length.

### Conflict decomposition
For Direction `CONFLICT`, retain evidence-block vote patterns. `CONFLICT` must represent genuine bullish + bearish opposition, not insufficient conviction.

### UNCLEAR decomposition
For Trend `UNCLEAR`, report Local Price trend and Breadth direction context.

### Missing / warmup decomposition
Flatten unavailable evidence by evidence key, unavailable reason, and input quality state.

### Core coverage comparable subset
Report a secondary coverage-only subset where all of these evidence items are accepted:

- `localPricePersistence`
- `twseBreadth`
- `foreignCashFlow`

This subset is diagnostic only. It is not a trading filter, strategy permission, or outcome-selected sample.

Important continuity rule: excluded source records create a break. Transition counts and run lengths must **not** connect two comparable records across an excluded trading record. The report includes `contiguousSegments` and `adjacentComparablePairs`. State counts may use all comparable records, but persistence/transition statistics only use truly adjacent source records.

## Risk-axis governance note

`ELEVATED` remains a research-draft state used by the current Market State experiment. It is **not** promoted here as a canonical product `riskState` value. Canonicalization of `ELEVATED` requires an explicit Product Owner decision. Until then, this health report may describe it, but it must not be treated as an approved Risk Engine schema or execution permission.

## Determinism

The same `records.json` must produce the same `healthDigest`.

Default output: `data/research/market-state-v1-health-check/v0/` with `health-report.json` and `manifest.json`.

## Explicit boundary

CRU-15 does not use outcomes to tune Market State, modify T0/P0/Frozen Artifacts, install collectors or Windows tasks, create broker/order routes, or authorize Strategy Permission, Risk Veto, paper execution, or live execution.

After this health gate passes, a separate descriptive outcome-linkage work package may compare pre-specified Market State categories with pre-specified future market outcomes. Any threshold change after outcome exposure requires a new explicit Owner decision and must be treated as a new hypothesis, not as confirmation of the original state definition.
