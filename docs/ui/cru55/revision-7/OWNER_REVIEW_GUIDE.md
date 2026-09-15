# CRU-55 Revision 7 — 5-minute Owner Review

Status: PREMERGE_UI_V1_ISOLATED_PREVIEW_READY_FOR_OWNER_REVIEW

Source HEAD: `181e78d07dc5e3509c5ba769252b427ecfa7abb8`
Branch: `codex/cru-55-premerge-ui-v1`
Draft PR: https://github.com/mike0345721/taiwan-quant-trading-system/pull/69
Preview: http://127.0.0.1:3055/

## Open

Working directory: `D:/Taiwan stock/standalone-v1/data/worktrees/cru55-premerge-ui-v1`

```powershell
node scripts/start-cru55-preview.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b
```

Requires Node 24, lockfile dependencies, clean source HEAD, existing private isolated bundle, free port 3055. Current isolated PID 36664 is already running. Use the launcher's local bootstrap link if authentication expires; its token must stay local. No formal runtime startup is required.

## Review (5 minutes)

1. Normal AVAILABLE text is quiet; PARTIAL/WARMING/STALE/UNAVAILABLE remain explicit. Do the lamps and table still scan clearly?
2. Handoff leads with its unavailable reason; secondary endpoint cells stay restrained. Identity selectors and source trust remain distinct.
3. Inspect the Ask GPT slot: 1920 compact card, 1536 prompt bar, 1366 entry button. K-line/CVD heights are unchanged by the slot.
4. Open Ask GPT. Confirm actual contract/session/cutoff/source trust. Choose one of four question categories and type a draft. Send is disabled. Escape/close clears the draft and returns focus.
5. Select an unavailable month and reopen Ask GPT: no old market snapshot should remain. Restore 2026-09. Does the slot feel proportionate and the placeholder status obvious?

## Screenshots

| Viewport | Real DAY fragment | SYNTHETIC / UI DEMO |
|---|---|---|
|1920x1080|[Real](screenshots/day-1920x1080.jpg)|[Demo](screenshots/demo-1920x1080.jpg)|
|1536x864|[Real](screenshots/day-1536x864.jpg)|[Demo](screenshots/demo-1536x864.jpg)|
|1366x768|[Real](screenshots/day-1366x768.jpg)|[Demo](screenshots/demo-1366x768.jpg)|

[Assistant drawer at 1366](screenshots/assistant-1366x768.jpg)

## Scope and limits

Only `public/cru55-preview.html`, `.css`, `.js` and new `docs/product/CRU55_DECISION_ASSISTANT_INTERACTION_CONTRACT_V1.md` changed since Revision 6. Entire stacked PR has 11 additive files against accepted CRU-54 66de7e9a416e9f2386eed1c9e8688afea1b804ab.

Ask GPT is a UI placeholder: no model answer, backend, API, chat persistence or order capability. The contract documents future governed snapshot requirements; no snapshot producer was added. Real evidence remains short, STALE, capture UNPROVEN, with incomplete windows and unavailable adjacent Handoff. Existing lower modules remain accessible by scrolling. No fake full session or Live state.

Approved main/runtime d3702315b46a1a6c23384338ae40904b8bc589c2, CRU-52 and frozen producers remain untouched. No merge, rollout, Product Ready or Owner Accepted claim.

formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false
