# CRU-21｜人工決策日誌與結果回顧 V1

本次補齊原V1人工日誌功能：自行評估信心、記錄是否執行、查看當時保存的快照摘要，以及追加人工結果。這不是策略、交易執行、績效計算或研究模型。

## 使用流程

1. 在正常登入工作臺鎖定快照，選擇Long intent／Short intent／No trade，填理由、條件與失效條件。
2. 可選填自評信心（低／中／高，**不是勝率**）與是否執行；未填保持未知，不補成零或已執行。
3. 儲存後，在決策回顧展開「查看當時快照（摘要）」：核對當時時間、完整快照hash、契約／盤別、價格、Flow與資料限制。只讀原保存值，不會改用目前盤況。
4. 在「人工結果與執行紀錄」選是否執行、原判斷／條件是否遵守，或填自行觀察的結果說明，再明確按「追加人工結果」。可繼續追加新的觀察；舊紀錄保留，不提供覆寫或刪除原決策。

編輯中的結果草稿及正在送出的表單不會被背景歷史刷新清空。未送出的內容可明確清除；送出結果不確定時保留輸入、不自動重送，使用「查回已存結果」檢查保存紀錄後再決定。不能僅憑錯誤回覆就斷言沒有寫入。當次尚未有合法結果就顯示「尚無人工結果」。

## 儲存與API契約

- 原決策仍在既有私有append-only journal；原有行、snapshot與recordHash不重寫。
- 新決策行可含 `confidence: LOW | MEDIUM | HIGH | null`、`executionStatus: UNKNOWN | EXECUTED | NOT_EXECUTED`。舊資料缺少欄位仍可讀，顯示未填／未知。
- 人工結果使用獨立的私有append-only hash chain，依原 `decisionRecordHash` 關聯，自動綁原snapshotHash；不讓caller改snapshot、時間、路徑或安全資格。
- 結果欄位限 `executionStatus`、`thesisStatus: UNKNOWN | FOLLOWED | VIOLATED | NOT_APPLICABLE`、`outcomeNote`（最多1000字）。全部未知且無說明會拒絕，不製造無資訊結果。
- 結果追加在獨占writer guard內讀取／稽核／寫入／再驗證，並比對實際讀取版本的檔案身分與內容；已存在或未知guard直接拒絕，不自動接管。程序中斷留下的guard必須保留待有權維護者查明，不能為了儲存而自行刪除。
- `GET /api/v1/decision-journal` 保留原 `data` 陣列，另提供經驗證的 `outcomes` 陣列。任何鏈或關聯損壞就拒絕，不傳半份看似正常資料。
- `POST /api/v1/decision-journal/outcomes` 使用原正常Session及CSRF保護；不擴大特殊隔離模式的write whitelist，不新增跨來源或未認證入口。

人工結果不寫入研究Forward evidence，不替換原快照，也不觸發行情、模型、訂單或服務操作。資料缺失／過期／品質不足仍保留原狀態。

## 明確沒有完成的後續能力

這版可回顧**人工登錄**的結果，不自動計算30m／60m／EOD、MAE/MFE、PnL、違反thesis統計或增量價值；這些需要另行凍結輸入、時間與研究契約。研究頁既有costed Outcome/OOS模組，不代表已與Human Journal建立自動linkage。

Entry Quality、最強反向證據等未凍結衍生能力仍不能藉人工日誌升格成市場判斷；沒有新策略、方向分數或正EV宣稱。

## 驗證界線

本輪使用合成暫存檔與純VM／DOM controller測試，驗證原decision bytes不變、舊資料相容、結果追加／關聯／hash／權限邊界，以及草稿／送出生命期。實際命令、計數及精確版本以同版PR收據為準。

沒有重試被阻的HTTP／browser或現場操作；本輪純離線測試不代替正常Owner G7、資料供應商／模型可用性或部署驗收。舊版CI／MSI收據不冒充這次新HEAD通過。

安全維持 formalWeight=0、researchOnly=true、executionAuthorized=false、orderRoutesEnabled=false。Draft only；Merge及正式部署另需明確批准。
