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

### 支援的 Windows 路徑契約

本機絕對路徑須逐層檢查從卷根至保存區的現存目錄、實際 ACL、owner、canonical path 與身分；任何 symlink／reparse、未知形狀或權限仍 fail closed。缺少目錄／檔案只回不可用，不自動建立。此處的信任假設維持目前 Windows 使用者及 privileged SYSTEM／Admin 的 OS 維護控制面可信；不承諾防護已控制該使用者或 OS-admin 的攻擊者。

- 祖先 owner 可為目前使用者、SYSTEM、Administrators，或固定、完整比對的 Windows TrustedInstaller service SID。TrustedInstaller 只作祖先 owner 分類，不信任任意服務名稱／SID 前綴，不新增其 privileged Allow ACE 特例。
- 其他 SID 在現存目錄祖先只能有讀取／執行權利，外加 `FILE_ADD_SUBDIRECTORY = 4`。這能建立兄弟目錄，不能刪除、改名或替換已選定的現存 child；保存區 directory／file／lock 不使用此例外。
- 其他 SID 的 parent `DELETE_CHILD`、child 自身 `DELETE`、write-data、寫入 extended attributes／attributes、變更 DACL／owner、GenericWrite／GenericAll 及未知 bit 仍拒絕。任何危險 Allow 都保守拒絕，不以 child 的 Deny DELETE 抵銷 parent DELETE_CHILD，也不假設 Deny 永遠覆蓋 Allow。
- InheritOnly 只在該祖先本身不生效；每個實際 child 的有效繼承 ACL 仍另查。NoPropagate 不取消目前物件的有效權利，不由 reader 猜測展開後的權限。
- 保存區 directory／密文 file／writer-lock 的 owner 與 Allow 主體維持僅目前使用者及 SYSTEM。未知 owner、其他服務 SID、TrustedInstaller leaf 或其他 SID 的任何 leaf Allow 都不接受。

例如暫存鏈的 Other Modify `1245631` 含 DELETE 及其他寫入權利，仍不支援；不因葉層已受保護便略過祖先。既有按名稱的前後身分檢查不能取代原生 held-chain 對具 rename 能力對手的防護，因此本修正不放行這類祖先，也不修其 ACL。若需接納可被不可信使用者替換的 namespace，須另作安全模型與原生相對讀取設計審查。

服務建構不再為status建立AI receipt目錄。自動GET上次結果只讀原收據；未能確認仍在執行的舊請求，回傳中斷的回應副本，不改原收據、不探PID、不封存或接管舊lease。原請求／取消流程的安全鎖仍保留。

guest不啟用這些操作，未登入、錯Origin、CSRF不符或非空accounts request均拒絕。特殊隔離模式的寫入allowlist沒有擴大。

## 驗證界線

基礎回歸使用暫存檔、mock Windows安全adapter、純VM與handler harness；它們不等於原生Windows證據。另行批准的合成原生測試須分開記錄真實ACL、原生FS／DPAPI與合成ACL adapter的範圍，不把部分混合證據升格為完整原生安全正路。不得讀真vault／secret、啟OAuth listener或模型、改ACL或開候選窗口；正常Owner登入及現場驗收仍需分開驗證，CI／mock PASS不等於現場通過。

產品修正與窗口fixture維護是不同提交。本功能不開窗、不合併／部署，也不解除任何既有被拒操作或環境限制。
