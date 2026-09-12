# CRU-50 中文變更卡與 C1–C8 evidence

工程候選／REAL_DATA_PENDING。尚未 GPT 獨立查收、Merge、正式部署或 Done。
Base `8756efabe3a54e49154ed2fe6a705a354607c69b`；branch `codex/cru-50-cvd-offline-core-v1`。
最終 exact HEAD、CI 和獨立 review 紀錄以本 PR / Linear checkpoint 為準；以下不冒充產品 L4/L5。

## 本次改了／沒改／間接影響

新增離線 CVD 純核心、獨立接續狀態、物理前綴驗證、不可變私有產物、CLI、歷史／Windows 驗證與維護對照。
實際 file allowlist 與功能→模組→來源→consumer→測試保存在 `CRU50_MAINTENANCE.json`，
`node scripts/cvd-audit-scope.mjs` 核對 actual diff + untracked，未知或共享變更即失敗。

未改任何共享演算法／resolver／lineage／frozen semantics；沒有 additive export。
未改 public、server、live writer、啟動腳本、Auth/CSRF、CI 排除、依賴、正式或 CRU-49 資料／程序。
既有 production entry 不會 import 新功能；沒有新 collector、port、RVOL 或基差。
間接依賴只讀 CRU-34 canonical/Pressure，以及歷史驗證所需 approved calendar/session classifier。
沒有產品執行接線，因此既有 consumer 路徑不變；這不是完整產品回歸已驗證的聲明。

## 改動／影響／回歸對照

| 功能 | 原版 | 候選 | 驗證及結果 |
|---|---|---|---|
| CVD 累積 | 沒有本包離線核心 | provider 原契約逐 tick 累積，UNKNOWN 獨立 | C1/C4/C5 工程 PASS |
| CVD 重啟 | 不適用 | 私有 state + source/prefix/cutoff 驗證 | C2/C3 全量／分批／resume／重跑 PASS |
| CVD 故障 | 不適用 | 不覆寫舊有效產物，錯誤 sink 受保護 | C6 注入與真實子程序競爭 PASS |
| Pressure/Response/Path | approved base 實作 | source bytes 未改 | 84 項既有 focused 回歸 PASS |
| 原正式／CRU-49 UI/API | 既有版本 | 沒有改動或啟動 | 本包 L4/L5 NOT_APPLICABLE；不冒充 runtime PASS |

## C1–C8

| Gate | 結果 | Evidence / limitation |
|---|---|---|
| C1 | PASS 工程 | BUY/SELL/UNKNOWN、量守恆、Pressure 同範圍對照、no observations、全 UNKNOWN、simtrade/duplicate、非法 price/volume、overflow |
| C2 | PASS 工程 | full/chunks/serialized resume 等價、後續 append 不改既有 prefix、semantic hash 可重現 |
| C3 | PASS 工程 | same-time distinct ordinals、不重算相同 record；wrong source/prefix/offset/checkpoint/schema 拒絕；原有效產物保留 |
| C4 | PASS 工程 | contract/date/session/epoch、Tick-only/partial BidAsk 恢復、未知身分、non-TX 非單調 receivedAt、idle 與長間隔不歸零 |
| C5 | PASS 工程 | physically later/future quote 不影響過去、late tick 使用合法較舊 quote；輸出 HISTORICAL_OFFLINE |
| C6 | PASS 工程 | truncate、write/fsync/link/error-sink 注入、兩個真正 child 競爭發布；Windows FileShare.None 實際拒絕讀取、解除後恢復、fixture bytes 不變 |
| C7 NIGHT | PASS 有界真實歷史 | 下方來源／hash／期間；分類品質受限，不代表全盤完整或 LIVE |
| C7 DAY | REAL_DATA_PENDING | 選定舊 physical prefix 不符 CRU34_SAFETY_BOUNDARY_INVALID；不改 safety、不改 raw、不宣稱 DAY 通過 |
| C8 | PASS source/focused | 無共享 diff，84 existing focused tests；新增 tests 進既有 default CI、沒有 skip／排除。CI 結果看 exact HEAD PR |

工程 fixture 和真正歷史分開。Windows sharing test 是私有 ENGINEERING 檔案的真實 OS sharing 行為，
不是對正式檔注入故障、不是 CRU-49 race 修復或全天可靠性證據。

## 真實歷史 C7

僅選定 `data/live-events/2026-09-12.ndjson` 與 `2026-07-30.ndjson` 的前 1,000 實體記錄。
沒有尋找整日 DAY offset、沒有過濾後重編 ordinal、沒有全 D 槽掃描。最多 16 MiB/run 讀取 buffer；
計算和 prefix verify 有界，完整資料、產物與詳細 checkpoint 只保留 worktree/data/cru50-private。

NIGHT：實體來源 `2026-09-12T00:00:00.021086+08:00`–`00:00:25.521438+08:00`；
1,374,480 bytes；1,000 physical records。TXFI6／2026-09-14／NIGHT／TX:1，
日期沿用既有 governed resolver，沒有新 TradingDay 定義。
TX 28 valid ticks、29 contracts；buy16 / sell11 / unknown2；CVD +5；coverage 27/29。
QUALITY_INSUFFICIENT / CLASSIFIED_COVERAGE_INCOMPLETE；quote matched19 contracts、conflict1。
TX 最後觀測 ordinal911 / availableAt `2026-09-12T00:00:22.397854+08:00`，
不是以產物生成時間取代資料時間。sessionStartProven=false；native missing sequence count=unknown。

- Prefix SHA256: `4f1bbdd152fe37800ae89af28d2ba378989135c84ee80367496de87930cb7fa8`
- Cutoff record hash: `2b296b82bb6d267aa5ea511ecbe1e953be0d2e5dca8f1f2415be93efe75a405c`
- Semantic SHA256: `706f583624db532c1f13a6910f32ee54dae0254d291303a649a892065ef552f4`
- Full vs 137-record JSON-checkpoint chunks: PASS。既有一次候選觀測 693ms、peak RSS 111,898,624 bytes；最終版本重驗耗時保存在 PR/private evidence，不把此時間當固定效能保證。

DAY 選定來源：`2026-07-30T09:17:17.682271+08:00`–`09:35:31.042043+08:00`；
1,511,582 bytes / 1,000 physical records，只有 stock_tick/index_quote。
Prefix SHA256 `269de88c78e7a0b8f67d739dd045c1c1408990943456fd1ef7e39f0c6a114463`。
舊 physical record 的 safety 欄位不符現行 canonical 契約；完整重算／DAY CVD NOT_RUN。
這只說明本次選定的有界 prefix 不可用，不推論全資料庫沒有任何 DAY ticks。
DAY 後續需要明確可治理的 TX physical prefix 或合法的既有起點證据；本包不為補驗改來源或 frozen semantics。

## 已驗／待驗／回復

已驗：純計算、接續、私有 I/O、source isolation、上述回歸及有界 NIGHT。
待驗：DAY 真實合規 TX 切片、GPT 最終獨立查收；Level3 reviewers/exact HEAD 見遠端紀錄。
沒有 L4/L5/live/UI 交付要求，不使用 55e78c1 舊影片或 CRU-49 evidence 替本包背書。

回復：本包未安裝，停止離線 CLI 即可；保留私有產物／raw。
舊 approved code 不讀此 schema，不把 CVD checkpoint 塞入 CRU-49／正式 checkpoint。
不需要重啟 formal server/producer，不 rollback ledger 或刷新舊 timestamp。
詳細相容、重跑與資源限制見 `CRU50_CVD_OFFLINE_CONTRACT.md`。

formalWeight=0、researchOnly=true、executionAuthorized=false、orderRoutesEnabled=false。
