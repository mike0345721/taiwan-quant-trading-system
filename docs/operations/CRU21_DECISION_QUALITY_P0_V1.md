# CRU-21 Decision Quality P0 V1 — Isolated Candidate

Status: SOURCE CANDIDATE / NOT DEPLOYED / NOT OWNER ACCEPTED.
Starting reference: PR #86 at exact 3add90a17fbb7a50ffbd71971649d5ce7d526377.
Scope is an independent feature branch and stacked Draft PR; formal main is unchanged.

## Counterexample and requirement
Owner snapshot: price 47243, VWAP 47195.4, prior-day observation 46883.
Reported geometric long R:R = (47720-46897)/(46897-46869) = 823/28 = 29.39.
The geometry starts at conditional confirmation price 46897, NOT the current price 47243.
The 346-point difference cannot be hidden by a generic disclaimer.
Missing or interrupted data must not become certified full-market VWAP or direction evidence.

## Implementation and contracts
1. Focus relevance: a current Next Watch/scenario is published ONLY when decisionFocus has a nearby qualified active node. With no active focus, nextWatch and scenarioWatch are null across raw API, snapshot, copy and AI; historical prices remain solely in separately labeled quality-aware levels and decisionFocus.nearestBackground. A candidate must be source-qualified, non-CONTEXT and within two existing zonePoints. Remote lawful history remains background; nearby quality-blocked references are refused. No near candidate means NO_ACTIVE_REFERENCE, and current UI/chart overlay/verified AI facts must not show the legacy scenario as active.
2. No test from price proximity alone. A BIDIRECTIONAL_TEST state now requires an eligible post-formation completed-bar touch; proximity to moving VWAP yields BIDIRECTIONAL_WATCH.
3. R:R applicability: arithmetic and original source prices are preserved. New fields describe current price, reference confirmation threshold, exact point gap and whether the conditional geometry is detached, near-but-unconfirmed, unavailable or target already passed. Every state has currentEntryRr=null and entryAuthorized=false, so geometric ratios are never executable current-price R:R.
4. Evidence Gate: price relation and qualified pressure/response descriptions are separated from unproven persistence, direction, executable ratio and order authority. Flow quality incomplete remains incomplete.
5. Canonical AI verification: current-focus gate suppresses stale scenario numeric claims; price-gap claims are recalculated against original current/confirmation fields before publication. A mismatch rejects the verified answer rather than inventing a number.

## Invariant restrictions
No raw ledger, Producer, Bridge, checkpoint, history or market-data service changes.
No credentials, model requests, paid API, formal weight, broker order, position or execution features.
No profitability, strategy edge, or guaranteed feed completeness claim.
On NO_ACTIVE_REFERENCE, live nextWatch and scenarioWatch are null even in the raw API. Historical contextual values remain traceable in levels and the separately labeled nearestBackground; old persisted snapshots are not promoted to current evidence.

## Acceptance requirements
- Reproduce owner 47243 / 46897 / 823 / 28 example.
- Near blocked reference is never promoted; lawful remote reference cannot be mislabeled active.
- Completed-bar touch evidence, not distance alone, is needed to label a test.
- Null target/unknown input never becomes zero.
- DOM and chart overlays omit current-focus claims when NO_ACTIVE_REFERENCE.
- Canonical AI output refuses misleading numeric applicability and rejects inconsistent gaps.
- Run focused and whole-repository regression; retain failing and passing evidence.
- Independent review and same-version runtime acceptance are required before deployment.
- PR86 formal cutover remains separately gated and Owner-approved.

## Out of scope
P1 Market State and Pressure to Expected/Actual Response require a separate event-level data contract, classification coverage, source/receipt clocks, controlled event labels and multi-session forward observation. They are not claimed as implemented by this P0.
