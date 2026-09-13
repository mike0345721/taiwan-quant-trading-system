# Daily Data Operations V1 — CRU-52 Phase A.2a

STACKED ON CRU-25 PR #58. NOT MERGEABLE TO MAIN YET. NO OWNER-FACING RUNTIME CHANGE.

本包把 A.1 日級驗收組合成營運評估，回答「哪些是必需且已到期、為何不完整、最小下一步、是否還在等待、驗收程式有沒有跑」。
只有手動離線核心；不提供 scheduler、API、Dashboard 或 collector/runtime 修復。

## Authority and dependency

- Owner/CRU-52 A.2a 授權；最新 approved main `9ac1cbf8c81789b6868fc8f4f2c20fd587d7ba2e` 的 AGENTS/governance governs。
- 功能依賴固定於 A.1 `63f03e0f3b4687e834b1da55e55e44fa3d56fc68`。不修改、rebase PR #58。
- CRU-51 的七個治理/Skill 檔與 A.1 十一個功能/規格檔無交集。
- A.1 report → operational profile → required-and-due → remediation → checkpoints → assessment → actual manual job receipt。

## Operational Profile V1

`src/daily-data-operations-profile.mjs` 是 `CORE_DAILY_DATA_OPERATIONS_V1`，不改 canonical registry。

| Role | Rows | Applicability / denominator |
| --- | --- | --- |
| CORE_INTRADAY_REQUIRED | tx_actual_trade, tx_best_quote | DAY/NIGHT，分開 feed/session；coreLive |
| CORE_DAY_CONTEXT_REQUIRED | equity_2330_raw_price, taiex_index | DAY；NIGHT NOT_EXPECTED |
| CORE_EOD_REQUIRED | taifex_daily_market, tx_futures_oi, tx_institutional_positions, txo_strike_expiry_cp_oi | 只有來源發布/已治理 due rule 可證到期才計 coreEod |
| SUPPORTING_OPERATIONAL_MONITOR | MTX/TMF Tick/BidAsk | datasetId=null；canonical gap 顯式，不計 core denominator |
| CONDITIONAL_CONTEXT | tx_large_trader, market_breadth_and_sector_leadership | 不是 core blocker；breadth 只表示 TWSE EOD，sector UNKNOWN |
| DERIVED_RESEARCH_READINESS | derived_pressure_response_efficiency | 只影響 researchReadiness，不計 raw denominator |
| FUTURE_NOT_ENABLED | txo_intraday_trade_quote_candidates, twn_futures, nq_futures | NOT_EXPECTED / NOT_ENABLED |

每列保留 datasetId、feedIdentity、role、sessions、dueRule、三種 blocker 及 governanceState。缺少 expected row 不會讓分母默默縮小，會建立 UNKNOWN row。未涵蓋 DAY 的 NIGHT-only A.1 input 不等於 whole-tradeDate PASS；其未評估 DAY 顯式 UNKNOWN。

## Due evidence and separate states

機器輸出 `coreLive / coreEod / supportingFeeds / researchReadiness / acceptanceJobHealth`，另保留 conditional/future rows。每列 `evidence` 是原 A.1 feed，capture/coverage/persistence/integrity/可用時間/原始原因不覆寫。`coreLive.captureState=PASS` 只表示收到資料；缺 native sequence 時 integrity/完整營運狀態仍可 UNKNOWN。Derived 缺失不修改 raw PASS。

`requiredAndDueCount` 是 core feed/session rows；DAY checkpoint 上限為 4 個 live rows，EOD/FINAL 是 6 個 live rows，另加最多 4 個可證到期的 EOD datasets。它不是 canonical dataset 總數，也不是研究成功率。未知 due 的核心 EOD 仍留在 coreEod 中、阻止假 PASS，但不假裝它已到期失敗。

EOD `DUE` 僅可由以下任一建立：

1. A.1 dataset-specific sourceDate、artifact SHA-256、observedAt、availableAt 都匹配且不晚於 A.1 cutoff。
2. 額外 frozen dueRules map：每個 key 必須是 core EOD ID，包含相同 datasetId/tradeDate、`governanceState=GOVERNED`、非空 governanceReference、sourceArtifactIdentity.sha256、observedAt、dueAt；observedAt 不得晚於 A.1 cutoff。此介面只承載已治理證據，呼叫端必須提供真實 reference；schema/雜湊不是 Owner 批准證明。

本次沒有提供真實 dueRules，沒有新增官方發布 threshold。`imported_at/fetched_at/built_at` 不改名為 availableAt。未知 due 是 UNKNOWN；已知未到期及 A.1 NOT_PUBLISHED_YET 是 PENDING。Stage PASS 不升為 dataset PASS。

單列營運狀態依 A.1 capture/persistence/integrity（live 另有 coverage）：任何 FAIL → FAIL，否則 PARTIAL → PARTIAL，否則 PENDING → PENDING，其餘缺證 UNKNOWN，全部 PASS 才 PASS。分組移除 NOT_EXPECTED 後：全部 FAIL → FAIL；任一 FAIL/PARTIAL → PARTIAL；其餘有 UNKNOWN → UNKNOWN、有 PENDING → PENDING、全部 PASS → PASS。Pending/unknown counts 及所有列仍顯式，聚合不消除它們。

Research 分組讀取 A.1 eligibility：READY→PASS、READY_WITH_LIMITATION→PARTIAL、NOT_READY→FAIL、UNKNOWN→UNKNOWN；raw prerequisites 和 derived rows 分開保存。Research PARTIAL 不代表全部 derived 已可研究。

## Checkpoints / finalization

- DAY_CHECKPOINT：只計 DAY live，NIGHT `inCheckpointScope=false`；EOD 依本次輸入 cutoff 如實呈現。只有 DAY 已結束或合法不適用，checkpointEligible 才 true。永遠不是 whole-date final。
- EOD_CHECKPOINT：組合 A.1 dataset evidence，並保存 NIGHT 狀態；NIGHT 可以仍為 PENDING。不是 whole-date final。
- FINAL_TRADEDATE_CHECKPOINT：DAY/NIGHT 都已結束或合法不適用、immutable cutoff 有身分、core live/EOD 無應等待 PENDING，才 finalized。缺證已確定 UNKNOWN 可以 finalize；final 不代表成功。
- 休市 finalized 狀態是 NOT_EXPECTED；不冒充成功交易日。

可選 `acceptanceInputs` 必須以 A.1 原純函式重建出所有原 report core fields 完全相符，才能讀其中 frozen `liveEvidence.sessionWindows`。此外必須綁定 A.1 evidenceInputs.calendar 的實體 SHA-256，驗證既有 governed calendar 與 A.1 DAY/NIGHT window 日期規則；metadata 單獨被改成舊年份不會使 checkpoint 提前通過。不掃原帳本、不新增 TradingDay 規則。沒有相符 metadata/calendar 的交易日報告可評估，但 session end 未證實，不可 finalize。原 CLI 的附加 evidenceInputs/evidenceGapMatrix 保留在 input report hash；不作為重建欄位。

時間進度用 **A.1 inputGeneratedAt** 判斷；晚一點執行同一份 pending input 不會自動升為 final。必須取得新的 A.1 report revision。歷史 DAY/EOD 評估若今天才執行，generatedAt 就是今天；不能宣稱當天 job 已跑過。

## Remediation Matrix V1

`src/daily-data-remediation.mjs` 提供 reasonCode → ownerLane/actionClass/off-session/trading-day/Owner decision/blocker/最小檢查/escalation。完整保留 A.1 reason，未知新代碼走 UNMAPPED_REASON_REVIEW，不猜根因。

Capture gap → source→subscription→callback→writer→ledger 的真交易日驗證；late start/scheduled-task failure → startup lane；reconnect/stale/writer/callback/queue → CRU49 runtime 或後續受控 lane；artifact/lineage → offline evidence；canonical/due semantics → Owner data governance；native sequence → accepted provider limitation；derived → CRU34/44 research。合法休市/未启用/未到期則 NONE/OWNER_SCOPE_CHANGE_ONLY/WAIT。Blocker flags 按該列 operational role 限縮。

`canFixOffSession=true` 表示可離線查既有 evidence/contract，不代表獲授權補採 raw、修改 runtime 或追溯消除歷史缺口。

## Manual invocation and job health

```powershell
node scripts/build-daily-data-operations.mjs --input=<frozen-A1-report.json> --acceptance-inputs=<matching-A1-replay-inputs.json> --checkpoint=FINAL_TRADEDATE_CHECKPOINT --generated-at=<explicit-zoned-time> --data-root=<local-data-root> --output-root=<data-root>/quality/daily-data-operations/<isolated-run>
```

Optional `--due-rules=<governed-frozen-map.json>`；`--calendar=<matching-calendar.json>` 預設既有 2026 calendar，仍須與 A.1 hash 相符。沒有自動化或背景服務。CLI 只讀明確指定的 JSON。

純 assessment 內 `acceptanceJobHealth.jobState=COMPUTED`，實際執行時間與保存成功維持 null；不可由 pure function 假證 disk write。真正執行結果在 `job-health.json` 與 immutable `runs/<runId>.json`：

- runMode 永遠 MANUAL_OFFLINE；沒有現存 job evidence 時 `readManualJobHealth` 回 NOT_RUN。
- RUNNING：實際 lastAttemptAt；SUCCEEDED：報告驗證/寫入完成，actual lastSuccessAt、artifact identity；先完成 health materialization，再保存 immutable success receipt。失敗 receipt 使用獨立 `.failed.json`，即使 receipt sink 故障也獨立嘗試保存 FAILED health。
- FAILED：錯誤 reason 與 ACCEPTANCE_JOB_FAILURE_NOT_FEED_FAILURE；保留先前 success/finalized 時間，不覆寫已成功的 feed assessment。
- lastFinalizedTradeDate/At 只隨合法 final 推進，較舊日期重跑不倒退。
- 輸出目錄本身不可寫時無法保存 failure receipt；CLI 非零退出為失敗證據，不宣稱 job-health 已持久化。

## Identity, history and safe output

Invocation hash 包含 tradeDate/checkpoint/generatedAt/inputReportHash/input file identity/calendarHash/acceptanceInputsHash/immutableLedgerCutoffs/dueRules/profile+matrix versions。reportHash 是除 reportHash 自身以外的 stable JSON SHA-256。原始 input 檔 bytes hash 與 semantic inputReportHash 分開標示。

輸出只容許 dataRoot/quality/daily-data-operations 下。所有既有 path ancestors/outputs 拒絕 symlink/junction 與多 hardlink file；輸出不得包含 inputs。exclusive manual guard 防止同 output root 同時寫入，未知/abandoned guard 不自動接管。

```text
YYYY-MM-DD/day/<reportHash>.json     immutable assessment revisions
YYYY-MM-DD/eod/<reportHash>.json
YYYY-MM-DD/final/<reportHash>.json
YYYY-MM-DD/day.json                 materialized checkpoint views
YYYY-MM-DD/eod.json
YYYY-MM-DD/final.json
latest.json
job-health.json
runs/<runId>.json                   immutable actual manual run receipts
```

同 input 重跑得到同 report/history identity；actual run receipt 另有新 runId/time。同時點不同 assessment 不默默覆蓋同 checkpoint view；新 evidence 要新 generatedAt。Materialized views 不回退至舊日期/時間。Immutable 檔已存在時只接受 byte-identical。檔案均 git-ignored；不得上傳 raw/local DB。

## Validation and remaining gates

Focused tests 覆蓋 Owner 的 22 類測試矩陣及 missing job/concurrent-output/history counterexamples；另跑 A.1 四組 focused regressions、syntax、diff check、secret scan。
真實評估使用 `data/quality/daily-collection-acceptance/phase-a1-20260912/final-63f03e0` 的 9/7、9/9、9/10、9/11、9/12 metadata，三 checkpoints 各重播兩次；receipt/hash 保存在本機 ignored outputs。這是本次 code 對舊 frozen observations 的評估，不是新 raw 掃描、當天 job 成功或五個自動化成功交易日。

Safety：`formalWeight=0; researchOnly=true; executionAuthorized=false; orderRoutesEnabled=false`。
不改 CRU34/44、Path30s、canonical IDs、Market State、Strategy、CRU49 runtime、public/server、startup/scheduler、Shioaji、collector、broker/order/position/risk/execution。

交付 gate：`CRU52_PHASE_A2A_OFFLINE_CORE_READY_FOR_GPT_REVIEW`。尚未是 Owner Accepted/Done；PR stacked Draft，不可 merge to main。A.1 merge sequencing、CRU49 runtime lane 釋放、A.2b scheduler/API/UI 與正式 rollout 均有後續 Owner gate。

Validator 驗 reportHash、invocationHash、必需 sections、profile row 完整性與分類、分母與摘要一致性、finalization 及 COMPUTED job contract；這不是外部資料簽章或 Owner 批准驗證。已凍結的全缺 ledger 清單可在 session 結束後 finalized UNKNOWN，不因無原始資料永遠等候。
