# Development Loop Stabilization V1

> Scope: CRU-28 only. This document defines the collaboration loop; it does not authorize new product, research, broker, order, position, risk, or execution capabilities.

## Goal

Reduce context loss and regression churn by making ChatGPT, Codex, GitHub, Linear, and Notion operate on one governed development loop.

## Source of Truth

Authority remains unchanged:

1. Product Owner explicit decision.
2. Notion for product vision, architecture, Owner Decisions, and durable research conclusions.
3. Linear for live CURRENT / NEXT, bugs, blockers, and acceptance state.
4. GitHub `main` for approved implementation truth.
5. Immutable manifests / ledgers / frozen artifacts for governed evidence.

## Roles

### Product Owner

- Approves scope changes, merge, production activation, evidence/model promotion, and any execution capability.
- Does not need to manually shuttle repository context between ChatGPT and Codex when connected sources can be read directly.

### ChatGPT — Project Brain / Tech Lead / Reviewer

Before proposing a non-trivial change, ChatGPT should reconstruct the smallest task-specific context from:

- Linear current work package;
- relevant Notion product/architecture/decision pages;
- `AGENTS.md`, `CURRENT_STATUS.md`, `KNOWN_ISSUES.md` and only the task-specific repository files;
- GitHub branch / PR / diff / CI evidence when reviewing implemented work.

ChatGPT is responsible for scope reasoning, architecture consistency, failure analysis, code review, and deciding whether evidence is sufficient for Owner review.

ChatGPT should not claim local-runtime facts that are not visible in GitHub or a bounded diagnostics artifact.

### Codex — Local Runtime Engineer

Use Codex when work requires the local checkout or execution environment, including:

- Windows shell/process behavior;
- localhost services;
- Shioaji market-data runtime;
- local SQLite or local-only market data;
- browser/runtime reproduction;
- broad multi-file edits that are better executed in the local repository;
- running local tests that require local artifacts or browsers.

Codex should receive a bounded task, not a request to redesign the entire project. It should work on a branch, verify the requested path, push the branch, and hand back a commit or Draft PR plus factual test/runtime evidence.

## Standard Handoff

### ChatGPT -> Codex

A handoff should contain:

- Linear issue identifier and exact authorized scope;
- suspected files / subsystems;
- invariants that must not change;
- exact local evidence to collect;
- tests or runtime checks to run;
- instruction to stop if a change requires scope expansion;
- branch / Draft PR requirement.

### Codex -> ChatGPT

The handback should contain:

- branch and commit SHA or Draft PR number;
- files changed;
- commands actually run and their results;
- local-runtime evidence that GitHub cannot observe;
- known limitations / unverified items;
- no claim that engineering review equals Product Owner approval.

ChatGPT then reads the real PR diff and CI state directly instead of relying on a prose-only summary.

## PR / CI Contract

Every non-trivial implementation should use a branch and PR. The baseline PR CI runs:

- `npm ci`
- `npm run security:scan`
- `npm test`

A failing full repository suite must stay visible. Missing local/frozen artifacts may explain a failure, but CI must not silently convert the failure into PASS. Follow-up work may split hermetic and local-artifact suites only through an explicitly reviewed change.

Branch protection is intentionally deferred until CI behavior is observed and stable; a broken new CI rule must not lock the Owner out of `main`.

## Local Diagnostics Contract

`COLLECT_DIAGNOSTICS.bat` runs `scripts/collect-development-diagnostics.mjs` and creates:

`data/diagnostics/latest.json`

The diagnostics collector is allowlist-based and reuses the governed read-only `project-status` probes. It may include bounded runtime status, Git identity/state, service health, quality state, and fixed safety invariants.

It must not collect:

- `.env` or credential files;
- API keys, passwords, session cookies, broker secrets, or private keys;
- SQLite table dumps;
- raw tick/live-event bodies;
- large research/raw archives;
- arbitrary process environment dumps.

`data/**` is local-only under the existing `.gitignore`, so the generated artifact is not intended for commit.

## Safety Invariants

These remain fixed for CRU-28:

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`

CRU-28 does not change Market State logic, Dealer logic, research conclusions, model weights, Shioaji authorization, broker/order routes, positions, risk, or automated trading.

## Follow-up (not in CRU-28)

After this loop is stable, a separate Owner-authorized work package may add Playwright / browser screenshots / console-network capture as PR artifacts. Multi-Agent orchestration and game-like control-center UI remain future work and are not part of this stabilization slice.
