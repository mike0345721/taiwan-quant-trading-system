# Market State V1 — Historical Premarket Dry Run

> Work package: CRU-14  
> Status: IMPLEMENTATION / RESEARCH ONLY  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Produce deterministic historical Premarket Market State records from the governed research database without changing T0, P0, Frozen Artifacts, broker routes, or live collection.

## Direction aggregation

- at least two bullish blocks and no bearish block → `BULLISH`
- at least two bearish blocks and no bullish block → `BEARISH`
- at least one bullish and at least one bearish block → `CONFLICT`
- otherwise, with at least two usable blocks but insufficient conviction → `NEUTRAL`
- fewer than two usable directional blocks → `UNAVAILABLE`

`CONFLICT` is reserved for genuine opposing bullish + bearish evidence.

## Final corrected validation

Code-validated head: `201fc060075434f20bbe9addaf1ab0312126857b`

- tests 15/15 PASS
- 753 records
- `futureDataViolations=0`
- deterministic record digest `70ce30a7ab0fc055f0daddf4a3639e25af97418cbadd19facc7b758ad8a98836`
- Direction BULLISH 231 / BEARISH 189 / NEUTRAL 116 / CONFLICT 216 / UNAVAILABLE 1
- `falseConflictCount=0`
- T0/P0/Frozen zero change
- `executionAuthorized=false`

## Governance

`ELEVATED` remains a research-draft Risk-axis value, not a canonical product `riskState`, unless explicitly approved by the Product Owner.
