# Repo-scoped Agent Skills Attribution

## addyosmani/agent-skills

- Repository: `addyosmani/agent-skills`
- Pinned commit: `f63ec56a3cc936408d792956ae583c3c96a825bd`
- Installed paths:
  - `skills/frontend-ui-engineering`
  - `skills/debugging-and-error-recovery`
- License: MIT; see `LICENSE.addyosmani-agent-skills`.

## michael-denyer/pstack-claude (port of Lauren Tan's pstack)

- Repository: `michael-denyer/pstack-claude`
- Pinned commit: `0dcb9cc049764a4a11aaf3aa32ae064832ee8ac9` (VERSION `0.9.133`)
- Installed paths (from `plugins/pstack/skills/`):
  - `principle-explain-the-number` — verbatim
  - `principle-prove-it-works` — verbatim
  - `blast-radius` — verbatim
  - `show-me-your-work` — **local fork**: adds a "Project overlay" block under the title; the rest is verbatim
- License: MIT (c) 2026 Lauren Tan, (c) 2026 Michael Denyer; see `LICENSE.pstack-claude`. Upstream provenance is in that repo's `NOTICE.md`.
- Not installed on purpose: `poteto-mode`, `automate-me` (they rewrite how the agent works and conflict with "Skills are tools, not governance"), `swarm`, and every other pstack skill.
- Companion skills these files mention (`how`, `why`, `arena`, `unslop`, `benchmark-checklist`, `poteto-mode`, `reflect`) are not installed. Treat those references as optional; a missing companion is not a reason to stop or to install it.

To update: re-copy the four directories from a new pinned commit, re-apply the overlay block to `show-me-your-work`, and update this file. Do not install additional pstack skills without Product Owner approval.

---

These third-party skills are repository-scoped engineering aids. They do not
override Product Owner decisions, `AGENTS.md`, Linear scope, project specs,
repository governance, evidence rules, or trading safety invariants.
