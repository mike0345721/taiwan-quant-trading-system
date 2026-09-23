# CRU55 一鍵更新候選交付與正式切換決策包

本文件接續 Linear CRU-55 的「本機一鍵更新」需求及 2026-09-23 Owner 隔離施工授權。交付 PR72；PR71 已合併至 `1ad9ec7c1814e401f8352048638f0a398bcf74fe`，不再修改其分支。正式環境未切換。

## 更新入口

在 `codex/cru55-one-click-update-v1` 隔離 worktree 雙擊根目錄 `update-local.cmd`。工程交付的私人 `data/cru55-update/update-plan.json` 固定來源主線、目標完整 SHA、端口、資料 manifest 與預期 publication。畫面顯示目前載入版本與目標；輸入一次完整目標 SHA 後，自動檢查、保留舊版與設定、準備整版和 locked dependencies、切換、真正登入驗證及必要回退。日常啟動不變。

這是 **ISOLATED_CANDIDATE 更新入口**。正式模式及 8787 均直接拒絕；合併本 PR 也不會使它成為正式部署工具。沒有正在執行的隔離 route 時首次建立新候選；歷史測試的 route 已保留為 retired 收據。舊格式缺少 configHash／launch ownership 證明時拒絕自動接管，不能靠刪除鎖或手改 route 強行接續。

## 本輪工程修復

程式驗證版本 `b531fb7c3ef1bf04c63466e9e729acd0e993f13d`；後續文件交付版本及 exact PR HEAD 見 PR72 收據。保留 UI、登入、producer 語意及日常 launcher。

- 回退不依賴日誌仍可寫入；持續 journal I/O 失敗時仍清理並驗證舊版，保留 recovery lock 與錯誤物件，不吞掉原失敗。route 已提交後的收據故障不停止已驗證版本。
- stop/preflight/verify 同時核對 launch receipt、設定雜湊、session、managed owner/config/output/binding 及 listener PID；僅 PID/啟動時間相同不能授權停止無關程序。
- 清理時容許已退出的自有程序；重用或未知 PID 仍拒絕。旧設定在切換前及重啟前核對，漂移即停止切換。

## 驗證與證據口徑

20/20 focused tests 通過（updater 14、managed plan 6），含 journal 故障、設定漂移、未知程序、退出程序、回退、重复點擊及已提交 route 的收據故障。Windows 預設 TEMP 在 sandbox 出現 EPERM，改用工作目錄下私人 TEMP 後通過，沒有放寬產品路徑檢查。secret scan 與 diff whitespace check 通過。

前次 `95462be…` 的六筆 transaction 原始檔 SHA256 全數符合 delivery.json；其正常更新、發布驗證失敗回退與瀏覽器證據是歷史驗證，沒有冒充新版本實測。UI 沒有變更，沿用 PR71 完整驗收與 9/22 瀏覽器觀察，再以十個 UI 檔案雜湊核對。不重跑完整 UI 設計驗收。

Windows 3062 使用真正 managed launcher、server、scrypt/session/CSRF 及已驗真實 NIGHT1800 私人片段；完整 cutoff hash 為 `ef090c555f7d51126d18341d760ed555fdc0803b7613468a861c7283c3495d40`，CVD=-14。每次成功／回退均驗六窗同 artifact、HEAD、no-store、完整原始 prefix 及八項 legacy API parity。

| 實測 | 結果 | 整筆交易秒數 | 收據 SHA256 |
| --- | --- | ---: | --- |
| 初始保留版 95462 啟動 | UPDATED_ISOLATED_VERIFIED | 28.247 | `37af673c159688004560a06cc0417f555e741625952ad364498df0808bb383bc` |
| 新版故意填錯預期 CVD | ROLLED_BACK_VERIFIED；舊版重新登入驗證通過 | 66.380 | `53872b9d128d103261c766896b752e173dec48b7272eb37d65ce46bf65b6b99e` |
| 新版啟動後精確停止自有 server，模擬退出 | ROLLED_BACK_VERIFIED；存活 managed 清理成功，舊版重新驗證 | 57.011 | `63dd4bde78c4fc619c1aa33d177937031a7954ab18259f8e9f51e04ea5cf8681` |
| 95462 → b531fb7 正常更新 | UPDATED_ISOLATED_VERIFIED | 43.277 | `4695b31c72958263247dfbeb19d11abfc87957b05caf9d8271eaacd820c54b50` |
| 同版本重複執行 | UNCHANGED_VERIFIED；重新驗產品，不只看 Git | 7.929 | `52222a530c3683c06758283eeff01c77a756a02f3e03a9eab16af08dbbbee1fc` |

以上時間包含整版準備／CIM／安裝／登入／驗證或回退，是小型隔離更新交易耗時，**不是 managed 全天發布延遲**。清理再次執行容許已退出 PID；只停止此次歸屬已核對的候選，active route 另存 retired 收據。

私人重現腳本、逐階段 transaction、dependency logs、版本樹、設定、資料副本均保留於本 worktree 的 ignored `data/recovery-20260923` 與 `data/cru55-update/lanes/recheck-20260923`；不將密碼、session、raw 或 SQLite 提交 GitHub。

## 工程審查

Level 3：current agent＋兩位獨立 reviewer。95462 的首輪發現 journal 中斷回退、已退出程序阻擋清理、設定未固定、程序身分未綁定歸屬四項 blocker。b531fb7 修復並覆審，三者均 APPROVE、B0/S0；兩位獨立 reviewer 各自執行 updater 14/14，不冒稱他們重跑 Windows runtime。本輪 Windows 整合證據由 coordinator 實測。

## 容量／發布耗時：新增 bounded managed 量測

2026-09-23T00:41:39Z–00:53:42Z，共 722.294 秒／243 cycles。使用保留的 95462 release；其 pipeline/managed 程式與本次修復版相同。另建私人 source/output，未改 resolver 程式。診斷外層 loop 呼叫未修改的 readManagedConfig、runManagedCycle、status publication、managedDelayMs 與真實 Windows owner/full-prefix pipeline；不是宣稱原 launcher CLI 自帶這些計時。

大檔從凍結真實 60000筆／82,021,423 bytes 起跑，按每30秒100筆目標，在實際32.131–604.610秒追加2000筆原始 suffix；保留2,472,115 bytes小型第二dated檔。最後大檔84,757,597 bytes，SHA256 `71a3bfb12e0270963d602c1818764b4a57eb05aa53b06272a34e446f4450a3e2` 與凍結來源完全相同。最後約117.7秒為不追加的 drain。初始追趕與追加重疊，**沒有建立穩態發布延遲或1.95GB正式量級能力**。

| 直接量到的外層階段 | 合計秒數 |
| --- | ---: |
| 每輪設定／版本／路徑檢查 | 61.507 |
| pipeline 函式整體 | 407.048 |
| managed 內、pipeline 外的來源選擇／狀態處理 | 32.237 |
| managed status 落盤 | 11.494 |
| 實際等待 | 209.883（要求208.000） |

因此本次設定＋manager＋status 約105.238秒、等待約209.883秒均可直接歸因；不再把這些全部塞入未知時間。pipeline407.048秒仍需按整個cycle的回傳phase閱讀：大檔 INGEST282.239、PROJECT35.785、VERIFY10.827秒；小檔合計78.196秒。這些不是函式內部各phase self-time，transition／publication可能混在同一call；不能回填或改寫9/22原量測的132.539秒未歸因值。

小檔1次發布、29次UNCHANGED；大檔僅完成第一個session boundary cutoff21806（觀察上界319.042秒），尚未完成目標DAY。結束時大檔 ingestion backlog=1,368,405 bytes，publication backlog=54,945,060 bytes、phase=PROJECT、DAY仍missing；verificationRestarts=0。這是初始追趕尚未完成的實測，不等於已證明穩態發散，也不是連續追加修復退化。最大抽樣RSS約306.9MiB；Node自身CPU187.250秒，未包含Git/CIM子程序。過程與隔離更新測試及既有主機工作重疊，不當作獨占主機基準。

結論仍為 **CAPACITY_NOT_ESTABLISHED**。已定位大檔 ingestion／全歷史投影、無變化小檔輪巡與每輪manager成本；後續針對這些位置比較，必須保持每次publication完整prefix驗證與證據身分。正式啟用前仍需完成初始追趕後的持續追加量測、代表性來源量級及可接受backlog/時效界線；此輪不擴寫pipeline或削弱驗證以取得PASS。

私人完整 log SHA256=`2921bc9ee6adb2e0fb7466f81e9b77da7527a51e7f70e2f74f5609a6622a899f`；外層重現腳本 SHA256=`ad5ac3f889b5f4c08052e1cc22d4778b9fd8ed539eef1773feeec60e019dc331`。`data/recovery-20260923/{measure-managed.mjs,managed-timing.ndjson,managed-timing-summary.json,summarize-timing.mjs}` 保留完整輸入身分／逐cycle／追加時點。首次sandbox CIM self-probe拒絕在pipeline執行前停止，失敗目錄保留；上述量測是新runId的另一次完整執行，未刪證據救結果。

## 正式切換決策

| 決策 | 本輪結論與前置 |
| --- | --- |
| PR72 source-only Merge | 交付 exact HEAD 與工程審查供 Owner 決定；本輪未 Merge |
| 正式 8787／binding／新 writer | **建議暫不批准**；容量未建立且本 updater 無正式模式，不能只填一個批准 URL 就部署 |
| 後續受控正式切換 | 先決定容量／耗時處置或明確接受 bounded trial 限制；再以批准 main SHA、實際路徑/alias 身分、source 日期範圍、新 outputVersion、reader/writer 同根及批准 URL 製作具體部署計畫 |
| 正式來源保護 | 另需明確批准當次 current `[0,N)` 與 prior `[0,P)` 範圍及 ordinary append 相容條件；不得由隔離測試推定正式 raw 已授權加鎖 |
| 監看與停止條件 | 版本/binding/alias 不符、collector 寫入受阻、完整性或認證/API 驗證失敗立即中止此次新 writer/reader；持續 backlog/延遲須先訂 Owner 接受的界線，不能自定全天 PASS 門檻 |
| 回退界線 | 只停止本次已證明歸屬的 Dashboard/CRU55 程序，恢復保留整版與原 binding/無 binding 狀態並真實驗證；未知 PID／回退失敗保留鎖與失敗證據，不停 collector、不改舊 ledger/artifact |
| 自然驗收 | LIVE、日夜/Handoff、完整自然交易日及 CRU52 五天仍分開驗收；一鍵更新成功不提升 Product Ready |

正式路徑細節沿用 `CRU55_RUNTIME_BINDING_CANDIDATE_V1.md`。本輪 2026-09-23T00:48:31Z 唯讀 `/healthz` 回報正式 loaded SHA 仍為 `e81c5259b5e38db6ad573242e9cf1ee4f305207f`；不據此推論今日收集完整。

`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`。未覆寫正式程式、未部署8787、未安裝正式 binding、未鎖正式 raw、未停止健康 collector、未修改排程或五天計數。
