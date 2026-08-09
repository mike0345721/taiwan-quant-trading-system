# Market State V1 — State Health Check

> Work package: CRU-15  
> Status: RESEARCH DIAGNOSTIC  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Before linking Market State to any future market outcome, validate that the state machine itself is structurally usable and explainable.

This gate is outcome-blind. It must not consume next-day return, opening gap, large-move labels, downside-tail labels, Trend-Day / Range-Day outcomes, first-60m persistence, or strategy PnL. No threshold may be changed because a downstream outcome looks better or worse.

## Inputs

CRU-15 consumes only CRU-14 historical Market State records and does not query SQLite directly.

## Checks

- reachability for every state axis;
- transition matrix and stay/change rates;
- run lengths and per-state persistence;
- Direction conflict vote-pattern decomposition;
- Trend UNCLEAR decomposition;
- missing/warmup/input-quality decomposition;
- evidence coverage;
- deterministic health digest.

## Core coverage comparable subset

A secondary diagnostic subset requires accepted:

- `localPricePersistence`
- `twseBreadth`
- `foreignCashFlow`

This is **not** a trading filter or outcome-selected sample.

Excluded source records create continuity breaks. The subset may use all comparable records for state counts, but transition/run statistics must not bridge across an excluded source trading record. The report exposes `contiguousSegments` and `adjacentComparablePairs` so continuity is auditable.

## Risk-axis governance note

`ELEVATED` remains a research-draft value in the current experiment. It is **not** promoted here as a canonical product `riskState`. Canonicalization requires an explicit Product Owner decision. Until then, it must not be treated as an approved Risk Engine schema or execution permission.

## Determinism

The same `records.json` must produce the same `healthDigest`.

## Explicit boundary

CRU-15 does not use outcomes to tune Market State, modify T0/P0/Frozen Artifacts, install collectors or Windows tasks, create broker/order routes, or authorize Strategy Permission, Risk Veto, paper execution, or live execution.

After this gate passes, a separate descriptive outcome-linkage work package may compare pre-specified Market State categories with pre-specified future outcomes. Any threshold change after outcome exposure requires a new explicit Owner decision and is a new hypothesis, not confirmation of the original definition.
