# CRU-55 current-main integration candidate V1

Owner IA freeze: Linear CRU-55 comment c90142d1-a798-4468-a5c8-33ce0940c352 and Notion Blueprint, 2026-09-16.

## Scope

Opt-in main server mode only, isolated branch `codex/cru-55-current-main-integration-v1`, port 3055. Default server startup and original main public/index.html, app.js and frozen CRU-54 producers remain unchanged. No Merge or rollout.

Overview has no sidebar. Primary navigation is exactly 總覽 / 台股現貨 / 台指期貨 / 選擇權 / 海外市場 / 研究回測. Functional workspaces retain original DOM IDs and API/listener behavior behind contextual navigation. Settings and Data Quality are utilities. Six context cards route to their corresponding workspaces; Risk opens evidence.

K/Volume/CVD/ΔCVD/Relationship/Session use one accepted isolated bundle cutoff. Existing main live chart / VWAP / replay remains accessible in 台指期貨, separately identified; it is not spliced into pinned CVD.

## Source and isolation

Approved main/runtime d3702315b46a1a6c23384338ae40904b8bc589c2; accepted CRU-54 66de7e9a416e9f2386eed1c9e8688afea1b804ab; Owner Visual Gate 1 source 181e78d07dc5e3509c5ba769252b427ecfa7abb8.

Launcher checks clean isolated branch, formal HEAD, accepted bundle digest; copies bounded public aggregate snapshot/history into candidate private runtime. Reads formal SQLite with readOnly + query_only. Raw/SQLite/credentials never copied or uploaded. Input receipt binds seed/context hashes and per-source dates. All session, journal and chart cache writes stay in candidate private root. Main auth/CSRF is reused with a distinct cru55_main_session cookie. Random candidate password, no formal .env/password inheritance. Collector/update startup and routes disabled. Manual journal remains candidate-private only.

Bottom cards are independently dated EOD/historical context. Missing is not zero. No fabricated contribution ranks, TWN/NQ, live Global, OI series or model summaries. Micro visuals use raw accepted values only; no intelligence score. Ask GPT interaction contract remains unchanged, with no backend or draft persistence.

## Acceptance pending

L0–L5, current HEAD browser click-through at 1920/1536/1366, capability/freshness matrix, must-preserve comparison, independent engineering review and remote readback are required before declaring CRU55_PREMERGE_MERGE_READY_FOR_OWNER_GATE. Owner final visual/merge authorization remains separate. A local WIP commit is not acceptance.

formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false.
