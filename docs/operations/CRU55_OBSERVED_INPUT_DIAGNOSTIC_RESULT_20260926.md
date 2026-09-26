# CRU-55｜OBSERVED_INPUT_DIAGNOSTIC_V1 一次結果與本機交付收尾

本次已取得可判讀的 CVD 產品反應，因 **HOST_RESOURCE_LIMIT** 停止；不是再次卡在 100ms 校驗，也不是產品未測。完整 30 分鐘、正常重開與排空仍未完成，**daily V1／本機正式交付 NOT_READY**。

**建議退回「沿現版補完測試即可日常交付」路線，停止工具校驗／盲修循環；不建議現在投入既有 7–11 人日整包。** 實際送入後仍有數分鐘發布延遲和未發布積壓，已不能用工具 p99 差幾十毫秒解釋全部落差；但本次也沒有證明批次儲存改造能解決端到端瓶頸。當日 CVD 目標若維持，下一個決策應是 Owner 接受哪些容量、時段、資訊延遲與恢復成本，並明確批准對應產品／架構路線；本輪不派下一次試驗、不施工。若不接受這項取捨，現範圍不足以交付日常版，應維持不放行，而非以歷史頁或 62k／09:45 退出替代需求。

## 1. 權威、版本與本次範圍

- 依 [PR73 comment 5841304424](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5841304424) 與 CRU-55 最新收尾安排；原 M4、R1/R2、盤點、舊失敗與更新／回退包沿用。
- 受測 exact HEAD **ee494670adc44272e4166db7bec4696ba50ddf0e**，base/main **1ad9ec7c1814e401f8352048638f0a398bcf74fe**。本次公開提交只有本報告和[去敏證據](../evidence/cru55-observed-input/diagnostic-evidence.json)，產品程式未改。
- 私人 helper 只加入事前固定的診斷判定／計時／記錄；保留原 100ms／1000ms 與負載誤差標準，但精度不合格不再中止產品觀察。完整性、順序、path／owner、資源、正式收集保護仍硬停；有到期未送事件且可信 append 收據停滯 30 秒也退出。30 秒是私人診斷停損，不是產品 SLA。
- 七個 helper 在執行前凍結，六項語法、四项停滯／空閒純函式案例通過；獨立 reviewer 核對後才執行。契約固定於 00:57:41.921Z、審查收據 00:58:29.621Z；未另跑五分鐘工具校驗。小測／審查工時未獨立精確量測，不併入 campaign 時長。
- 前輪 **TOOL_CALIBRATION_FAILED／PRODUCT_NOT_TESTED** 原封保留；本輪另記 **PARTIAL_OBSERVED_NOT_RELEASE／HOST_RESOURCE_LIMIT**。機器摘要的 `BUDGET_LIMIT` 是資源上限，不是 55 分鐘耗盡。

## 2. 原定流程與實際結果

使用同一已驗 9/24 frozen 副本，不換輕窗口、不等待產品追上、不降速、不只篩 TX。完整來源／分類／时间／缺值語意及產品 fsync 不變。

| 階段 | 固定安排 | 實際結果 |
| --- | --- | --- |
| 來源準備 | ≤10 分鐘 | 89.571 秒完成 |
| 完整 byte0 初始化 | 31,322 筆／42,903,318B，≤15 分鐘 | 首 publication 244.539 秒；真認證 API 244.583 秒；原頁 NIGHT 相同 artifact 確認後切 DAY |
| 持續流入 | 原 08:45–09:15，108,341 筆／148,442,620B，30 分鐘 | **21 分 28.514 秒**，81,839 筆／112,068,067B、13,405 批；最後原事件 09:06:28.478004；剩 26,502 筆／36,374,553B 未送 |
| 正常重開續收 | 安全允許才重開一次，09:15–09:20 共 14,070 筆，≤5 分鐘 | **NOT_STARTED**，資源硬停早於重開時點 |
| 有界排空 | 停止流入後 ≤5 分鐘 | **NOT_STARTED**；保護性清理不算排空或恢復驗收 |
| 候選總上限 | ≤55 分鐘 | 08:59:55.293–09:26:31.822（Asia/Taipei），**26 分 36.528 秒** |

流入時鐘起點為 09:04:58.061；最後 write 可見在流入後 1,288.489 秒。最後 fsync 220.900ms 成功，停止前完整寫入的 bytes 均有最終 durability 收據。逐小批 write 可見、close 與最後 durability 分開記；沒有把每批 `durable=null` 冒充當時已 fsync。

資源首因為兩個相鄰有效 CPU 樣本 **97%／94%**，時間 09:25:51.781／09:26:25.298，量測收據間隔 **33.540 秒**，超過原 >85% 連續兩次門檻。樣本為 Windows 主機 LoadPercentage，依至少 30 秒間距檢查，**不是 30 秒均值，也不能歸因全部由 CVD 使用**。共 53 次資源觀測；writer RSS 52 次有效值，最高 359,194,624B。記憶體／磁碟下限照原邏輯檢查，沒有觸發；未保存逐次 free 值，故不虛報觀測最小值。維持一個 below-normal writer、32768／8頁／8MiB 與原所有上限。

首因 `HOST_CPU_GATE` 後送入器收到停止，`APPENDER_EXIT_INCOMPLETE` 是收尾次因；不是新的工具故障或產品例外。沒有觸發 10 分鐘來源成長但零發布進展的 gate。停止後僅清理本次已核對身分的程序；writer／server／appender 等均 absent、3071 無 listener，同一測試頁已關閉，鎖／checkpoint／輸出保留。

## 3. 來源、處理、發布與積壓

| 停止後已核前綴 | records | bytes |
| --- | ---: | ---: |
| 來源 | 113,161 | 154,971,385 |
| committed | 99,590 | 136,363,818 |
| DAY published | 96,006 | 131,451,369 |
| 未 committed | 13,571 | 18,607,567 |
| 已 committed、未 published | 3,584 | 4,912,449 |
| **全部未 published** | **17,155** | **23,520,016** |

NIGHT 保留自身 #31,322／42,903,318B，沒有套用 DAY pointer。共 16 個 publication（初始化 NIGHT 1、DAY 15），最後 DAY #96,006；未發布是處理／發布尚未完成，不是 raw 遺失。

全部 27 個來源／committed／published 快照及 16 次 publication 首見時間收在去敏證據。流入期間快照觀察到最高未 committed 13,674 筆；最高未 published **27,700 筆／37,962,724B**，在流入後 1,230.941 秒、pipeline phase=QUERY。之後 publication 前進到 #96,006，停止時降至 17,155，故不能把單一上升段推斷為必然永遠不收斂。最大已完成發布間隔 **205.335 秒**；最後未推進區間 18.392 秒是設限區間，不算已完成間隔。快照間可能有更高峰值，這裡只報已觀察最大值。

實際流入平均 **63.514 records/s、86,974.692B/s**；這是該段到達量，不是處理能力 μ。固定完整 30 分鐘原窗口均量 60.189/s，不能拿已停止的 21 分鐘分母冒稱全窗口通過。原 09:01–09:02 高負載分鐘已進入實測：同一 aligned minute 原 7,788 筆、實到 7,784 筆，差額落到鄰近格；此分鐘不等於全天最高 rolling-60s 認證。

## 4. 實際更新延遲、母體與送入誤差

逐筆母體為初始化後 **81,839 筆**；publication／API／同頁 UI 各成功觀察 **64,684 筆**、未觀察 **17,155 筆（20.96%）**。以下是成功子集的逐筆權重、首次觀察時間上界，**不是完整母體 p95／p99，不是精確發布或 render 時刻**。

| 實際 write 可見 → 首次觀察（秒） | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: |
| publication | 129.593 | 304.210 | 325.236 | 329.968 |
| 真認證 API | 129.691 | 304.285 | 325.310 | 330.043 |
| 同一原 UI | 137.765 | 310.197 | 331.223 | 335.955 |

| 原定送入 → 首次觀察（秒，同一成功子集） | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: |
| publication | 129.601 | 304.228 | 325.246 | 329.977 |
| 真認證 API | 129.700 | 304.303 | 325.321 | 330.052 |
| 同一原 UI | 137.773 | 310.215 | 331.233 | 335.965 |

完整母體分位數未建立；未發布樣本完整保留，不補 0、不丟棄。截至各通道最後觀察，有效右設限筆數為 publication 17,155／API 16,942／UI 17,068，等待最長分別 223.423／218.772／221.027 秒。另有 **213 筆在最後 API 觀察後、87 筆在最後 UI 觀察後送入**，後續觀察缺失，其等待 age=null，不混入右設限等待分位數；三通道未觀察總數仍各 17,155。獨立審查發現初版派生把這些缺口截為 0，已只訂正報表計算，原派生與所有原紀錄保留，本次去敏 closeout 的 v2 欄位為準；沒有重跑工具／產品。去敏證據並列各通道末次觀察時點。批次權重另有成功 10,889／13,405 批，未觀察 2,516 批；API 成功批次 p95 286.194 秒，不能與逐筆 304.285 秒混用。

送入 lateness（81,839 筆）p50／p95／p99／max = **12.022／20.485／161.529／1,106.048ms**；1,119 筆 >100ms、5 筆 >1000ms。原 p99≤100／max≤1000 標準均未過，未改標工具 PASS。1 秒 records／bytes 的 L1 差異÷總量為 **6.4077%／6.4064%**，60 秒為 **0.08553%／0.08552%**；秒尖峰仍為 749 筆／1,020,840B、位移 0 秒；最大累積欠送 55 筆／75,318B。完整 1 秒格與失敗原因在去敏證據，逐分鐘記錄與所有原收據留在本機 hash 索引。

精密原市場負載外推資格仍不成立；兩個起算時間接近不能推論「沒有抖動時 CVD 必然同樣快」。可以成立的是：**本次實際收到這些原始資料後，產品出現上述數分鐘延遲與積壓。** 原 5／10 秒效能 FAIL 不變；120／180 秒等曾提案的新預算未批准，也不能因本結果改成已達成。

## 5. 觀測、完整性與正式收集保護的證據界限

- API 保留 269 次初期 503（206 `PROJECTION_NOT_AVAILABLE`、63 `STREAM_SELECTION_INVALID`），DAY／NIGHT 各自首次有效 200 後 503／error 均 0；共 1,120 次有效 API 觀察。每次驗 exact HEAD、盤別／cutoff、rawReadsPerRequest=0、完整前綴標記及安全旗標。
- 同一頁 240 次讀取，239 次在產品觀察截止內、208 次合法 artifact 可见（含初始化）；1 次停止後錯誤清空樣本未混入成功延遲。read error=0；固定 5 秒排程有 **63 個略過格、最大採樣缺口 36.694 秒**，排程遲到 max 31.727 秒。UI 時鐘橋接殘差 max 2.340ms；不能把缺口內未知渲染時刻補成精確值，也未用新頁替代。
- 停止後 154,971,385B 逐 byte 等於既有 frozen byte0 前綴；來源 SHA256 **c92bce8b66c4d526b95bc543f0a249cef7e6184ad8289730f4e44df7cc331d96**。113,161 個 previousHash 連結、16 份 artifact 自身 hash／cutoff／bytes、ingest envelope hash 及位置核對；無 partial tail，frozen identity/size/mtime/ctime 不變。**本輪沒有逐筆重算 recordHash、重建 CVD oracle 或重驗 Windows guard**；沿用既有認列的原始／產品證據，不能寫成全套重驗 PASS。
- 檢視仍為 `CLASSIFIED_COVERAGE_INCOMPLETE / QUALITY_INSUFFICIENT`；合法當前段數值可見，未知／倒置時鐘與缺值規則保持，歷史資料年齡不是此次處理延遲，不升 LIVE／READY。
- 來源為私人副本，候選獨立 ordinary output，正式 8787／collector／raw／SQLite／排程／五日計數未操作。這證明本輪操作邊界，**不等於已通過自然正式 collector 全日非干擾驗收**。sender、writer、API、UI 同機共用 I/O 與觀測成本，CPU 是主機總負載；未做新的 profiler，不能單由 QUERY 快照判定唯一根因是儲存／fsync。

## 6. 距本機交付的完整剩餘清單與順序

以下集中沿用現有整版更新／回退包與 CRU-34 狀態，不是新盤點或自動授權。所有項目須在一次具體操作包中處理，不能把 62k／09:45 當終點或自行提高上限。

| 順序 | 尚缺證據／決策與完整操作 |
| --- | --- |
| 1. 產品取捨 | Owner 決定日常必需 current/prior 規模、容量、DAY/NIGHT 時段、可接受資訊延遲、冷啟動、正常重開、積壓退出／恢復預算。原新 SLA 尚未批准。現版本次不足以放行，7–11 人日包也無已證端到端收益，不能直接開工。 |
| 2. 容量與持續性 | 這次只有小起點與部分早盤；30 分鐘未完，正常重開與排空未測，成熟約150萬／完整日夜盤未建立。若 Owner 選擇繼續原日常目標，新的批准包需一次包含代表容量、同口徑到達量、持續發布／突發／排空、冷追趕與正常追加分開驗收及固定停損，不能把本次短段沿用成 PASS。這是缺口，非本轮自動再測。 |
| 3. D日真來源 | 用實際 approved calendar／EXPECTED、calendar file date 與 tradeDate 分開；從 byte0 識別當日 current 及必要 prior，保留各自完整前綴驗證與 physical alias 身分。缺 prior 時 handoff 保持不可用；不能接 M4 artifact、固定歷史或改 timestamp 冒稱當日。D resolver 跨日與容量要與批准時段一致；舊9/29候選日期不保證上線。 |
| 4. 自然收集相容性 | 既有 CPython append flags／native guard 證據沿用；正式 collector 的實際 handle 與新前綴保護在自然 append 下仍缺驗收。批准的正式包須同看 tail、queue、error、sharing 與發布，發現可歸因干擾立即停止本次 writer；不注入正式 raw、不降 guard、不任意停止健康 collector。舊3次5秒自然樣本不是全天非干擾。 |
| 5. CRU-34與既有面板 | Linear CRU-34 Done 指 PR44 研究引擎已合併，不是 runtime READY。最新既有證據 25/25 QUALITY_INSUFFICIENT（V1完整coverage未達）與本機 CURRENT_LEDGER_MISSING／舊狀態／owner程序缺席保留；正式包需以既有正常 owner-guard 入口恢復、核對真 snapshot／cutoff。不得捏造 Market Pulse／Observed Flow 或降品質門檻。 |
| 6. exact版本／依賴 | 本輪交付候選查收、相稱測試與必要審查／CI讀回後，仍須 Owner **exact SHA Merge**；再取實際合併 main SHA。沿既有整版 Git 同步與鎖檔 `npm ci`，檢查 Node／native／vendor，不能手複單一 JS 或混搭 node_modules。既有盤點 Node24.18.0、candidate koffi3.3.1／正式缺 koffi 只作更新提示，未在本輪重新盤點。health SYNCED不能取代元件驗證。 |
| 7. binding／path／output | 正式操作前凍結批准 main SHA＋Owner URL、current/prior實際來源身分、STREAM_PAGED_V2／FULL_PREFIX_BEFORE_PUBLICATION／32768／8頁／8MiB；新普通目錄與 outputVersion，先 plan 再 activation preflight。保留 source/runtime 合法 junction 身分，禁止把 writable output 放入 junction；不重標舊checkpoint、不讓舊新binding並存、不跨resolver套結果。 |
| 8. 正常入口整合 | START_DAILY_USE 涉及 dashboard／bridge／CRU34／CRU55，啟停、已載 SHA 與 binding 不一致 reader 的替換要放在同一次已批准切換中。日常入口會 ensure writer，目前沒有已批准 writer-off／archive-only 日常替代。有限試用仍受原上限，不能放寬成常駐。PR72 更新器只支援隔離 candidate、3000–3999，不能拿來操作8787或移除其guard。 |
| 9. 正式驗收／常駐批准 | Merge後仍須一份正式操作 gate，包含容量／時段／來源prior、binding／writer／CRU34／依賴、自然非干擾、監看與退出。真認證API／同一原面板須有合法当日多cutoff持续前進、完整驗證、品質/null誠實及正常重開恢復；保留原K線／量／Market Pulse／Observed Flow／Data Quality。有限試用不能替代常駐所需證據；只有批准容量／時段達標且 Owner 明示日常常駐批准，才可稱本機交付。 |
| 10. 完整回退 | 切換前保存當時已批准整版、matching依賴／設定／入口／原binding（舊e81c5259…／無binding只是舊錨點，切換前要核實）。出問題只停止可核owner／start／command／path的本次reader/writer，釋放lease，保留outputs／locks／log／cutoff；整版恢復程式＋依賴＋binding／入口。用真認證API／原workspace與collector自然append核實恢復；不成功標ROLLBACK_NOT_VERIFIED。raw／SQLite／secrets／junction collector／排程／五日計數不能回寫或重置。 |

## 7. 查收結論

這一輪補到了先前缺少的實際產品反應：持續產出 15 次 DAY publication，但成功資料的逐筆 API p95 約 304 秒、未發布 17,155 筆，且主機資源限制使原定重開與排空無法安全執行。**本次診斷工作完成；日常可用性驗收未完成，不建議 Merge／正式本機更新。**

必要 helper 審查在執行前完成；结果另由獨立 reviewer 從既有 logs 重算逐筆分母、雙起算延遲、保真格及首因。原始失敗／未發布／採樣缺口與 hash 索引全保留；公開文件去敏、exact 提交／CI與PR／Linear讀回收據在交付 comment。審查認可只代表本報告忠實呈現有限結果，不是產品放行。

停點：**ONE_DIAGNOSTIC_STOPPED_HOST_RESOURCE_LIMIT_DELIVERED**。CRU55 In Progress；不再自動開工具校驗、小修、重播或儲存重構。安全保持 `formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`。Draft only. Product Owner approval required before merge.

## 8. G1-A 最小施工差異包｜2026-09-26｜ROUTE_READY_FOR_OWNER

**單一建議：批准 `DERIVED_INDEX_PACK_V1`，只對 PROJECT 產生的稀疏衍生 range-index 頁作有界打包，再用固定 G1-A 驗收決定成敗。** 本節是接續 [5842156588](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5842156588) 與 CRU55 頂部 G1 的新差異，不改寫 §§1–7 的歷史結果。建議投入這個封頂候選；**不建議投入原 7–11 人日 INGEST 批次提交整包，也不保證此路線足以完成 G1-B／C。** 本次只有程式／既有證據核對與決策文件，產品改動、候選效能及 G1-A/B/C 均尚未完成。

起點重新核實：PR73 exact `e697a56e920817234e311746b1e13ee63b37867d`、main `1ad9ec7c1814e401f8352048638f0a398bcf74fe`，候選 worktree clean、Draft/unmerged。最新遠端尚無本具體路線批准。CURRENT 依 Linear，舊 PR body／CURRENT_STATUS 不覆蓋新 HEAD。已對齊 Project Status、Entry Point、Doctrine、Lessons、Authority；原 M4、R1/R2、盤點與私人更新／回退包沿用。

### 8.1 產品改動位置、已知成本與選擇理由

現版 INDEXED 已把六時窗及圖表共 **213 個 query 合併走訪，圖表 200 桶**；正常 DAY 後續發布已是 suffix projection，不能再以「重複掃 213 遍／重算整段」作施工理由。此次核對修正了初步口頭判斷，沒有為錯誤假設改碼。

| 實際產品位置 | before → 待批准 after |
| --- | --- |
| `src/cru55-projection-range-index.mjs`：`beginRangeAppend` | 每個最多 128 facts 的 archive 頁各寫一個衍生 nodes 頁 → 累積一個有界 group 的相同葉節點／內部節點，按原實體順序生成同一 forest，再寫不可變內容定址頁。增加暫存／回退及序列化大小預檢；不改 sums、safe-integer 判定或 fractional leaf fold。 |
| `src/cru55-stream-pipeline.mjs`：PROJECT loop、jobBinding、projection checkpoint | group 最多 **7 個 archive 頁／896 facts**，只在同一 bounded cycle 內組裝；先完成 immutable 頁 fsync/link／碰撞全文核對，再一起推 projection、roots、previous hashes 與 nextIndex。QUERY 保持原合併遍歷與 cycle-local cache；減少需讀的實體小頁以及因此衍生的 managed round-trip。 |
| `src/cru55-indexed-projection.mjs`：`startIndexedProjection` | 增加 layout 身分相等檢查；不同 layout 不沿用 projection checkpoint。原段落／時間／來源回退重建條件全部保留。 |
| `src/cru55-managed-plan.mjs`、`src/cru55-runtime-binding.mjs`：config validation／pipeline option 傳遞 | 顯式 `indexLayout=DERIVED_INDEX_PACK_V1`，legacy 缺省仍走現行 layout；納入 binding/job/checkpoint 身分並拒絕未知值。正式 activation 仍要求 Owner URL、actual approved main 與版本，不自動啟用。只增加選項與驗證，不快取／省略現有 path、owner、code 檢查。 |
| `tests/cru55-projection-range-index.test.mjs`、`tests/cru55-indexed-projection-state.test.mjs`、`tests/cru55-indexed-pipeline.test.mjs` 及對應 managed/binding 測試 | 驗打包邊界、大小／碰撞預算、exact oracle、checkpoint 身分及 fault recovery。原 API／面板介面不改；相稱測試與原驗收整合沿用。 |

**硬上限不變：** 每個 index 頁 ≤2MiB、整個 cycle 實際讀取 ≤8 頁／8MiB。PROJECT 要預留至多一個 2MiB collision read，archive 讀取最多 7 頁且受剩餘 bytes 限制；不足時以較小 group 完成，不把 7 當保證。若下一 archive 頁會使衍生頁超 2MiB，回到加入該頁前的暫存狀態，先落盤前一 group；同 cycle 可再處理的 group 仍共用原總額度。已讀又放回的頁照實計成本。单一 archive 頁就無法容納時明確失敗，不放大上限。不能在計費／碰撞失敗後留下已前進 cursor。

現有 page JSON 的 `nodes` 與 hash/index reference 格式可容納多個 archive 頁生成的 nodes，**不新增 raw 儲存格式、不重寫既有 index、不做背景 compaction**；layout policy 身分必須明示，不以「schema 字串一樣」混用 checkpoint。新候選用新普通 output/runId，舊目錄保留。`cru55-stream-store.mjs` 的每筆 archive 提交、pending、ingest、latest 及 fsync 不納入修正；publicationSchedule 仍為既有 32768 cutoff 方案。

以下只讀既有失敗 campaign 留存檔，未開 writer、重播、長測或新 profiler：

| 已完成 cycle 回傳 phase | cycle 數 | pipeline 秒 | config＋manager 秒 | work 秒 |
| --- | ---: | ---: | ---: | ---: |
| INGEST | 113 | 390.850 | 46.928 | 437.777 |
| PROJECT | 126 | 156.992 | 52.126 | 209.117 |
| QUERY | 546 | 262.696 | 244.415 | 507.111 |
| VERIFY | 181 | 157.242 | 83.678 | 240.920 |
| VERIFY_PRIOR | 76 | 45.412 | 38.042 | 83.454 |

這是 **1,042 個已完成 cycle 依「回傳 phase」分組的 timing**，不是獨占函式 profile；跨 phase 的 cycle 歸回傳 phase、最後未完成 cycle 未入表，status 寫入亦不含在 workMs。不能把表格每欄當精確根因時間。既有 stdout SHA256 `05cc727878292ec0ac65cc41e06f527ffd024043dc02d884b46940615e0926e1`，只公開彙總與 hash。

同一既有 source output 的保留 index 目錄有 **644 頁、14,658,376B、6,432 nodes**；平均 22,761B，最大 147,064B，均遠小於 2MiB。**此數包含舊 generation／可能不再可達的頁，不是最後一次 QUERY 的 unique read 數。** 支持「稀疏小檔可合併」這一機械成本判斷，不支持把 644 直接除 7 當端到端加速。

選此路線的理由是：它同時指向已見的衍生小檔 I/O 與 QUERY 多次 managed 往返，改動集中於衍生索引；不需要先推翻原始前綴完整性或改 INGEST 提交協議。**局部可減：** 若 k 個 archive 頁的 nodes 可同包，這組衍生 immutable 寫入／相應實體讀取由 k 份變 1 份；k 在 1–7，尚未實測。**仍保留：** 每筆 durable archive、所有 raw/current/prior 完整前綴讀取、chunk 讀取、必要 job/manager fsync、分類及 exact query 運算、API/UI 與送入器成本。讀到較大 packed 頁可能增加 over-read、單次解析與暫存成本。

**端到端收益尚未知。** CPU97%／94%屬主機，不是 CVD 專屬；本路線不聲稱 CPU、HDD 或 fsync 是唯一瓶頸。原局部19%估算不沿用、不換算成304秒下降幅度；吞吐與積壓具非線性，這裡沒有全母體延遲改善成績。早期正常 incremental 已成立的證據也不等於成熟大帳本成功。

### 8.2 凍結契約差異與故障邊界

| 契約 | 原規則 → 本路線 | 替代保證／失敗／回退 |
| --- | --- | --- |
| FULL_PREFIX_BEFORE_PUBLICATION | **不變**；每次 publication 前完整 current＋必要 prior 原始 byte 前綴驗證 | 衍生 index 只加速 query，不作 raw proof；guard／來源改變即失效，不能沿用舊 current。 |
| raw durability／提交 | **不變**；既有 raw page、pending、ingest、latest 持久順序與 fsync | 不新增批次 raw commit、不延遲 raw durability。未發布不等於遺失。 |
| 衍生 projection 恢復單位 | 每個 archive 頁形成一個 durable reducer step → 至多 7 頁的 bounded group 形成一個 step | 索引先 durable 才讓 roots/cursor 可持久；崩潰最多重算該 group（≤896 facts），不是丟失 raw。RAM group 不算 checkpoint；replay 不重複計入。這是本包需 Owner 明確接受的實作差異。 |
| owner/path／來源身分 | **不變**；ordinary output、hash、plain-path、owner lock、physical source 與 resolver 綁定 | 不用跨 cycle 未驗證快取取代身分檢查。layout 也入綁定；新舊 output 不重標、不遷移。 |
| 原始 bytes 與順序 | **不變**；byte0、完整原行、所有種類依 physical ordinal | 打包只變衍生頁分組；同一 forest 邏輯順序／leaf identity 不變，不能篩 TX 或截中段。 |
| 分類／時間／盤別／品質／缺值 | **不變** | 原算法 exact oracle；fractional／unsafe sum 照原葉順序，future／逆序／跨段／缺 prior 保持原因及 null。中斷清值與合法新段恢復沿 M4，禁止歷史值補失效 current。 |

必測故障：group 暫存中止、index fsync/link 前後中止、index 已落盤但 job 未替換、job 已 durable 後正常重開、相同／異內容 hash collision、超頁／bytes budget、source/output/owner 置換。只允許舊 durable cursor 或完整新 group；孤兒 immutable 頁保留且在重試時全文核對，不能吞碰撞、重複累積、跳 ordinal 或發布半組。packed 上限使碰撞預留可計算；用既有 Windows guard/path 測試驗受影響部分，不重做全專案。

候選回退：先依 owner/PID/start/command/path 停止本次候選並保留全部輸出，取消這個 opt-in／回到已保存 exact 舊候選整版與其獨立 output；新版 checkpoint 不交給舊版讀。不刪孤兒救測試，不切正式8787。舊候選效能仍 FAIL，回退只恢復工程狀態，不能叫 G1-A 通過。

### 8.3 工程投入、固定窗口與完整停止預算

**工程估 4–6 人日，硬停止 6 人日**（非上線日期）：產品打包／cursor 與 binding 2–3；故障／數值／資源小測及必要獨立審查 1–2；候選 campaign、結果核對／回存及最多一次有根因修正共 1。包含範圍內修復，不能用「6 人日到了所以另開微調包」延長；不足即交未完成與具體原因。按涉及 immutable 衍生檔／安全綁定採保守 Level3：實作者＋兩個獨立工程 review context，exact HEAD 的 blocking findings 全清才開昂貴驗證。本次決策文件僅 Level1 自審，**不是實作 Engineering APPROVE**。

代表資料固定為原 **2026-09-24 frozen calendar ledger**，full SHA256 `907e0722abde0214c2f5c1f4e370175f245f2f4f2b304d32c61980c0dd6db3f7`，共1,510,562筆／2,074,014,548B。初始化從 byte0 至 receivedAt<08:45，**31,322筆／42,903,318B**，新空 output、無假 checkpoint；先產出合法 NIGHT，再按既有當前段規則轉 DAY。主流入固定 **[08:45,09:45) 60分鐘**，包含原09:01高峰；唯一正常重開後繼續 **[09:45,09:50) 5分鐘**，送入器不因重開暫停。保持原 receivedAt 間距、原 bytes、種類及順序，不降速、不換較輕窗口。若同一檔內必要前序不足，保留 null／原因，不捏造 prior。

新65分鐘完整 records／bytes、各秒格與終點 ordinal 由批准後單次來源準備依上述唯一窗口計算、凍結再啟動；**目前既有紀錄只給前30分鐘108,341筆及後5分鐘14,070筆，不能冒充已知65分鐘分母**。窗口與來源 hash 事前已固定，計數不是可任意挑樣的參數。已驗 R1 DAY均量35.89/s、分鐘p95 65.9/s及 rolling60 max137.3/s只作代表性參照，不當 pipeline μ。R1紀錄 SHA256 `b5f9a8463d895f17f06acfe343caa5916499749e9f7564d5e890b35d86bc4f0e`，不重跑R1。

| 工序 | 每一輪固定 wall-clock 上限／條件 |
| --- | --- |
| 私人來源準備 | ≤10分鐘；只用既有 frozen，不訪問／寫入正式 raw；計數與身分核對超時即不啟動 campaign。 |
| 完整前綴 cold 初始化 | ≤15分鐘；包括候選啟動、原認證API／同一原頁首次可用。完整31,322筆，不沿用舊 product checkpoint。 |
| 正常持續流入 | **60分鐘**，API／同頁連續觀測；不因慢處理延長／降速。 |
| 一次正常重開續收 | **5分鐘**，包含正常 stop/start 的所有等待。保留 output與同頁；來源仍照節奏流入。 |
| 停止流入後 drain | **5分鐘**，不再加資料，驗 source=committed=published 並核bytes。 |
| 安全清理 | ≤2分鐘；只處理本次程序，核無候選 writer/listener；清理未完成標阻擋，不算效能測量或延長 drain。 |
| 總額 | **候選運行＋清理 ≤87分鐘；連準備 ≤97分鐘／輪。** 舊55分鐘上限不用於此新案；這是待批准的新上限。最多兩輪共194分鐘（來源準備亦計），小型相稱回歸另計但受6工程人日總額。 |
| 交易時段／正式操作 | G1-A 用隔離固定來源，市場等待0；G1-B 要另准一個合格真實日盤及盤前、完整current/prior冷準備預算；G1-C正式切換尚未排程／批准，不把等待或正式操作藏進工程人日。 |

資源／安全沿原硬停：主機有效 CPU 樣本間隔至少30秒、連續兩次>85%；free RAM<6GiB、候選writer RSS>2GiB、disk free<100GiB；一個 below-normal writer。候選各程序CPU時間增量／wall時間、RSS、I/O與主機樣本分列，送入器、server及觀測器分開；採樣缺失明示。原正式收集非干擾、path／來源／hash失配立即停止。資源觀測失敗、無法確認安全時停止送入並保護性結束，不以關閉正式服務騰資源。沿用10分鐘 source成長但publication零進展、到期事件且可信append收據停滯30秒等保護；stage/total超時先到即停。100ms精度舊FAIL保留，只記實際偏差，不開工具校驗專案。

### 8.4 如何通過或退回 G1-A

1. **長測前先證明改動真正在省工作。** 用既有合法小型資料與保留 archive 頁做現行／packed 兩種衍生 layout 的有界函式對照，不啟舊版完整 runtime。對同一 sparse group 的實際 query unique-page reads 要至少減少50%，序列化總bytes不得增加超過10%；同時測一頁、滿頁及跨2MiB等不利情境。這是本路線的機械收益停損，不是效能PASS。若收益不存在、exact結果不等或安全無法成立，直接 `G1-A BLOCKED`，不開昂貴campaign、不順接另一微調方案。
2. **相稱正確性：** packed／原 INDEXED／FULL_SCAN 在相同 checkpoint/cutoff 比對實際數值、分類、six frames、200 bins、identity、完整性、時間、quality與null（只剝除有意不同的執行layout／timing等證據欄位，不剝語意差異）。含合法第二段、跨盤、逆序／future、fractional／unsafe、quote-only、重開及上述故障。原M4 UI不重做；維持原API與同一原面板must-preserve，受影響binding/reader回歸要過。
3. **母體與時鐘：** 60分鐘 normal、5分鐘 restart各列並合計全部新增筆；每筆以實際完整原行 write可見收據至第一次可信API cutoff覆蓋計時，API／同頁first-seen為採樣上界。初始化另列，不混入65分鐘的分母。保留完整到達收據、unpublished與採樣缺口；未觀察到的樣本不丟、不補0，完整母體分位數未建立就不判PASS。另列預定與實際送入誤差、每秒／60秒records及bytes、尖峰及欠送；舊100ms標準未過仍記FAIL並限制原市場外推，不代替資料安全判定。
4. **驗收門檻：** normal與65分鐘合計完整逐筆母體API p95≤120秒／p99≤180秒；同一原頁p95≤150秒，另列restart子群。停止／重開期間原頁不能沿用失效current。正常checkpoint重開從stop請求開始≤5分鐘內合法新publication，且至少一次進度快照追到當次一致捕獲的完整source cutoff（API已覆蓋，記採樣時間差）；不只追到重開前舊值。以合法source/read snapshot捕獲先後界定，不能靠不一致快照湊相等。drain開始後≤5分鐘達最終 source=committed=published、bytes一致，API／原頁最終cutoff均確認。缺任一項即未達成。
5. **資源及積壓：** 每段記 source/committed/published records與bytes、差額曲線及發布間隔；保留初始503、錯誤、未發布與觀察缺口。另列pack實際group大小、物理index讀頁／bytes與cycle數、candidate CPU/RSS/I/O及主機負擔；不要用hostCPU推唯一根因或拿局部更快代替目標。原認證API rawReadsPerRequest=0、安全旗標及同一面板 CVD/ΔCVD/cutoff/start/contract/session/latency/quality 持續核對。
6. **昂貴驗證最多一候選＋一次有根因修正後驗證。** 首輪未過只有定位到本路線範圍內具體產品缺陷並已實際修改、相稱小測／重審通過才可第二輪，預算相同；環境資源超限、未修改版本、未知根因或工具精度FAIL均不是再跑理由。第二輪仍失敗即 `G1-A NOT_MET`／具體 `BLOCKED`；不自動第三輪，不提高資源／延遲上限，不接別的儲存重構。若沒有可修根因，首輪即交收尾結果。

大 cold 追趕與正常追加分開：本輪只驗31,322筆初始狀態及65分鐘成長，不能宣稱已有150萬筆起始帳本能力。既有150萬cold未完的負向證據原封保留；全日多cutoff重驗前綴的成本仍隨帳本成長，**這是路線即使通過G1-A仍可能無法支撐G1-B的主要風險**。若實測顯示殘餘INGEST／完整VERIFY／主機負擔已使G1-A不可達，本路線結案為不足以達標，需改變產品／架構決策，不能無限局部微調。

### 8.5 同一條通往本機交付的清單（沿§6，非重做盤點）

| 層級／項目 | 已完成、待驗與待批准 |
| --- | --- |
| G1-A 產品候選 | **已完成**：選定本路線、現有程式／成本及凍結差異核對。**待批准**：本節8.6整包。**待做／驗**：實作、exact小測與獨立審查、固定60＋5＋5流程、完整母體、push/CI/遠端讀回。文件完成不是候選改善。 |
| G1-B D日current/prior與日期 | **已有**：R1來源／calendar規則與§6定位。**待驗**：批准D日的file date/tradeDate、當日current及全部必要prior／physical alias、合法資格；缺prior不補歷史值。 |
| G1-B 容量與冷／暖／恢復 | **已有**：150萬cold負向、早盤實際負載及未測項。**待驗／批准**：current至少對照1,510,562筆／2,074,014,548B、必要prior逐份加總；完整無checkpoint冷準備預算與盤前起跑時間、正常追加、全日狀態成長。G1-A同版有效重開證據可引用，不能外推成熟大帳本。 |
| G1-B 自然collector／完整日盤 | **已有**：CPython/native guard及短自然樣本。**待批准／驗**：一個真實合格DAY，盤前正常入口啟動、自然append下prefix guard相容性、tail/queue/error與共享句柄、原API／同頁持續合法值與品質；干擾即停本候選，不停健康collector。 |
| G1-C CRU34／正常入口 | **已有**：CRU34非runtime READY的定位與M4主卡/清值/合法新段能力。**待驗**：原owner-guard入口、程序身分及真snapshot；START_DAILY_USE全鏈與K線／量／Market Pulse／Observed Flow／Data Quality保留，不捏造coverage。 |
| G1-C dependencies／binding | **已有**：matching Node/native/koffi/lockfile差異與更新包。**待驗／批准**：合併版整版npm ci、native載入、版本；legal current/prior路徑、新ordinary output／outputVersion／layout、binding plan→activation及原入口接線。不是手複單JS或沿用混版node_modules。 |
| G1-C 版本／整版同步 | **待批准**：經G1-A/B查收的exact候選Merge與具體正式操作。**待做**：取actual merged main；依既定Git流程整版同步、保護既有本機dirty與資料、核已載版本。PR72隔離更新器不能用於8787。 |
| G1-C 日常常駐／回退 | **待驗／批准**：批准日盤容量／時段、自然全日結果、正常捷徑重開、觀測與退出規則，Owner明示從有限試用進入日常常駐；62k／09:45及45分鐘退出不是交付終點。切換前保存當時整版＋matching依賴＋設定／binding／入口，失敗按§6整版回退並真API／原頁／collector核實，不碰raw/SQLite/排程／五日計數。 |

順序固定為：路線批准 → 產品修正／正確性安全／獨立review → G1-A固定campaign／恢復排空／原API同頁 → exact push/CI/readback與GPT查收 → 另准G1-B真實日盤及容量／cold／自然收集條件 → 結果接受 → exact Merge批准 → actual merged main＋完整正式操作包批准 → 整版同步／依賴／binding／CRU34／正常入口驗收與可核回退 → Owner常駐批准及G1-C完成。G1-B/C正式環境步驟本輪只列齊，不操作。

### 8.6 一次Owner決策與本輪停點

**建議一次批准以下整包，或整包退回：**

- 單一路線 `DERIVED_INDEX_PACK_V1` 與8.1列定產品改動；只改衍生索引分組／恢復單位及顯式layout綁定，接受8.2最多896 facts重算的替代恢復保證。原始storage/commit/fsync及全部凍結語意不變，舊7–11人日包仍不施工。
- 工程4–6人日／硬上限6；8.3固定來源與60分鐘主流入＋5分鐘重開續收＋5分鐘drain，每輪準備10、運行清理87、合計97分鐘。最多一候選＋一次已定位且已修正的範圍內驗證，共194分鐘；既有安全上限保持，資源觀測失敗不繼續。
- 採用8.4完整母體API120/180秒、原頁150秒、恢復／drain各5分鐘作 **G1-A工程驗收目標**；不是正式release SLA、LIVE或延遲資訊可供交易的批准。只做必要helper計量接線與小測，不開精度校驗迴圈。
- 允許批准後同一工作包連續實作、相稱修復／review／測試、push/CI及去敏PR73／CRU55回存讀回；觸及列定停止條件即交G1-A未達／具體阻擋。**G1-B真實正式日盤、G1-C、Merge、Promotion、正式8787及正式容量／時段／啟動設定仍另行批准。**

本輪 **ROUTE_READY_FOR_OWNER／RECOMMEND_BOUNDED_IMPLEMENTATION**；沒有施工、沒有新campaign、沒有把分析算成產品前進。若Owner退回此有限投入，或批准後在固定停點證明不足，應明確記G1-A受阻並重新決定產品／架構路線，不再用現版重测或工具小修代替。安全保持 `formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`；CRU55仍In Progress、daily NOT_READY。

## 9. Owner批准後施工與候選一次驗證差異｜2026-09-26

**G1-A 未達成／已停止。** Owner已明確批准 `08d522d7f7cea56de558cfc9b3095c4e5072e0e7` 的§8.6，本節接續該批准，§8的待批准文字保留為歷史。受測產品 exact **`310796e5ecd184ed47c433946de83f343d5b9017`**，PR73 Draft／未Merge。**建議保留局部改善成果，但不把此路線當成足以交付G1的方案，也不自動開第二轮。** 本次不只遇到主機安全停點；實際送入母體已有足夠已觀測超標樣本證明延遲目標未達。尚無已定位且已修改的範圍內產品根因，環境超限／UI缺口／精度FAIL均不構成再跑理由。

### 9.1 已完成的產品改動與驗證

實際修改 `src/cru55-stream-pipeline.mjs`、`cru55-projection-range-index.mjs`、`cru55-indexed-projection.mjs`、`cru55-managed-plan.mjs`、`cru55-runtime-binding.mjs`：顯式 `DERIVED_INDEX_PACK_V1`，最多7 archive頁／896 facts／2MiB的衍生group；索引durable後才保存roots/cursor；layout納入job/checkpoint/binding。新舊output分離，原始提交、fsync、完整current/prior前綴驗證、分類／時間／品質／缺值數值不變。

獨立審查找到真實after-link crash的雙連結殘留、Windows pending-only唯讀FD fsync失敗；均在packed衍生路徑內修復。只對精確同目錄、同physical identity、全文等於重算值的owned staging恢復；任意hardlink／碰撞仍拒絕。immutable target保留，清除的是已識別暫存連結。Windows真子程序於link前／後退出，均以正常managed owner接管、保留retired鎖並恢復到FULL_SCAN exact結果。

沿用48個不同baseline小測；新增／重跑僅受影響的group暫存、fsync、link、job替換、異內容／foreign link及真process-exit案例。稀疏synthetic query讀頁7→1；**既有896筆archive實讀5→1（減少80%），76,557→75,911B，與原算法exact**。這是局部機械收益，不能換算端到端加速。首次邊界fixture、sandbox TEMP、真exit fixture斷言失敗保留於證據，不刪除救結果。

兩個獨立context `g1a_pack_correctness`／`g1a_pack_safety` 對受測exact **APPROVE，B0/S0**；實作者整合核對同意。CI **200 success**。來源準備／60+5+5接線僅做必要靜態／語法審查，未重開100ms校驗。第一施工checkpoint已回存讀回；合格後未等待Owner查收便連續執行候選1。

### 9.2 一次實際運行與停止

固定來源及窗口沿§8.3，full SHA不變。私人準備 **9.804秒**，完整初始31,322筆／42,903,318B，無舊checkpoint；首次可信NIGHT publication/API約 **189.967／190.001秒**，原頁核對後242.854秒開始流入。冷初始化成本獨立計算，不外推150萬筆成熟帳本。

預定60分鐘新增198,016筆；重開5分鐘另12,914筆。實際流入 **42分9.552秒**，新增 **146,447筆／200,780,338B**，固定65分鐘窗口尚有64,483筆未送入。候選運行及清理 **46分19.443秒**，從來源準備起含中間等待 **48分2.519秒**；沒有延長97分鐘預算。

停止主因：主機CPU有效樣本 **15:05:59為90%、15:06:31為86%（+08），間隔32.851秒**，觸發既定 `HOST_CPU_GATE`。不是30秒平均，也不是CVD專屬CPU。`APPENDER_EXIT_INCOMPLETE` 是保護性停止後的次要紀錄。一次即停，正常重開與有界drain **未測**；沒有另開第二候選。

停止後再次讀durable狀態及來源，確認：

| 進度 | 筆數 | bytes |
| --- | ---: | ---: |
| source | 177,769 | 243,683,656 |
| committed | 175,444 | 240,489,969 |
| published | 169,831 | 232,784,006 |
| 未提交差額 | 2,325 | 3,193,687 |
| 未發布差額 | 7,938 | 10,899,650 |

實際來源與既有frozen的byte0相同長度逐bytes相等、完整行數一致；未發布不是原始資料遺失。積壓未排空。原始日行情／SQLite／排程／五日計數未由本工作修改。

安全清理 **7.013秒**，最終fresh PID/listener核對writer、appender、server及3071均不存在。首次immediate-stop曾回報 `STOP_WRITER_NOT_ABSENT`，後續同一次清理确认已停止；這項負向紀錄保留，不冒稱第一次停止即成功。8787及原bridge仍為08:50:18啟動的同一程序。

### 9.3 延遲、完整分母及量測限制

以每筆實際完整原行write可見時間起算，母體 **146,447**。API/UI各觀測138,509筆，另7,938筆未發布；**完整母體分位數未建立**，以下僅成功子集，絕不作全母體PASS：

| 成功子集／採樣上界 | p95秒 | p99秒 |
| --- | ---: | ---: |
| API首次cutoff覆蓋 | 146.065 | 190.121 |
| 原產品面板首次可見（含中斷後新tab） | 178.029 | 227.516 |

不補0、不排除慢樣本的保守判斷：已觀測API>120秒 **24,773筆／全實際母體16.92%**，API>180秒 **2,394筆／1.63%**；UI>150秒 **13,206筆／9.02%**。即使完全不推測censored值，違約數已超過相應5%／1%尾部額度；不能因母體未全發布而迴避已證目標未達。這不等於建立完整60分鐘的分位數。

送入誤差p95 **20.081ms**、p99 **515.052ms**、max **2,009.797ms**。原精度條件仍FAIL；沒有因此修工具或放慢送入。實際／原定1秒records尖峰均749；60秒格實際7,799／原定7,788。1秒records變異7.016%、60秒0.0369%；對原市場情境外推受限，不能宣稱precise replay。

原tab途中消失，原因未知；11個UI錯誤樣本保留，恢復的是同一原產品URL與既有Session的新tab。**不是同一tab全程連續證明。** 含錯誤採樣的最大間隔79.113秒；有效可見DAY樣本最大空窗 **139.087秒**。UI時鐘沿既有Node hrtime/wall→CUA performance橋接，未取得新精度資格。API記錄215次初始／未發布503、0次api-error；沒有把API成功代替UI連續性。

### 9.4 資源與仍保留的工作

89次主機樣本，p95=68%、max=90%。分程序CPU來自相鄰樣本的CPU時間差；12 logical CPUs下另列占整機理論容量，不能直接與主機瞬時LoadPercentage相減推論未測程序：

| 程序 | 單核心CPU比例p95 | 整機容量比例p95 | 最大RSS bytes |
| --- | ---: | ---: | ---: |
| candidate writer | 49.10% | 4.09% | 304,324,608 |
| appender | 5.59% | 0.47% | 546,086,912 |
| observer | 1.23% | 0.10% | 173,031,424 |
| API server | 2.11% | 0.18% | 189,947,904 |

writer已採樣区間ReadTransferCount增量約13.83GB／write約848.86MB；是程序邏輯transfer，**不是HDD實體吞吐**。appender/server各4個啟動前缺樣、writer1個；browser/CUA、PowerShell probe及其他主機負擔未完整歸因。RAM/free-disk硬停檢查仍執行，但未保存完整數列，不能捏造歷史最小值。

pack確有生效：最後未完成job的44 archive頁形成8組，max7；QUERY完成cycle累積讀6,192 index頁／919,139,276B。完整raw VERIFY及VERIFY_PRIOR仍分別計費約6.84GB／2.37GB。phase timings依**回傳phase**分組，跨phase工作與最後中止cycle限制保留，不能當唯一根因profile。局部讀頁減量不能消除原始提交、反覆完整驗證、管理checkpoint與UI/API成本。

### 9.5 距G1-A／B／C、批准與同一交付清單

| 階段 | 本次增量與仍缺項 |
| --- | --- |
| G1-A | 真正產品修正、數值／安全小測、讀取減量、Level3 review、push/CI及候選1已完成；**目標未達**，60分鐘／重開／排空未完成、UI連續性缺口。保留成果而停止本包昂貴驗證。若仍要推進G1，需Owner另行決定具體產品／架構或運行資源路線；不把原批准自動延伸，不建議同版再測或串接盲修。 |
| G1-B | §8.5已有盤點沿用；仍須先有足以驗收的候選及批准D日、current與所有必要prior／交易日與檔案日期／合法資格、代表容量、成熟cold預算、自然collector與prefix guard相容性、完整合格真實DAY。既有150萬cold负向保留；本次不批准正式日盤。 |
| G1-C | 仍需G1-A/B查收與exact Merge批准，取得actual merged main，按既有包整版Git同步／matching Node與native／lockfile；合法binding與普通output／版本，CRU34正常owner入口與真snapshot，START_DAILY_USE和原面板must-preserve能力、正常捷徑重開、正式驗收／常駐批准與整版回退。本次未更新8787；PR72隔離更新器不能代替正式更新工具。 |

今日既有營運日曆為NON_TRADING_DAY。收尾唯讀見正式檔49筆／41,131B，最後receivedAt **15:01:02.671191+08**：1 bridge_started、1 subscriptions_ready、29 provider_event、18 quote_type_resubscribe，無trade/quote；這不是交易日收集成功證明。原 **quality FAILED／data_continuity_audit FAILED** 及resubscribe紀錄均列為日常交付缺口，沒有自行修正式流程。本機main及其既有dirty檔保留。

工程投入自13:46開始至本次收尾，屬同一已准4–6人日包、未達6人日上限；不能把已花數小時或通過CI當成日常交付。停止依據為資源gate與實際未達標，不是工程預算耗盡。推薦：**本有限路線不足以放行G1；保留候選成果、退回G1-A驗收，不啟G1-B/C、不Merge、不Promotion、不切8787。**

去敏彙總見 [`campaign-1-result.json`](../evidence/cru55-index-pack/campaign-1-result.json)、[`review-corrections.json`](../evidence/cru55-index-pack/review-corrections.json)；逐筆、raw、SQLite、憑證與私人helper留本機。獨立逐筆重算已確認分母／分位數／CPU停點，B0；沒有重啟產品測試。

## 10. 驗證連續性隔離原型交付差異｜2026-09-26

**PROTOTYPE_PROVEN_WITH_LIMITS。** 接續 [5845329009](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5845329009) 與 CRU-55 最上方原型授權；`9dbddd2` 是已查收並停止的索引打包交付，本節不重交該包。21:35 起核對候選工作樹乾淨、無未回存原型；PR73 Draft/unmerged，遠端 main `1ad9ec7c1814e401f8352048638f0a398bcf74fe`。本次可執行程式 exact **`b35e492b16f4e4762e299ee55137f228ea3e0a71`**。

**推薦 Owner 批准 §10.6 的單一有限產品接入包，但必須明確接受 §10.4 的完整性政策差異。** 若仍要求每次發布都重新讀取全部 raw、或要保證偵測任意 mapped write／靜默損毀，本路線不足，應退回，不自動改另一方案。這次有原型程式與 native 證據，**現行產品程式改動為零，G1-A/B/C 均未完成**。

### 10.1 程式差異與可重現方式

| 檔案 | 實際可執行差異 |
| --- | --- |
| `experiments/guarded-prefix-continuity.mjs` | `GuardedPrefixContinuity.verify/assertReady/close`；首次先保護再全讀，後續先取得新 `[0,M)`、核新舊 lease 同時有效、釋舊後只讀 `[N,M)`。完整 chunk metadata/hash 鏈仍每輪核對；來源、owner、ledger、resolver、role/session、cutoff、鏈終點與活 epoch 綁定。失敗作廢 receipt；lease 遺失重新全讀；記憶體 receipt 不可由 JSON 復活。current/prior 同實體混用拒絕。 |
| `experiments/guarded-prefix-exit-child.mjs` | 僅私人 synthetic 輸入；子程序完整驗證後真 `process.exit(0)`，刻意不顯式釋放 guard，用來驗證 OS 退出及重開全讀。 |
| `experiments/run-guarded-prefix-check.mjs` | 序列小測入口；所有 run 的開始／結束／失敗保存於私人 ledger，累計 900,000ms 硬上限，單次最多120秒；有未結束 run 就拒絕續跑。 |
| `tests/guarded-prefix-continuity.test.mjs` | 真 Windows／NTFS 故障、追加、鏈、prior、退出與 mapped 反例；每次 verify 記實際 bytes/ranges/time，另作全量對照。Linux CI 只跑隔離匯入檢查，8項 native 明示 skip，不能算 Windows PASS。 |

重現命令（只供檢查，本次已執行完）：`node experiments/run-guarded-prefix-check.mjs`，在 PR73 worktree 執行。只建立 `data/test-tmp/guarded-continuity/synthetic-*` 可拋棄人工 bytes；沒有 raw、SQLite、市場回放或正式程序。未修改既有 `src/cru55-prefix-guard.mjs`、pipeline、publisher、reader、launcher、package 或凍結證據，未產生現行 reader 能接受的 artifact。

核心 checkpoint [5846735294](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5846735294) 與 Linear `e4bfb558-714b-4ad7-9fa1-ce4d6381ce77` 已逐字讀回；沒有停下等待查收。

### 10.2 實際讀取、覆蓋與時間

Windows／Node v24.18.0，NTFS 由原生 guard 強制檢查。run-1：9/9，2.410秒；run-2：新增明列 receipt context、子程序路徑限制、每步量測及 OS handle 對照後，9/9，4.195秒。**累計動態 6.605秒／900秒**，零 CVD 長測。兩次正負紀錄都保留於[去敏證據](../evidence/cru55-prefix-continuity/prototype-result.json)；run-2 包含36次成功／失敗 verify 的實讀量和時間，失敗覆蓋為 null，不冒充已驗前綴。後續沒有新程式變更，不再重跑。

以下是 run-2 主要逐步結果，範圍採半開區間，單位 bytes／ms：

| 步驟 | fullRead | suffixRead／實讀範圍 | 已保護且已驗覆蓋 | 原型耗時 | 對照全讀／耗時 | hash |
| --- | ---: | --- | --- | ---: | --- | --- |
| 首次完整 | 524,288 | 0；`[0,524288)` 全讀 | `[0,524288)` | 44.083 | 524,288／4.038 | 相同 |
| 追加一 | 0 | 131,072；`[524288,655360)` | `[0,655360)` | 44.391 | 655,360／4.750 | 相同 |
| 追加二 | 0 | 262,144；`[655360,917504)` | `[0,917504)` | 51.963 | 917,504／9.063 | 相同 |
| 真程序退出後恢復 | 131,072 | 0；`[0,131072)` 全讀 | `[0,131072)`，新 epoch | 47.941 | 131,072／1.090 | 相同 |

三步主案例累計 **917,504／2,097,152 bytes，減少56.25%邏輯 raw 讀取**。一般式為同活 epoch 首次 `N0` 加全部新尾段，對照為各次完整 cutoff 加總；prior 固定範圍第二次 rawRead=0，仍核 metadata、身分與活 lease。逐 chunk 範圍與其他步驟原值見 JSON，不以0填未測項。

**不是耗時加速結論。** 此小檔對照全讀實際更短；原型耗時包含 guard／來源路徑檢查、hash鏈、失敗探針、原生載入及程式開銷，oracle 僅是受保護下的全量 byte/hash 對照。run-1 首次217.935ms與run-2首次44.083ms也不可解讀為產品改善。OS快取、實體HDD吞吐、CVD處理、API／UI延遲均未由本次量到。節省的是 raw 重讀工作，原始提交/fsync、INGEST、QUERY、全 metadata 掃描、序列化／checkpoint、API／UI及重啟全量成本仍在。

### 10.3 真 Windows 安全反例與獨立審查

| 反例／情境 | 實測結果及保證邊界 |
| --- | --- |
| 舊區域一般寫入 | 真 `fs.writeSync` 在已有 prefix、交接 overlap、新guard生效後均拒絕；覆蓋首尾byte探針。 |
| 尾端追加 | Node append 及 CPython `O_APPEND|O_BINARY` 在活 guard 下成功，新增 bytes 全讀後與 oracle 相同；未操作正式collector。 |
| 保護擴展／取得失敗 | 真獨占suffix鎖令新shared guard取得失敗；取得後 overlap／交接後注入失敗均不留receipt。釋舊之前確有新保護，失敗不沿用旧資格。 |
| 資源有界 | 程式穩態1組、交接最多2組guard。另以 `GetProcessHandleCount` 真量到185→187→185，兩次追加後穩態185／185／185；只證這兩次，未證長持無洩漏。 |
| 來源／範圍／鏈變動 | 活guard下rename／truncate拒絕；失去guard後真rename+替換實體拒絕，壞suffix、錯鏈、cutoff倒退、owner/resolver/session變更均作廢。 |
| 保護遺失／零追加 | 遺失後新epoch從byte0重驗；零新增仍檢查來源與live lease。序列化receipt、同檔prior、跨context receipt均拒絕。 |
| 真程序退出恢復 | 子程序未顯式清理而退出，新程序不能復用舊receipt；全讀相同。退出後普通old-byte改寫可成功，但重新全讀會拒絕壞raw。 |
| **mapped write** | **真Python mmap舊區寫入成功；zero-suffix重用未偵測，full hash發現不同。這是已觀察到的排除條件，不刪掉、不改PASS為全防護。** |

[Level3獨立審查](../evidence/cru55-prefix-continuity/engineering-review.md)：root自審＋兩個獨立context針對 exact b35e492 重審，均 APPROVE／B0，僅限原型。reviewer沒有另外跑測試。原生cleanup回傳未逐項檢查是沿用guard的限制，後續長持接入前須做可觀測清理／失敗封鎖，不在此暗改既有guard。

### 10.4 接入時必須批准的政策差異（目前尚未實作）

| 項目 | 現行規則 | 推薦的新規則、失敗情境與回退 |
| --- | --- | --- |
| raw完整性 | 每次發布 `FULL_PREFIX_BEFORE_PUBLICATION`，重新讀current與必要prior全部原前綴 | 明確新policy `GUARDED_PREFIX_CONTINUITY_V1`：同活程序／owner／來源epoch第一次全讀，持續保護後核新增全部raw及完整metadata鏈。guard-loss／重開必須重新全讀；不把新policy標成舊policy PASS。 |
| 修改偵測 | 重讀有機會發現兩次發布間的mapped／非普通寫入變更 | 接受連續epoch內未重讀舊raw而失去該次偵測機會。只保證受OS普通檔案I/O保護的byte前綴；不覆蓋mapped/kernel/privileged/靜默損毀。若不接受，拒絕此路線。 |
| 提交與恢復 | 原raw durable提交／fsync、checkpoint順序 | 全部不變；新receipt只記憶體有效，disk欄位僅audit。重開保留合法原checkpoint做計算恢復，**raw信任必須重建**；新artifact不可在首次完整驗證前發布。 |
| owner/path／來源／盤別 | 真owner與source/resolver、ordinary output、physical path、合法日期及當前段 | 不放寬。把原型字串接到實際owner nonce/PID/start/command/binding、ledger/resolver與當前合法session。prior獨立source+epoch+範圍；同檔或換盤不得跨角色借proof，必要時回全讀。身分錯誤直接BLOCK，不收另一來源。 |
| bytes、順序、數值／時間／品質／null | 既有原值與語意 | 不變；不篩TX、不改時間／分類、安全旗標、不補0、不用歷史值填失效current。 |
| 長持及讀端 | 每次publication後釋guard；reader只接受v2/FULL_PREFIX | 新版producer跨publication保留guard；讀端必須識別新schema/policy與producer存活、失效狀態。先作廢current資格再釋guard；程序已死／狀態未知時清值。舊reader不得把磁碟receipt當live proof。 |
| 回退 | 舊版整套、既有output | 候選先停止新producer並保留全部新證據；回到已存exact整版與獨立舊output／binding，重驗來源後才供值，不轉標新artifact。舊版效能仍未達，不稱回退後G1-A通過。正式回退仍依既有整版包且另准。 |

官方依據：[LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex) 支持重疊shared lock，明訂mapped view可繞byte lock與程序退出釋放；[CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) 定義share/delete相容性。上述本機測試才是本次Windows證據。

### 10.5 接入產品的確切程式與營運差異（供一次決策，未施工）

| 位置 | 擬變更的實際處理階段 |
| --- | --- |
| 新 `src/cru55-prefix-continuity.mjs`；`src/cru55-prefix-guard.mjs` | 把已證交接和receipt邏輯收斂為產品模組，去除測試hook；補guard清理結果與資源計量。維持舊API/default。長持穩態每來源1組，新舊交接最多2；失敗永不保留發布資格。 |
| `src/cru55-stream-pipeline.mjs::runStreamCycle` | 新policy分支在QUERY→VERIFY不歸零活receipt；以持久chunk/cutoff對照舊鏈，先擴展guard，再用原分段budget核suffix；發布前assert涵蓋完整cutoff。成功後保留lease，BLOCK／owner改變／退出先失效、再釋放。原FULL_PREFIX分支完整保留。 |
| `src/cru55-stream-prior-verifier.mjs::beginPriorVerification/advancePriorVerification/priorStillVerified` | 相同prior身分與固定cutoff才重用活receipt；新的prior／換盤／遺失時回全驗。原型目前保守拒絕同實體雙角色；接入必須支援同檔合法prior，以獨立role/session receipt與各自shared guard完整驗prior，禁止直接借current receipt；角色切換先撤銷該角色旧資格。這部分尚未由原型證明，須接入小測過關。 |
| `src/cru55-managed-plan.mjs::runManagedCycle`；`scripts/run-cru55-managed.mjs` | 將continuity物件生命週期提升到同一managed writer／owner，而非單次cycle；stop/restart/error撤銷狀態並清理current/prior，durable checkpoint不得恢復receipt。不另開runtime。 |
| `src/cru55-managed-owner.mjs`、`src/cru55-stream-reader.mjs::createStreamReader` | 新policy讀端核v3 artifact/pointer、binding及producer epoch。用綁PID＋建立時間的native process handle作廉價存活檢查；程序死亡／未知拒絕current。producer在釋lease前先原子標失效，reader每request查狀態而非僅cache artifact；這是讀取「當時已驗publication」，不是從disk建立活guard。注入status/guard釋放/退出各順序故障，禁止stale current。不得每API呼叫用CIM重查造成新重成本。 |
| `src/cru55-runtime-binding.mjs::validateRuntimeBinding`、`src/cru55-managed-plan.mjs::readManagedConfig` | 新 `STREAM_PAGED_V3` producer、`cru55-stream-view-v3`／`cru55-stream-public-v3` schema及policy明確opt-in、新 `stream-continuity-v1` outputVersion；新舊互拒，綁Owner決策URL、exact候選與source/owner身份。舊FULL_PREFIX及正式啟動預設不變。 |
| 對應pipeline/prior/reader/binding/owner小測及私人campaign計量 | 同cutoff對照原數值／分類／六frame／時間品質null；保留現有API/同一原面板，不重做未受影響M4。記full/suffix、source/committed/published、原始write可見延遲及各程序資源。 |

長持保護相容性尚未證：no-delete sharing可能阻止輪替、刪除、截短與某些備份／收集開檔模式；CPython短append成功不足以代表正式collector完整生命週期。先在私人同型檔保留原collector寫入旗標、開閉／fsync/輪替嘗試、長持資源與故障清理，再由G1-B另批自然collector非干擾。若依賴正式collector改寫/截短同檔或不相容開檔模式，停止本路線，不自行改collector、放鬆guard或停正式服務救測試。

重啟成本：本次僅證131,072B全讀47.941ms；不是完整CVD恢復成本。代表成熟current已知至少2,074,014,548B，加全部必要prior；每次失去epoch都需重新讀上述受驗範圍，metadata/INGEST/QUERY另計。未量得這個容量的恢復時間，不用小檔吞吐線性外推5分鐘。G1-A以原31,322筆起點及65分鐘成長狀態驗重開；成熟帳本無checkpoint冷啟動與全天長持留G1-B門檻，不偷加新長測。

### 10.6 一次Owner批准項、预算與停點

推薦**有限接入施工**，不是立即上線。請Owner一次決定以下整包；本原型授權與已停止索引包的§8.6批准不能自動轉用：

1. 接受§10.4新完整性政策及已實證mapped-write偵測差異；批准§10.5限定接線、schema/producer/output隔離。原raw提交/fsync、FULL_PREFIX預設、owner/path及所有數值語意不改；不重新啟動7–11人日儲存重構。
2. **新工程估5–6人日，硬上限6**：核心分段驗證/生命週期2；prior/reader/binding/owner接線1–2；數值安全/兩獨立review1；campaign、結果及最多一次有根因修正1。範圍內修復包含在上限內，不是保證6日曆天上線。長持原生cleanup、owner存活接線不能在此額內安全完成就BLOCK，不自動另包微調。
3. 相稱小測累計≤30分鐘（新接入包預算，**本輪原型仍只有15分鐘**）；須先證同合法cutoff數值exact、失效清值、重開全讀、新舊policy互拒、真OS安全及原始讀取減量。重複raw工作未减少／語意不同／安全假設失敗則不啟campaign。Level3 exact三方無B才續行。
4. **候選每輪完整97分鐘，最多一次候選＋一次有明確產品根因且已修正後驗證，合計最多194分鐘**。準備10、完整byte0初始化15、原節奏流入60、正常重開續收5、停止送入排空5、清理2；stage與total先到者停。不把舊55分鐘套進60分鐘驗收，不延長、降速、換窗口或自動第三輪。
5. 固定來源與窗口沿§8.3、§9實際已凍結的2026-09-24來源：初始31,322筆／42,903,318B、新空output；08:45–09:45新增198,016筆，09:45–09:50重開续收12,914筆。不重做R1/M4/盤點，保留所有種類／原bytes／節奏／完整前序。來源準備核既有hash／索引身分，不啟正式writer。
6. G1-A完成條件沿§8.4：完整逐筆母體API p95≤120s、p99≤180s，同一原頁p95≤150s；重開含stop/start與追到當次source≤5min，drain≤5min且source=committed=published/bytes一致。正常與restart分組再合計，初始另報；unpublished／缺口保留，分位數無法建立即不判PASS。原主機CPU兩個相隔≥30s有效樣本>85%、RAM<6GiB、writer RSS>2GiB、disk<100GiB及無法觀測安全、原始收集干擾均停。候選／appender／observer與主機分開觀測，不推唯一根因。

交易時段等待：G1-A私人固定來源為0；G1-B須等一個另准的合格真實日盤，盤前冷準備額另批。正式操作：G1-C整版更新尚未排程／批准，不能藏在工程人日。首輪若無可修根因或仍受原資源硬停即結案，不能因環境超限自動再跑。

### 10.7 同一份G1-A／B／C接續清單

| 階段 | 本次已完成 | 仍缺及批准狀態 |
| --- | --- | --- |
| G1-A | 隔離continuity程式、真Windows對照與反例、Level3 review | **待§10.6批准**後才產品接入；exact數值／安全、60分鐘＋正常重開＋drain、原API/同頁完整母體及資源仍待驗。本次沒有改善過的現行CVD候選。 |
| G1-B | 沿§6／8.5／9.5既有盤點與負向證據；不重做 | 待批准D日current及全部prior／file date-tradeDate／合法當前段、代表150萬以上容量及全量冷／暖／恢復成本、自然collector與長持guard非干擾、真實完整DAY；quality/data_continuity_audit FAIL保留，不能以有值代品質合格。 |
| G1-C | 沿既有UPDATE_AND_ROLLBACK包及M4主卡/圖表/清值/合法第二段成果 | 待G1-A/B與Owner接受，exact候選Merge批准、actual merged main整版Git同步、matching Node/native/lockfile、legal binding/path/ordinary output/version、CRU34正常owner入口與真snapshot、START_DAILY_USE/原面板must-preserve、正常捷徑整版重開及實際回退。正式驗收、批准容量/時段、有限試用→日常常駐須Owner明示；62k/09:45或45分鐘回退不是終點。PR72隔離更新器不能作8787更新工具。 |

此次停在 **PROTOTYPE_PROVEN_WITH_LIMITS／產品接入待Owner決策**。正式collector/raw/SQLite/排程／五日計數、8787、正式容量與安全旗標0/true/false/false均未操作；未Merge／Promotion。既有索引包NOT_MET與今日品質FAIL原封保留。本節只新增原型及後續一次決策差異，沒有把報告或CI當產品前進。
