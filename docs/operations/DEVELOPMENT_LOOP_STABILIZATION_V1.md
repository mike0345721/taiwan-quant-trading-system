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

Every non-trivial implementation should use a branch and PR. The PR CI baseline runs:

- `npm ci`
- `npm run security:scan`
- `npm run test:ci`

`test:ci` is the required hermetic/default lane. Every `tests/*.test.mjs` file is included in CI unless it is explicitly classified in `tests/test-lanes.json`. New test files therefore enter CI by default instead of silently escaping the gate.

Non-hermetic suites remain visible and separately executable:

- `npm run test:windows` — Windows, PowerShell, or governed D-drive semantics;
- `npm run test:artifacts` — local-only frozen/research artifacts excluded by `data/**` governance;
- `npm run test:runtime` — browser/runtime integration pending a separately stabilized gate;
- `npm test` — the historical full repository suite, retained for broad local verification.

An excluded lane is **not** counted as CI PASS. Classification explains where the test must run; it does not waive the test. Missing local/frozen artifacts, platform requirements, or browser runtime behavior must remain explicit in review evidence.

The initial unclassified full-suite baseline on GitHub Actions produced 516 tests with 478 pass, 36 fail, and 2 skip. Failures clustered in Windows/D-drive assumptions, intentionally untracked local research artifacts, and one browser-runtime cleanup failure. This observation is the reason for explicit lane separation rather than `continue-on-error` or blanket suppression.

Branch protection remains intentionally deferred until the hermetic CI lane is observed stable; a broken new CI rule must not lock the Owner out of `main`.

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

After this loop is stable, a separate Owner-authorized work package may promote selected Windows/artifact/runtime lanes into additional required checks once their environments are reproducible. Playwright / browser screenshots / console-network capture as PR artifacts also remain separate future work. Multi-Agent orchestration and game-like control-center UI are not part of this stabilization slice.
