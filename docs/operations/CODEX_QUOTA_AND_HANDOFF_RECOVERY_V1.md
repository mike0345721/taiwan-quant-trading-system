# Codex Quota & Handoff Recovery Contract V1

Status: **PLANNING / GOVERNANCE CANDIDATE**  
Linear: **CRU-32**

## Purpose

Codex usage exhaustion, app/session interruption, context compaction, model handoff, subagent handoff, or a worker stopping mid-task must not make project state depend on chat memory.

This contract makes interruption recoverable and keeps partial work from being mistaken for completion.

## 1. Non-negotiable rules

1. Partial work is never `DONE`.
2. A quota or session problem never authorizes scope reduction, safety downgrade, evidence promotion, or merge.
3. A critical task is never silently reassigned to a lower-capability model role merely because the preferred model is unavailable.
4. Secrets, credentials, raw market data, local runtime state, and unauthorized frozen-artifact changes are never committed just to create a checkpoint.
5. Git reset/restore or destructive cleanup is never used as a resume shortcut when uncommitted work may exist; inspect and preserve first.
6. Resume starts from durable truth, not from a model's recollection.
7. Parallel agents do not share implicit memory; each worker must receive an explicit bounded scope and durable handoff context.

## 2. Work-package sizing

A work package should be small enough that one coherent phase can reach a durable checkpoint before a long uninterrupted run is required.

For T2/T3 work, split implementation into bounded slices such as:

```text
Contract / plan
→ first coherent implementation slice
→ tests / evidence
→ review fixes
→ acceptance
```

Do not start a large multi-subsystem rewrite that has no safe intermediate checkpoint.

One major package normally maps to one Linear work item, one branch, and one PR. Same-PR review fixes remain in the same task; new scope, a new PR, or post-merge hotfix starts a new task context.

## 3. Checkpoint cadence

Create a durable checkpoint at minimum:

- after Scope / Acceptance Contract is frozen;
- after each coherent implementation slice;
- after meaningful test/evidence generation;
- before independent review;
- after review fixes;
- whenever a usage-limit warning or likely interruption is observed;
- before merge request;
- after merge and before post-merge runtime acceptance when Gate J is required.

For long T2/T3 work, checkpoint by completed semantic slice rather than by elapsed time.

## 4. Durable Checkpoint contents

Each checkpoint / Resume Packet records:

```text
WORK_ITEM:
STATUS: CURRENT | REVIEW | STOPPED | HOTFIX | DONE
AUTHORIZED_SCOPE:
ACCEPTANCE_GATE:
BRANCH:
PR:
BASE_SHA:
HEAD_SHA:
LOCAL_WORKTREE:
GIT_STATUS_SUMMARY:
CHANGED_FILES:
COMPLETED:
REMAINING:
TESTS_RUN:
TESTS_NOT_RUN:
BLOCKERS:
KNOWN_LIMITATIONS:
NEXT_EXACT_ACTION:
MODEL_ROLE:
IMPLEMENTATION_MODEL:
REASONING_LEVEL:
RECOMMENDED_RESUME_MODEL_ROLE:
MODEL_CATALOG_SNAPSHOT:
MODEL_AVAILABILITY_VERIFIED_AT:
INDEPENDENT_REVIEW_REQUIRED:
SAFETY_INVARIANTS:
```

`LOCAL_WORKTREE` may be `NOT_APPLICABLE` for a cloud-only task. Local-only evidence must not be described as independently verified.

Named model mappings are operational state, not permanent governance. If model routing matters, the checkpoint must record both the stable `MODEL_ROLE` and the actual selected model/catalog snapshot.

## 5. WIP commit / Draft PR rules

Prefer a coherent WIP commit on the feature branch plus a Draft PR when the slice is internally consistent and safe to persist.

A WIP checkpoint commit:

- may be incomplete;
- must not be presented as acceptance evidence for work that has not been tested;
- must not change `main`;
- must not be merged;
- must clearly leave unfinished items in the Resume Packet.

If a coherent commit is not safe yet, preserve the local worktree and record exact `git status`, changed files, and next action in Linear. Do not manufacture a commit by adding secrets/raw data or unrelated local files.

## 6. Sudden interruption with no final checkpoint

If Codex stops abruptly before it can create a final checkpoint:

### When the local worktree still exists

1. Do not reset, restore, clean, or overwrite it.
2. Inspect branch, HEAD, `git status`, and diff.
3. Compare against the last durable Linear/GitHub checkpoint.
4. Classify every extra local change as `UNVERIFIED_RECOVERED_WORK` until reviewed.
5. Re-run the relevant tests before promoting recovered work into a normal checkpoint.

### When the lost worker/session had no recoverable worktree

The last durable GitHub/Linear checkpoint is authoritative. Anything claimed after that checkpoint but not persisted is `NOT_VERIFIED` and must be reproduced rather than assumed complete.

## 7. Resume / rehydration sequence

Every new session/model/agent must preserve the repository's existing Task-based Context Routing.

Minimum resume sequence:

1. `AGENTS.md`
2. Linear exact work item + latest Resume Packet
3. `CURRENT_STATUS.md`
4. `KNOWN_ISSUES.md`
5. Acceptance Contract plus task-specific data/research/security/architecture documents required by `AGENTS.md`
6. GitHub PR + exact HEAD + open review findings
7. branch + `git status` + diff in the actual worktree
8. changed code paths and dependencies
9. tests/evidence recorded at the checkpoint

Then compare actual state against the packet. If they differ, stop and reconcile before implementing.

Context compaction follows the same rule: re-read the minimum set above before the next major gate; do not infer scope/completion from compressed memory.

## 8. Model fallback rules

Fallback is defined by stable role, not by permanent model name.

| Situation | Allowed response |
| --- | --- |
| `ROUTINE` role unavailable | Use another currently verified model suitable for routine work if worthwhile, otherwise wait |
| `STANDARD_ENGINEERING` role unavailable | Escalate to a verified higher-capability role only when priority/cost justifies it, or pause; do not push standard engineering down into an unsuitable routine role |
| `COMPLEX_ENGINEERING` / `CRITICAL_REASONING` role unavailable | Pause the critical slice or do only separately carved-out safe lower-risk work; do not silently downgrade core reasoning |
| Qualified independent reviewer unavailable | Keep the Review Gate pending; no Engineering APPROVE / merge |
| A reserve/fallback model becomes available after regular quota exhaustion | Use it only for work whose stable role it genuinely satisfies; reserve availability does not override task-risk requirements |

The currently available model catalog and any operational mapping such as Luna/Terra/Sol must be re-verified at task start or resume rather than assumed to be permanent.

Model routing changes must be recorded in the next checkpoint.

## 9. Bounded multi-agent / subagent concurrency

Parallelism is allowed only when it reduces wall-clock work without weakening review, checkpoint, or quota discipline.

Rules:

1. A coordinator owns the authoritative scope, branch/PR identity, and final integration verdict.
2. Every subagent gets an explicit subtask boundary, exact input/reference HEAD, expected output, and allowed files or evidence domain.
3. Two agents must not concurrently edit the same file or mutable artifact unless a coordinator explicitly serializes the writes.
4. Subagents may research/review in parallel; implementation parallelism is limited to genuinely independent slices.
5. Each subagent returns a mini-checkpoint: completed work, files/evidence touched, tests run/not run, findings, unresolved items, and exact output identity.
6. The coordinator must re-read/integrate subagent output; subagent completion is not automatically Engineering APPROVE.
7. Parallel agents multiply quota usage. Concurrency must be deliberately bounded to the minimum useful number and must not consume scarce critical-reasoning quota on routine duplicate work.
8. If one subagent is interrupted or quota-blocked, its subtask becomes `STOPPED` / `NOT_VERIFIED`; independent sibling work may continue only when no dependency is violated.
9. A subagent cannot merge, change Product scope, promote evidence, or change safety invariants.

## 10. Review recovery

If interruption occurs during review:

- existing findings remain open until explicitly resolved;
- a new reviewer must read the exact reviewed HEAD and all open findings;
- a code/spec change after review invalidates approval for the affected HEAD and requires the configured re-review;
- review verdicts are tied to exact commit SHA, not branch name alone;
- model diversity is useful but reviewer independence primarily means a separate review context that does not inherit the implementer's conclusion.

## 11. Acceptance recovery

Acceptance verdicts are tied to exact artifacts and states.

If HEAD changes after a PASS, rerun the affected gates. If target `main` materially advances, reconcile merge-base/diff and rerun affected tests/review before final approval. If runtime or local main changes, post-merge/runtime acceptance must be repeated whenever Gate J is required.

Never carry a PASS forward because a previous version was similar.

## 12. Cross-system Sync Receipt and degraded mode

At each major gate, persist a Sync Receipt in Linear with:

```text
LINEAR_ID
NOTION_DECISION_REF (if applicable)
GITHUB_BRANCH / PR
EXACT_HEAD_OR_MERGE_SHA
ACCEPTANCE_GATE + VERDICT
SYNC_STATE
RUNTIME_COMMIT / STATE (if applicable)
NEXT_GATE
```

Notion stores durable Owner/Product/Architecture decisions; Linear stores execution/checkpoint/acceptance state; GitHub stores exact implementation/spec evidence; Runtime remains the actual production truth.

If any system is stale or contradictory, reconcile before crossing the next affected gate.

Degraded/outage handling follows the project blueprint:

- Notion unavailable → no new durable Product/Architecture decision becomes fully synchronized; mark `SYNC_PENDING_NOTION`.
- Linear unavailable → no invented new scope/status/acceptance transition; mark `SYNC_PENDING_LINEAR` and restore Linear before the next affected gate.
- GitHub unavailable → local work may continue only in an isolated preserved worktree; exact-HEAD review/checkpoint/merge remains blocked.
- Runtime unavailable → Gate J cannot PASS when it is required.

## 13. Safety invariants

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

A quota, fallback model, handoff, resume, subagent, or degraded sync mode cannot change these invariants.
