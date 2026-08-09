# Market State V1 Forward Shadow Gate Draft

> Work package: CRU-19  
> Status: DRAFT — NOT ACTIVE, NOT OWNER-FROZEN  
> Forward collector / scheduler: NOT AUTHORIZED  
> `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`

## Frozen reference candidate

The following references describe the candidate baseline to be frozen only after Product Owner approval:

| Artifact | Version / reference | SHA-256 |
|---|---|---|
| Repository baseline | `9c9bbaeae6260c7b660a4e3bcf18287ef05c0739` | Git commit |
| Market State evaluator | `market-state-v1-premarket-evaluator-v0` / `src/market-state-v1.mjs` | `a7285f53006f49ae0cd1613e2798eaca730d83d03eb980d9f5d1e095d6b512b7` |
| Historical adapter / evidence construction | `src/market-state-historical.mjs` | `b1ecbe423c8660a9eec64baa62edca68478357db4c2a76be647099950b83d9c4` |
| Outcome Contract | `market-state-outcome-contract-v1` / `src/market-state-outcome-contract.mjs` | `b5cf8434636aec5a54fdfeaa63754213495aa563f315d09e39bd1dca34580f96` |
| Single-axis linkage contract | `cru18-single-axis-linkage-v1` / `src/market-state-outcome-linkage.mjs` | `884afd174e6d86d9c525629138c12ae5d67316b3f904013d69e2d813ea66a081` |

Any approved forward launch must record a new immutable freeze manifest containing these hashes, the Owner-approved sample policy, the selected axes, and the start date. CRU-19 does not create that launch manifest.

## Daily append-only snapshot

Each official trading day must produce exactly one traceable status record, including missed or rejected days. At minimum preserve:

- `tradeDate`, `sessionId`, `decisionAt`, `availableAt`, `recordedAt`;
- evaluator version, evaluator hash, Outcome Contract version and hash;
- independent axis snapshots for `trend`, `direction`, `volatility`, `globalAlignment`, and `riskResearchContext`;
- explicit candidate participation for each Owner-approved Forward Shadow axis;
- evidence identifiers, source dates, source timestamps, source hashes, feature versions, and maximum legal input `availableAt`;
- `qualityStatus`, stale / missing state, unavailable reasons, session / contract state, and any future-data or temporal-alignment violation;
- outcome observation start, outcome availability, actual contract code, source lineage and outcome hash after the observation window completes;
- prior ledger hash, sequence number, record hash, idempotency key, and deterministic replay digest;
- `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`.

The daily state snapshot must be written before its linked outcome is observable. The later outcome record may reference the immutable state record but must never alter it.

## Time and evidence rules

1. `decisionAt` and every required evidence timestamp must be legal and no later than the state snapshot's `availableAt`.
2. The Market State decision must precede the Outcome Contract's `observationStartAt`.
3. No outcome, partial outcome, future bar, PnL, strategy result, or later-revised source may enter state generation.
4. Missing inputs remain unavailable; they are never zero, neutral, prior-filled, or guessed.
5. Evidence lineage must allow a reviewer to reconstruct every accepted or unavailable state.
6. Canonical risk remains `NORMAL | HIGH_RISK | UNAVAILABLE`; `ELEVATED` is legal only in `riskResearchContext`.

## No peeking and no retroactive backfill

- No performance or outcome summary may be viewed before the predeclared checkpoint unless the Owner stops the run for integrity reasons.
- A missed forward day cannot be recreated as forward evidence. A later replay must be labeled `RETROSPECTIVE_REPLAY_ONLY` and excluded from the forward sample.
- Corrections are append-only. Existing state, outcome, and hash-chain records are never silently replaced.
- After the Owner-approved forward start, no axis semantics, threshold, evidence block, Outcome formula, observation window, sample rule, or missing-data rule may be changed inside the same run.
- Any necessary semantic change closes the current run and requires `RETURN_TO_RESEARCH`, a new version, and a new Owner-approved start date.

## Deterministic replay

Identical frozen code, specs, inputs, source hashes, and timestamps must reproduce identical state, outcome, alignment, and ledger digests. A replay mismatch is a hard integrity failure. Replay may verify existing evidence but may not manufacture a missed forward observation.

## Sample sufficiency policy

### CODEX_RECOMMENDATION — NOT USER INTENT, NOT FROZEN

For each promoted axis, require:

- at least 60 clean accepted forward trading days overall; and
- at least 30 clean observations on both sides of its predeclared primary comparison.

Rationale:

- **Statistical:** 30 observations per compared state is the existing minimum for descriptive effect size and deterministic bootstrap intervals. It is a minimum descriptive floor, not proof of edge.
- **Operational:** 60 clean days expose repeated scheduler, source availability, stale-data, settlement, roll, and deterministic replay behavior.
- **Planning:** uneven state occurrence means approximately 120–180 trading days may be needed. This estimate does not alter the proposed gate.

If a required state remains rare, report `INSUFFICIENT_SAMPLE`. Do not merge states, retune thresholds, extend windows, add axes, backfill missed days, or select only favorable periods.

## Draft status definitions

### PASS

May be proposed only when:

- all Owner-frozen integrity, time, lineage, deterministic replay and sample requirements pass;
- there are zero unauthorized executions, future-data violations, temporal-alignment violations, duplicate records, hash-chain failures, or silent corrections;
- the predeclared single-axis comparison satisfies the still-unresolved Owner-approved statistical and practical-effect criteria; and
- the Product Owner explicitly approves promotion.

Engineering PASS alone does not establish predictive edge, trading permission, formal weight, or Strategy Router eligibility.

### FAIL

Use when an Owner-frozen integrity requirement fails, or when a sufficient clean sample fails an Owner-frozen validation criterion. Preserve the negative result. Do not retune or rescue it inside the same run.

### INSUFFICIENT_SAMPLE

Use when the run is clean but the Owner-frozen total or per-state sample requirement is not met. Continue append-only accumulation if the run remains operationally valid. Do not inspect partial performance to decide whether to continue.

### RETURN_TO_RESEARCH

Use when the evaluator semantics, source lineage, available-at policy, Outcome Contract, state availability, or data quality is no longer fit for the frozen question. Close the forward run before designing a new version. This status cannot be used to erase an unfavorable sufficient-sample result.

## Eligibility for a later Strategy Router design review

An axis may be brought to a separate Strategy Router design review only after:

1. its Forward Shadow gate receives Owner-approved `PASS`;
2. all evidence and negative results are preserved;
3. a separate promotion decision defines the permitted product role;
4. formal weight, conflicts, expiry, stale behavior and risk veto remain separately governed; and
5. the Product Owner explicitly authorizes a new work package.

This draft does not connect Market State to Strategy Router, Risk Engine, Paper Trading, broker APIs, orders, or execution.

## Owner decisions required before launch

- axes admitted to Forward Shadow;
- sample policy;
- statistical and practical-effect PASS criteria;
- official start date and immutable hashes;
- daily timing, missed-day and late-start operations;
- hard-fail versus unavailable quality rules;
- checkpoint visibility and stop authority;
- promotion role and evidence required for any later Strategy Router design review.

Until those decisions are frozen: `FORWARD_SHADOW_STATUS=NOT_AUTHORIZED`.

