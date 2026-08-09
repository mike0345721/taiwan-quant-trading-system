# Market State V1 — State Health Check

> Work package: CRU-15  
> Status: RESEARCH DIAGNOSTIC  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Before linking Market State to any future market outcome, validate that the state machine itself is structurally usable and explainable.

This gate is deliberately outcome-blind. It must not consume:

- next-day return;
- opening gap;
- large-move labels;
- downside-tail labels;
- Trend-Day / Range-Day outcome labels;
- first-60m persistence;
- strategy PnL.

No threshold may be changed because a downstream outcome looks better or worse.

## Inputs

CRU-15 consumes only the historical Market State records produced by CRU-14.

The health checker does not query SQLite directly and does not modify Market State semantics.

## Checks

### 1. Reachability

For each axis, report observed and unobserved states.

An unobserved state is evidence about the current evidence set; it is not automatically a bug and must not be fabricated.

### 2. Transition matrix

For each axis:

- from-state → to-state counts;
- stay count;
- change count;
- stay rate;
- change rate.

This measures whether a state is stable enough to be meaningful or merely flips every session.

### 3. Run length

For each axis:

- number of runs;
- longest run;
- run-length buckets 1 / 2 / 3 / 4 / 5+;
- per-state run count and mean run length.

### 4. Conflict decomposition

For Direction `CONFLICT`, retain the evidence-block vote pattern, for example:

```text
breadth=BEARISH | localPrice=BULLISH
```

The purpose is to understand what kind of disagreement creates conflict, not to remove conflict because it is frequent.

### 5. UNCLEAR decomposition

For Trend `UNCLEAR`, report the Local Price trend and Breadth direction context that produced it.

This helps distinguish:

- genuine price/breadth disagreement;
- insufficient local history;
- neutral / mixed structure.

### 6. Missing / warmup decomposition

Flatten unavailable evidence by:

- evidence key;
- unavailable reason;
- input quality state.

This separates semantic uncertainty from data availability problems.

## Determinism

The same `records.json` must produce the same `healthDigest`.

Default output:

```text
data/research/market-state-v1-health-check/v0/
```

Files:

- `health-report.json`
- `manifest.json`

## Explicit boundary

CRU-15 does not:

- modify PR #6 state thresholds;
- use outcomes to tune Market State;
- modify T0/P0/Frozen Artifacts;
- install collectors or Windows tasks;
- create broker/order routes;
- authorize Strategy Permission, Risk Veto, paper execution, or live execution.

After this health gate passes, a separate descriptive outcome-linkage work package may compare pre-specified Market State categories with pre-specified future market outcomes. Any threshold change after outcome exposure requires a new explicit Owner decision and must be treated as a new hypothesis, not as confirmation of the original state definition.
