# CRU-34 — Phase 1 Lineage Acceptance

Status: **PHASE 1 PASS / RESEARCH ONLY**  
Linear: **CRU-34**  
Approved base main: `1c7f83934a8b046f5456eb2e44dc9f2c92aeff7f`

## Scope completed

Phase 1 implements the canonical TX observation-lineage adapter required by the CRU-34 implementation contract.

Implemented:

- physical append-only input order materialized as stable 1-based `ledgerOrdinal`;
- `availableAt = receivedAt` as wall-clock lineage only;
- no sorting by `eventTime` or `availableAt`;
- exact `actualContract`, `tradeDate`, `session`, `continuityEpoch` identity on canonical events;
- recorded reconnect / quote-type resubscribe lifecycle events establish continuity boundaries;
- joined Tick/BidAsk continuity warms up again after a boundary and requires both streams;
- quote eligibility requires same contract/tradeDate/session/epoch, prior physical ordinal, non-future event time, non-future availability, bounded age, usable lineage;
- non-monotonic `receivedAt` in the physical ledger invalidates the active availability lineage segment, including when the regression is first observed on another ledger event kind;
- exact output lineage helper preserves `cutoffLedgerOrdinal`, `cutoffRecordHash`, `maxUsedLedgerOrdinal`, `maxUsedRecordHash`, and `sourceLedgerIdentity`;
- safety boundaries fail closed.

## Focused validation

Focused Node test file:

`tests/tx-intraday-pressure-path-efficiency.test.mjs`

Phase-1 focused execution result during implementation:

- 11 tests
- 11 PASS
- 0 FAIL

Covered cases include:

- stable physical ordinal;
- legal prior quote;
- equal-availability physically later quote rejection;
- delayed earlier-event quote / clock regression;
- future-event quote;
- stale quote;
- known partial resubscribe epoch reset;
- identity mismatch;
- snapshot cutoff/max-used lineage;
- cross-stream wall-clock regression;
- safety boundary violation.

## Known boundary

This package does not modify the production collector. Continuity can only use durable lifecycle evidence already present in the ledger. Unknown external discontinuity that is not durably recorded cannot be invented after the fact; any future real-data acceptance must measure whether current ledger lifecycle evidence is sufficient for the intended joined derivation.

## Safety

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

Phase 2 may build the Executed Pressure Proxy on this canonical substrate. This document does not promote Relative Intensity, Market Control, Absorption, Market State, Strategy, Risk, or Execution.
