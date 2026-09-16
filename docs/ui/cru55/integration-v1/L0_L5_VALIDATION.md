# Integrated L0 → L5 evidence

Source `9f1bedd0e6036ead82b55a225edb6533fef38d7b`, branch `codex/cru-55-current-main-integration-v1`; exact final runtime PID48576 / localhost3055. Evidence captured 2026-09-16. No formal runtime activation.

| Layer | Engineering finding | Evidence |
|---|---|---|
|L0 scope/semantic|PASS: latest Owner IA freeze, Visual Gate 1 preserved; no GPT/execution/producer semantics|CRU55 c90142d1 Owner comment + current Blueprint; source audit|
|L1 source integration|PASS: current main ancestor; clean candidate, core original files identical; 15 integration files|source-audit.json; independent reviews below|
|L2 dependencies/build|PASS: actual Node24 launcher, local chart vendor loaded/rendered, authenticated original app available|screenshots, startup/API receipt; lockfile dependencies|
|L3 producer/data chain|PASS for integration wiring: existing formal producer verified read-only with original path/identity checks; no new producer enabled|producer-readonly-audit.json. Source LIVE at 09:19:54; 1m/5m QUALITY_INSUFFICIENT is coverage truth, not missing path|
|L4 real API|PASS: 37 actual HTTP checks, accepted DAY/NIGHT endpoints295/5; source dates and main APIs actual governed data|api-audit.json|
|L5 browser|PASS for tested engineering scope: no steady-state overflow, important control/text clipping, duplicate IDs or <11px visible text; original capabilities reachable|39 DOM audits, 18 window operations, replay, card routing, selector/drawer/Ask evidence and screenshots|

## Tests at final HEAD

- [focused-tests.tap](focused-tests.tap): 13/13 PASS (10 preview + 3 context cards).
- [security-tests.tap](security-tests.tap): 4/4 PASS.
- [cvd-tests.tap](cvd-tests.tap): broad run **77 PASS / 12 refused by frozen CVD_ISOLATED_WORKTREE_REQUIRED**. The 12 artifact/materializer tests did not execute their full assertions on this branch. They are NOT PASS and NOT a tool failure. The accepted producer's guard only allows its CRU-54 branch; it was deliberately not modified. Projection/core/API semantics that do run passed. Existing accepted CRU-54 artifact/GPT PASS evidence remains tied to 66de7e9, not relabelled this HEAD.
- No full unrelated repository suite run. No new source behavior depends on changing the frozen artifact producer; candidate consumes the accepted sealed bundle and validates its hash.

## Browser result details

Official sizes 1920×1080 /1536×864 /1366×768, actual UI clicks through six primary entries and their contextual sections. Overview has no sidebar; functional sidebar expanded175/190px, collapsed46px. All six cards reachable and five navigate correctly; Risk drawer opens.

18 source/window combinations: DAY endpoint+295, NIGHT+5, demo+2026; all six Fast Scan data-code/state agree exactly with corresponding Relationship rows. Unsupported month clears CVD, changing back restores it. Ask Send disabled, Escape clears draft and focus returns to ask-open. Native settings, trust, risk, Handoff drawers open with correct titles. Replay resets 1/60, increments2/60, restores60/60. Main price/VWAP/volume/Flow is visibly rendered from current producer in the same candidate URL.

One intermediate `options-1536` sample caught legacy small text between data insertion and the existing candidate font-floor animation frame. `options-loaded-1536` is the settled recheck at unchanged HEAD: zero small text. Original raw record retained; final screenshot replaced before evidence publication. No overflow/clipping record was nonzero. Browser tool timeouts interrupted batching; persisted records were resumed and the missing 18th window completed. No browser timeout was counted as a product PASS.

[overview-console.json](overview-console.json): empty error/warn list. [workspace-console.json](workspace-console.json): one expected `[V2_BACKTESTS] V2_BACKTEST_NOT_READY` from original research API503. UI shows unavailable with reason; this optional missing report is nonblocking. Do not claim all console output is empty.

## Independent review

- isolation reviewer: APPROVE B0/S0 at b30c4da, unchanged server/config/launcher scope carried to exact 9f1bedd, producer JSON independently captured.
- presentation reviewer: initial 4df1699 REQUEST_CHANGES because normalized DOM wrapper would hide entire spot group; fixed in9f1bedd to direct section children, re-reviewed APPROVE B0/S0. Browser spot/futures focus verified.

Engineering approval is not GPT/Product acceptance or Owner acceptance. This pack supplies the requested integrated evidence for the next Owner/GPT gate. Final visual comfort and Merge authorization remain Owner decisions.

## Honest limitations

Real overview DAY9/7 is ~43seconds, one valid K; NIGHT9/14 ~22seconds with no valid K. Both STALE/observed fragment/capture UNPROVEN; full sessions, adjacent real Handoff, full4h, VWAP/OI within the fragment unavailable. Background 9/15 data is independently dated; Global NDX/SOX9/9 and USDTWD9/10 are historical. True NQ/TWN, accepted contribution ranking and missing formal backtest report remain unavailable. Synthetic mode is UI demo only and suppresses real background. No execution, GPT backend or new intelligence.
