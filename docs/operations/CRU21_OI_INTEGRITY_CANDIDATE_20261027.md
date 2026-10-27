# CRU-21｜2026-10-27 法人期貨 OI 一致性隔離修復候選

> **狀態：CANDIDATE / NOT DEPLOYED / NOT DATA_REPAIRED / OWNER_APPROVAL_REQUIRED。** 此分支來自已批准 main `4d8251686bdb4abbdb469bc00ae798717c0fd583`，與 CRU-21 UI PR #97 exact `398b38daeb9e4c05e0c744d576a6646fa392d37e`、Market State、正式 MSI 8787 完全隔離。本分支不得自行 Merge 或正式套用。

## 來源證據與範圍
- 10/27 08:55:04 的既有品質收據：`institutionalFuturesOiConsistency` 1,610 筆比對中 `internal_mismatch_rows=38`、`cross_table_mismatch_rows=0`。
- 一個可重現例子：2026-07-15 自營商，既有資料庫多方 7,573／空方 5,221／淨額 -664；MSI 上由原有期交所月資料快取讀取的對照三欄為 3,941／4,605／-664。快取數字符合 `3,941 - 4,605 = -664`；資料庫三欄卻不能互相證明。快取不是自動認定的正式更正權限。
- `v2/scripts/backfill-domestic-institutions.mjs` 每次執行 `reconcileDomesticInstitutionNets`；原邏輯遇到跨表淨額不一致會單獨覆寫 `open_interest_net`，即使長短倉位的數字不支持該淨額。此路徑可能造成不一致或掩蓋來源差異；**不能因此斷言 38 筆全部由它造成**。

## 候選修正
- 只在 `open_interest_long`、`open_interest_short` 與目標 `final_net` 均為安全整數，且前兩者相減確實等於目標淨額時，才允許原本的「淨額一致化」。
- 否則原始 detail 值不變，回報 `blocked[]`（原因 `SOURCE_LONG_SHORT_FINAL_NET_CONFLICT`）；保留 `INSTITUTIONAL_OI_NET_MISMATCH`／`INSTITUTIONAL_OI_ARITHMETIC_MISMATCH` 品質錯誤，不以清零或遮蔽解決。
- 不執行歷史重下載、不自動重算 38 筆、不修改 Ledger/Market State/TXO/下單/研究權重；此修正屬**防止不一致擴大**，不是宣稱現存 38 筆已修復。

## 隔離測試與驗收條件
1. 僅在乾淨、獨立的候選副本執行 `node --test v2/tests/domestic-institution-backfill.test.mjs v2/tests/taifex-position-parser.test.mjs`，不得對 MSI 正式資料庫執行匯入或更正。
2. 測試「目標淨額與原始多空欄位衝突」：不得改寫 detail，`blocked` 要明確，品質仍 FAIL。
3. 測試「多空欄位確實支持目標淨額」：只允許該例原有的 net-only 同步，且稽核通過。
4. 真正修復 38 筆前，另以最新可信期交所原始資料和 SHA 對照每筆日期、機構與來源版本，產出**限定欄位**的 before/after 差異、零資料覆寫的診斷收據，並經 Owner 精確核准備份／回復及單 writer 資格。
5. 2026-09-02／09-03／09-09 仍各為 `AUDIT_INCOMPLETE`；`Market State` 既存 Manifest HEAD 不符與 10/23 例外治理亦各自保持 HOLD，不因本 PR 通過改稱修復。

**授權邊界：**不讀取憑證、不 Broker 登入、不啟停 Bridge/Producer/Dashboard、不改原始帳本或正式排程、不合併／部署、不啟用下單路由。CI 成功不代表 10/27 日資料合格或 Owner UI 接受。

## 2026-10-27 MSI 實際只讀來源對照收據（後續補充）
- 在**隔離候選程式副本**執行 `node v2/scripts/inspect-domestic-oi-cache-readonly.mjs`，以程序內環境變數 `CRU21_OI_READONLY_SOURCE_ROOT` 指向原有 `v2` 報告與期交所 CSV 快取。工具只開啟固定 `reports/latest-quality.json` 與 `data/domestic-institution-cache/*.csv.gz`，不讀憑證、不搬移任何原始資料、不改 SQLite、行情帳本或快取。
- 收據：`READ_ONLY=true`，`STATUS=REVIEW_ONLY_HOLD`，`INSPECT_EXIT=2`，`REVIEWED=38`，`REPAIRED=0`；全部 **38/38** 在本機既有 CSV 快取中找到算術一致且淨額匹配的候選三欄，分類 `CANDIDATE_PENDING_SOURCE_VERIFICATION`。不是 `PASS`，沒有真實修復。
- 來源真偽與「當前最新」仍須從期交所官方回查、檔案 SHA/日期/型別逐筆綁定；即使 38/38 在快取吻合，也**不得自動 UPDATE DB**。未核准前原有 38 筆 QC FAIL 持續存在。
- 隔離測試（截至本次候選更新前）：`domestic-institution-backfill.test.mjs`、`taifex-position-parser.test.mjs`、`inspect-domestic-oi-cache-readonly.test.mjs` 共 **10 PASS / 0 FAIL / 0 SKIP**；之後版本須重驗。
