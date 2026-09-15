# CRU-55 — isolated preview validation / resume packet

## Identity and authority

- Work item: [CRU-55](https://linear.app/cruise41319/issue/CRU-55/pre-merge-ui-integration-v1isolated-dashboard-preview-responsive).
- Authorized scope: isolated responsive Dashboard integration only; Owner-visible preview followed by Owner review.
- Source HEAD: `0d5996707fbad7266753c41fba3ad832ee3919ca` (clean).
- Branch / PR: `codex/cru-55-premerge-ui-v1` / [Draft #69](https://github.com/mike0345721/taiwan-quant-trading-system/pull/69).
- Accepted feature/base: `66de7e9a416e9f2386eed1c9e8688afea1b804ab` / Draft #68, open and unmerged.
- Approved formal main/runtime baseline: `d3702315b46a1a6c23384338ae40904b8bc589c2`; local main verified unchanged. Original local audit-report modification was pre-existing and untouched.
- Worktree: `D:/Taiwan stock/standalone-v1/data/worktrees/cru55-premerge-ui-v1`.
- Isolated runtime: `127.0.0.1:3055`, PID 28864 at evidence capture; process lifetime is local, no Scheduler/service installation.
- Private bundle: `ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b`.
- Reporting/evidence branch: `codex/cru55-ui-evidence-v1`. This branch stores documents and screenshots, and is not the runtime source. Its base was the earlier reviewed source; every final artifact explicitly binds the final source HEAD above.

CURRENT-only rehydration read CRU-55 full issue/Owner authorization, latest project status, CRU-54 Phase E GPT PASS and force-light decision, AI Project Entry Point, Delivery & Acceptance Doctrine, Lessons Register, Remote Reporting & Authority Contract, Final Dashboard UI Blueprint, AGENTS, current main sources, and accepted contracts. CURRENT_STATUS/KNOWN_ISSUES remain supporting historical snapshots. No new Owner product decision was made, so Notion Blueprint was not changed.

## Changed source scope: exactly 10 additions

```text
public/cru55-presentation.mjs
public/cru55-preview.css
public/cru55-preview.html
public/cru55-preview.js
scripts/cru55-synthetic-demo.mjs
scripts/prepare-cru55-preview.mjs
scripts/start-cru55-preview.mjs
src/cru55-preview-bundle.mjs
src/cru55-preview-server.mjs
tests/cru55-preview.test.mjs
```

No production entry point or inherited source file changed relative to accepted CRU-54. The accepted producer/semantic modules and original price palette module are reused unchanged. Draft #69 is stacked on #68 to expose only CRU-55's delta; it does not integrate either candidate into main.

## Engineering evidence

Final-head command (normal Windows identity; sandbox temporary-directory path inspection is restricted):

```text
node --test --test-reporter=tap tests/cru55-preview.test.mjs tests/cvd-chart-projection.test.mjs tests/cvd-relationship-projection.test.mjs tests/cvd-session-context-projection.test.mjs tests/cvd-handoff-projection.test.mjs
```

**64 tests PASS, 0 fail** — see [tests.tap](tests.tap). Tests cover frozen CVD/relationship/context/handoff semantics, segment/null/reset behavior, signed bars, identity/safety/kind tampering, bounded reads before allocation, hard-link rejection, timeline lineage, handoff scope labels, and authenticated memory-only HTTP behavior. The HTTP test replaces filesystem open/read functions with failure traps after load, and exercises all windows, query rejection and safety flags.

Independent reviews, final exact HEAD:

- **Isolation APPROVE**: B=0, S=0. Earlier file-read cap and synthetic relabel findings repaired and re-reviewed; subsequent edits did not change importer/server. Reviewer independently passed focused tests and 43 HTTP assertions, then verified final HEAD carries identical isolation code.
- **Presentation APPROVE**: B=0. Earlier lineage time, unavailable scope, stale-value clearing, precision, pane sizing and marker-copy overlap fixed. Final one-line label offset preserves chart attribution.

These are engineering verdicts, not Owner acceptance. No merge is authorized. GitHub Actions returned no PR workflow runs for the prior pushed head; this receipt relies on the recorded local suite and actual browser checks, not invented CI green status.

## Browser acceptance

Actual browser: Codex In-app Browser. Exact source HEAD is rendered into the page and recorded by DOM audit. Six canonical viewport JPEGs were captured with explicit viewport-sized clips (no image resizing/editing). Full-page images additionally show accessible lower modules.

| Viewport | K / Volume / CVD / Δ pane px | Largest core bottom, real / demo | Verdict |
|---|---|---|---|
| 1920×1080 | 313 / 49 / 124 / 53 | 1007.05 / 1021.05 | PASS |
| 1536×864 | 187 / 29 / 74 / 33 | 801.14 / 815.14 | PASS |
| 1366×768 | 179 / 28 / 71 / 31 | 753.61 / 767.61 | PASS |

Pane measurements exclude separators and the time axis. K-line is ~58%, CVD ~23%, implemented with the chart library's stretch factors; CVD visible-range autoscaling remains independent. No forced common zero scaling flattens the CVD path. Its zero reference is visible when in range; ΔCVD always includes zero.

All three sizes, real and synthetic:

- Blocking console errors **0**; horizontal overflow **0**; visible formal text below 11px **0**; duplicate IDs **0**.
- Core cards within viewport, core text overflow **0**, inspected chart labels clear: **PASS**.
- Fast Scan and right table share the same enum/state/tone for all six windows: **PASS**.
- Same-cutoff CVD endpoint invariance: **PASS** in all 18 real DAY / real NIGHT / synthetic × timeframe combinations: **295 / 5 / 2026**, respectively.
- CVD segment/null truth; signed Δ bars; Session Context; Handoff; Data Trust; PARTIAL/WARMING/UNAVAILABLE: **PASS** from frozen tests, new mapping tests, real states and rendered demonstration. WARMING/null/reset cases are regression fixtures, not claims that the real captured market currently has those states.
- Original lower modules accessible through navigation and evidence drawers: **PASS**. Both accepted price palettes, fit range, all 10 detail categories, timeline, and local snapshot copy verified.
- Deliberate session invalidation cleared prior answers, endpoint, panes and Δ direction color; login recovered. Expected 401s in that fault test are recorded separately from normal-operation console errors.

See [browser-audit.json](browser-audit.json) for measured rows, rectangles, state pairs and test-head provenance. Earlier unchanged interaction/failure code checks are explicitly tagged with their tested heads; final viewport and 18 switching checks were re-run on final HEAD.

## Real data and truth limits

| Source | Accepted scope | CVD | Price | Truth |
|---|---|---|---|---|
| DAY 2026-09-07 | observed 42.928 seconds | +295 | 1 lawful K bar; observed Volume 773 vs price-subset Volume 55 | STALE; capture UNPROVEN; all windows PARTIAL |
| NIGHT 2026-09-14 | observed 22.394 seconds | +5 | 0 lawful K bars; strict Price Δ unavailable, accepted Response -2 retained separately | STALE; capture UNPROVEN; all windows PARTIAL |
| SYNTHETIC / UI DEMO | observed 2 hours, synthetic | +2026 | 121 minute bars | Explicit synthetic banner; 4h PARTIAL; never mixed with real background |

- No lawful adjacent real Handoff: unavailable. The DAY display's candidate prior NIGHT is later-dated; the frozen handoff rejects adjacency. Display does not imply continuity, official open/close, cross-gap CVD or path.
- VWAP absent from accepted isolated price payload; familiar chart location is retained with UNAVAILABLE. No new VWAP producer or inferred input was introduced.
- Lower modules use a separate **2026-09-10** read-only public-market snapshot and are clearly STALE. Index Contribution/current Risk remain unavailable; historical option expiry walls are not current pressure advice.
- Real negative cumulative endpoints, warming windows, full-session proof and adjacent handoff are not available in these captures. Their governed regression tests do not become real-market evidence.
- Real original Dashboard HTTP entry at 8787 was unavailable during this session. The original product skeleton and palette were inspected in approved main source; formal runtime was not started to obtain a comparison screenshot.
- Chrome automation returned a client-blocked navigation; browser acceptance used the functioning IAB. No browser security bypass or reduced protection was used. Mobile production/cross-browser production acceptance is outside V1.
- Preview is pinned to a sealed offline bundle. Refresh re-reads its in-memory projection/freshness, not a live stream. Session token and bundle stay local.

## Isolation / reads and writes

Importer verifies accepted clean CRU-54 worktree and unchanged frozen modules, re-validates two sealed context bundles through the accepted read-only loader, and imports the specified public-market aggregate snapshot. Writes are only content-addressed bundles in `data/cru55-private/bundles` (exclusive create).

Launcher verifies clean isolated branch, reads bundle/vendor/static assets once, writes a private session receipt and binds loopback 3055. The HTTP path reads memory only; host/origin checks, per-run token, HttpOnly SameSiteStrict cookie, CSP, bounded bodies and allowlisted GET routes are enforced. No raw/SQLite, Shioaji, broker, order, scheduler or formal collector capability exists in this preview route.

Evidence branch contains screenshots, source hashes and sanitized reports. No `.env`, tokens, private bundle, raw ticks, SQLite or formal evidence artifacts are published.

## Owner gate / next exact action

Owner opens the real preview and follows [the 8-minute guide](OWNER_REVIEW_GUIDE.md). Unresolved UI questions are Owner judgments: familiarity with original Dashboard, preferred scan density, CVD slope readability, exact Path value versus density, handoff placement, duplication between selected change and Session Context, lower-card scroll distance, and deep-blue consistency.

Stop only after GitHub/Linear evidence and readback:

`PREMERGE_UI_V1_ISOLATED_PREVIEW_READY_FOR_OWNER_REVIEW`

No Product Ready, Owner Accepted, formal integration, merge or rollout. CRU-52 natural operational validation remains independent.

`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`
