# CRU-35 Browser and Adaptive Acceptance Evidence

Status: `READY_FOR_GPT_REVIEW_AND_OWNER_BROWSER_ACCEPTANCE`

This evidence is for review only. It does not approve merge, mark CRU-35 Done, start a live materializer, promote CRU-34 evidence, or authorize execution.

## Exact implementation under test

- Branch: `codex/cru-35-observed-flow-evidence-ui-preview-v1`
- Authoritative base: `ef7c8054c05e816297f0a36317cbfc1ec8aee7a7`
- Implementation commit: `d3703ff50da5e249b9915cac9a0fff581eb42a11`
- Implementation tree: `5906b2886ad50d6762ef86af2d2112735c52c97a`
- Browser observation time: 2026-09-02 08:28-08:46 Asia/Taipei
- Runtime: production server path, loopback only, `MOCK_DATA=0`, read-only UI, one governed CRU-36 artifact
- Browser authentication: one-time local acceptance credential; the Owner password was not read or changed

Governed artifact evidence:

- Source state / mode: `HISTORICAL` / `HISTORICAL`
- Actual contract / date / session / epoch: `TXFI6` / `2026-08-28` / `DAY` / `TX:2`
- Source ledger identity: `sha256:cd029bf442fffdcd2cf39e7e3b43ca7df8689a1a90674a05dec65bcfe1611900`
- Semantic content hash: `f96bf8c37e67e5c4203df4460dca0af6ad613690d897bb9bd61a483d27da81de`
- Artifact hash: `5687a10d97fd41f00a891190264a33cc0d2ee65d11a96ec8d802ff1c2f313127`
- Research quality / formal direction: `QUALITY_INSUFFICIENT` / `NOT_PROMOTED`
- Classified coverage: 60s `97.9%`; 300s `98.3%`

## Required desktop checkpoints

The measurements use the browser's exact inner viewport. K-line clipping checks the chart owner, stage, host, and all chart canvases. Observed Flow clipping checks the card, comparison chain, trust block, and drawer trigger. Drawer vertical scrolling is allowed; viewport or horizontal clipping is not.

| Viewport | K-line / Observed Flow visual-area ratio | Horizontal overflow | K-line clipping | Observed Flow clipping | Duplicate IDs | Visible formal text below 11px | Meaningless bare dash |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1920x1080 | 2.96 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1680x900 | 2.32 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1536x864 | 2.84 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1440x900 | 2.86 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1366x768 | 2.56 | 0 | 0 | 0 | 0 | 0 | 0 |

Every checkpoint also observed:

- dashboard load state `READY`
- seven K-line canvases present
- K-line precedes supporting evidence and has at least 1.8 times the Observed Flow visual area
- prominent `HISTORICAL · 2026-08-28` plus `非目前盤勢`
- visible `−1 ← 0 → +1`, `window displacement`, and `0 winding · 1 direct` semantics
- `QUALITY_INSUFFICIENT`, `NOT PROMOTED`
- `60s 97.9% · 300s 98.3%`
- blocking console errors: `0`

## Continuous adaptive sweep

- 29 exact inner-width samples
- Widths: 1920 down to 1380 in 20-pixel steps, plus 1366
- Heights: 1080 at 1920, 768 at 1366, and 900 for intermediate samples
- Boundary samples explicitly include 1620, 1600, 1580, 1400, 1380, and 1366
- Failures: `0`

At every sample:

- horizontal overflow `0`
- K-line clipping `0`
- Observed Flow clipping `0`
- core clipping `0`
- duplicate IDs `0`
- visible formal text below 11px `0`
- meaningless bare dash `0`
- K-line precedes supporting evidence and visual-area ratio remains at least `2.16`

The sweep found and the implementation fixed one bounded reimplementation defect: the shorter supporting-card height caused internal card scrolling after drawer focus restoration. The corrected tier height preserves `scrollTop=0` without reducing K-line primacy.

## Evidence drawer acceptance

At 1366x768:

- one click on `查看證據 >` opened `Observed Flow Evidence`
- panel bounds: left 811, right 1351, top 0, bottom 768; width 540
- drawer clipping `0`; horizontal overflow `0`
- required evidence present: `BuyProxyVolume`, `PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE`, `NOT_PROMOTED`, and `artifactHash`
- Escape closed the drawer
- focus returned to the exact Observed Flow trigger
- original card `scrollTop` returned to `0`
- source technical detail remained `display:none` outside the drawer

## Refresh fail-closed acceptance

The production DOM regression verifies that `DASHBOARD_REFRESH`:

- changes load state to `UNAVAILABLE`
- replaces all 60s / 300s pressure, response, path, coverage, quality, and source values with an explicit unavailable reason
- removes prior `BuyProxyVolume` detail
- disables evidence copy

The manual `更新畫面` failure path now calls the same `reportDashboardLoadError(error, 'DASHBOARD_REFRESH')` handler; a regression contract prevents the manual path from retaining prior values.

## Verification commands

- `npm.cmd run test:ci`: PASS, 558 passed / 2 governed skips
- `npm.cmd run test:windows`: PASS, 37 passed / 0 skipped
- `node --test tests/trader-terminal-ui.test.mjs tests/dashboard-observed-flow.test.mjs tests/dashboard-decision-workspace.test.mjs`: PASS, 41 passed / 0 skipped
- `node --test tests/trader-terminal-production-dom.test.mjs`: PASS, 5 passed / 1 optional real-runtime skip
- `npm.cmd run security:scan`: PASS
- `git diff --check`: PASS

## Owner browser handoff

Use [CRU_35_OWNER_BROWSER_REVIEW_GUIDE.md](./CRU_35_OWNER_BROWSER_REVIEW_GUIDE.md). The exact local URL is `http://127.0.0.1:8788/`, and the guide is designed for a review of 10 minutes or less.
