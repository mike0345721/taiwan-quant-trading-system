# 勢衡收尾候選：休市、登入與唯讀啟動

這是 PR94（接續 PR93）的候選程式，未正式部署、未合併。年度日曆、歷史帳本與既有排程保持原樣。

## 行為與驗證範圍
- 營運日曆合併獨立雜湊的臨時休市例外；相衝證據拒絕。候選例外只有明確候選環境可以套用；未啟用時該日期保持 UNKNOWN，不宣稱開市。來源為券商轉載期交所公告，非直接下載的期交所原件。
- 歷史圖表的夜盤歸屬不被營運日曆重分類。Python 及 JavaScript 的即時行情期待依當下民用日期／盤別判斷；非交易時間、未知日曆、重試跨收盤均不重新訂閱或啟動橋接。
- 主首頁、API 及資料營運排程使用同一營運休市判定。休市保留歷史圖表、來源時間與品質限制，不能因快取仍新鮮而顯示合格即時判讀。
- 正常密碼／Session／CSRF 機制保留，QA 分支仍限 loopback:18722、指定完整 commit、基線與乾淨程式碼；版本 MISMATCH 不會改成正式同步。
- launcher 及舊版隱藏啟動入口不再附帶券商登入或背景回補；現有埠即使健康逾時也不重複啟動。橋接 helper 預設只回報 BROKER_START_NOT_REQUESTED。獨立啟動旗標不能取代 Owner 授權，且仍須通過日曆與埠檢查。

## 唯讀健康快照
在已審查的 worktree 執行：

```powershell
node scripts/inspect-readonly-health.mjs --candidate --port 18722 --expected-head <完整候選SHA>
```

只做兩個有逾時與大小上限的 loopback GET；不重試、不登入、不讀憑證、不啟停程序、不寫帳本。輸出保留 provider 原始 DEGRADED/PARTIAL，休市只改變新報價期待；無法連線、版本不明或真實資料錯誤仍顯示 ATTENTION_REQUIRED。這不是 LIVE 或正 EV 驗收。

## 開機啟動與回退
現有 bound-daily-use 入口具有綁定版本、程序身分、單次工作與期限收據；部署時應固定 launcher／producer／dashboard 各自完整 SHA，先 CheckOnly，再由 Owner 明確批准套用既有安裝流程。本次沒有安裝、改捷徑或改排程。休市不啟動新的 Shioaji；資料缺口不能由反覆登入修補。

候選回退：停止且僅停止本次 launch receipt 記錄的候選 PID／精確程序，確認18722釋放；保留失敗與成功收據。PR94 前一工程 checkpoint 為 5d7fb695a3735705be1667a293242ce7b6b992e7；用新 worktree 檢視舊版本，勿 reset 既有工作或把舊程式直接覆寫正式目錄。正式 main 固定 4d8251686bdb4abbdb469bc00ae798717c0fd583；未曾切換，無需執行正式回滾。不得複製舊 snapshot／checkpoint 回 live 資料根目錄。

## 必須保留的未完成項目
正常本人登入後真實 API／UI、開市時新 Tick+BidAsk、三個完整交易日稽核與最終 Owner 接受，必須各有本版本證據。合成版面／隔離認證測試不能取代上述驗收；原始缺日不補零、不重寫。監控採有界單次快照，未私自新增持續排程。正式啟動與部署仍需明確批准。
