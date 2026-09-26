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
