# CRU-34 — TX Intraday Pressure & Path Efficiency Research Engine V1

Status: **OWNER AUTHORIZED / IMPLEMENTATION CONTRACT V1 / RESEARCH ONLY**  
Linear: **CRU-34**  
Parent: **CRU-13**  
Approved starting main after PR #43: `1c7f83934a8b046f5456eb2e44dc9f2c92aeff7f`  
Implementation branch: `codex/cru-34-tx-intraday-pressure-path-efficiency-research-engine-v1`

## 1. Product question

Build the first deterministic, replayable TX intraday research engine that can answer:

1. Which side has observed executed-flow pressure advantage?
2. How did price actually respond in the same governed window?
3. Was the observed price path direct or noisy?
4. Is the evidence usable, incomplete, conflicting, stale, or lineage-invalid?

The engine must not manufacture Relative Intensity, formal Market Control, Absorption, Market State, trading direction, confidence, strategy permission or execution permission.

## 2. V1 output chain

```text
Governed TX Tick + BidAsk ledger prefix
        ↓
Canonical identity / observation lineage
        ↓
Executed Pressure Proxy
        ↓
Price Response
        ↓
Price Path Efficiency
        ↓
UI-ready Research Snapshot
```

No composite Market Control score in V1.

## 3. Safety invariants

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

Any input/output that violates these boundaries fails closed.

## 4. TX reference identity

V1 reference instrument is TX near/actual governed contract only. The core implementation must still expose an instrument-profile boundary rather than hard-code product assumptions throughout the derivation.

Required joined identity fields:

```text
instrument = TX
product
market / venue when available from governed context
actualContract
tradeDate
session
continuityEpoch
eventTime
receivedAt
availableAt
ledgerOrdinal
recordHash
sourceLedgerIdentity
```

A joined Tick/BidAsk derivation requires exact match on `actualContract`, `tradeDate`, `session`, and `continuityEpoch`.

If any required identity/continuity field cannot be established from existing governed evidence, the joined best-quote cross-check returns an explicit unavailable/quality reason. This package does not silently add or modify a production collector to manufacture missing identity evidence.

## 5. Observation-order and availability contract

Canonical V1 rules inherited from CRU-33:

```text
availableAt = durable ledger receivedAt
observationOrder = physical append-only ledger order
ledgerOrdinal = stable ordinal materialized from physical order
```

`ledgerOrdinal` is authoritative observation order. `availableAt` is wall-clock availability lineage. `eventTime` is market/event chronology and quote-age/window evidence. Neither timestamp may reorder physical system knowledge.

### 5.1 Quote eligibility

A BidAsk quote is eligible to cross-check a Tick only when all are true:

```text
same actualContract
same tradeDate
same session
same continuityEpoch
quote.ledgerOrdinal < tick.ledgerOrdinal
quote.eventTime <= tick.eventTime
quote.availableAt <= tick.availableAt
0 <= tick.eventTime - quote.eventTime <= maxQuoteAgeMs
availabilityLineageStatus == USABLE
```

Missing/invalid lineage fails the joined cross-check closed.

### 5.2 Non-monotonic receivedAt

If physical ledger order advances while `receivedAt` regresses, replay does not sort around the anomaly.

Required state:

```text
availabilityLineageStatus = INVALID_NON_MONOTONIC_RECEIVED_AT
```

Availability-dependent joined derivations fail to `UNAVAILABLE` / `QUALITY_INSUFFICIENT` until a new independently valid continuity segment begins.

### 5.3 Continuity epoch

The joined pressure cross-check must not bridge a known delivery discontinuity.

V1 continuity behavior:

- full reconnect begins a new joined continuity epoch;
- a known interruption/recovery of either required stream (Tick or BidAsk) also ends the current joined epoch;
- joined quote matching resumes only inside a newly established epoch where both required streams have legal continuity evidence;
- no quote from a prior epoch may classify a Tick in a later epoch;
- if existing durable evidence cannot distinguish a partial recovery boundary, joined quote evidence stays unavailable rather than guessing.

No collector modification is authorized solely to hide missing continuity evidence.

## 6. Deterministic observation windows

V1 freezes two trailing research windows because the existing substrate already exposes 1m/5m context and the product needs both immediate and contextual evidence without introducing an open-ended window search:

```text
PRIMARY_WINDOW_MS = 60_000
CONTEXT_WINDOW_MS = 300_000
```

Each snapshot is anchored to a legal TX Tick at `cutoffLedgerOrdinal` and `anchorEventTime`.

Window membership for Tick-derived pressure/response/path evidence:

```text
record.ledgerOrdinal <= cutoffLedgerOrdinal
same actualContract / tradeDate / session / continuityEpoch
(anchorEventTime - windowMs) < record.eventTime <= anchorEventTime
```

Records are processed in physical ledger order. They are never re-sorted by event time.

A physically later event with earlier `eventTime` may affect only snapshots emitted after it was physically observed. It may never rewrite an already-emitted earlier cutoff.

No qualitative synthesis between 60s and 300s is authorized in V1.

## 7. Executed Pressure Proxy V1

Provider `tick_type` remains provider-side classification proxy:

```text
1 -> BUY_PROXY
2 -> SELL_PROXY
0 / other -> UNKNOWN
```

Required window outputs:

```text
buyProxyVolume
sellProxyVolume
unknownVolume
classifiedVolume
netAggressiveFlowProxy = buyProxyVolume - sellProxyVolume
pressureRatio = (buyProxyVolume - sellProxyVolume) / (buyProxyVolume + sellProxyVolume)
classifiedCoverage = classifiedVolume / totalExecutedVolume
```

Rules:

- `pressureRatio` is `UNAVAILABLE` when `buyProxyVolume + sellProxyVolume == 0`;
- UNKNOWN is preserved and never forced to zero-side direction;
- low coverage remains measurable evidence and cannot silently become a directional conclusion;
- no `True CVD`, participant identity, dealer/主力/外資 identity, hidden inventory or causal wording.

### 7.1 Best-quote cross-check

When §5.1 eligibility passes, preserve separately:

```text
bestQuoteBuyProxyVolume
bestQuoteSellProxyVolume
bestQuoteInsideSpreadVolume
bestQuoteUnavailableVolume
bestQuoteMatchedCoverage
classificationConflictCount
classificationConflictRate
```

Best-quote evidence never replaces provider-side classification and is not five-level displayed-liquidity pressure.

## 8. Price Response V1

For each legal window:

```text
startPrice = first eligible TX Tick price in physical observation order
endPrice = last eligible TX Tick price in physical observation order
priceDisplacementPoints = endPrice - startPrice
priceDisplacementTicks = priceDisplacementPoints / instrumentProfile.tickSize
```

`response.directionRelation` may only describe the observed relation between the sign of valid Pressure Ratio and price displacement:

```text
SAME_DIRECTION
OPPOSITE_DIRECTION
FLAT_PRICE
PRESSURE_UNAVAILABLE
```

This is observational, not causal.

## 9. Path Efficiency V1

Candidate formula is frozen for implementation:

```text
abs(endPrice - startPrice)
/
sum(abs(price[i] - price[i-1]))
```

Price observations are eligible TX Tick prices in physical ledger order inside the governed window.

Required conditions:

- minimum eligible Tick count: `3`;
- denominator `0` / all-equal price path -> `UNAVAILABLE_ZERO_PATH`;
- no crossing actualContract, tradeDate, session or continuityEpoch;
- no crossing a known reconnect/partial-recovery boundary;
- same-timestamp records retain physical ledger order;
- if included TX Tick `eventTime` regresses relative to the prior included TX Tick inside the same path, Path Efficiency fails closed to `QUALITY_INSUFFICIENT_EVENT_TIME_REGRESSION`; it must not retroactively reorder the path;
- maximum observed event-time gap between adjacent eligible TX Ticks is frozen initially at `30_000ms`; a larger gap returns `QUALITY_INSUFFICIENT_LONG_GAP` for Path Efficiency;
- when available, value must be bounded to `[0,1]` within numerical tolerance.

Path Efficiency means path directness only. It is not Trend Strength, Control, probability or signal quality.

## 10. Snapshot lineage

Every emitted snapshot must preserve exact physical knowledge cutoff:

```text
availableAt
cutoffLedgerOrdinal
cutoffRecordHash
maxUsedLedgerOrdinal
maxUsedRecordHash
sourceLedgerIdentity
```

Required invariants:

```text
every used input ledgerOrdinal <= cutoffLedgerOrdinal
maxUsedLedgerOrdinal <= cutoffLedgerOrdinal
cutoffRecordHash binds cutoffLedgerOrdinal to source ledger
maxUsedRecordHash binds maxUsedLedgerOrdinal to source ledger
availableAt = max(availableAt of every input actually used)
```

Two outputs with the same wall-clock `availableAt` but different physical prefixes must remain distinguishable by ordinal/hash/source-ledger lineage.

## 11. UI-ready research snapshot

Minimum machine-readable direction:

```text
schemaVersion
identity
lineage
windows.primary60s
windows.context300s
quality
methodology
limitations
promotionState
formalWeight
researchOnly
executionAuthorized
orderRoutesEnabled
```

Each window preserves:

```text
pressure.raw proxy volumes
pressure.netAggressiveFlowProxy
pressure.ratio
pressure.classifiedCoverage
pressure.bestQuoteCrossCheck
pressure.conflict
pressure.relativeIntensity = RESEARCH_PENDING
response.displacementPoints
response.displacementTicks
response.directionRelation
pathEfficiency.value OR unavailable reason
control.observationState = RESEARCH_PENDING
absorption = RESEARCH_PENDING
```

Market State is not generated by this engine.

Any quality percentage shown later in UI must be explicitly named, e.g. `classified coverage 96%`; generic wording such as `96%可信` is forbidden.

## 12. Explicitly out of scope

- new provider/data source/collector;
- production Dashboard wiring;
- qualitative `弱 / 中 / 強` thresholds;
- relative-intensity percentile baseline/promotion;
- five-level displayed-liquidity pressure derivation;
- absorption promotion;
- formal Market Control state/score;
- Market State integration/promotion;
- strategy/filter/alpha tuning;
- Risk Veto;
- Position/Broker/Order/Execution;
- options/NQ/stocks expansion.

## 13. Planned implementation footprint

Phase 0 code audit freezes the following minimal intended footprint; exact names may be adjusted only to match existing repository patterns without semantic expansion:

```text
NEW  src/tx-intraday-pressure-path-efficiency.mjs
NEW  tests/tx-intraday-pressure-path-efficiency.test.mjs
NEW  scripts/build-tx-intraday-pressure-path-efficiency.mjs   # offline/replay research adapter only, if required
MOD  package.json                                              # only if a focused research command is added
```

Existing `src/futures-order-flow.mjs` remains a research substrate. V1 should prefer wrapping/reusing its transparent provider-side classification semantics instead of silently changing its legacy output contract, unless a focused refactor is required and regression-tested.

`broker/live_event_ledger.py` and `broker/shioaji_readonly_bridge.py` are not planned modification targets in V1. If implementation proves a collector/runtime change is actually required, stop and request Product Owner scope expansion instead of modifying them opportunistically.

## 14. Mandatory focused tests

At minimum:

1. provider BUY/SELL/UNKNOWN volumes and bounded Pressure Ratio;
2. denominator-zero Pressure Ratio unavailable;
3. UNKNOWN/low-coverage preserved;
4. legal best-quote match;
5. delayed earlier-event quote rejected;
6. equal-availableAt physically later quote rejected;
7. future-event quote rejected;
8. stale quote rejected;
9. non-monotonic `receivedAt` fails joined derivation closed without reorder;
10. deterministic equal-time physical ordering;
11. reconnect/continuity boundary rejection;
12. partial Tick/BidAsk recovery boundary rejection or explicit unavailable when durable evidence is insufficient;
13. contract boundary;
14. tradeDate/session boundary;
15. provider/book classification conflict preserved;
16. Tick-only and BidAsk-only truth states;
17. Price Response start/end selection deterministic;
18. Path Efficiency direct path;
19. Path Efficiency noisy path;
20. Path Efficiency zero-path unavailable;
21. Path Efficiency event-time regression fail-closed;
22. Path Efficiency long-gap fail-closed;
23. output availability max-used-input invariant;
24. output ordinal cutoff invariant;
25. output lineage hashes/source-ledger identity;
26. identical legal ledger prefix -> identical semantic snapshot;
27. safety invariants remain false/research-only.

## 15. Acceptance gates

- A Scope / Contract — REQUIRED
- B Data Truth — REQUIRED
- C Derivation / Replay — REQUIRED
- D Engineering — REQUIRED / Level 3 Triple Review
- E Dashboard Truth — REQUIRED for snapshot/schema semantics only; production UI N/A
- F Production Browser — N/A
- G Decision Assist runtime — N/A
- H Owner Acceptance — REQUIRED
- I Merge — REQUIRED
- J Post-Merge Runtime — N/A unless Owner later expands runtime-delivered behavior

## 16. Phase 0 exit checklist

Phase 0 is complete only when:

- approved merged base SHA is recorded;
- AGENTS/Linear/CURRENT_STATUS/KNOWN_ISSUES/CRU-33/Blueprint are re-read;
- current `futures-order-flow` and ledger semantics are re-verified;
- 60s/300s deterministic windows are frozen;
- identity, continuity, quote eligibility, non-monotonic time and lineage output semantics are explicit;
- Path Efficiency observation/gap/boundary semantics are explicit;
- file impact list and mandatory test list are explicit;
- no production collector/runtime modification is hidden in scope;
- safety invariants are unchanged.

Phase 1 may begin after this contract is committed; no additional Owner approval is required while work remains inside CRU-34 scope.