# Market Control System Blueprint V1

Status: **PLANNING ONLY / NOT IMPLEMENTATION AUTHORIZED**  
Linear: **CRU-32**  
Baseline main at creation: `82c24d99f1cff287e3750e7dcfc5461ccf3078dc`

## 1. Product End State

The target is a multi-instrument Market Control & Decision Assist system, not a TX-only indicator.

```text
Canonical Market Data
        ↓
Context / Position
        ↓
Pressure / Liquidity
        ↓
Price Response / Path Efficiency
        ↓
Market Control
        ↓
Market State
        ↓
Decision Assist
```

The production Dashboard must be able to answer, without fabricated intelligence:

1. What is happening now?
2. Who is applying pressure?
3. Is price responding as expected?
4. Is one side effective, failing, or being absorbed?
5. Is the path efficient or noisy?
6. Do related instruments confirm or conflict?
7. What evidence supports the current interpretation, what contradicts it, and what would invalidate it?

The formal presentation hierarchy remains **Result → Evidence → Detail**.

## 2. Capability Blueprint Template

Every new capability must define these before implementation:

1. User Question
2. Product Output
3. Allowed States
4. Required Evidence
5. Raw Data
6. Instrument / Identity Contract
7. Derivation
8. Cross-Instrument Normalization
9. Validation
10. Interpretation Boundary
11. Dashboard Contract
12. Promotion Gate

A feature request may not jump directly from idea to coding.

## 3. Multi-Instrument Contract

Core engines must not be hard-coded to TX. TX may be the first reference implementation, but products join through an Adapter + Instrument Profile.

The canonical instrument context must carry, where applicable:

- `instrument`
- `product`
- `assetClass`
- `underlying`
- `contract`
- `expiry`
- `tradeDate`
- `session`
- `tickSize`
- `multiplier`
- `eventTime`
- `receivedAt`
- `availableAt`
- `source`
- `quality`

Candidate expansion order is a product decision, not an authorization in this document. TX / MTX / TMF are natural architecture proofs because they share an underlying but have different contract multipliers. Stocks, NQ, and options require their own source and semantic gates.

## 4. Acceptance Ladder

A capability is not DONE because code exists or a PR merged.

### Gate applicability is part of Gate A

At Scope / Contract time, every gate must be marked `REQUIRED` or `NOT_APPLICABLE` with a short reason. `NOT_APPLICABLE` is a governed verdict, not an omitted check.

Default applicability:

| Gate | Default requirement |
| --- | --- |
| A Scope / Contract | Always REQUIRED |
| B Data Truth | REQUIRED when data inputs, source semantics, identity, timestamps, quality, or coverage are involved |
| C Derivation / Replay | REQUIRED when calculations, transforms, classifications, replay, research outputs, or normalization are involved |
| D Engineering | Always REQUIRED; review level follows project risk rules |
| E Dashboard Truth | REQUIRED when formal user-visible data/value/state presentation changes |
| F Production Browser | REQUIRED when production UI, browser behavior, charting, or critical interactions change |
| G Decision Assist | REQUIRED when interpretation, recommendation posture, evidence synthesis, or Decision Assist changes |
| H Owner Acceptance | REQUIRED when Product Owner visual/product acceptance is part of the authorized package or when a durable governance/product decision is being approved |
| I Merge | REQUIRED for any PR intended to enter `main` |
| J Post-Merge Runtime | REQUIRED only when the merged change affects runtime behavior, runtime-delivered assets, production data flow, or runtime acceptance evidence |

A work package may be marked DONE only when all `REQUIRED` gates PASS, all `NOT_APPLICABLE` gates have an explicit rationale, and no blocking finding remains. For runtime-affecting work, Gate J is mandatory and **Merge != Runtime Acceptance**.

### Gate A — Scope / Contract

- Authorized question and product output are explicit.
- Allowed states and unavailable states are defined.
- Required evidence and raw inputs are named.
- Safety and scope boundaries are frozen for the work package.
- Gate applicability is recorded before implementation.

### Gate B — Data Truth

- Real provider data is used for production-data claims when relevant.
- Instrument / contract / tradeDate / session / timestamp lineage is correct.
- Coverage and quality are measured.
- Negative cases exist for required-stream missing, stale, conflict, and sibling-stream-only conditions.
- Fixture PASS is not production-data PASS.

### Gate C — Derivation / Replay

- Same input produces the same result.
- No future-data leakage.
- `UNKNOWN`, `CONFLICT`, and coverage are preserved instead of forced into direction or zero.
- Cross-instrument normalization semantics are explicit before comparison.

### Gate D — Engineering

- Focused tests and appropriate regression tests pass.
- Security/data-contract checks match actual change risk.
- L1/L2/L3 review rules apply.
- Independent review is required at the configured level.
- Governance, acceptance, recovery, or execution-process contracts that can change how future work is authorized or accepted require at least Level 2 review even when the diff is documentation-only.

### Gate E — Dashboard Truth

Formal UI may display only:

- qualified VALUE,
- explicit `UNAVAILABLE_REASON`, or
- explicit `RESEARCH_PENDING` / not-promoted state.

Missing is not Neutral; unknown is not zero; stale/delayed is not Live.

### Gate F — Production Browser

Preview PASS is not Production PASS.

Production acceptance must use the production entry/path and verify critical interactions. Source/string checks are guardrails only.

For desktop-oriented acceptance, the supported validation set includes:

- 1920×1080
- 1536×864
- 1366×768

at effective 100% browser viewport assumptions. Actual browser zoom is not inferred from screenshots; when it is not verified, state `NOT_VERIFIED`.

Normal-path acceptance includes, as applicable:

- blocking console errors = 0
- duplicate critical IDs = 0
- horizontal overflow = 0
- prioritized core clipping = 0
- formal text below the approved floor = 0
- critical navigation / expand / drawer / progressive disclosure works
- chart remains bounded and usable
- no recursive resize/render loop
- network/API failures remain visible and truthful

A missing external source may be a valid product state if the UI truthfully renders Missing/Unavailable. Data Availability and Rendering Regression must be classified separately.

After a critical interaction bug, an automated regression is required when technically practical.

### Gate G — Decision Assist

Decision Assist must be traceable to evidence and must state:

- supporting evidence,
- contrary/conflicting evidence,
- missing/stale evidence,
- invalidation conditions,
- posture only at the promotion level actually authorized.

It must not silently convert research-only observations into BUY/SELL, confidence, strategy permission, or execution authorization.

### Gate H — Owner Acceptance

Capabilities requiring product or visual acceptance must receive Product Owner acceptance on the real product path. Durable governance contracts also require explicit Product Owner approval before they become project policy.

### Gate I — Merge

Engineering APPROVE does not equal Owner APPROVE. Merge requires explicit Product Owner approval.

Before final Engineering APPROVE / Owner merge decision:

1. verify the current target `main` and merge-base;
2. record the exact reviewed PR HEAD SHA;
3. if `main` advanced or the branch/base changed, reconcile the diff and rerun every affected test/review gate;
4. do not carry forward an approval that was tied to a different HEAD or materially different base.

### Gate J — Post-Merge Runtime

When Gate J is REQUIRED, after merge:

1. local `main` is synchronized to the approved merge SHA;
2. runtime commit equals approved main;
3. runtime identity is `VERIFIED` and sync state is `SYNCED` where the runtime contract provides those states;
4. formal runtime boot/health passes;
5. critical interaction smoke passes;
6. safety invariants remain unchanged.

When Gate J is `NOT_APPLICABLE`, the acceptance record must say why the change cannot affect runtime behavior or runtime-delivered assets.

## 5. Codex Model Routing

Do not spend the highest-cost / highest-capability model on every routine task.

Stable governance is based on **task-risk roles**, not on permanent model brand names. Named model availability, usage limits, pricing, and account entitlements are operational state and may change.

Every task must record:

```text
TASK_COMPLEXITY:
MODEL_ROLE:
IMPLEMENTATION_MODEL:
REASONING_LEVEL:
INDEPENDENT_REVIEW_MODEL:
MODEL_CATALOG_SNAPSHOT:
MODEL_AVAILABILITY_VERIFIED_AT:
ESCALATION_RULE:
```

Stable role routing:

| Class | Stable model role | Typical work |
| --- | --- | --- |
| T0 Routine | ROUTINE | repository scan, lists, formatting, repetitive edits, simple test execution |
| T1 Standard Engineering | STANDARD_ENGINEERING | normal feature work, adapters, tests, UI wiring, documentation |
| T2 Complex Engineering | COMPLEX_ENGINEERING | cross-module architecture, market microstructure, recovery/race behavior, difficult data semantics |
| T3 Critical Reasoning | CRITICAL_REASONING | timestamp lineage, normalization contract, evidence contract, research design, promotion/safety decisions |
| T4 Independent Review | INDEPENDENT_REVIEW | independent engineering/data/research review at the configured review level |

An operational profile may map these roles to the Codex models currently available to the account. For example, when actually selectable and suitable, a profile may map routine work to Luna, standard engineering to Terra, and complex/critical reasoning to Sol with an appropriate reasoning level. That mapping is **not** a permanent project invariant and must be re-verified rather than assumed.

Escalation is based on task semantics, not convenience. A lower-capability model encountering unresolved market-data semantics, timestamp lineage, frozen evidence, promotion, broker/order/risk/execution, or cross-module safety behavior must stop or escalate instead of guessing.

A critical task must not silently downgrade solely because a preferred model has reached usage limits.

Model diversity is preferred for independent review when practical, but reviewer independence primarily means a separate review context that reads the exact HEAD, acceptance contract, and open findings rather than inheriting the implementer's conclusion.

## 6. Quota / Interruption Recovery

Codex usage exhaustion, session interruption, context compaction, application restart, or model handoff are expected operational states. Work must not depend on one conversation remembering what happened.

### Durable Checkpoint

Create a durable checkpoint after each major phase and before a foreseeable interruption. Persist at least:

- Linear ID and exact authorized scope
- acceptance criteria / current gate
- branch / Draft PR / exact HEAD SHA
- changed-files and `git status` / diff summary
- completed checklist
- remaining checklist
- tests actually run and results
- tests not run
- unresolved blocking findings / known limitations
- exact next action
- implementer model role, actual model, and reasoning level
- recommended resume model role
- model catalog/availability snapshot when model routing matters
- safety invariants

Prefer a coherent WIP commit on the feature branch plus Draft PR when it is safe to commit. Do not commit secrets, credentials, raw market data, local runtime state, or unauthorized frozen-artifact changes merely to make a checkpoint.

Partial implementation must never be reported as complete or merged.

### Resume Packet / Rehydration

A new Codex session, model, or agent must preserve the repository's existing Task-based Context Routing. The minimum resume sequence is:

1. `AGENTS.md`
2. Linear CURRENT / exact issue + latest Resume Packet
3. `CURRENT_STATUS.md`
4. `KNOWN_ISSUES.md`
5. acceptance contract and task-specific spec/data/research/security documents required by `AGENTS.md`
6. GitHub PR / exact HEAD and relevant review findings
7. current branch + `git status` + diff in the actual worktree
8. current code around changed paths and dependencies
9. relevant tests and last recorded results

Then reconcile reality against the Resume Packet. Do not infer scope, completion, or PASS from memory.

If the required qualified model is temporarily unavailable, record the task as STOPPED/BLOCKED or route only work that is independently safe for an available model role. Do not hide the downgrade.

## 7. Task Lifecycle

One major work package should normally map to one task context, one branch, and one PR.

Recommended durable states:

```text
[CURRENT]
[REVIEW]
[DONE]
[HOTFIX]
[STOPPED]
```

- Review fixes inside the same authorized PR stay in the same task.
- New scope, new PR, or post-merge hotfix uses a new task context.
- DONE requires every REQUIRED acceptance gate to PASS; runtime-affecting work additionally requires post-merge runtime acceptance.

## 8. Cross-System Synchronization

Each system has one job:

- **Notion** — durable Product / Architecture / Owner Decisions.
- **Linear** — CURRENT/NEXT, authorized scope, blockers, checkpoints, Resume Packets, acceptance status.
- **GitHub** — code, specs, tests, configuration, manifests, branch/PR, exact SHA and review evidence.
- **Runtime** — actual production execution truth.

Authority is evaluated by information type as defined in `AGENTS.md`; do not treat a single stale copy in another system as an override of the system that owns that information type. If a cross-type contradiction remains, stop and resolve it through Product Owner decision rather than guessing.

Every major gate should leave a **Sync Receipt** containing, where applicable:

- Linear ID
- Notion decision/reference
- GitHub branch / PR
- exact HEAD or merge SHA
- current acceptance gate and verdict
- sync state
- runtime commit/state after deployment or post-merge acceptance

Synchronization sequence for a durable Owner product/architecture decision:

```text
Owner Decision
→ Notion durable decision
→ Linear scope/status
→ GitHub branch/PR
→ Engineering evidence/review
→ Owner merge approval
→ GitHub merge truth
→ Linear merge checkpoint
→ local main/runtime sync
→ post-merge acceptance when REQUIRED
→ Linear DONE
```

Notion is not a step-by-step execution log. Linear must not pretend code exists. GitHub must not claim product authorization. Runtime truth cannot be inferred from merge status.

### Degraded / outage mode

A connector or service outage must be explicit:

- **Notion unavailable**: existing already-authorized work may continue from durable Linear/GitHub truth if no new Product/Architecture decision is required. New durable Owner decisions remain `SYNC_PENDING_NOTION` and may not be treated as fully synchronized until Notion is updated.
- **Linear unavailable**: no new scope, status transition, acceptance transition, or merge request may be invented. Existing bounded implementation may continue only when exact authorized scope and the last checkpoint are already durable elsewhere; record `SYNC_PENDING_LINEAR` in the PR/checkpoint and restore Linear before the next major gate.
- **GitHub unavailable**: local work may continue only in an isolated preserved worktree. Review, durable exact-HEAD checkpoint, and merge gates remain blocked until GitHub is restored.
- **Runtime unavailable**: Gate J cannot PASS. Runtime-affecting work remains not DONE.

If systems disagree or a required system is stale, mark the sync state explicitly, reconcile it, and only then cross the next affected gate.

## 9. Market Control Initial Capability Direction

This document does not authorize implementation, but the intended research decomposition is:

### Pressure

- Aggressive Buy Volume
- Aggressive Sell Volume
- Net Aggressive Flow
- Aggressor Coverage
- Estimated CVD / Aggressive Flow Proxy

### Liquidity

Only when legal source data supports it:

- Bid/Ask imbalance
- spread
- depth depletion
- depth refill

Displayed liquidity is not executed flow.

### Response

- price change / ticks moved
- volatility-normalized response when a contract is defined

### Efficiency

- Price Path Efficiency
- Pressure → Price Impact Efficiency

### Research-only observations

- Buyer Effective
- Seller Effective
- Buyer Absorption
- Seller Absorption
- Balanced / Conflict

These remain descriptive/research-only until their derivation and promotion gates pass.

## 10. Relationship to Existing Work

- **CRU-5 P0 Forward Paper Validation** remains independent and continues on the frozen baseline. This blueprint must not retune or rescue P0.
- **CRU-13 Market State Data Collection Track** may supply raw collection truth. Collection does not imply promotion.
- CRU-32 is planning/governance work only. It does not authorize Pressure/CVD/Efficiency production implementation.

## 11. Safety Invariants

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

No model, Skill, checkpoint, quota fallback, or degraded sync mode may override these invariants.
