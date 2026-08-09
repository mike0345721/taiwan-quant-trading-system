# Market State V1 — State Health Check

CRU-15 validates Market State structure before outcome linkage.

The gate is outcome-blind: no next-day return, gap, large-move, downside-tail, Trend-Day/Range-Day, first-60m, or PnL fields may be consumed.

## Core coverage comparable subset

Requires accepted `localPricePersistence`, `twseBreadth`, and `foreignCashFlow`.

This subset is diagnostic only. Excluded source trading records create continuity breaks: state counts may use all comparable records, but transitions and run lengths must not bridge across an excluded record. `contiguousSegments` and `adjacentComparablePairs` make this auditable.

After the continuity fix, the prior core transition/run metrics and prior health digest are superseded. Re-run targeted tests and the health checker twice on the same regenerated CRU-14 records before review readiness.

## Governance

`ELEVATED` remains a research-draft Risk-axis value, not a canonical product `riskState`, unless explicitly approved by the Product Owner.

`outcomeFieldsConsumed=[]`, `thresholdOptimizationPerformed=false`, `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`.
