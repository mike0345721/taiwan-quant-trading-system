# Market State V1 — Historical Premarket Dry Run

> Work package: CRU-14  
> Status: IMPLEMENTATION / RESEARCH ONLY  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Produce deterministic historical Premarket Market State records from the existing governed research database without changing T0, P0, Frozen Artifacts, broker routes, or live collection.

This work package tests whether Market State semantics can be materialized consistently across historical coverage. It does not certify predictive edge and does not authorize strategy filtering.

## Direction aggregation

Direction uses block-level votes from Local Price, Breadth, Futures Positioning, and Institutional evidence.

- at least two bullish blocks and no bearish block → `BULLISH`
- at least two bearish blocks and no bullish block → `BEARISH`
- at least one bullish and at least one bearish block → `CONFLICT`
- otherwise, with at least two usable blocks but insufficient conviction → `NEUTRAL`
- fewer than two usable directional blocks → `UNAVAILABLE`

`CONFLICT` is reserved for genuine opposing bullish + bearish evidence. A lone directional block surrounded by neutral evidence is not conflict.

## Final corrected validation

Code-validated head: `201fc060075434f20bbe9addaf1ab0312126857b`

- tests: 15/15 PASS
- records: 753 (2023-07-04..2026-08-07)
- `futureDataViolations=0`
- repeated record digest: `70ce30a7ab0fc055f0daddf4a3639e25af97418cbadd19facc7b758ad8a98836`
- deterministic replay: PASS
- Direction: BULLISH 231 / BEARISH 189 / NEUTRAL 116 / CONFLICT 216 / UNAVAILABLE 1
- `falseConflictCount=0`
- T0/P0/Frozen zero change
- `executionAuthorized=false`

Subsequent commits on this branch are documentation-only unless explicitly stated otherwise.

## Governance

The current experiment may emit `ELEVATED` in its research Risk axis. This remains a research-draft value and is not promoted by CRU-14 as a canonical product `riskState` without explicit Product Owner approval.

## Explicitly deferred

- true NQ futures intraday
- intraday USD/TWD
- official TAIEX constituent weights and true TSMC/Top-10 contribution
- forward TXO IV/Skew collector deployment
- true aggressor CVD promotion
- Strategy Permission / Risk Veto integration
- live or automated execution
