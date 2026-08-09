# Market State V1 — Implementation Milestone 1

> Work package: CRU-12 / CRU-13  
> Status: RESEARCH ONLY  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Delivered

1. EOD / Premarket semantics specification.
2. High-value intraday data collection specification.
3. Pure `evaluatePremarketMarketState` evaluator with no SQLite, broker, paper-trading or strategy dependency.
4. Past-only percentile helper with minimum-history gate.
5. Canonical market-state collection record validator.
6. Unit tests for execution boundary, availableAt filtering, Direction/Risk separation, conflict handling, global mixed state, hard risk, percentile history gate and collection provenance/time/hash rules.

## Deliberately not delivered

- no SQLite adapter;
- no historical dry-run;
- no collector process;
- no Windows scheduler changes;
- no T0/P0 changes;
- no Strategy Permission or Risk Veto integration;
- no broker/order route;
- no live execution.

## Local verification gate

Before merge, Codex should validate the branch in an isolated worktree or equivalent safe checkout and report:

1. targeted Market State tests pass;
2. full root `npm test` passes or any unrelated pre-existing failures are clearly identified;
3. no tracked files outside this branch diff are modified;
4. no T0/P0/Frozen Artifact change;
5. `executionAuthorized=false` remains enforced.

## Next engineering milestone after approval

If this milestone passes Owner Review, the next implementation step is a read-only SQLite evidence adapter and historical dry-run that generates explainable Premarket Market State rows without changing any strategy or paper-trading behavior.
