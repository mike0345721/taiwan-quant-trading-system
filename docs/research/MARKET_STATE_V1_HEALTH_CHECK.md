# Market State V1 — State Health Check

> Work package: CRU-15  
> Status: RESEARCH DIAGNOSTIC  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Validate Market State structure before any future-outcome linkage. This gate is outcome-blind and must not consume next-day return, opening gap, large-move labels, downside-tail labels, Trend-Day/Range-Day outcomes, first-60m persistence, or PnL.

## Core checks

- state reachability
- transition matrix
- stay/change rates
- run-length persistence
- Direction conflict decomposition
- Trend UNCLEAR decomposition
- missing/warmup/input-quality decomposition
- deterministic health digest

## Core coverage comparable subset

The secondary subset requires accepted `localPricePersistence`, `twseBreadth`, and `foreignCashFlow`.

This is diagnostic only. It is not a trading filter or outcome-selected sample.

**Continuity rule:** excluded source trading records break continuity. State counts may use all comparable records, but transitions and runs must not bridge across excluded source records. The report exposes `contiguousSegments` and `adjacentComparablePairs` for auditability.

## Risk-axis governance

`ELEVATED` remains a research-draft Risk-axis value. It is not a canonical product `riskState` unless explicitly approved by the Product Owner.

## Boundary

`outcomeFieldsConsumed=[]`, `thresholdOptimizationPerformed=false`, `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`. No T0/P0/Frozen, broker/order route, collector deployment, Strategy Permission, or Risk Veto changes are authorized.
