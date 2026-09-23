# CRU-55｜CVD 效能修復與驗收交付（2026-09-23）

交付判定：**B｜目前有改善，但未達目標。** 已完成程式修復與本輪驗收收尾；效能門檻 FAIL，CRU-55 保持 In Progress，PR73 維持 Draft／未合併。

## 結論與範圍

本輪保留原時效門檻與完整性契約，完成隔離候選的效能修復、Windows 原子替換修復、測試及獨立審查。工程 APPROVE 與效能達標分開判定；尚未達標不得宣稱 Product Ready、自然 LIVE、全天或五天驗收通過。

Branch `codex/cru55-cvd-performance-v1`；PR [#73](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73)；approved base `1ad9ec7c1814e401f8352048638f0a398bcf74fe`。最終量測 runtime 為 `0342ad719cd1e73206c456decfa913153f8f9971`，CI179/run35828568760 SUCCESS。交付文件後續提交不等於重跑其 exact HEAD；必須核對 runtime source tree 沒有變更。

Baseline `17d210dbaa5ac0ab833b9f272b54463fd5538ab2` 的 tree `905d7a3a87769314e1df4206003c4bc5cd0b2de7` 與 approved main 相同。PR72 `051a6ca00f834165584bc723b0c742c369f1bcb5` 保持獨立。未 Merge／正式 8787 切換／新增正式 writer／鎖正式 raw／停 collector／改排程或 frozen contract；`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`。

## 修復內容與保證

- Ingestion 捕捉 cutoff 後才提交 append；相同 job 不重複 fsync。既有增量 CVD 核心不重寫。
- 只在 generation、來源與相鄰 artifact 完全相符且內容 hash 驗證成功時重用已完成 projection；每次真正發布仍重新驗證完整 current raw prefix 與必要 prior。
- 完成的 projection 另存 content-addressed immutable artifact，VERIFY 只落盤有界 cursor；恢復時核对 hash、generation、session、source、resolver。
- Raw ranges 上限與 archive pages 分開，在既有 8 MiB cycle budget 內有界讀取；archive page cap 未增加。仍有進度的 managed source 不再被 idle sleep 延誤；不完整尾行仍 back off。
- 每個有界 projection batch 只 validate/clone/seal 一次，calendar 一次建立；逐頁、逐 record、terminal/checkpoint 仍核對。budget interruption 保存已完成頁面；錯誤頁面使 batch 不可再提交。2 MiB serialized job cap 在 batch finish 核對，暫存受既有 cycle/page/minute/display caps 約束。
- Managed、pipeline、store pointer 的 Windows 替換使用同一已 fsync temp，僅對 EPERM/EACCES/EBUSY 最多 6 次替換嘗試（含 5 次重試），等待 25/50/100/200/400 ms；絕不刪除舊可讀 target。每次replacement設定重試等待合計最多775 ms，並非operation或cycle的wall-clock上限；rename、fence、fsync與OS排程另有耗時。每次公開 pointer rename 前重新查 source path/identity、prior、prefix lease/STAMP；合法來源變動回 PENDING，完整性錯誤 fail closed。

沒有改成交分類、available_at、盤別／交易日、continuity、UNKNOWN/null、六時窗、VWAP、Relationship、Session 或 Handoff 語意。新 cutoff 的 projection 仍從歷史起點掃描；不冒稱已完成精確增量窗口索引。

## 方法與可重現輸入

私人 frozen `2026-09-18.ndjson`：62,000 records、84,757,597 bytes、SHA256 `71a3bfb12e0270963d602c1818764b4a57eb05aa53b06272a34e446f4450a3e2`，terminal record `d3a235f41c9fa38afe1d839bb76d4dfe2ceecf05fa7701d6f48e68a1b3c428bb`。Frozen direct比較為NIGHT截止21,806、DAY截止62,000；managed依實際已發布cutoff選擇，最終restart為NIGHT21,178、DAY62,000，不冒稱兩者相同NIGHT cutoff。每輪全新輸出，不拼接重複資料、不更改原始 bytes／順序／receivedAt／available_at。

正常 27 records/s 取自 62,000/2,293 active seconds=27.039；active-second p50=19、p95=72、max=1,009。壓縮歷史空檔的重播不是自然全盤。Steady 先完整追到 10,000，30 分鐘追加 50,220 至 60,220；第 10 分鐘 54/s 持續 60 秒，另留 180 秒 drain。起算點為實際 fsync 完成，API 約 500 ms 輪詢，保留所有 unavailable、exception、超時及未發布批次。API observed-cutoff gap 不冒稱精確 publication timestamp。

Windows 11 10.0.26200、i7-8750H（6 cores/12 logical）、約32 GiB RAM、Node24.18.0、D槽可用逾1.2 TB。Process cold 不等於清空 OS cache；hash/copy 已暖 cache，沒有受控清除。重型 baseline/candidate 依序執行；主機其他程式仍有負载，未干預。資源計數含 cache I/O，不是實體磁碟吞吐，也不足以證明 collector 完全無干擾。

## 量測與固定目標

固定門檻：[pre-measurement contract](CRU55_PERFORMANCE_TARGETS_20260923.md)。冷啟動為正常 launcher→真登入 DAY API，180 s；暖機後 append→API p95 5 s/p99 10 s；同頁面 p95 10 s；突發後回到原 backlog 120 s；無未解釋的超過30 s停更。未達門檻不可因相對改善而改判。

| 項目 | Baseline | 最終0342ad7候選 | 判定 |
| --- | ---: | ---: | --- |
| 正常冷啟動→DAY62,000 API（第1組） | 480.144 s | 409.631 s | 改善14.69%，FAIL180 s |
| 正常冷啟動→DAY62,000 API（第2組） | 495.371 s | 324.779 s | 改善34.44%，FAIL180 s |
| 30min追加／固定3min drain後批次 | 1,799／251未發布 | 1,800／0未發布 | 最終候選追到60,220；baseline只到53,443 |
| API延遲p95／p99 | 成功樣本351.162／394.236 s；全體未知 | 全體154.644／177.891 s | FAIL5／10 s；兩組所有批次均超10 s或未發布 |
| API最大延遲 | 成功樣本409.128 s，另有未發布 | 187.664 s | 不能用成功樣本最大值排除censored批次 |
| 54/s×60s後回到原backlog | 117.452 s／原3,078筆 | 151.564 s／原1,566筆 | 候選FAIL120 s；相對回復不等於低延遲 |
| API觀測到的最大cutoff gap | 221.030 s | 98.354 s | 保留全部長gap，沒有逐一建立「無未解釋gap」PASS |
| 原頁面30min連續性 | 約17min tab消失 | 約27.5min tab消失 | FAIL；兩者原因皆未知，恢復頁面不補算 |
| 62,000筆驗證途中中斷恢復 | 本輪未做同條件時間比較 | 中斷→API133.914 s，含harness等待；正常重啟→API18.032 s | 12 API及恢復exact語意PASS，不宣稱恢復速度改善 |

候選觀測區間為2026-09-23T07:02:37.687Z–07:36:36.068Z；warmAt07:03:35.794Z，暖機後1,980.274 s。30分鐘追加50,220筆，API39次前進；例外0，但仍保留503：212 PROJECTION_NOT_AVAILABLE、858 STREAM_SELECTION_INVALID（未逐筆建立原因歸類）。不能把例外0寫成全程HTTP200。

冷啟動兩組均依序使用全新output。第1組baseline/candidate host CPU p50/p95為6%/16%對55%/76%，writer CPU121.969對169.203 s；第2組baseline為14%/25%、writer CPU128.484 s，candidate為14%/27%、writer CPU113.688 s。第一次存在明显主機負載混雜，不能只用單次wall time推論純程式加速。全部最終候選cold仍未達180 s；process cold亦不代表OS cache cold。第二組基準與最終候選均有12項API/artifact比對PASS、API例外0，不將未發布期間503忽略。第二組writer read/write為995,719,481/212,545,350對872,586,516/157,004,065 bytes，peak working set296,177,664對291,250,176 bytes；52個candidate資源samples對80個baseline samples。兩組冷啟動都觀察到改善，但樣本n=2且負載未完全控制，不外推成穩定加速百分比或全天容量。

原頁面1,108 DOM samples包含錯誤樣本；245批在原頁面無可見證據，成功覆蓋1,555批的p95=160.152 s／p99=182.126 s／max189.607 s只是稀疏觀測上界，全部批次p95未知，最長取樣gap75.146 s。僅明確metadata事件與觀測區間外的DOM被排除，原始檔不改；恢復頁面與重啟資料另存，不挽救原30min gate。

| Steady資源（採樣值，非實體磁碟量） | Baseline | 最終候選 |
| --- | ---: | ---: |
| Writer CPU | 622.828 s | 999.281 s |
| Writer read／write transfer bytes | 4,086,824,341／560,332,193 | 6,672,151,505／267,673,618 |
| Writer採樣peak working set | 351,985,664 bytes | 367,226,880 bytes |
| Server CPU／read transfer bytes | 170.266 s／2,682,408,756 | 195.234 s／2,936,930,859 |
| Server採樣peak working set | 322,945,024 bytes | 324,861,952 bytes |
| Host CPU p50／p95／max | 23%／79%／100% | 57%／83%／96% |
| Resource samples | 335 | 330 |

候選完成較多發布，同時CPU與讀取量較高；這是觀測關聯，未隔離其因果。不能宣稱所有資源都省下來，也不能把有背景負載的差異全歸因程式。追加fsync耗時候選p95369.157 ms/max1,735.321 ms；到達jitter p95430 ms/max1,749 ms，均保留，不改寫成理想節奏。

前一 runtime 的兩次 direct 比較（不含 managed/auth/UI）為 baseline287.657/260.874 s、candidate202.845/201.709 s，配對改善29.49%/22.68%；artifact 相同、兩次全產品語意比較 PASS。前一 runtime managed cold480.144→334.659 s，仍 FAIL180 s。這些是保留的前序量測，不能冒充最終0342ad7數字。最新 direct270.115 s、CPU127.000 s、peakRSS539,025,408 bytes，位於兩次baseline260.874–287.657 s之間；不能選最慢baseline宣稱穩定改善。

Baseline steady：1,799批，251未發布；成功1,548批的 p95 351.162 s/p99 394.236 s/max409.128 s，完整批次分位數無法確定。全部1,799批超10 s或未發布。來源60,220、API53,443，drain後剩6,777 records。Burst recovery117.452 s回到原先3,078 records backlog，不代表低延遲。最大observed進度gap221.030 s。API exceptions0，但包含503（270 PROJECTION_NOT_AVAILABLE、1,007 STREAM_SELECTION_INVALID），不能寫成服務完全無 unavailable。

Baseline steady host CPU p50=23/p95=79/max100%，writer CPU622.828 s/read4,086,824,341/write560,332,193 bytes/peak351,985,664 bytes；server CPU170.266 s/read2,682,408,756/peak322,945,024 bytes。335 samples，完整採樣時間保存在receipt。與最終candidate同口徑對照，不能拿cold低負載作steady代表。

## 已保留的失敗

1. 首輪84527cf：managed-status rename EPERM，645批、236未發布，未滿11分鐘、burst未完成；具體占用程序未知。已修復並加測，未刪除失敗資料。
2. ec22335完整第二輪：30分鐘、1,779批、未發布0；API p95123.634 s/p99138.715 s/max148.764 s，全部超10 s。Burst42.495 s回到既有2,133-record backlog。974 browser samples，最長gap92.608 s，不能宣稱連續畫面PASS。原12 API checker未完整綁定requested view，已修正，不能拿弱版當最終驗收。
3. cd52e7f batch-steady：2026-09-23T06:41:22Z pipeline lifecycle-status rename EPERM，BLOCKED；畫面503 PRODUCER_BLOCKED。643.085 s後停止observer，642批、180未發布，burst未完成；成功樣本p9571.767 s/p9978.785 s/max82.783 s。這促成0342ad7同類原子替換修復。失敗畫面、log、raw、未發布樣本均保留。
4. Baseline browser 在約第17分鐘tab消失，原因未知；555 DOMsamples及interruption receipt保留，不能宣稱baseline30分鐘同頁PASS。cd52瀏覽器也有觀測器設定／context恢復造成的取樣空窗，未刪掉。

前次只讀正式health request曾3秒timeout，原因不明；本輪未據此修改正式程序，也不宣稱正式服務健康／收集完整。

## 剩餘瓶頸、限制與選擇

具體呼叫路徑：正常入口[start-cru55-managed.ps1](../../scripts/start-cru55-managed.ps1)啟動[run-cru55-managed.mjs](../../scripts/run-cru55-managed.mjs)，每cycle執行[readManagedConfig／runManagedCycle](../../src/cru55-managed-plan.mjs)，再呼叫[runStreamCycle](../../src/cru55-stream-pipeline.mjs)。新generation仍以`nextIndex=1`建立[createProjectionJob](../../src/cru55-stream-projection.mjs)，透過有界`beginProjectionBatch`逐頁重算，完成後進入current raw與prior驗證才公布pointer。API讀immutable已發布artifact，因此增加reader快取或手動刷新不能跳過這段上游成本。

最終候選1,538個managed cycles的分項如下，均為量測結束後、受控restart之前保存的日誌摘要。表內為phase-at-return分組，不是纯phase函式profile；涵蓋全部cycles，沒有與API觀測區間精確對齊。

| 回傳phase | cycles | pipeline s | config s | manager s | total work s |
| --- | ---: | ---: | ---: | ---: | ---: |
| INGEST | 43 | 189.663 | 12.824 | 5.830 | 208.317 |
| PROJECT | 1,165 | 830.835 | 342.960 | 162.661 | 1,336.456 |
| VERIFY | 242 | 194.195 | 68.443 | 39.097 | 301.735 |
| VERIFY_PRIOR | 88 | 47.542 | 24.019 | 13.444 | 85.005 |
| 合計 | 1,538 | 1,262.236 | 448.246 | 221.032 | 1,931.514 |

PROJECT分組最大，讀取9,320個archive pages、2,875,271,290 budgeted bytes。反覆config驗證與manager工作亦有可量測成本；不能把所有延遲都歸給raw驗證。scheduled idle delay合計25 s，並非主導總時間。這些數字支持後續減少重算與重複驗證配置工作的方向，尚不是單因果或已證明速度上限。

Baseline managed logs的1,431 cycles合計999.673 s pipeline時間：PROJECT409.927 s（41.0%）、INGEST258.421 s、VERIFY247.320 s、VERIFY_PRIOR84.004 s。PROJECT有4,600 archive-page reads及1.416 GB budgeted reads；current/prior驗證合計33.1%。日誌涵蓋全部managed cycles，未與API steady interval對齊；這是phase-at-return分組，包含跨phase工作，不是純函式CPU profile；baseline缺config/manager/CPU/sleep分項，不能用未量測差額推論。新cutoff從`nextIndex=1`重新投影的O(N)是程式證據；量測尚未證明全部延遲都由它造成，也未證明full-prefix是不可突破的主要下限。

保留full-prefix保證下，差異明確的後續方向最多三個：

1. 優先精確增量projection／可驗證range aggregates，避免每個cutoff重算derived history；需正確處理窗口expiry、late events、predecessor/path、品質、continuity、OHLC次序、display重分桶與crash recovery。
2. 合併連續raw reads但保留逐chunk hash驗證與完整prefix，減少syscall／metadata讀取；仍受8 MiB budget及source/lease/stamp fencing，不能沿用舊hash免讀原始bytes。
3. 私有archive durable group commit，降低ingestion小批次fsync成本；代價是交易式恢復，資料／manifest durable後才能公布head，保留quote cursor、no-recount及orphan recovery。

上述尚未實作，不能描述成外部阻擋或演算法無解。沿用目前方法的每次新cutoff重算成本仍随歷史增長；小片段改善不能推算1.95 GB、peak1,009/s或多日容量，沒有已證明的吞吐上限。

真正的Owner決策：是否批准這份**仍未達時效門檻的部分改善候選只合併原始碼**。目前沒有此批准；即使source-only merge獲准，也不等於正式rollout、降低門檻或啟用runtime。現階段不建議以本候選做全天正式切換。

## 驗證、證據與部署準備

最終0342ad7：29/29針對性Windows/helper/pipeline/store/prior測試通過；其中最後plain-path recheck補正後受影響2/2再通過。涵蓋sharing retry、原pointer保留、retry期間append、來源rewrite/truncate/replacement、late quote、immutable orphan與prior recovery。CI179（run35828568760）security scan及test:ci SUCCESS；兩位獨立工程審查均APPROVE/B0/S0。前序39/21/14/18項測試保留原HEAD，不冒稱全部重跑於0342。

交付收尾只改offline summary的DOM量測區間邊界，新增1項hermetic regression測試並PASS（量測前／後可見資料不能補救區間內的失敗樣本），security scan與diff whitespace檢查通過。runtime source相對0342沒有變更；最終文件commit的exact SHA、兩位delta審查及CI讀回保存在PR73／Linear交付收據，不把文件HEAD偽稱已重新做整輪runtime量測。

最終direct與baseline的原始bytes/chunks、artifact hash及全產品結果比對PASS，整數、浮點、null、category均exact，沒有放寬誤差；比較明確正規化resolver/publication/generation等來源衍生identifier，排除不同私有實體路徑binding，不偽造相同原始artifact identity；完整清單在semantic receipt。該比對不包含全面archive-page audit。最終steady與restart的DAY/NIGHT×6時窗共12組真登入API對immutable artifact產品比對PASS，僅排除隨查詢時間改變的dynamic freshness；requested view/session/frame與runtime HEAD均核對。

受控恢復：steady結束另追加原剩餘1,780筆至62,000，在VERIFY index38/offset6,491,629中斷私有writer。Windows短暫仍回報退出程序，使harness保守停住；保存失敗note，重新核對程序消失後沿正常managed入口重啟，未盲殺其他程序。verificationRestarts=1；完整current raw/prior驗證後API62,000，artifact `9adefa0e94aa0aa475ad1bbb4da5489dd127da5bd5e2d7581063eeb2419a4af1`。同sealed projection與相同previous/adjacent artifacts的未中斷finish，對恢復結果全部產品exact一致，沒有排除identifier。中斷至API133.914 s含harness診斷等待；正常重啟啟動至API18.032 s，不是冷啟動效能證據。

Recovery-only頁面使用既有真登入cookie，不宣稱重新輸入帳密；同頁六時窗切換後endpoint CVD=-44，ΔCVD=[3,-6,-44,-44,-44,-44]，4個chart panes、DOM error=false、console warning/error=0，actual CSS1366×768無horizontal overflow。協調者另檢視完整viewport JPEG，未拿被capture裁切的full-page圖當完整覆蓋。工具初始副檔名為PNG但實際bytes為JPEG，保留原檔並保存正確副檔名及更正receipt。此頁不補算原30分鐘延遲與連續性；原same-page gate仍FAIL。暫時viewport已復原，自有tab已關閉，writer/server依完整CreationTime/command/owner核對停止並確認消失。

基準／候選私人資料均留在本機，不提交帳密、raw、SQLite或整份runtime輸出。證據索引與重現命令另列於下。

正式接入仍須有已批准exact版本、受控whole-version同步與本機source binding、單writer/owner核對、停止條件與rollback以及適用交易時段證據。PR72隔離更新器不因此變成正式更新支援；不得只刪guard。未修改任何正式binding或操作排程。

## 本機證據索引與重現入口

去敏索引 [CRU55_PERFORMANCE_EVIDENCE_20260923.json](CRU55_PERFORMANCE_EVIDENCE_20260923.json) 只含選定證據的相對路徑、長度與SHA256，不含原始市場資料、登入資訊或完整runtime輸出。它能確認本機收據是否改變，不能取代讀取私有證據的獨立驗證。

候選worktree：`data/worktrees/cru55-cvd-performance-v1`；baseline worktree：`data/worktrees/cru55-growing-prefix-v1`。兩者均位於Owner既有專案D槽資料夾下。

- 冷啟動原始收據：各worktree的`data/cru55-dynamic/acceptance/candidate-perf-{baseline|retry}-cold-v{1|2}/performance-summary.json`、`launch-clock.json`、`observations.ndjson`、`resources.ndjson`與`api-final.json`（baseline首輪未跑新版12項checker，不補造）。
- Steady摘要：候選worktree的`data/perf/final-baseline-steady-v1-audit.json`與`final-retry-steady-v1-audit.json`，另有逐批samples；phase摘要為`baseline-steady-phases.json`與`final-retry-steady-v1-phases.json`。
- Strict direct：`data/perf/semantic-compare-retry-day-1.json`；前序兩次為`semantic-compare-batch-day-{1|2}.json`。它們保留exact比較範圍、identifier正規化及未audit項目。
- 最終restart、browser與cleanup：候選worktree的`data/cru55-dynamic/acceptance/candidate-perf-retry-steady-v1/`，包括`api-after-restart.json`、`restart-validation.json`、`restart-semantic-comparison.json`、`browser-continuity-failure.json`、`browser-recovery-restart-six-frames.json`、viewport JPEG與`final-cleanup.json`。不要誤引`data/perf/api-after-restart.json`，那是較早runtime。
- 所有歷史失敗、原始DOM、未發布樣本與harness失敗note均保留；不因最終成功追上而刪除或納入其他run。

重現需在隔離worktree核對指定runtime HEAD、乾淨程式、私人frozen hash及background manifest；每輪使用未存在的runId、新output與空閒非8787 port，baseline/candidate依序執行。PowerShell以正常使用者權限進行；若目前安全策略阻擋本輪腳本，僅在該次程序使用既定ExecutionPolicy Bypass，不改全機政策。範例中的變數均為已核對的絕對路徑，不公開session內容：

```powershell
# $moduleRoot = the exact runtime worktree; $harness = the reviewed harness worktree
# $frozen = the private frozen-input directory; $background = manifest-listed inputs
$runId = 'candidate-perf-reproduce-cold-v1' # must be fresh; use steady for a separate run
$prepared = node "$harness/scripts/prepare-cru55-performance.mjs" $moduleRoot $frozen $background $runId cold | ConvertFrom-Json
$session = node "$harness/scripts/launch-cru55-performance.mjs" $moduleRoot $prepared.data 3066 | ConvertFrom-Json
node "$harness/scripts/observe-cru55-performance.mjs" $prepared.data $session.receiptPath
node "$harness/scripts/check-cru55-performance-api.mjs" $prepared.data $session.receiptPath "$($prepared.data)/api-final.json"
node "$harness/scripts/summarize-cru55-performance.mjs" $prepared.data "$($prepared.data)/audit.json"
```

資源測量需同時以`sample-cru55-performance-resources.ps1 -Data ... -SessionFile ...`採樣，啟动前保存writer owner及server的完整CreationTime／CommandLine；sampler不是UI瀏覽器觀測器。Steady browser應真登入原頁面獨立保存DOM時鐘及artifact，頁面消失即保留FAIL，不能另開頁合併補算。完成或失敗後僅停止與原receipt完全相符的自有writer/server，確認已退出；不碰正式collector或既有其他程序。本輪使用的私有包裝腳本會做此身分核對與清理，重現者不能僅照PID盲停。
