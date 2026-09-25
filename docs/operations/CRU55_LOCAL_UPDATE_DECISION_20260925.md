# CRU-55 M2｜本機整版更新與回退決策包

狀態：待 M2 工程交付、GPT review、Owner 真實畫面驗收及 exact-version 決策；本文件不是 Merge 或正式切換授權。

## 已核對的起點

2026-09-25 02:22 UTC 唯讀核對：正式 runtime `D:/Taiwan stock/approved-main-runtime` 為 detached `e81c5259b5e38db6ad573242e9cf1ee4f305207f`、tracked clean；8787 health 回報相同 runtime／VERIFIED／SYNCED，cru55Binding=null。共享 origin/main 當時已為 `1ad9ec7c1814e401f8352048638f0a398bcf74fe`。health 的 SYNCED 不能替代對最新批准 main 的獨立核對。

新位置 `data/cru55-runtime/binding.json` 與舊位置 `data/runtime/cru55-binding.json` 均不存在。data/live-events 與 data/runtime 為指向主工作區的 junction；不得在 runtime junction 下建立正式 CRU55 可寫輸出。

PR72 `051a6ca00f834165584bc723b0c742c369f1bcb5` 的更新器只接受 ISOLATED_CANDIDATE 和 3000–3999 埠；正式啟用明確拒絕 UPDATE_FORMAL_ACTIVATION_NOT_IMPLEMENTED。小型私人 seed 不包含 raw／DB／憑證遷移。因此不能用 PR72 宣稱已支援正式 8787，更不能移除護欄硬套。

## 需要 Owner 決定的最小差異

1. 接受 M2 後批准 PR73 的確切候選 SHA Merge；Merge 完成後另記批准的完整 main SHA。不能以分支名或 future HEAD 代替。
2. 批准正式 runtime 整版同步該 SHA，並新增正式 binding、普通目錄 outputVersion 及 managed writer。這是目前「無 binding」正式狀態的實質變更。
3. 批准 sourceSelection 起始日期、當次 current 原始檔 [0,N) 與必要 prior [0,P) 的共享前綴保護；不鎖尾端或整個目錄。須先確認 collector ordinary Python/CRT append 與 sharing 相容；不允許 writable mapping、truncate 或 rotate/replace。
4. 決定可接受的 backlog／觀測延遲、觀察時段與回退觸發值。既有 API p95/p99 114.250/126.632 秒 FAIL、自然全天 NOT_ESTABLISHED 維持；設定 preflight ready 不是全天容量 PASS。

## 批准後的整版程序（目前不執行）

- 重新讀回 GitHub 批准 main、runtime HEAD／dirty／loaded identity、啟動捷徑和 wrapper；記錄 8787／8790／CRU34／CRU55 的 PID、start、command、HEAD。核對來源／資料／DB／logs／checkpoint／磁碟與 junction 實體目錄身分，確認 collector 持續追加。
- 保全舊整版 checkout、相應依賴鎖檔、設定與「原先無 binding」狀態。以受控 Git whole-version 同步 exact approved SHA，再 npm ci；驗 Node／koffi native／chart vendor。保留原 .env、憑證、SQLite、raw ledgers、junction；不逐檔複製 JS，不把私人資料提交 GitHub。
- 在私人審閱位置生成 binding proposal：runtimeRoot=`D:/Taiwan stock/approved-main-runtime`，dataRoot=`<runtimeRoot>/data`，sourceRoot=`<dataRoot>/live-events`；sourceAlias 的 physicalRoot 與 dev/ino/birthtimeNs 必須由當下讀取，不能套用範例值。producer=STREAM_PAGED_V2，sourceVerification=FULL_PREFIX_BEFORE_PUBLICATION；readerRoot=outputRoot=`<dataRoot>/cru55-runtime/output/<新outputVersion>`。resolver 變更使用新 outputVersion，不能改標舊 checkpoint。
- `node scripts/inspect-cru55-runtime-binding.mjs <proposal> plan` 先做唯讀核對。取得正式啟用決策 URL 後才設定 OWNER_APPROVED／exact runtimeCommit，安裝到普通目錄 `data/cru55-runtime/binding.json`，排除新舊 binding 同存，再執行 activation-preflight。
- 使用正常 `scripts/start-daily-use.ps1`。此入口可能啟動／重啟 dashboard、bridge、CRU34 並依 binding 啟動 CRU55，屬正式切換動作，不能當作無害探測。逐一核對所有元件與 owner；不停止 collector 救驗收。
- 若 8787 已載入相同新 SHA 但 binding 不符，daily-use 會 fail closed，不會自行重啟；須在已批准 cutover 範圍內核對並停止該 reader 後再啟動，不能移除 guard。
- 正常啟動後核對 health HEAD／bindingHash、managed owner/status、source 持續 append、完整前綴驗證、published cutoff/backlog，再以原認證檢查六窗 API／原總覽／原 workspace／Data Quality。historical／stale／unavailable 保持誠實。未通過條件則停止晉升，保存失敗。

## 回退程序

觸發：錯誤 identity／alias／binding、collector 追加受阻、完整性／認證／API 失敗，或超過 Owner 指定 backlog／延遲界限。只停止本次新增或接管且 PID＋start＋command＋HEAD＋binding/config 均核對的 reader/writer；PID 重用或 owner 未知時不得殺程序、不得刪鎖。

保留失敗 logs、owner、checkpoints、artifacts 和新 outputVersion。回復上一個批准的完整版本及依賴、原設定；原先無 binding 就移出本次 binding 並清除本次 shell override。保留 collector、source/runtime junction、raw／SQLite／排程／五天計數。不跨 resolver 接續或改標 checkpoint，不 backfill ledger。

重新驗舊版本 health／真正登入／原 UI 和 collector 持續追加；回退失敗也要保留並回報，不能宣稱已恢復。Merge、正式部署、自然全天與五日驗收是不同 gate。

## Owner 操作檢查

交付候選後，依序檢查：來源日期及歷史標示 → 六時窗切換 → 觀測累積／窗口 ΔCVD／cutoff → 資料年齡與「處理延遲未量測」 → 不可用中文理由 → 資料品質明細 → 原工作區。核可畫面不等同接受全天 LIVE 效能。

依據：PR73 `docs/operations/CRU55_RUNTIME_BINDING_CANDIDATE_V1.md`、正常 daily-use／managed launcher；PR72 `docs/operations/CRU55_LOCAL_UPDATE_CANDIDATE_V1.md`、`CRU55_UPDATE_DELIVERY_20260923.md`、`src/cru55-local-update.mjs`。獨立 readiness 稽核只讀，正式環境未修改。

Safety：formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false。
