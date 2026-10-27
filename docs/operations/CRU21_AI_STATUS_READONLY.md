# CRU-21｜AI狀態查詢唯讀契約

正常登入頁自動查詢AI狀態，只檢查目前保存區的存在性、安全性與密文外形；不初始化或修復vault、不執行ACL setter、不建立writer-lock、不解密權杖、不刷新token、不連provider。缺失、不安全、正被寫入或無法確認時顯示不可用，不以自動修權限取得成功。

## 使用流程

1. 自動 `GET /api/v1/ask-gpt/status` 回傳啟用狀態與明確原因。發現密文只代表有保存資料；帳號與訂閱資格尚未讀取／驗證，不宣稱已連線。
2. 本人明確按「讀取已儲存帳號」才以正常Session、Origin與CSRF保護的 `POST /api/v1/ask-gpt/accounts` 讀既有合法store的帳號metadata。這個讀取不建新store、不改ACL、不刷新token；合法既有帳號不需重做OAuth。
3. 缺store或安全條件不合格，保持不可用。原「連接／重新授權」仍是另一個明確設定動作；status或讀取失敗不會自動啟動它。
4. 模型目錄與分析仍需各自明確操作、原有授權與用量確認，沒有自動模型請求或付費備援。

## 儲存與安全邊界

status只回allowlist metadata，沒有路徑、密文、account token、帳號數或假定的可用訂閱。現有密文無法在不解密下證明DPAPI內容有效，因此顯示PRESENT_UNVERIFIED；明確讀取帳號若發現解密／schema失敗，仍fail closed。

Windows既有store讀取須通過原app-owned範圍、reparse／symlink／hardlink、檔案大小、ACL與writer-lock檢查；只查詢安全狀態，不修復。原DPAPI CurrentUser與跨程序writer lease保留。初始化與寫入只留在原有明確設定／請求流程，讀取既有store與初始化不再共用入口。

服務建構不再為status建立AI receipt目錄。自動GET上次結果只讀原收據；未能確認仍在執行的舊請求，回傳中斷的回應副本，不改原收據、不探PID、不封存或接管舊lease。原請求／取消流程的安全鎖仍保留。

guest不啟用這些操作，未登入、錯Origin、CSRF不符或非空accounts request均拒絕。特殊隔離模式的寫入allowlist沒有擴大。

## 驗證界線

本輪使用暫存檔、mock Windows安全adapter、純VM與handler harness測試。它們不執行真實Windows ACL／vault／DPAPI、不讀secret、不啟OAuth listener或模型、不連MSI。Windows原生、正常Owner登入與候選窗口仍需分開驗證；CI／mock PASS不等於現場通過。

產品修正與窗口fixture維護是不同提交。本功能不開窗、不合併／部署，也不解除任何既有被拒操作或環境限制。
