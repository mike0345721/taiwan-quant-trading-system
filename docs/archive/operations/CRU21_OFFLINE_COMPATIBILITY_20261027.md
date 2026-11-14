# CRU-21｜離線部署相容性排查與回歸修復

## 範圍與精確起點

依 PR102 交接留言 [6436162891](https://github.com/mike0345721/taiwan-quant-trading-system/pull/102#issuecomment-6436162891) 與 Owner 本輪要求，僅處理 repository 程式及隔離測試。

- 起點 commit：`fe62f53b6394a0355651e5130932f980ebb1f087`。
- 起點 tree：`95dd22650d5ff853c23a2419336b142f417939c7`。
- 獨立後續分支：`codex/cru21-offline-compatibility-20261027`，不覆寫 PR102 分支或 main。
- 雲端環境：Linux、Node `v24.19.0`。shell Git fetch 無法連上環境 proxy；經 GitHub connector 取得起點，逐一驗證缺少的 182 個 blob、完整 tree 及 commit SHA 後建立 worktree。沒有變更網路政策或憑證。
- 正式 Dashboard `4d8251686bdb4abbdb469bc00ae798717c0fd583`、Producer `2e4c89e2dbf465bd0703d99b98e30ee83fa0267b`、launcher `e52dc6745fe6c568a946bff3e924619a69112ef4` 僅為交接中的歷史記錄；本輪沒有取得現場新證據。

## 可重現缺陷與最小修正

1. **讀取根未完整傳遞。** `server.mjs` 已選定 `readDataRoot`，但圖表 fallback 仍讀 `config.dataDir`，Flow／研究報價的 data root 與預設 projection root 仍綁 `appRoot/data`。在 source、private data、shared data 分離的合成 fixture 中，圖表與其他既有 shared inputs 因而讀不同根。修正三行 fallback：chart 與 Flow data root 使用已驗證的 `readDataRoot`，預設 projection 跟隨 Flow data root。explicit overrides 保留；session、journal、chart cache、研究結果依舊私有；沒有自動填入 live snapshot/status 或啟動任何 Producer。
2. **後續候選的身分／metadata 接線。** 本次獨立分支原被 `CRU21_BRANCH_MISMATCH` 拒絕，且 product surface 回退 CRU46。僅將此精確分支加入兩個既有清單。HEAD、base、實際 branch、clean source、LIVE、loopback 18722 等門檻不變；`complete=false`，不取得正式8787資格或 Owner acceptance。
3. **跨平台測試 fixture。** `runtime-identity.test.mjs` 原以 Windows 路徑作所有平台的絕對路徑預期。改為平台原生合成路徑，仍檢查精確 process-local `safe.directory`，並新增獨立 temp Git repository／linked worktree，驗證候選 HEAD 與 main 不混淆。

沒有修改 PR102 的 Flow 演算法、發布效能、30秒期限、品質門檻、研究權重或交易路由；沒有重新實作研究頁。

## 相容性判定與來源

| 檢查 | 程式證據與結論 |
| --- | --- |
| 舊 rollout | `scripts/cru21-dashboard-rollout.ps1` 的 `Assert-SourceBaseline` 要求 primary 是 main／baseline、指定唯一 dirty report、formal 同 baseline；`Assert-ExistingServices` 固定 formal 根下 projection。與交接中的多 worktree／分離 data root 不同，應拒絕，不能移除 guards 硬套。 |
| merged-main／tree | rollout Deploy 要求 `origin/main=ExpectedMain` 且 merged tree 等於 reviewed plan tree。未合併 PR102 不是正式版。此為 source inspection；Windows 動態 wrong-tree 測試未執行。 |
| 持續啟動 | `scripts/bound-daily-use.psm1` 各自檢查 launcher／producer／dashboard roots、exact SHA、dirty/untracked、worker PID／instance／command／lifetime／paths；Dashboard 要求 runtimeCommit=approvedMainCommit=pin、VERIFIED、SYNCED。未修改此模組。 |
| 正式／候選 | `src/runtime-identity.mjs` 正式驗證要求 main 身分、一致 SHA、clean、LIVE、127.0.0.1:8787。候選驗證限18722，不把未合併分支冒充 SYNCED。temp Git worktree 已離線驗證。 |
| 快照與資料來源 | shared root 跟隨修正後仍保留 producer heartbeat／lock／path／hash／identity 檢查；既有 alias、錯根、錯instance、dead process、stale/future heartbeat 測試通過。未配置 live snapshot 時仍 unavailable。 |
| 研究頁 | 首頁連 `/research.html`；`/api/v1/research-evidence` 在正常 session 保護內，quote 讀 `cru34LiveDataRoot`，result 固定 `config.dataDir/research-validation/result.json`。missing／hash損壞／過期／未來來源不提供合格數值；沒有 corpus 時比較指標維持 null/BLOCKED。 |

## 實際測試

此環境預設 `node --test` 只列檔案級結果、未提供內部案例數，因此不採用該輸出作 assertion PASS。以下均使用 `--test-isolation=none`。

### 修前重現

在另一個 detached 起點 worktree，僅複製本次三個回歸 test files（未替換 production code）：

```sh
node --test --test-isolation=none --test-reporter=tap tests/dashboard-source-binding.test.mjs tests/cru21-preview-contract.test.mjs tests/cru21-current-surface.test.mjs
```

結果 **21 PASS／4 FAIL／0 SKIP**：兩個資料路徑案例、候選 branch gate、候選 metadata 失敗。這是新增回歸案例對起點的反例，不是宣稱原 PR102 全 suite 失敗。

### 修後定向回歸

```sh
node --test --test-isolation=none --test-reporter=tap tests/cru21-preview-contract.test.mjs tests/runtime-identity.test.mjs tests/cru21-current-surface.test.mjs tests/cru21-formal-browser-proof.test.mjs tests/cru21-preopen-integration-gate.test.mjs tests/cru21-producer-path-alias.test.mjs tests/cru21-snapshot-publication.test.mjs tests/cru21-rollout-windows.test.mjs tests/windows-automation.test.mjs tests/cru46-dashboard-integration-contract.test.mjs tests/dashboard-source-binding.test.mjs tests/dashboard-runtime-truth.test.mjs tests/dashboard-research-evidence.test.mjs tests/research-replay-outcome.test.mjs tests/research-incremental-oos.test.mjs tests/cru34-live-projection.test.mjs tests/cru49-flow-refresh.test.mjs tests/observed-flow-selected-truth.test.mjs
```

結果 **116 PASS／0 FAIL／7 SKIP**（123 cases）。7項為4項 Windows rollout/PID 測試與3項 Windows snapshot sharing/lock 測試；不計 PASS。包含過期 LIVE 降級、發布時鐘、錯身分／資料根、研究缺失不可變正EV、正常候選與正式版辨識。

另實跑 `node --check server.mjs`、`git diff --check`、`node scripts/scan-secrets.mjs`，均 exit 0，掃描未發現常見硬編碼秘密。兩名非作者獨立 reviewers 對本次程式與測試 diff 均為 scoped APPROVE／0 blocking；審查不是部署驗收。

### 未通過的環境相關測試

- `node tests/cru49-flow-http.test.mjs`：0 PASS／1 FAIL（tool exit 0，依內部測試失敗判定），建立合成 localhost socket 即 `listen EPERM: operation not permitted 127.0.0.1`。未到正常登入／Session／HTTP assertions；不稱 HTTP PASS。
- `node --test --test-isolation=none tests/research-evidence-browser.test.mjs`：0 PASS／2 FAIL；390／1366px 均 `BROWSER_TEST_START_FAILED`，Chromium crashpad `setsockopt: Operation not permitted`。沒有關閉 sandbox 或改權限重試，不稱 browser PASS。
- `pwsh`／`powershell.exe` 不存在，`.ps1`／`.psm1` 動態測試未執行。
- 未跑全 CI／Windows suite／本機研究 artifacts lane，不沿用歷史 CI333、MSI1520 或 focused177 宣稱本次 HEAD 全通過。

本輪 TAP／scan logs 與子任務 stdout 節錄轉錄留在雲端 `/workspace/cru21-evidence`；不是 MSI runtime receipt。報告的修後測試對應本次 patch 的程式 tree；本地 commit／tree 以最終交接回覆的精確版本為準。

## 發佈狀態

嘗試經 GitHub connector 建立第一個 blob 時，自動安全審查以「向未驗證 GitHub repository 上傳內部報告，判定超出本輪本地程式與隔離測試授權」拒絕，未回傳 blob SHA。本輪沒有改用其他工具重送，沒有建立 remote branch／Draft PR，也沒有回覆 PR102；僅交付本地提交、patch 與報告。此拒絕不表示先前 MSI 遠端操作的拒絕原因已釐清或解除。

## 剩餘阻塞與未執行項目

- Windows 隔離動態驗證仍缺，尤其 unknown／reused PID、wrong HEAD/tree、持續啟動契約與實際 filesystem sharing 行為。
- 靜態發現舊 rollout 的 CIM identity check 後仍 `Stop-Process -Id`，檢查與動作之間有 PID 重用競態風險；尚無本環境動態反例，未修改高風險程序操作。舊 Preflight 建立 `$targetArgs` 但未執行，PREFLIGHT PASS 不代表 target env 解析通過。這兩項不列已修復。
- 缺正常認證 HTTP／browser、新行情 chart/Flow parity、Owner UI、正式切換及 rollback 證據；本次不補取現場證據，也不準備切換 controller。
- 交接中的明確平台安全拒絕仍未解決，原因 UNKNOWN；本輪沒有重送、改寫或代替執行被拒遠端操作，不能宣稱攔截解除。
- 本輪沒有連 MSI／券商／真實部署端點、讀搬 `.env` 或憑證、碰 raw ledger／正式SQLite／binding／排程、Stop/Start/Restart 真實服務、模型請求、Merge 或部署。

安全界線保持 `formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`、`orderRoutesEnabled=false`。狀態為 **OFFLINE_PATCH_VALIDATED_WITH_ENVIRONMENT_GAPS / NOT_DEPLOYED**。

Draft only. Product Owner approval required before merge.
