# 勢衡｜交易員每日網站

目標：Owner 每天開機就能用的台指期看盤與交易計畫網站。路線見 ROADMAP.md，已定的決策見 DECISIONS.md。
這份檔案取代舊的 AGENTS.md 與 docs 內所有治理文件；兩者衝突時以這份為準。

## 十條規則

1. 資料不可動：`standalone-v1\data\live-events`、`standalone-v1\data\intraday\archive`、`standalone-v1\data\strategy-research`（紙上追蹤帳本，有雜湊鏈）、`standalone-v1\v2\data`、`forward`、`forward-shadow-backup`、日誌、`.env`、券商憑證檔。只讀，不搬、不改、不刪。
2. 不讀、不輸出 `.env`、密碼、token、憑證的內容。
3. 顯示用「顯示並標註可信度」，不要隱藏；只有動作才硬擋（資料不即時就不能建計畫卡、不能下單）。不補零，舊資料不冒充即時。
4. 價位、停損、目標、口數一律由規則程式計算並有單元測試；AI 文字只能引用這些值。價位與買賣力道只能寫成描述（在哪裡、距離多少、數字多少），不寫成方向建議；已測過無效的項目見分支 `claude/level-reaction-study-v1` 的 `research/level-reaction-v1/runs/RESULT_*.md`。
5. 階段 5 之前，程式裡沒有任何下單碼；Bridge 維持唯讀。
6. 一次一個工作包、一個分支、一個 PR。不做工作包沒要求的東西；想到別的，寫進 ROADMAP.md 的「想法暫存」。Owner 可以插隊，插隊也算一個工作包。
7. 修改分三級：
   - A 顯示與文案：做完告訴 Owner 怎麼看。
   - B 計算、資料管線、啟動：要有測試，開 PR；GitHub CI 綠燈後，Owner 說「合併」才合併。
   - C 下單、動原始資料、刪除或搬移既有檔案：先寫出計畫與回復方式，Owner 明確同意才做。
8. 測試只寫會擋住真實錯誤的：計算正確性、資料對齊、啟動流程。本機用 `npm run test:ci`；CI 顯示「0 checks」代表還沒開始跑，不是通過。
9. 完成的定義：Owner 在瀏覽器上看得到並實際用過。用繁體中文白話回報，不超過 15 行：改了什麼、怎麼看、沒做到什麼。不確定就問，不要猜；已寫明的事不要重複問。
10. 規則預算：這份檔案不超過一頁。要加一條就刪一條，而且只在真的出過事之後才加。

## 做之前要先問 Owner 的動作

停止或啟動常駐程序、改開機捷徑或 Windows 排程、更新執行目錄的版本（部署）、刪除或搬移任何既有檔案、合併或推送到 main。

## 專案停損

每個階段的工作包預算寫在 ROADMAP.md。用量超過預算的 1.5 倍還沒驗收，就停下來向 Owner 回報，不要繼續加碼。

## 環境

- 開發目錄：`D:\shiheng`（main 的檢出）。執行目錄：`D:\Taiwan stock\approved-main-runtime`。這份檔案的正本在 `D:\shiheng\CLAUDE.md`。
- 角色：Bridge 8790（Python，唯讀行情）、Producer（Node，算 Flow 投影）、Dashboard 8787（Node，`/healthz`）。
- 啟停：登入排程 `ShihengStartDaily` 跑 `scripts\start-daily.ps1`（看門狗，每 60 秒補起掉的程序）；`scripts\stop-daily.ps1` 停 Dashboard 與 Producer，不停 Bridge。
- 每日收集排程 `TwChipDashboard-DailyUpdate` 跑的是 `owner-acceptance-runtime\30978ea`（綁定檔 `_v2\daily-writer-binding-30978ea.json` 鎖版本），不是執行目錄；批次程式要更新得另做新版本目錄與綁定檔。
- 研究排程不可停、封存時不可移除：`TwChipDashboard-V4TrendPaper`、`-MultiMarketPaper`、`-PreopenCacheNight`、`-PreopenCacheDay`、`-PreopenReport`（紙上追蹤與開盤前報告，程式在 `standalone-v1\data\strategy-research` 與 `standalone-v1\data\preopen-report`）。
- 研究資料庫：`D:\Taiwan stock\standalone-v1\v2\data\research-v2.sqlite`。
- 啟動腳本一律用 Windows PowerShell 5.1（不是 PowerShell 7）。
- 已知：本機 3 個 symlink／hardlink 測試在 Windows 一定失敗；CI 的 Chrome 暖機逾時（exit 124）重跑即可。
