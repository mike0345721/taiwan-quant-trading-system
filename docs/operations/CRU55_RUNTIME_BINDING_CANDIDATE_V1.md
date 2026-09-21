# CRU55 Runtime Binding Candidate V1

本文件是 PR71 的部署準備與驗收規格，不是 Merge、正式啟動或 Collector 授權。本輪不安裝正式設定、不重啟正式服務、不啟動任何 Collector。Product Owner 批准整個版本並完成 Merge 後，仍須取得正式 Runtime 啟用授權才執行安裝。

## 交付範圍與未完成項目

Binding 將已批准的完整程式版本、既有來源帳本、衍生輸出及 API reader 綁定到同一份私人持久設定。這不是全交易日 writer 的完成證據：檢查輸出中的 `fullDayReady=false` 必須保留。`activationReady=true` 只表示設定通過本機 preflight，不表示 Producer 正在運作、資料為 LIVE、捕捉完整或排程已驗收。

本版本的 Producer 固定為 `BOUNDED_ACCEPTED_V1`，每批仍以 `FULL_PREFIX_EACH_BATCH` 驗證原始前綴。既有批次、資料量與計算上限不因 Binding 而改變；達到限制必須保留 BLOCKED／UNAVAILABLE，不得重設 checkpoint、提高限制或換來源救結果。全盤容量、writer 啟停／重啟、日夜盤與交易日切換、來源檔案選擇及自然排程驗收仍需另行完成。

## 私人設定格式

以下路徑及 SHA 全部是佔位值；不得直接當成正式設定。先將提案保存在正常 launcher 不會讀取的私人位置，例如 `<PRIVATE_REVIEW_DIR>\cru55-binding-proposed.json`。不要在審查階段把 `PROPOSED` 檔案放到正式啟動位置，否則正常啟動會 fail closed。

```json
{
  "schemaVersion": "cru55-runtime-binding-v1",
  "state": "PROPOSED",
  "runtimeRoot": "D:\\APPROVED_RUNTIME",
  "runtimeCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "dataRoot": "D:\\APPROVED_RUNTIME\\data",
  "sourceRoot": "D:\\APPROVED_RUNTIME\\data\\live-events",
  "outputRoot": "D:\\APPROVED_RUNTIME\\data\\runtime\\cru55-overview",
  "readerRoot": "D:\\APPROVED_RUNTIME\\data\\runtime\\cru55-overview",
  "sourceVerification": "FULL_PREFIX_EACH_BATCH",
  "producer": "BOUNDED_ACCEPTED_V1",
  "formalWeight": 0,
  "researchOnly": true,
  "executionAuthorized": false,
  "orderRoutesEnabled": false
}
```

啟用版本須將 `state` 改為 `OWNER_APPROVED`，並新增 `ownerDecisionUrl`，指向 Product Owner 明確批准此次版本及 Runtime 啟用的 GitHub 或 Linear 紀錄。`runtimeCommit` 必須填寫 **Merge 後已批准的完整 40 位小寫 commit SHA**，並同時等於實際 Runtime checkout HEAD 與已核實的 `origin/main`；不得填 feature branch HEAD、只複製單一程式檔或偽造 URL 代表授權。Schema 檢查只驗證 URL 格式，不會替 Owner 核實其內容。

所有路徑須為絕對路徑。請用同一組已解析的 Windows 路徑字串產生 `sourceRoot`、`outputRoot` 及 `readerRoot`，避免斜線、大小寫或尾端分隔符差異。`dataRoot` **必須等於 `<runtimeRoot>\data`**；既有 Collector、CRU34 與 acceptance 都固定採用這個位置，其他 dataRoot 會被 `CRU55_BINDING_EXISTING_DATA_ROOT` 拒絕。`sourceRoot` 固定為 `<dataRoot>\live-events`；`outputRoot` 固定為 `<dataRoot>\runtime\cru55-overview`；`readerRoot` 必須與 `outputRoot` 相同。另選外部 dataRoot 需要另外審查整條資料鏈，不在此版本啟用範圍。

設定檔只保留本機，使用私人資料相同的存取控制；不得提交實際路徑設定、密碼、憑證、SQLite、來源帳本或衍生大型 Artifact。檔案須是單一普通檔案、非 hardlink／symlink，大小不超過 16 KiB。

## 同一條來源與產出鏈

| 階段 | 綁定位置／限制 |
| --- | --- |
| 既有來源 | `<dataRoot>\live-events\<approved-ledger>.ndjson`；Binding 不新增來源或 Collector |
| DAY producer run | `runId=day`，輸出 `<outputRoot>\day` |
| NIGHT producer run | `runId=night`，輸出 `<outputRoot>\night` |
| API reader | `<readerRoot>\day`／`night`，與相應 writer 目錄完全相同 |
| 已發布證據 | 各 run 的 `latest.json`、`view-latest.json` 及所指向的 immutable generation／view Artifact |
| 生命週期 | 相同 run 目錄的 `lifecycle-status.json`；BLOCKED 不得回退成舊 READY |

Reader 使用 `view=day|night` 查找固定子目錄，因此正式綁定不能任意改成其他 runId 後宣稱已接線。DAY／NIGHT、契約與日期仍按接受的投影契約分離。有效相鄰盤別才能提供 Handoff；缺失／不相鄰時保持不可用。

## 唯讀 preflight 與正常 launcher

以下指令只展示唯讀檢查；先替換佔位路徑並確認執行的是整個目標版本。`plan` 也要求設定中的 root 與 HEAD 對得上該 checkout。

```powershell
node 'D:\APPROVED_RUNTIME\scripts\inspect-cru55-runtime-binding.mjs' '<PRIVATE_REVIEW_DIR>\cru55-binding-proposed.json' plan
```

Owner 明確批准、Merge 及既定 Git 同步完成後，安裝位置固定為 `<runtimeRoot>\data\runtime\cru55-binding.json`。以已批准設定執行：

```powershell
node 'D:\APPROVED_RUNTIME\scripts\inspect-cru55-runtime-binding.mjs' 'D:\APPROVED_RUNTIME\data\runtime\cru55-binding.json' activation-preflight
```

兩種 inspection 模式都不安裝、不啟動、不停止、不部署任何服務。`origin/main` 是本機 remote-tracking ref；inspection 不自行 fetch，須依既定同步流程先核實 GitHub 已批准的 exact SHA，不能把過期 ref 相等誤當最新批准證據。

Activation 額外執行 `git status --porcelain --untracked-files=no`，只要有 tracked 檔案的 staged 或 unstaged 變更，即以 `CRU55_BINDING_TRACKED_CODE_DIRTY` 拒絕。HEAD 相同不代表載入的程式內容相同；不得以未提交修改冒充完整已批准版本。這項檢查刻意不把私人 untracked 資料當成程式修改，並不授權提交或刪除這些資料。

`scripts/start-daily-use.ps1` 正常啟動時讀取上述固定持久檔案，通過 `activation-preflight` 後才設定子程序的 `CRU55_RUNTIME_BINDING` 與 `CRU55_DYNAMIC_ROOT`。沒有持久檔案卻只在 shell 設定這兩個環境變數，正常 launcher 會拒絕；有檔案但為 PROPOSED、版本／路徑不符或授權欄位不足，也會在既有 Runtime 動作前停止。不要用直接啟動 Node 或暫時 shell 變數迴避這個正常啟動契約。

Dashboard `/healthz` 的 `cru55Binding` 只公開啟動時的 `state`、`bindingHash`、`runtimeCommit` 與 `fullDayReady`，不公開私人路徑。正常 launcher 重用同一 HEAD 的既有程序前，還必須比對持久設定導出的 bindingHash 與此啟動證據；同 HEAD 但 hash／binding state 不一致時，在既有 Producer 動作前停止，不擅自重啟元件。設定不存在時，也不能重用仍宣稱 BOUND 或 CANDIDATE_UNBOUND 的程序。設定檔事後改動不會讓舊程序的啟動 binding 自動更新，須走已批准的完整切換。

檔案不存在且沒有這兩個環境變數時，launcher 保留既有流程；這不代表新總覽來源可用。正常 launcher 的原有功能可能啟動既有行情服務，因此本輪只能檢查其程式與測試，不執行正式 launcher。

## Writer 仍需獨立的受管理啟動

Binding 不會自動啟動 `watch-cru55-dynamic.mjs`，也沒有建立全盤排程。正式 writer 必須在 Owner 已授權的受管理啟動方案中，明確指定：整個 Runtime 版本、相同持久設定路徑、來源 `.ndjson`、`day`／`night` runId、可比的 priorRunId（或不提供）、程序擁有者、啟停與錯誤處理方式。背景啟動須隱藏視窗，並保留可追溯的程序與狀態紀錄。

受管理 writer 與 reader 都須由同一設定導出 root，不以 shell-only 路徑覆蓋。既有 `writer.lock`／`lifecycle.lock` 不得由未知擁有者自動清除。有限批次或有限 cycles 的本機驗證不能替代全交易日排程、自然重啟或完整捕捉驗收；不得因此宣稱 Full Formal Ready。

## Merge 後驗收順序

1. 保存 Owner 決策、已 Merge PR、核實的 approved main SHA、實際 checkout HEAD、原設定與既有程序基線。透過既定 Git 同步整個版本，不手動混搭檔案。
2. 在私人位置完成 proposal，核對來源與共同 dataRoot；`plan` 應顯示預期 `bindingHash`、root、SHA、`activationReady=false`、`fullDayReady=false`。
3. 得到正式啟用授權後才安裝批准設定，確認 tracked code 乾淨，執行 activation preflight，保存新的 bindingHash。只因 preflight 通過不能宣稱已部署。
4. 依已批准程序啟動正常 launcher 及另行管理的 writer。核對 `/healthz` 的啟動 bindingHash／runtimeCommit 與持久設定相符，實際執行版本、writer source/output 與 API readerRoot 一致；檢查來源原始資料、舊 Frozen Artifact 及 Ledger 未被修改。相同 HEAD 的舊程序若持有另一個 binding，必須保留拒絕結果並走批准的切換程序。
5. 驗證 unauthenticated 401、非法 query 拒絕及 no-store；以有效登入核對 DAY／NIGHT 各窗 API 的 artifactHash／generationHash／cutoff、CVD／delta 與 UI 一致。UNKNOWN、不完整窗口、價格 lineage 排除與缺少 Handoff 均須保留真實不可用狀態。
6. 核對來源新增後 writer 發布新 Artifact，API/UI 更新；來源／writer 故障須 fail closed，恢復後不得回寫舊 immutable 證據。Fault injection 只在明確批准的隔離測試進行，並標示為注入測試。
7. 分別記錄「版本同步」「持久 Binding」「受管理 writer」「自然整盤驗收」的實際結果。未完成的項目保持未完成，`fullDayReady=false` 不得被人工改成 true。

## Rollback 準備

啟用前先記錄可回復的已批准完整版本、舊持久設定是否存在、檔案 hash、程序啟動方式與 Reader 原資料路徑。回復方案也須在此次 Owner 授權範圍內。

若新綁定或新 writer 不符驗收，先以已批准的程序僅停止此次新增、身分已確認的 writer／reader，保留失敗狀態、checkpoint、Artifact 與 log。不要停止其他 Collector、改既有 Forward Shadow 或五日計數。隔離新設定並恢復先前已批准設定／完整版本；若原先沒有 Binding，恢復「檔案不存在且無 CRU55 shell override」的基線。不要在正常讀取位置留下 PROPOSED 或與回復版本不符的設定。

回復後重新核對版本、root、安全旗標與既有健康狀態；失敗的新 Artifact 保留供追查，不覆寫、不 backfill、不將上一筆好結果冒充目前結果。以上是回復計畫，不是本輪執行停止、刪除、切版或正式啟動的授權。
