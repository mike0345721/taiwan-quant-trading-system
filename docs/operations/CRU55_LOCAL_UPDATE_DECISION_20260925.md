# CRU-55 M4｜本機整版更新與回退決策包

狀態：Owner 已批准並實作當前連續觀測段主卡；候選真資料驗收見 M4 報告。待 GPT／Owner 畫面查收及 exact-version Merge／正式啟用決策；本文件不是正式切換授權。

M3補件：M2工程已認列；同版真資料正向案例已補齊，見 `CRU55_OBSERVATION_M3_20260925.md`。以下為具體推薦，取代「將source起點／時段／門檻交Owner自行設計」；exact Merge及正式啟用仍分開決策。

## M4 具體推薦（正式操作待批准，尚未執行）

**目前推薦：一次查收 M4 新段主卡候選及畫面，再決定 exact code Merge；正式8787維持原版無binding。** PR73 comment 5826936270 已批准 active-segment 呈現，新欄位只讀同一已驗 publication，跨段後合法新成交可恢復主卡；舊 sessionContext 仍按 single-segment envelope 保持 null。主卡語意不再等待批准；正式 binding／source保護與全天容量仍是獨立 gate。

來源起點推薦分為兩個不同用途：

- **可重現產品查收**：`sourceSelection={kind:DATED_CALENDAR_LEDGER,startDate:2026-09-18}`，使用已凍結私人副本及完整[0,16930)→[0,17042)→[0,17183)前綴。累積源自ordinal29，不是把16930當新起點；只作歷史觀測證據，不能掛正式當LIVE。M3 已認列；M4 僅重驗受影響主卡，另包含 pending21806、第二段42987與60000→61000→62000。不得以中段截取避開原連續性。
- **若Owner另准正式受控啟用**：選既有營運日曆判為collector EXPECTED、且有人值守的下一個日期D，`startDate=D`（本地日曆原始檔日期），從該檔原始byte0／ordinal1驗證至當次完整尾端N；不從2026-09-18一路追到現在，也不任選「看起來乾淨」的中段重置。若需要prior，按既有resolver實際解析並逐一列出原始檔[0,P)，只使用相鄰來源；缺少則handoff保持不可用。D不等於交易日標籤，不手改session mapping。新source／outputVersion與完整prefix guard proposal須先保存供批准。

建議受控時段為D日 **09:00–09:45 Asia/Taipei**：09:00–09:15為初始暖機上限，首次合格publication後連續觀察30分鐘，最晚09:45結束；未在09:15達到ready就回退，不把觀察往後無限延伸。挑D前唯讀確認既有日曆、collector預期與資料身分，休市／collector非EXPECTED時改選下一合格D，不啟動collector補場景。

| 項目 | 建議觸發／動作 | 依據與未知 |
| --- | --- | --- |
| warmup | 15分鐘內完成首次full-prefix驗證、合法artifact、API可讀且head/binding一致；否則保存失敗並回退 | 舊62000筆冷啟動486.336秒；900秒是受控停損上限，原180秒效能FAIL不變。超過62000筆或多來源總量尚無此上限可達證據，preflight應停止並回報量級，不能硬宣ready |
| backlog | 每60秒保存source完整尾端、published ordinal/bytes及publicationBacklogBytes；有新增但連續5分鐘無cutoff推進，或backlog连续5分鐘逐次增加，退出候選writer並回退 | 以本機單調觀察時間衡量，不用有skew的eventTime；短突發可等至5分鐘上限。已有突發恢復40.219秒，正常最大API間隔67.082秒；此提案非新SLA |
| 停更／讀取失敗 | 首次ready後，source持續增長而API或原頁同一cutoff停5分鐘；或API連續5分鐘無法讀取新合法artifact，回退。identity/hash/prefix/auth隔離錯誤立即回退 | API p95/p99=114.250/126.632秒歷史FAIL保留；不以HTTP200掩蓋停更。source本身沒新資料時不可直接歸咎writer，先按collector EXPECTED與來源證據分類 |
| collector受阻 | 任一新增share violation／append失敗與本次prefix保護相關，立即停止本次writer釋放lease，保存owner/logs並回退；不等5分鐘、不停止健康collector | ordinary Python/CRT append與共享前綴的正式相容性仍待當場驗證。不得移除guard、刪鎖或改raw救啟用 |
| 資料資格 | 明示CLOCK_ORDER_INVALID、multi-segment context null、長窗PARTIAL；保持原值。若本次啟用要求正向主卡而無合格來源，停止正式啟用並回存DATA_ELIGIBILITY_BLOCKER | M4 驗當前段恢復與有界持續更新；不保證新D同樣合格，不將新欄位代填舊context，也不以歷史曲線末點代替current |

暖機／backlog條件為有限操作風險上限，非量測結果或歷史門檻修改。不得改stale/delayed界限；資料年齡仍照真實時鐘顯示。具體日期D、exact已批准main SHA、source/prior清單、formal binding/writer及prefix lease變更列成同一份操作proposal後才執行，不重問「是否希望收尾後更新」這個已確認意圖。

**回退推薦**：保留並回到當前已批准整版 `e81c5259b5e38db6ad573242e9cf1ee4f305207f` 與原依賴／無binding設定（實際切換前若已獲批准更新，以當時核對並保全的上一正式exact版本為準）。只停本次可驗身分reader/writer、移出本次binding，保留新outputVersion與失敗證據，整版恢復後驗原health／認證UI／collector追加。不得把PR72套到8787，也不得用回退名義改collector、SQLite、raw、排程或五天計數。

## 已核對的起點

2026-09-25 02:22 UTC 唯讀核對：正式 runtime `D:/Taiwan stock/approved-main-runtime` 為 detached `e81c5259b5e38db6ad573242e9cf1ee4f305207f`、tracked clean；8787 health 回報相同 runtime／VERIFIED／SYNCED，cru55Binding=null。共享 origin/main 當時已為 `1ad9ec7c1814e401f8352048638f0a398bcf74fe`。health 的 SYNCED 不能替代對最新批准 main 的獨立核對。

新位置 `data/cru55-runtime/binding.json` 與舊位置 `data/runtime/cru55-binding.json` 均不存在。data/live-events 與 data/runtime 為指向主工作區的 junction；不得在 runtime junction 下建立正式 CRU55 可寫輸出。

PR72 `051a6ca00f834165584bc723b0c742c369f1bcb5` 的更新器只接受 ISOLATED_CANDIDATE 和 3000–3999 埠；正式啟用明確拒絕 UPDATE_FORMAL_ACTIVATION_NOT_IMPLEMENTED。小型私人 seed 不包含 raw／DB／憑證遷移。因此不能用 PR72 宣稱已支援正式 8787，更不能移除護欄硬套。

## 需要 Owner 決定的最小差異

1. 查收 M4 後批准 PR73 的確切候選 SHA Merge；Merge 完成後另記批准的完整 main SHA。不能以分支名或 future HEAD 代替。
2. 批准正式 runtime 整版同步該 SHA，並新增正式 binding、普通目錄 outputVersion 及 managed writer。這是目前「無 binding」正式狀態的實質變更。
3. 批准 sourceSelection 起始日期、當次 current 原始檔 [0,N) 與必要 prior [0,P) 的共享前綴保護；不鎖尾端或整個目錄。須先確認 collector ordinary Python/CRT append 與 sharing 相容；不允許 writable mapping、truncate 或 rotate/replace。
4. 批准或調整上列具體推薦（D日09:00–09:45／15分鐘暖機／5分鐘積壓退出），不是要求重新設計方案。既有 API p95/p99 114.250/126.632 秒 FAIL、自然全天 NOT_ESTABLISHED 維持；設定 preflight ready 不是全天容量 PASS。

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

## 11. 有限設計審查與集中收尾包（2026-09-25；尚未實作）

**決策：RECOMMEND_IMPLEMENTATION。** 建議批准下述「有界提交群組」一套候選及固定驗證預算；不是批准正式更新，也不是宣稱日常承載已解決。它有可逐項計數的 metadata flush 減量，仍保留 page/chunk 各自持久化、原始重讀、分類與完整 current/prior 驗證，因此有值得施工的具體路徑。**只做管理快取不足以支持交付；本案承認會新增儲存提交／恢復版本，須由 Owner 批准這個明確差異。** 若下列安全或收益停點未過，結案為本範圍不足，不再自動串接小修、packing、SSD 或放寬正式上限。

授權：[PR73 comment 5831416202](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5831416202) 與 CRU-55 頂部 2026-09-25 有限設計批准。唯讀核對基線為 PR73 `fabdcf4ebe43895f5fe7007ec2607128ad1dec6f`、main `1ad9ec7c1814e401f8352048638f0a398bcf74fe`，Draft/unmerged。以下優先於本文件較早的「下一步待設計」及固定歷史提案；先前證據不改。M4/M2/M3、native/CRU34盤點、私人更新包§10沿用；daily V1 NOT_READY、原5/10秒FAIL、全天NOT_ESTABLISHED、CRU55 In Progress保持。正式最後回存為e81c5259…／無binding，本輪未重新盤點或操作8787。

### 11.1 首選改動、資料流與相容性

| 草案 | 決定及實際施工範圍 |
| --- | --- |
| A 批次提交 | 採用：新 opt-in `BOUNDED_INGEST_COMMIT_V1`，將同一正常 cycle 內成功完成的最多8個原128-record小批次合成一次進度提交；最多1,024 records，仍受既有8頁／8MiB讀取預算、512KiB輸入及2MiB單頁限制約束。8是上限，實際k由quote/page/raw预算決定；不得為湊8延長cycle。每個page/chunk格式及鏈關係保留，不packing、不改index演算法。 |
| B 管理／路徑 | 只採用「合併A所取代之metadata生命週期」。config/path長存活快取、directory handle新機制、不逐次檢查branch/HEAD/code/calendar、降低status頻率，本案均不採用，收益記0。原pending/job、owner、selection與BLOCKED的安全用途須保留，不能當一般logging刪掉。 |
| C 發布契約 | 完整保留 `COMPLETE_RECORD_PREFIX_V1/maxRecords=32768`、盤界／完整尾端提前收輪、INDEXED投影、每次current及必要prior全前綴驗證、artifact→public pointer→selection順序。提交群組不得跨越既有發布cutoff；不把32768改成新的交易提交大小。 |

新資料流（名稱為提案，未建立檔案）：

`raw exact reread → durable prepare → k組獨立 durable page + chunk → immutable commit manifest → atomic ingest-commit pointer → PROJECT/QUERY → current/prior full verify → durable artifact → guarded stream-public → guarded stream-selection → 原認證API/面板`

- `prepare.json`：一個群組的txId、前一commit hash、source physical identity／genesis、resolver/config/code/calendar identity、captured job/cutoff、原始連續範圍與hash、起始ordinal。先預計畫，再按原raw重讀/分類；預讀和重讀均入既有budget。planned不等於staged，staged不等於committed。
- 每個page/chunk仍用原獨立資料檔；每個新增檔都先write/fsync，再沿既有同目錄temp/link/rename方式建立可引用名稱。不得用manifest的fsync代替資料檔fsync。相同hash但內容不符、nlink異常或路徑改向均拒絕。
- commit manifest（上限64KiB，超出fail closed）：只記至成功完成的連續前綴，含schema、txId、parentCommitHash、source/resolver/binding identities、k組有界refs與hash、raw offset/length/terminal hash、chunk/page head、完整checkpoint hash及對應ref、job捕捉目標/roundSession/排程。checkpoint內容仍在已持久page；manifest不得只指向RAM狀態。
- `ingest-commit.json`（上限4KiB）原子指向已持久manifest，成為**唯一ingestion提交權威**；新模式不再寫可被誤認為另一權威的pages/latest.json與ingest.json。job是衍生工作cursor，不能把其位置當已提交進度。bootstrap以已持久genesis commit建立空狀態；非空目錄缺root不能自動視為空。
- store新增「從明確committed head讀取／stage下一頁」內部介面；staged head只供同一持鎖群組的合法quote回查，仍逐頁hash/record/fact驗證、每append清cache及計入page/byte budget。不得先推全域store pointer。舊獨立store.append API與舊root讀取維持原模式。
- 到budget、quote PENDING、頁過大、盤界、partial tail或32768邊界就封閉已完成k頁，k=0不得假提交。未完成quote cursor須綁同一parent/raw/batch；若提交已完成前綴改變其binding，丟棄cursor並按原raw重算，不能移植舊proof。prepare進度更新/quote cursor flush是額外成本，納入量測。
- commit root成功可讀並驗證後才回報durablyCommitted；root替換結果不明時進入RECOVERY_REQUIRED，重新核對root/manifest，不直接重算累加。publication仍是另一道完整驗證後的權威；對外available/cutoff不能超過published，ingested和staged不能冒充published。
- 新schema/resolver/outputVersion、明確opt-in；不就地升級或重標舊checkpoint。V1模式拒讀新root，新模式拒接舊pages/latest與ingest權威。舊輸出留作原版讀取／回退證據；新候選由byte0合法生成，不能手工補checkpoint。reader公開artifact及M4 adapter語意不變。

預計修改模組：`cru55-stream-store.mjs`（stage/head介面）、`cru55-stream-pipeline.mjs`（有界prepare/commit/recovery與job fence），一個局部commit helper；`cru55-managed-plan.mjs`、`cru55-runtime-binding.mjs`及既有候選launcher只傳遞並驗證新opt-in/schema。helper納入pipeline CODE_FILES身分計算。projection/prior verifier僅於確需讀新committed root之處接線，分類、時間、核心CVD、range index與UI不改；原reader以相同public格式讀取。對應store/pipeline/binding/Windows故障測試更新。不是新的儲存平台或正式raw格式遷移。

### 11.2 Before/after呼叫與可省成本

下表是**正常新頁、無quote pending／retry／split、managed owner模式的程式靜態計数**。k為同一cycle本次成功小批次数，1≤k≤8；額外重試、初始化、碰撞及publication另計。fsync數不等於磁碟實體flush次數或同成本。

| 順序／檔案 | fabdcf4e現況 | 提案 | 必留屏障 |
| --- | --- | --- | --- |
| pipeline owner lock | 每cycle 1次owner fsync | 相同 | 單writer、可查死owner、未知不搶鎖 |
| pending/prepare | 每小批次atomic pending，k次fsync | 群組prepare 1次；需重寫時另計 | 先綁原raw、parent與捕捉目標 |
| pages/*.page.json | k次各自fsync＋link/unlink temp | 相同k次 | 每頁durable且內容驗證 |
| pages/latest.json | k次temp fsync＋atomic rename | 0；stage不得發布store head | head由commit manifest綁定 |
| chunks/*.json | k次各自fsync；現有atomic-temp rename再link | 相同k次與原hash鏈 | 每chunk durable，不能只存manifest |
| ingest.json | k次temp fsync＋atomic rename | 0 | 改由下面單一root承諾進度 |
| 新commit manifest/root | 0 | manifest 1次fsync＋root 1次fsync/atomic rename | 所有引用資料先於root |
| nested store owner lock | k次owner fsync | 相同k次；不藉此改鎖契約 | owner/path/競爭程序保護保留 |
| job/lifecycle/managed state/status | 普通PENDING cycle通常各1次，共4次 | 相同；不合併BLOCKED或降低heartbeat | job可恢復；兩層BLOCKED仍拒讀 |
| artifact/public/selection | 成功發布各自durable；prior/current必要重驗 | 相同 | 每次替換重驗，舊可讀pointer不先刪 |

INGEST資料／進度檔合計：**5k → 2k+3，省3k−3次fsync**；k=1省0，k=8省21（40→19）。連nested locks及普通cycle固定5次後，約**6k+5 → 3k+8**；k=8為53→32，約39.6%呼叫減量，**不是39.6%全流程加速**。初始化與pending額外flush能降低此收益。保留hardlink暫態與collision驗證，不將unlink前nlink=2誤當可接受的永久資料狀態。

程式核對點（均基線fabdcf4e）：pipeline:45–57 atomic/immutable、129–181 pending→append→chunk→ingest、261–334 full verify/public；store:37–51資料落盤、131–248 append/latest；managed-plan:22–41 config、79–113來源與selection/state；runner:29–35每cycle config/status；managed-owner:53 nested owner fsync。所有資料／路徑操作仍經原assertPlainPath/assertBoundWriteRoot；少掉的metadata檔自然少了相關呼叫，但不刪其餘路徑檢查。

**量測與估算分開：**

- 既有8cycle／8,192筆樣本：427次fsync，20.324秒（修正前）／18.494秒（修正後），wall 41.736／39.376秒；讀檔585→450，427未減。若64個小批次均可8組合併，純靜態估算少168次，427→約259，未含新模式額外cursor/恢復/namespace成本。平均fsync成本可移轉這個未證假設下，只約省7.3–8.0秒（該樣本約19% wall），**不是實測承諾；保守已證收益下界0**。
- path sampled inclusive約10.244／10.370秒，含其他呼叫，不與fsync或分類inclusive時間相加。未證等同防護的快取收益=0；config289.853秒與manager114.837秒也不當全可刪。
- 同量級1,795.150秒試驗：只發布162,396/1,500,000筆，尚餘1,337,604，讀入195,164；pipeline INGEST813.178、PROJECT273.476、QUERY166.379、VERIFY57.536、VERIFY_PRIOR11.964秒。後四項至少509.355秒已觀測工作仍保留；config/manager加總404.690秒亦大部保留。這是phase-at-return，不能當互斥底層函式profile。末次未完成cycle、status寫入等不被這組數字完整涵蓋。
- 即使不可能地消除所有813.178秒INGEST，既有completed-cycle工作1,727.224秒也仍有914.046秒；這個Amdahl反事實只說明局部方案不能保證數倍端到端提升，不可外推全150萬結束時間。
- 162,396/1,795.150≈90.46 ledger records/s只是該冷前綴的有效發布平均；不能當TX trades/s、暖態μ或容量SLA。後段全前綴成本隨N增長，約包含(Ncurrent+Nprior)/有效讀驗速率及chunk metadata，不因有派生checkpoint消失。新方案的代表量μ仍未知。

### 11.3 提交、恢复與路徑安全矩陣

不變量：`published ≤ durablyCommitted ≤ complete raw prefix`；staged另報、不得加進committed；每次commit單一連續parent鏈；資料與checkpoint相互綁定；舊已承諾commit不丟不重計；current/prior每次publication完整驗證；UNKNOWN/null、available_at、actualContract/tradeDate/session/continuityEpoch與M4失效規則不變。

| 故障注入位置／事件 | 預期恢復／拒絕結果；施工後必驗 |
| --- | --- |
| prepare之前／prepare寫一半或fsync失敗 | root不變；未完成temp不是commit；只用原committed offset重讀raw。已使用root缺失或壞hash立即BLOCKED，不重置累加。 |
| prepare durable、page/chunk尚未全durable | 舊root仍權威；本tx staged不計已提交。依prepare重讀相同raw範圍重建；缺檔可補，既有同名異內容必拒絕，不覆寫證據。 |
| 全資料durable、manifest前後、root之前 | 無論有無manifest都不能自動promote orphan。只接續prepare所綁parent；驗完每個ref/raw/ordinal/checkpoint後重試同一tx。未知孤兒保留並阻擋，不刪掉救PASS。 |
| root rename前後、回覆前崩潰 | root只允許有效舊／新兩種；新root已指向完整manifest時從新末端接續，不重加。若提交結果不明須讀回；root壞或指向缺資料即BLOCKED，不fallback到更舊commit假稱未遺失。 |
| 已commit但job/prepare清理未完成 | root決定ingest；只在job parent/captured cutoff相符時恢復，否則由已驗root重建衍生job。已完成tx的prepare可識別為retired，不當下一批。半寫/不相容job不得繼續發布。 |
| quote budget、split、partial末行 | 不提交未完成小批次，不越過換行。保留已完成前綴；quote proof綁定失效則重算，不跨generation取巧。oversize按現有split規則處理，prepared manifest更新先durable。 |
| 跨盤、午夜、pending中斷、新連續段 | 群組在原排程邊界收口；各genesis來源分離；盤別仍calendar/resolver判定。只驗受影響邊界單元/oracle，不重跑M4整套；null不補0、不跨缺口拼段。 |
| commit之後、PROJECT/QUERY或current/prior VERIFY中斷 | committed保留；衍生cursor需綁該root。重啟lease無效，驗證從既有規則要求的起點重做；舊verify游標不是原raw信任票。 |
| artifact落盤／public替換前後 | artifact先durable；beforePublish及每次rename重試仍驗來源identity、current lease及prior。未成功public可見前不可回報PUBLISHED。 |
| public已成功、selection前後崩潰 | selection只能引用完整已驗artifact；重新調度可延遲可見，但不得引用未發布generation。原managed與lifecycle BLOCKED保持最高優先，不靠舊status抹除錯誤。 |
| 同名來源置換、truncate、舊prefix篡改、假genesis／hash | 每cycle來源fstat/首筆、原exact reread/hash鏈及每publication全prefix拒絕；current或必要prior失效即停止發布。mtime/size相同不能證內容未改。 |
| output/source祖先junction/symlink、hardlink、目錄或owner換身分 | 原每次assertPlainPath/BoundWriteRoot、nlink、sourceAlias physical identity保留；提交新增beforeReplace驗parent root、source/path及owner。檢查後被置換的競態需Windows fixture證明至少不退化；無等價證據就不批准移除檢查。 |
| root/manifest/hash不符、cursor跨binding、第二writer、PID reuse | BLOCKED/REFUSED；不手刪鎖、不猜owner。死owner按原可驗證退休流程，原證據留下。 |
| ENOSPC／EIO、atomic replace共享衝突 | 不推新commit/public；保留舊已驗pointer及失敗證據；只沿既有有界rename retry，不能unlink目標後重寫。 |
| 程序強制退出 vs Windows斷電 | 逐步exception/kill可驗程序崩潰恢復，**不是實機斷電證據**。現行write/fsync/link/rename無明示directory flush；新方案不宣称突然斷電必保最新root。若Owner要求超出现行支援模型的斷電後零遺失，需另核可native durability/儲存契約，本方案不能自行保證。 |

路徑生命週期：啟動仍驗exact HEAD/branch/config/approved main/owner與schema；每cycle仍讀驗config、code/calendar、來源alias、dated selection、首筆及實體identity；每次資料open/read/write仍保留原plain-path、nlink與budget檢查；commit/public/selection前與每次重試再驗目標及動態來源。程序重啟、設定/來源/root改變均失效，不沿用舊path cache。此次不採directory-handle快取，故不把既有檢查說成對任意惡意kernel/外部writer的完整TOCTOU證明。

### 11.4 固定驗證計畫與待批准的觀測版預算

**本輪只做設計，不執行以下工作。** 後續批准時一次包含所有隔離實作、必要修復、相稱測試、審查及下列固定campaign；未通過就保存結果停止。不得測到PASS為止。不重跑既有M4／盤點／舊版長測。

| 工作 | 輸入、方法、硬預算與交付 |
| --- | --- |
| 靜態與正確性 | 同cutoff INDEXED/FULL_SCAN、原raw重算分類/quote/checkpoint parity；0/unknown/clock/盤界與受影響M4 null fixture。每項故障表至少有對應case，驗committed/public/reader三層；包含新root first-commit、k=1/8、quote PENDING、8MiB budget、舊版拒新root及完整重啟。用小fixture做真Windows kill/路徑置換，不假稱單元exception=斷電。 |
| cold一次 | 同既存9/24 byte0私人1,500,000筆／2,059,524,347B，SHA256 `7b4b69fd190daf62341a91f360cb444fe107f5c3b553707543ab3f3e15d612b6`。單一正常managed、原32768/8頁/8MiB。最多1,800秒含收尾，1,795秒停入；和已留fabdcf4e證據比，不重跑baseline。準備另計、cache/負載與baseline五epoch差異照列。未完成保留censored末輪；30分鐘不是開機SLA。 |
| warm checkpoint獨立準備 | 不以cold成功作前提；由同候選exact／正常pipeline在獨立私人output自byte0合法產生並驗至1,500,000完整publication，核對root/page/chunk、完整current/prior及API。最多4小時低優先序準備，先驗disk预算；時間/CPU/I/O/bytes/峰值/所有重啟另記，費時不能隱藏為已暖機。可接續同exact合格cold輸出，但省下的是準備工，不改cold未完成結論。到限未有合法checkpoint即PREPARATION_FAILED並停止，不能手造、借舊resolver或換62k冒充。 |
| warm獨立一次 | 由上述150萬publication開始，另有15分鐘固定預算；原完整1510562筆中的最後10,562筆只依原順序追加。具體有界挑戰：270秒×27/s＋60秒×54/s=10,530筆；其後最多300秒drain；受控restart及剩餘32筆驗恢復用其餘270秒。兩段時鐘與樣本分開，restart不混入steady百分位；未發布樣本保留、不得删掉算p95。這是約5.5分鐘流入挑戰，不冒称30分鐘自然穩態或全天證據。 |
| 實際需求／代表性 | 既有9/18文件只給active-second p95=72/max=1009與27/s試驗；不能移植成9/24／自然全日λ。未有同口徑9/24到達率，當前列UNKNOWN。後續在**已批准checkpoint準備讀取**時計數既有來源receivedAt的1秒/60秒窗口、idle占比、缺失/逆序、ledger records/bytes與TX trades分開，來源日和交易日分開；不另盤點/啟collector。需對照warm實际發布μ及λ：若27/54不足代表需求，warm只能記challenge結果，不能放行日常；不循環／改時戳補滿樣本。 |
| 長度／來源不足 | 10,562筆不能支持150萬checkpoint後再做27/s連續30分鐘，明列限制。若Owner需該時長或更高λ，必須另有合法既存連續suffix及一次明確追加批准；本包不假設資料存在、不自動加跑。這是產品驗收缺口，不以降低負載抹掉。 |

所有新量測共用原資源停損：單一below-normal writer，不並跑重型A/B；free RAM≥6GiB、RSS≤2GiB、free disk≥100GiB、host CPU連兩次30秒sample>85%停止；collector有可歸因新增share/append/queue問題立即停候選。準備前以既有bytes/page/chunk規格估計空間，兩份raw約4.12GB另加派生檔、temp與失敗保留；派生大小未知不得只報raw容量。沿既有監督器保存末輪、停止身分與資源；不改全域優先序或健康collector。

時鐘與統計：保存append完成的本機單調時間、commit、public、authenticated API首個covering cutoff、原頁首見；市場event/available_at保持原值。每個sample以source identity＋ordinal對齊，另報API錯誤、觀測間隙、未發布與右設限；不足100個可用批次時p99標樣本不足。以相同來源/窗口計算ledger μ與λ，必須有μ>λ及實際drain，不能只用ingest速率；B/(μ−λ)只在速率近穩定時估算，不外推整日。

**建議另行批准的「延遲觀測V1」工程預算（全未達成；不替換Live V2）：**

- 從合法大規模checkpoint重開：300秒內恢復第一個完整重驗、可讀且能續增的cutoff；不是cached HTTP200。全新D日受控啟用仍沿15分鐘warmup硬退出，150萬cold只報30分鐘診斷是否完成，不捏造完成SLA。
- warm append→API p95≤120秒、p99≤180秒；原頁首見p95≤150秒；來源持續增長時不得連續180秒無有效cutoff推進。理由是舊62k的114.250/126.632秒已接近此量級，用作較慢觀測用途的候選驗收，而非從新150萬實測導出。Owner若不接受2–3分鐘資訊延遲，**此有限方案不應以降低原5/10秒要求放行**。
- 54/s×60秒突發結束後≤300秒回到突發前backlog範圍；steady各60秒窗口報source/commit/public bytes與records，不能連續5分鐘積壓增長。這是明確停損／恢復提案，非已批准SLA。末尾短32筆只驗restart接續，不稱另一段steady。
- 範圍施工成功至少需：fsync/metadata減量符合实际k、正確性/故障矩陣通過、同樣時間published cutoff超過原162,396且無吞吐重大倒退，獨立warm合法完成並符合Owner接受的觀測預算。這些是必要而非充分條件；λ不可信、μ≤λ、未測完或只省管理卻無端到端改善，結論直接轉NO_DEFENSIBLE_PATH_WITHIN_SCOPE／不正式啟用。原5/10秒、30秒停更及全天判定另報，歷史FAIL不改。

### 11.5 工作量、風險、完整整版交付順序

工程估計（規劃範圍，非工期承諾）：**7–11個工程人日**，含commit/stage/recovery 3–4日、绑定/相容/故障矩陣2–3日、一次有界量測/分析1–2日、獨立審查修復與整版包1–2日。日曆上另受Owner決策、CI及下一個自然合格交易時段限制。cold≤30分鐘、warm準備≤4小時及量測≤15分鐘已另列，不當免費準備；不承諾9/29上線。若需突破11人日估計或更大storage/native契約，先交具體scope/cost取捨，不能無限延伸。

主要風險：雙權威/重計（高，單root＋故障矩陣）；staged quote與job綁定（高，原raw/oracle）；路徑置換及突然斷電（高，保留guard、不擴張保證）；k偏小/全prefix與QUERY主導導致收益不足（高，量測硬停）；Windows重命名競爭/舊版接新root（中高，版本隔離及fail closed）；資料不足／自然λ未知（高，不能升READY）。新群組最多增加1,024筆未承諾重播量，raw仍完整，已committed不准退步。

| 順序 | 一次收尾工作與gate |
| --- | --- |
| 1 設計決策 | Owner一次批准11.1提交版本＋11.3支援故障模型＋11.4固定測量/準備及候選預算；或退回本方案。此次設計批准不含這項施工授權。不可只批准「再研究」而繼續盲修。 |
| 2 連續隔離工程 | 同PR73工作包，核對exact/base，不改main；新opt-in/output，實作→相稱unit/Windows kill/path/同cutoff oracle→範圍內修復。單元與範圍驗證優先攔安全失敗，再進固定cold/warm；兩種試驗獨立。無關M4畫面/三尺寸/native盤點不重跑。 |
| 3 連續審查／封包 | 恢復／manifest／路徑實作按治理Level3：current＋兩個獨立review，保留findings並覆核修正exact；定向安全掃描、commit/push、CI及遠端讀回。沒有安全/收益證據就不標APPROVE/READY；不發起第二輪無授權campaign。 |
| 4 候選單次查收 | 一次交GPT/Owner：exact HEAD/tree、measurement與未解限制、L0→L5矩陣、binding proposal、依賴/CRU34恢复/来源保护/正常重開/回退及實際merge計畫。新程式使runtime identity改變，不能借旧M4 SHA冒充本版runtime測試；僅補受影響鏈。 |
| 5 exact Merge gate | Owner明確批准該候選exact才Merge；記實際merge SHA/tree、最新approved main/CI，tree有變或base插入不符就停止重核。這是source gate，不等於正式切換。 |
| 6 一次正式操作gate | 把實際merge SHA、新outputVersion/schema/schedule、D日byte0 current及必要prior清單、physical aliases、binding/writer、prefix保護、依賴/CRU34必要恢復、值守時段、退出與回退一起交批准。不逐個元件再加可預見gate；亦不能把第1步批准當正式批准。 |
| 7 本機整版更新 | 保全舊整版e81c5259…（若屆時另有已批准正式版，以保全的actual previous SHA為準）、鎖檔/依賴/設定及原無binding；原raw/SQLite/credentials僅本機。受控Git同步actual approved main **整版**，npm ci及既有Node/native/vendor核對；不手抄單一JS、不套PR72隔離更新器到8787。data/live-events、data/runtime junction保留；新output必須普通目錄。 |
| 8 安裝與正常入口 | binding proposal先plan檢查，再附Owner URL與actual runtimeCommit、新outputVersion及opt-in做activation-preflight；新舊binding衝突即停。用正常daily-use入口恢復必要CRU34、reader、CRU55；對所有本次受控停止/啟動程序核PID/start/command/HEAD/binding。健康collector不重啟；bridge/來源不符合前提即取消，不補啟collector救場。 |
| 9 自然當日驗證 | D取既有日曆EXPECTED且有人值守的合格日，仍09:00–09:45、15分鐘初次ready／之後30分鐘觀察。正式原62k／84,757,597B限制保持：超過即退出，不能用新150萬隔離測試自行提高。prefix lease下用自然append驗相容性，不注入raw；完整性/Auth/owner錯誤或collector受阻立即回退，停更/積壓沿原5分鐘硬退及Owner另批准更嚴預算。 |
| 10 恢復／交付 | 正常重開仍單一writer，fresh自然cutoff→全prefix→真認證API→同面板。原K/Volume/VWAP、Flow/Pulse/CRU34、Fast Scan、CVD/Δ、Session/Handoff、Data Quality/workspace/Auth都按既有契約核對，不改UI。有限試用到時回退，不能暗留全天。Owner若要常駐日常版，必須在同份操作決策中明確批准經證據支持的容量/時段；缺此批准仍不能稱日常整版完成。 |
| 11 回退 | 保留新output/commit/owner/失敗log；只停本次身份可驗reader/writer並釋放lease，whole-version恢復保全SHA及匹配依賴、原設定/無binding，按原正常入口核health、真登入、原面板及collector追加。舊writer不得開新root；不改舊checkpoint、raw、SQLite、排程/五天計數。失敗寫ROLLBACK_NOT_VERIFIED，不宣已恢復。 |

L0→L5沿私人更新包既有定義：L0授權/契約；L1來源/lineage；L2依賴/native；L3producer/CRU34及單writer恢復；L4真認證API同cutoff；L5原瀏覽器與正常重開。M4文件另有分層名稱，引用時標明來源，不混用編號。**自然當日操作、正式切換、全天／五日成功另列**，任何L級PASS不得代替。既有盤點只作基線，cutover前僅核會變動的exact/identity/source必要前提，不重新全面盤點。

### 11.6 本輪審查收據及停止條件

本轮屬文件設計，依治理Level1由current agent逐項核對程式、既有量測、提交依賴、失敗矩陣及範圍；**不是獨立工程實作APPROVE**。設計review已處理的關鍵問題：補回managed nested lock fsync；所有資料檔先durable再root；quote PENDING/split及first-commit恢復不得少計；保留path/config安全呼叫所以不虛報全部管理收益；大規模warm準備有獨立成本/硬上限；10,562筆不足30分鐘不偽稱；正式62k有限試用仍不能等於每日整版可用。未執行新測試/量測，施工後Level3與真Windows fault驗證仍是明列工作，不冒充已做。

**供Owner/GPT一次決策：建議施工上述有界commit候選，接受7–11人日估計及一次固定驗證；不是建議再做不定期研究。** 成功才進exact及正式整版gate；安全契約無法保持、warm準備到限、無端到端改善、代表λ不足或觀測延遲不被接受，均一次回報本範圍不足，交Owner選擇較大修復／延期／改順序。本輪不自動啟動任何一項替代，不把固定歷史當交付。

安全維持 formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false；collector/raw/SQLite/排程/五天計數不動，無Merge、無8787切換。
