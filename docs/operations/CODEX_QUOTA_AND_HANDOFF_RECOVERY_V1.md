# Codex Quota & Handoff Recovery Contract V1

Status: **PLANNING / GOVERNANCE CANDIDATE**  
Linear: **CRU-32**

## Purpose

Codex usage exhaustion, app/session interruption, context compaction, model handoff, or a worker stopping mid-task must not make project state depend on chat memory.

This contract makes interruption recoverable and keeps partial work from being mistaken for completion.

## 1. Non-negotiable rules

1. Partial work is never `DONE`.
2. A quota or session problem never authorizes scope reduction, safety downgrade, evidence promotion, or merge.
3. A critical task is never silently reassigned to a weaker model merely because the preferred model is unavailable.
4. Secrets, credentials, raw market data, local runtime state, and unauthorized frozen-artifact changes are never committed just to create a checkpoint.
5. Git reset/restore or destructive cleanup is never used as a resume shortcut when uncommitted work may exist; inspect and preserve first.
6. Resume starts from durable truth, not from a model's recollection.

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
- after merge and before post-merge runtime acceptance.

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
IMPLEMENTER_MODEL:
REASONING_LEVEL:
RECOMMENDED_RESUME_MODEL:
INDEPENDENT_REVIEW_REQUIRED:
SAFETY_INVARIANTS:
```

`LOCAL_WORKTREE` may be `NOT_APPLICABLE` for a cloud-only task. Local-only evidence must not be described as independently verified.

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

Every new session/model/agent resumes in this order:

1. `AGENTS.md`
2. Linear exact work item + latest Resume Packet
3. Acceptance Contract / relevant spec
4. GitHub PR + exact HEAD
5. branch + `git status` + diff in the actual worktree
6. changed code paths and dependencies
7. tests/evidence recorded at the checkpoint

Then compare actual state against the packet. If they differ, stop and reconcile before implementing.

Context compaction follows the same rule: re-read the above before the next major gate; do not infer scope/completion from compressed memory.

## 8. Model fallback matrix

| Situation | Allowed response |
| --- | --- |
| Luna unavailable on T0 | Route to Terra if worthwhile, otherwise wait; do not consume Sol by default |
| Terra unavailable on T1 | Route to Sol only when priority justifies it, or pause; Luna may handle only a separately carved-out T0 subtask |
| Sol unavailable on T2/T3 | Pause the critical slice or do only independently safe T0/T1 work; do not silently downgrade core reasoning to Terra/Luna |
| Independent reviewer unavailable | Keep Review Gate pending; no Engineering APPROVE / merge |
| Regular Codex usage exhausted but an account offers Luna Reserve | Use it only for tasks valid for Luna; it does not authorize critical-task downgrade |

Model routing changes must be recorded in the next checkpoint.

## 9. Review recovery

If interruption occurs during review:

- existing findings remain open until explicitly resolved;
- a new reviewer must read the exact reviewed HEAD and all open findings;
- a code change after review invalidates approval for the affected HEAD and requires the configured re-review;
- review verdicts are tied to exact commit SHA, not branch name alone.

## 10. Acceptance recovery

Acceptance verdicts are tied to exact artifacts and states.

If HEAD changes after a PASS, rerun the affected gates. If runtime or local main changes, post-merge/runtime acceptance must be repeated for the new identity.

Never carry a PASS forward because a previous version was similar.

## 11. Cross-system Sync Receipt

At each major gate, persist a Sync Receipt in Linear with:

```text
LINEAR_ID
NOTION_DECISION_REF (if applicable)
GITHUB_BRANCH / PR
EXACT_HEAD_OR_MERGE_SHA
ACCEPTANCE_GATE + VERDICT
RUNTIME_COMMIT / STATE (if applicable)
NEXT_GATE
```

Notion stores durable Owner/Product/Architecture decisions; Linear stores execution/checkpoint/acceptance state; GitHub stores exact implementation/spec evidence; Runtime remains the actual production truth.

If any system is stale or contradictory, reconcile before crossing the next gate.

## 12. Safety invariants

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

A quota, fallback model, handoff, or resume cannot change these invariants.
