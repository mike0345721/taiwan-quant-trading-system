# 每日資料健康摘要 V1：唯讀證據投影

## 修復範圍與版本

本次依 Owner 2026-10-25 明確授權接續資料完整性修復。在雲端獨立分支
`codex/daily-data-health-evidence-20261025`，從正式 main
`4d8251686bdb4abbdb469bc00ae798717c0fd583` 實作。此文件與修復在同一 commit；
最終 exact HEAD、審查與驗證結果記於 Draft PR／任務交付。

開工與驗證前均以遠端 refs 核對下列候選，皆未合併：

| 來源 | Exact HEAD | 本次處理 |
|---|---|---|
| PR94 | `c7cf3e77f543cbeda85fca5270d8a4ade1130472` | 已有 operating calendar、10/23 休市例外及 bridge/dashboard readonly health；不重做 |
| PR97 | `398b38daeb9e4c05e0c744d576a6646fa392d37e` | 疊於 PR94 的預開市／exact identity gate；不改其 lane |
| PR98 | `cade4804987d92f27328e79f0690ecb2477267c8` | 正式入口／開市 SOP；不改 MSI binding |
| PR99 | `0adc6926f098cef07eaef2e7e0fe398a29042d58` | T0→Outcome／corpus Stage 1 候選，與資料營運摘要無重複 |

PR99 的 137 sessions、133 signals、4 no-trade、143 source hashes unchanged 是歷史作者收據；
本輪沒有重跑。qualified-day count 仍 null，OOS 0 不構成新研究資格。
main 的 10/23 年度日曆缺口仍須依既有 PR94/97 候選流程解決，不能把本 PR 當成日曆修復。

## 已證實的缺口與行為

1. `projectDataOperations` 原先丟棄 A.1 已有的實收筆數、首末時間、observedAt、availableAt、逐項 researchEligibility。
   現在以白名單 `evidenceSummary` 投影，不公開 DB／ledger 路徑、raw payload 或完整 sourceArtifactIdentity。
2. 缺 `job-health.json` 原先顯示 `NOT_RUN`。這不能證明遠端沒有執行；改為
   `UNKNOWN / JOB_HEALTH_UNAVAILABLE`。有效失敗收據仍是 FAILED；有效未到期排程仍是 NOT_DUE。
3. 原有頁面新增小型 `dailyHealthBrief`，分開顯示排程、實收證據、cutoff 驗收、既有研究前置資格。
   今日排程日期與保存評估日期不一致時，今日數量與資格保持 null／UNKNOWN，舊評估仍清楚標日期。

本次只讀現有受保護 `GET /api/v1/data-operations` 與既有 immutable assessment/receipt reader。
沒有新增 collector、API 路由、權限、排程、雲端同步、來源下載、DB migration、服務或執行指令。
沒有改 A.1/A.2a 判定、available_at、日曆、cutoff、raw／frozen 證據、資格或交易權限。
`runtimeVerified=false`、`executionAuthorized=false`；此摘要不能代表 MSI 即時 active/full。

## 小型摘要資料契約

既有 `dashboard-data-operations-v1` 加入 `dailyHealthBrief`，schema 為 `daily-data-health-brief-v1`。
辦公室可讀既有頁面或已授權 API 的此欄位；本 PR 不自動推送或另建每日任務。

| 欄位 | 口徑／未知規則 |
|---|---|
| tradeDate / observedAt | 既有 scheduler reader 的日期及讀取時間，不是行情最後時間 |
| assessmentScope | CURRENT_DAY_SNAPSHOT / OTHER_DATE_SNAPSHOT / UNAVAILABLE；當日快照也不等於最新市場狀態 |
| assessmentTradeDate / reportHash | 保留原評估日期與 A.2a identity，供回查 |
| scheduler | 保留 completion、punctuality 與三 checkpoint 狀態；成功只證明驗收工作完成 |
| received | 本 checkpoint 原始來源的資料／時段列數：assessedRows、withRecords、zeroRecords、unknown。排除 derived、future、NOT_EXPECTED 及 checkpoint 範圍外列；各筆數不跨資料集加總 |
| cutoffAssessment | 直接保留原 overallState、inputGeneratedAt、checkpointType、requiredAndDueCount；不重算或升格為全日合格 |
| researchPrerequisites | 既有壓力／價格反應／效率前置條件 state；不是所有策略或 corpus qualification |

每資料／時段列另提供原 researchEligibility 及 `evidenceSummary`：

- `recordCount` 為 A.1 所引用檔案的非負整數筆數，未量測為 null；0 不證明檔案存在。
- `expectedRecordCount=null`：目前沒有治理完整的應收逐筆數，不能用實收數反推應收數。
- `firstReceivedAt`、`lastReceivedAt`、`observedAt`、`availableAt` 與 `sourceDate` 保留原語意。
  首末接收不等同 exchange timestamp；EOD 檔案有列數但缺 cutoff 前 observedAt/availableAt，仍不可認證當時完整。
- `missingIntervalCount`、`duplicateCount`、`timestampErrorCount` 目前都是 null。
  A.1 沒有提供這些數字；absence of reason、capture PASS 或首末跨滿時段均不能推導為 0。
- 涵蓋、保存、完整性、reasonCodes 與處置仍分別顯示；缺段可見 LATE_START、STALE_DELIVERY、CONTINUITY_BREAK 等既有原因，未量化數量仍未知。

休市、尚未到期、未知到期、失敗、品質不足沿用各來源既有判定；不新增「週末免收」規則。
原始日曆或 due rule 不正確時，此顯示修補不能替代其治理修復。

## 歷史證據與不能修復之處

主對話提供的新 MSI 唯讀查核：10/22 TX DAY 約 09:53 起、NIGHT 晚啟動／重連／stale，
overall PARTIAL、EOD UNKNOWN；9/29 排程成功但資料 PARTIAL，大額交易人當時缺，
晚間補入不可倒填 18:10 available_at。9 checkpoint 與 36 receipt/acceptance/inputs hash 吻合；
事後六類日表 805/805 覆蓋不能證明 cutoff 前 complete。
這些是主對話提供的 MSI 查核結果，並非本輪雲端重新讀取或重算的現場證據。

回歸測試用合成資料重現「晚啟動」「排程成功但 PARTIAL」「805 列晚於 cutoff」等限制，
不是把合成資料認證為上述日期的實況。歷史未收到的逐筆無法由本次軟體修補補回；
沒有早期 publication／retrieval／commit 證據，也不能重建當時 available_at。

MSI Git Permission denied 與三項 DataOperations CIM 拒絕仍維持停止；本輪沒有重試或繞路。

## 責任、流程與現場驗收

| 責任 | 下一步與交接 |
|---|---|
| 資料部主責 | 按 source/date/session 維護應收、due、實收、缺口、來源時間與證據索引；提供小型 metadata，不搬整批私有行情 |
| 工程部協作 | 本 PR 交付摘要與未知狀態修正；後續僅對已證實第一故障環節修補。既有 calendar 用 PR94/97，不重寫 collector |
| 研究部限制 | 依用途別資格取資料；晚啟動／缺段區間不得宣稱全日逐筆回測，晚到 EOD 不得進早期決策；corpus null 不變成可用日數 |
| 風控驗收 | 查核日期、契約、時段、hash、cutoff、缺值與研究限制；job 成功不替代資料完整，READY_WITH_LIMITATION 不等同無限制使用；合併／部署仍需 Owner 流程 |

最小現場證據需求，先重用已取得的 9 checkpoint／36 收據，不重跑歷史收集：

1. 實際 approved runtime commit、active binding、calendar／exception hash；main 和候選分開。
2. 1–3 個指定日期既有 A.1、inputs、A.2a、checkpoint 指標及引用收據的脫敏小型 JSON／hash。
3. 四核心 EOD 的 publication、retrieval、寫入時間與來源 revision；缺證維持 null。
4. 既有 bounded audit 的首末時間、缺段／重複／時間錯誤與範圍摘要；沒有量測時回 unknown，不能只看尾端樣本。

驗收順序：資料部核對 identity／應收 → 工程核對 reader 投影與 API/UI 一致 →
研究部確認可用用途 → 風控確認限制 → Owner 決定候選採用／合併／部署。
不需要新原始行情下載、重跑 PR99 linkage、啟動交易或更改 MSI 任務權限。

## 驗證與狀態

- 雲端 Node v24.19.0；新增合成回歸與既有 data-operations、scheduler、API/UI 測試。
- 對 PR94 exact HEAD 的隔離 worktree 檢查補丁相容性；不變更 PR94 branch 或正式環境。
- 未啟動每日排程、行情登入、MSI 服務、長時間回放、部署、下單或新策略回測。
- 這份工作完成的是雲端候選修補；現場完整日驗收、全 corpus qualification 與虛擬辦公室其他功能不在本輪完成範圍。
- 瀏覽器對本機 preview HTML 的讀取被環境管理政策以 `ERR_BLOCKED_BY_ADMINISTRATOR` 拒絕，已停止，沒有替換存取路徑。畫面／鍵盤驗收仍待可用環境；VM render、跳脫與讀取測試另有結果，不冒充瀏覽器成功。

Review 強度為 Level 2：新增 Dashboard Data Contract 投影；不修改 timestamp lineage 或資格規則。
需 Current Agent 與一位獨立 reviewer 無 Blocking Finding 才能 Engineering APPROVE；不等同 Owner 批准。
