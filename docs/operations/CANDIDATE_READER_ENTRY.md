# 候選 ReaderOnly 入口

`scripts/start-research-workbench.ps1` 以既有本機入口 r4 為基礎，加入候選 V2 治理讀取身分檢查，保留 UTF-8 BOM。預設模式仍為 `OpenExisting`。本檔與入口程式不構成正式安裝、啟用、部署或切換授權；沒有變更 C 槽入口、正式 binding、8787、8790 或排程。

`ReaderOnly` 僅供已有明確授權與 exact HEAD binding 的候選 18723 使用。Bridge 與 Producer 都必須已存在且身分合格；本模式不會啟動收集器或 Producer。不存在候選時，僅在全部來源與設定檢查成功後啟動候選。重複開啟會核對現有程序的版本、讀取邊界與實際健康身分，缺值或不符時拒絕，不自動替換程序。

唯一允許的每日資料 manifest 是既有治理版本 `b9577adc91155c490f0c3845ba387ca410e90e2110a321a27c3e11ab193bbb1b`，搭配日曆 `77e3703b470288d8018dffc5dbfd4b33bd0661efc5a9c02a3d9ef8c3a952bb21`。路徑、完整治理與來源組合、檔案 hash、連結與實際 `candidateReadOnly=true` 均須通過；其他 routing 覆寫仍拒絕。冷啟動、暖重用與最終成功回傳都須核對實際 `/healthz.dataOperationsReader`，不能以當次 shell 的預檢代替現有程序證據。

僅 `ReaderOnly` 注入 `DASHBOARD_CANDIDATE_V2_BINDING=GOVERNED_ACTIVE_V1`。實際設定與 `/healthz.v2Reader` 必須回報相同治理來源、manifest 與日曆身分，否則拒絕。V2 DB／報告來源由該固定 manifest 與明列角色解析，沒有開放任意路徑覆寫。artifact metadata 的 `MISSING`／`OVERSIZE`／`UNVERIFIED` 保留為資料缺口，不冒充新資料，也不把缺少研究 forward ledger 當成所有日常功能的啟動阻擋。

合成回歸：

```text
node --test tests/research-entry-manifest.test.mjs
powershell.exe -NoProfile -NonInteractive -File tests/research-entry-reader-only.test.ps1
```

第一項只執行入口內的純 JS 驗證區段，以合成物件與注入的檔案檢查驗證 pin；不載入真正 config、manifest 或環境檔。第二項只載入 PowerShell 函式，模擬程序、網路、健康、Node 設定檢查與候選啟動，僅在暫存目錄寫入新的合成收據。它不啟動 Node、瀏覽器、Bridge 或 Producer，也不執行原始 r2 測試。

合成測試通過不代表實機候選、登入、即時資料、瀏覽器或重開機已驗收。`127.0.0.1:18723` 只指向開啟瀏覽器那台機器；不是手機遠端入口。關機後服務不可用，是否常駐仍取決於實際啟用方式與授權。
