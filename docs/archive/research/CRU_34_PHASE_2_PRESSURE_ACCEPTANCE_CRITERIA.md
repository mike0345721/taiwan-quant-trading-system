# CRU-34 — Phase 2 Pressure Acceptance Criteria

Phase 2 passes only when the implementation and focused tests prove all of the following:

1. BUY/SELL/UNKNOWN executed volume are deterministic from provider `tick_type`.
2. UNKNOWN is preserved and included in total executed volume but excluded from the pressure-ratio denominator.
3. `pressureRatio` is bounded to `[-1, 1]` and unavailable when classified volume is zero.
4. `classifiedCoverage` is explicit and never renamed confidence/probability.
5. Best-quote cross-check uses only Phase-1 legal quote eligibility.
6. A physically later, delayed, future-event, stale, wrong-identity, wrong-epoch, or lineage-invalid quote cannot classify a Tick.
7. Best-quote evidence remains separate from provider classification.
8. Provider/book conflict is counted and preserved.
9. Low coverage does not silently become a qualitative strength/control conclusion.
10. Identical legal ledger prefix produces identical pressure output.
11. Safety invariants remain `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`.

No relative-strength percentile, `強/中/弱`, Market Control, Absorption, Market State, strategy or execution output is permitted in Phase 2.
