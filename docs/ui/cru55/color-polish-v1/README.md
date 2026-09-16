# CRU-55 Color semantics / icon polish — Owner review

Source HEAD `dd536a88a72ef49c1d793ae1448682a032428514` on `codex/cru-55-current-main-integration-v1`, Draft PR70. Base and formal runtime remain `d3702315b46a1a6c23384338ae40904b8bc589c2`.

Owner decision: Linear comment `83488359-d4f1-46f7-a813-05d425ed6b52`, 2026-09-16. No layout redesign. Only three files changed from prior reviewed `9f1bedd`: presentation mapper, bottom-card SVG/color presentation, semantic tests. No HTML/CSS/chart/controller/server/producer changes.

## What changed

- ALIGNED is fixed Teal, including aligned selling. It describes agreement, not price direction. Partial/Unavailable still gray; Warming/weakening/mismatch amber; opposite Alert Red. Existing MIXED quality gate remains PARTIAL/gray; no underlying enum or quality promotion.
- Futures icon: contract sheet with folded corner and position bars. Options: symmetric walls with center circle. Same existing badge, SVG size and stroke; other four icons unchanged.
- Breadth count micro-bar now uses fixed evidence colors, with explicit up/down/flat labels. Price preference is restricted to the existing price-bound surfaces.
- Existing toggle was already wired: candles, price text/percent and candle-derived volume flip. No BROKEN_OR_UNWIRED toggle was found. The ALIGNED mapping was a separate semantic presentation defect, now fixed.

## Browser acceptance

Real in-app browser at actual DOM viewport 1920x1080, 1536x864, 1366x768. Both price modes, both real DAY and explicitly SYNTHETIC demo: 12 captures. Three additional lower-card captures. Browser screenshot bytes exclude scrollbar/chrome margins (1905x1072, 1521x856, 1351x760); actual viewport values are recorded in browser-audit.json. Images were not resized or edited.

All 12 DOM checks: horizontal overflow 0, checked control/title/table clipping 0, visible formal text below 11px 0, duplicate IDs 0. Visual inspection confirms core chart stack and bottom cards remain readable; normal vertical scrolling remains available. Console errors/warnings 0 after final authenticated reload.

Six Taiwan/International comparisons: price text colors change, fixed DOM evidence colors identical. Actual rendered K and Volume pixel regions differ; CVD and signed DeltaCVD regions have exactly zero pixel difference in every pair. See pixel-comparison.json for coordinates and measured RGB differences. This uses real screenshot pixels, not chart configuration assertions. Demo demonstrates both positive and negative histogram bars; real short DAY fragment stays explicitly stale/partial.

## Review and tests

13 focused tests PASS (preview + context cards), including negative/zero ALIGNED fixed Teal, opposite/mismatch, partial/warming, source/cutoff invariance, null/reset gaps, signed DeltaCVD, auth and missing sources. First run had 12 PASS / one ENOENT because isolated test temp directory did not exist; created that directory and reran the same suite: 13 PASS. No test/guard weakened.

Structured current-agent code review of the complete 3-file delta: patterns PASS; error handling unchanged; semantic test coverage PASS; no layout/server/producer changes PASS. B0/S0, APPROVE for this small presentation delta. Previous independent integration reviews remain evidence for 9f1bedd, not relabeled as new independent reviews. Broader unchanged integration L0-L5, must-preserve, API and security evidence is linked below, not claimed rerun.

## Owner review (under 5 minutes)

Open http://127.0.0.1:3055/ in the authenticated local preview. Switch source to SYNTHETIC / UI DEMO, then switch top-right Taiwan / International; watch price/candles/volume flip while CVD/DeltaCVD/statuses remain fixed. Scroll to the six cards and compare futures contract-bars vs options wall-center icon. Return to real DAY to inspect truthful unavailable/partial states.

Launcher, from the source worktree:

`node scripts/start-cru55-integration.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b`

Prerequisites: clean exact source HEAD, existing local immutable bundle, approved-main-runtime at d370, Node and installed dependencies, free port3055. Launcher creates a private per-run access receipt; do not publish the access code. Current isolated process PID48172. Formal data read only; no collector or formal runtime activation.

Prior integration evidence: https://github.com/mike0345721/taiwan-quant-trading-system/tree/280ad8c6f32a71aed7ca429e2a8a77386cee0802/docs/ui/cru55/integration-v1

Known limitations retained: real CVD fragments are historical, not complete sessions; no lawful adjacent handoff/full4h; no fake Live, no GPT backend. This is an Owner preview/engineering handoff, not new GPT Product PASS or Owner acceptance.

`CRU55_PREMERGE_MERGE_READY_FOR_OWNER_GATE`

No Merge / formal rollout / intelligence / collector / GPT backend / execution.
formalWeight=0, researchOnly=true, executionAuthorized=false, orderRoutesEnabled=false.
