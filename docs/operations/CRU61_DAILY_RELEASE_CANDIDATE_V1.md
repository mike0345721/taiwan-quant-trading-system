# 勢衡每日使用版：發布邊界與驗收契約

本輪屬 CRU-61 已授權穩定性與交付工作，沒有新增策略。此文件記錄可審查的程式與操作邊界；實際 exact SHA、CI、程序、時段和驗收結果以同版交付收據為準。未取得實機證據的項目不能用本文件升格為 PASS。

## 收斂的版本

實際共同基線為 main `4d8251686bdb4abbdb469bc00ae798717c0fd583`。既有 PR109 `356d49500229410e826039672e16b0a36e2a0edf`、每日獨立修補 `e1ce4f2583c5a7ba9affa378441f41ce6da9e478`、PR110 整合 `3aeb847`／接線修補 `4d667a5` 有直接 ancestry。本輪繼續唯一候選分支 `codex/cru61-smc-cvd-profile-v1`，不啟第三套服務。

PR109／110 不是相對 main 的獨立完整產品。發布審查須保留以下必要父層，不能僅挑兩個 PR 的 diff，也不逐一自動合併舊 PR：

| 元件 | 必要內容與可追查 commit |
| --- | --- |
| 原登入、日誌、Review、Outcome | `a4afb07`、`3c7fb6f`、`f3a4ee4`，原 Session／CSRF 與 append-only 日誌 |
| 價格、圖表、Flow、RVOL、Pulse | `463540a`、`51a7f9b`、`8e323de`、`3add90a`、`be19556`、`374b5c4`、`8839540`、`32a2790` |
| 每日資料、導航、候選 reader | `ab31284`、`23f8f92`、`7b23a5e`、`6dd7ca8`、`03718a1`；含 `613ebf3` 五檔 wire 修復 |
| 固定入口與程序身分 | 既有 bound startup supervision、singleton 身分驗證及 ReaderOnly 防止來源重複啟動 |
| AI 關閉及正式 HTTPS | `45a5422`、`54a1abe`；靜態 import 所需 AI 模組保留，但不啟用帳戶或推論 |
| 午夜排空 | `e1ce4f2` 的 runner 與 `cru34-calendar-rollover.mjs` 一起發布 |
| 三模組持續處理 | 本輪私有 SQLite 歷史、分批推導、完整性驗證、暖機恢復與來源位置 |
| 每日 writer | 本輪來源 tuple／NULL 保留、來源衝突隔離及 TAIFEX 後處理與回退狀態 |

離線 OOS／ablation 工具不加入日常啟動鏈，不作策略效益的發布依據。原有研究檔與證據保留。AI 始終 `DISABLED_BY_OWNER`；`researchOnly=true`、`formalWeight=0`、`executionAuthorized=false`、`orderRoutesEnabled=false`。

## 容量與資料語意

LIVE 使用既有 chart worker；請求 8 秒、V8 old generation 256 MiB／young generation 32 MiB、一個 active／一個 queued，health 只 peek 已有結果。V8 上限不是整個程序 RSS 上限。

完整每日版本使用 Node 22.13+ 的 22.x 或 Node 23.4+，因私有歷史使用無需旗標的內建 SQLite；本機測試 Node 24.18.0，CI 使用 Node 22.x。啟動不符版本時在服務監聽前明確失敗，不把舊圖表能啟動當成三模組相容。

1. 來源：驗證原始 canonical checkpoint bytes/hash，最大 96 MiB／250,000 retained events；冷起始最多取 20,000 筆 canonical 片段。來源 physical hash、原／縮減 checkpoint hash、ordinal、byte offsets、availableAt 分開揭露。
2. 請求：來源驗證、持久化 verified input、每次至多 2,000 筆推導、歷史驗證及 legacy cache 遷移各自有界。未完成的來源不發布成完整快照；重啟沿已封存 input/cursor 繼續。
3. 記憶體：最多兩個開啟 store／resident source，SQLite page cache 每個 8 MiB，temp 在磁碟、mmap 關閉；完整 quote/trade/point 保存在私有 SQLite。私有 schema 在一個 transaction 建立，避免每個 DDL 各做 durable commit。
4. 儲存：每個 derived store 最大 4,194,304 頁（預設 4 KiB 頁約 16 GiB）；沒有任意刪除 quote、舊點或原始 ledger。不同日期的 store 保留，總磁碟需求隨天數增加，須按實測每日用量規劃，不宣稱無限容量。不得靠清空 store 偽造相同 CVD 起點。

   scoped 候選允許唯一 `market-observation` 子目錄及已知 cache/SQLite/暫存檔名；拒絕 nested directories、symlink／hardlink 與超過 4,096 entries 的 namespace。此為啟動／請求路徑檢查預算，不是整盤事件容量；達限時明示停止並保留檔案，不能偷偷刪歷史。已識別的 SQLite rollback journal／原子暫存檔消失競爭不誤拒整頁。
5. 畫面：K 線最多 400、CVD 分鐘點 2,000、價位 bins 2,000、事件 200、區域 100；這些顯示限制不改累積量或原始分類。SMC 計算上限來自 2,000 bars 的可推導事件數，保留合法較早活動區域。

私有交易同時提交資料、索引摘要與 cursor；chunk receipts／row hashes 驗證重啟歷史。舊 JSON cache 先驗 bytes，再以不複製整個物件圖的 canonical hash 驗 fragment，分批遷移，不改原 cache。UNKNOWN、品質、原始 ordinal、event time／availableAt、合約／盤別／交易日／epoch、晚到與時鐘倒退均保留。

歷史 cutoff 先從 availability covering index 取得可知的最大 physical ordinal，再限定 profile 尾端與交易端點查詢，保留 `availableAt`／event time 過濾，不假設時間順序等於原始順序。至多 256 筆 cutoff 索引 memo 於私有 transaction 提交或外部檔案變動後失效；當分鐘 CVD 查詢使用相同語意的時間範圍索引。完整盤負載已保存的資料可在獨立副本重新驗證歷史查詢，不覆寫原 FAIL 收據。

完整 raw history、可得 canonical fragment 與冷 Producer checkpoint 是不同證據範圍。冷來源沒有的 noncanonical 歷史或跨 GENESIS 連續性不可還原。全量／增量／重啟比較必須使用相同可得資料，不宣稱冷片段是完整盤。

容量驗證以官方 TX 夜盤 15:00 至次日 05:00 的 14 小時為最長盤別。來源三個固定範圍速率樣本只是估計，不是全天速率上界；以 20 events/s、3 quote:1 trade 的合成整盤驗證 1,008,000 events，另外用實際 retention 函式產生四小時 checkpoint，再交原 worker。保留每次 FAIL、CPU/耗時、RSS/heap、來源位置與結果雜湊，最終同版收據才決定容量 PASS。

## 每日資料與畫面

每張來源卡與來源表顯示 data date、source time（來源未提供則未知）、last successful fetch、last attempt、目前狀態與原因。六種狀態為 `NOT_DUE`、`SOURCE_NOT_PUBLISHED`、`JOB_NOT_RUN`、`JOB_FAILED`、`STALE`、`AVAILABLE`。Dashboard fetch 與 Windows scheduled batch 明確分列，不把其中一者成功當成另一者完成。

來源完整 tuple 更新保留 null；歷史不一致只回報隔離原因，不以另一來源的單一 net 值改寫 long/short。當日獨立合格 artifact 仍按原時間／身分契約發布，整批失敗繼續顯示 FAIL。TAIFEX cache fallback 保留原取得時間與失敗原因，不能覆寫歷史成功收據為今天成功。手動重跑不是排程驗收。

三模組已驗證但尚在追趕新來源時保留舊 snapshot／cutoff 並標 WARMING_UP；僅已知追趕狀態使用 250ms 單一請求重試，正常輪詢維持 5 秒。真實錯誤清楚顯示並可恢復，不影響原價圖或整頁。

## 發布及回復：三個版本 pin，兩個產品服務角色

固定入口定位為 **MSI 本機**。`127.0.0.1`、手機 viewport 或 D 槽 HTML 均不是手機遠端入口；沒有既有受信任通道時不開公網。

正式版本上版沿既有 `cru21-dashboard-rollout.ps1` V4；`switch-bound-dashboard.ps1` 只用於同版 reader routing，不可冒充版本升級器。固定既有快捷入口沿 `install-bound-daily-use.ps1`，所有啟動仍核對版本、路徑、程序／埠身分；不以健康 HTTP200 取代登入、資料或完整功能驗收。

發布提案須各自列出：

- Dashboard：最終 reviewed SHA/tree、原 formal SHA/root、TLS bundle／trust／handshake 真實收據、設定差異與正常登入證據。
- 既有 singleton Producer：原 launch receipt pin、目標 exact pin、checkpoint／ledger 身分、受控停止／接續窗口。Dashboard 切換不會自動部署午夜修補。Bridge 不重複登入或啟 collector。
- 既有每日排程 writer：實際 task action/root、目標 exact pin、原 schedule；不新增第二個 collector／排程。只讀 fixture 或候選修補不等於正式 writer 已更新。

回復保存原來源、設定雜湊、部署 plan/hash、程序 fingerprints、各次失敗日誌、四個入口的原檔及 hash。Dashboard 依原 V4 plan 回復；Producer 另按其剛核對的身分與原 pin 接續；入口 Restore 僅恢復原四檔。不得回灌舊 checkpoint、SQLite、ledger 或成功收據，不把回復到舊缺口稱為新版本 PASS。

原 TLS／native preflight 自動安全拒絕在沒有受支援的正式處理結果前保持 `BLOCKED_UNRESOLVED`；不換工具、命令或請他人代跑。Merge、正式切換和來源操作的缺少授權只能在最終 exact 版本、測試、功能矩陣與回復包完成後提出具體最小動作。

## 實機交付 gate

必須在同版本正常登入下，核對導覽全部既有功能、API／圖表／摘要／Copy 同 snapshot、適用時段至少三點來源→畫面前進、至少 60 分鐘有界觀察、日誌跨頁／重新登入／程序重啟持久化、桌機／手機尺寸、冷啟／重複啟動與恢復。故障注入限隔離環境。未重開機記 `REBOOT_NOT_RUN`；非交易時段或平台阻擋記 NOT RUN／BLOCKED，不能用 replay、fixture、測試項數或計畫取代固定入口。
