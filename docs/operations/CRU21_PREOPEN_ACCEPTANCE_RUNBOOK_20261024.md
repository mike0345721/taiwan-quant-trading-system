# 勢衡 CRU-21｜開市前驗收作業流程 V2（2026-10-24）

> **文件性質**：10/27 預定交易日的 P0 唯讀工作臺驗收 SOP。**本文件是操作規格與已有證據的更新，不構成啟動／登入券商／更改正式環境／合併／交易的新授權。**
>
> **單一目標**：以正確已批准版本及原始資料，證明勢衡 V2 能在正常帳號下安全呈現 K 線、六窗 Flow、Market Pulse、當下觀察條件及來源品質。研究績效、正 EV、TXO/CVD、Blave、實盤交易皆不在本次交付範圍。
>
> 本文件從已批准 GitHub main 另開**文件專用候選**；不修改 PR #97 已審查之任何程式碼或精確 HEAD。產品／CURRENT 狀態以 Linear CRU-21 和 Owner 最新決策為準。

## 0. 開市判定與來源

- 日期採 Asia/Taipei。**2026-10-23（五）**因颱風期交所日、夜盤休市；**2026-10-26（一）**是補假休市；**2026-10-27（二）**為目前預定下一交易日，**必須當日再查有無最新緊急公告**。
- 官方依據：[臺灣期交所公告](https://www.taifex.com.tw/cht/11/announcement)、[臺灣期交所首頁緊急公告](https://www.taifex.com.tw/)、[TWSE 2026 休市日曆](https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html)。
- 10/23 官方公告亦使部分當日到期的週五臺指選擇權最後交易／結算日順延。重新開市時重新核對實際期貨合約、到期／換月身分；此流程**不因此啟用 TXO 訂閱或交易**。
- 交易日曆衝突、來源未經核准或新宣布停市：**CALENDAR_UNKNOWN / MARKET_CLOSED_EXPECTED**，不重訂閱、不索取不存在的 Tick，也不把該日記作 Forward Paper 有效交易日。
- 凍結年度日曆、歷史 10/22 NIGHT 歸屬、2026-10-23 緊急休市例外及原始事件時間不得回寫；候選例外不得當成正式營運的授權證據。

## 1. 固定版本與已完成事實（截至 10/24）

| 對象 | 精確版本／結果 | 不可混淆的範圍 |
| --- | --- | --- |
| GitHub 已批准 main | 4d8251686bdb4abbdb469bc00ae798717c0fd583 | 正式舊版；不是新版 V2 |
| 新版整合候選 PR #97 | 398b38daeb9e4c05e0c744d576a6646fa392d37e | Draft、未 Merge、未上正式 8787 |
| PR #97 GitHub CI #321 | 1460 PASS／0 FAIL／9 SKIP；SUCCESS | 驗程式，不等於真實行情 |
| PR #97 MSI Windows CI | 1466 PASS／0 FAIL／3 SKIP | 尚需真實同版 Browser／行情驗收 |
| PR #97 Codex code review | exact 398b38d completed，無發現／無未解項 | 工程審查，不是 Owner 交付批准 |
| PR #94 休市日曆 P2 | 已回覆並在 GitHub 標記 Resolved | 保留原來的審查與測試收據 |
| 正式 active binding | SHA-256 707BEE91C0497C9100D27F226B4B72A6D8E804E86F7B5D60FFA11991DA049D8B | 僅已批准舊版啟動綁定已修復 |
| Dashboard 正式來源 | D:\Taiwan stock\approved-main-runtime / HEAD 4d825168… | 乾淨、與 binding 的 commit 相符 |
| Launcher / Producer | e52dc6745fe6… / 2e4c89e2dbf… | 原來已相符、未更版 |
| 10/17 逾時 safety guard | 已以 mutex 對帳與封存，原始失敗證據未刪 | 不代表正式啟動或回復演練 PASS |
| 正式 active CheckOnly | 10/24，run 6e2a209d-2fc8-488e-bd9b-68ba421cacc9，PREFLIGHT_PASS／exit0 | 僅來源與啟動前預檢，並非 BOUND_SOURCE_READY |
| 最新已知服務埠 | 8787／18722／8790 未監聽（10/24 前次實機查核） | 每次值班前要重新讀；不能假設一直離線 |

- 綁定修復原檔 SHA-256 1389729446C1AF16D39BF9E94494E58ADA47E447E10444F5CDC383F584AFC9D8 已存私有備份；修復收據 SHA-256 0538D1C4DB31A7DD438181CF2AE3FC6F2E514236382467CB7C5D00CB069D5260。原失敗 guard 已封存；不把它恢復成會再次阻擋正常啟動的狀態。
- 精確收據與原始服務根、憑證、原始 Tick／BidAsk 均保留於 MSI 私有資料目錄。不得 commit 憑證、環境檔、SQLite 或原始行情。
- **歷史 9/2、9/3、9/9 完整性稽核仍為 AUDIT_INCOMPLETE**（有界讀取未完成），不得改稱原始資料毀損，也不得列成已修復。

## 2. 分工與禁止越權

| 角色 | 可做什麼 | 不可自動推論 |
| --- | --- | --- |
| 系統讀取／ChatGPT 追蹤 | 讀官方公告、GitHub/Linear、MSI 程序／排程／健康收據，整理阻塞 | 讀取成功 ≠ 執行緒已啟動；無授權不啟停 |
| MSI 操作與工程驗證 | 已授權且受控的 CheckOnly、隔離候選測試、來源與程序指紋比對 | 不可因 CI 通過自動啟動 Bridge／Producer／8787 |
| Product Owner | 正常帳號登入與介面確認、批准精確版本／操作／回復方案 | Owner 同意設計 ≠ 同意 Merge、模型扣點或下單 |
| 非作者審查 | 確認 exact HEAD、安全、資料時序與失敗收據 | 工程 APPROVE ≠ 正式交易資格 |

全程固定：researchOnly=true、formalWeight=0、executionAuthorized=false、orderRoutesEnabled=false；沒有 broker order route、模型自動請求、額外付費、回填缺日與靜默自動重試。

## 3. 當日作業順序（建議時段／不是新增排程）

| 時段 | 關卡 | 必留證據 | 判定／處置 |
| --- | --- | --- | --- |
| 10/26 休市或 10/27 前一晚 | **G0 官方日曆與精確版本** | 期交所緊急公告、預定交易日、PR #97 exact HEAD/CI/review、正式 binding SHA、已核准版本／回復基線 | 無法證實交易日或來源變更：HOLD |
| 10/27 08:00–08:15 | **G1 主機／程序／綁定** | MSI online、時間來源／偏差、可用空間、CPU、現有 PID／creation time／port owner、既有 tasks LastRun/LastResult、git clean、binding/guard/shortcut 指向 | SHA/PID 不同或 guard 重現：STOP；不盲改／殺程序 |
| 08:15–08:35 | **G2 啟動前授權與 CheckOnly** | 原正式已批准 binding 4d825…及 CheckOnly exit；如取得適當操作授權，受監督啟動的 terminal receipt 與真實程序身分 | 沒有啟動授權或正式服務未啟動：STARTUP_PENDING；不得冒稱 LIVE |
| 08:25／08:30／08:35 | **G3 原有排程查核** | Market State State、Daily Update、P0 Forward 與 V3.10 的真執行收據；任務沒有重複 writer 或跨日 backfill | Exit0 只代表程序結束；Forward 有效日須另有完整 session／對帳 |
| 08:45 期貨日盤開市後 | **G4 真正行情** | 新 TX／MTX／TMF futures_tick、futures_bidask；實際期貨契約、DAY、交易日、交易所時間與收件時間、sequence/duplicate/gap、原始帳本追加 | provider ACK／HTTP200／舊 snapshot **不算**流入行情；無 Tick+BidAsk → DATA_BLOCKED |
| 09:00 起 | **G5 Producer → API** | Producer lock/instance/source SHA、一致 read-root、新增 ledger ordinal／snapshot、4 路實際 API 來源／合約／時間／品質對齊 | Producer NO_COMPLETE_SUFFIX、過期或違法 as-of → LIVE_DATA_NOT_READY |
| 新流入資料資格完成後 | **G6 正常登入＋桌面／手機 UI** | 同一 PR #97 exact HEAD、正常帳號認證/Session/CSRF、1366×768／390×844 Chrome、K 線／量、六窗 Flow、Market Pulse、CurrentFocus/R:R、登出與過期處理 | 缺價不能拿日收盤冒充 tick；長窗暖機不冒充方向；只判定當下合格欄位 |
| 完成 G0–G6 之後 | **G7 Owner 顯示驗收** | Owner 明確「哪個 exact SHA／畫面／當日真資料」通過，列未通過與未來工作 | UI 產品驗收可以先完成，不能因此升級研究／交易權重 |
| 另行精確批准後 | **G8 Merge 及正式切換** | PR 依賴合併順序、正式 source/tree、單 writer、部署/回退預檢與真 terminal 收據、8787 正常登入／來源重驗 | Merge ≠ 8787 已部署；未批准任何一項不執行 |

- 既有一次性 ChatGPT 09:00「勢衡開市驗收檢查」是**唯讀查核提醒**，無法代替 G1/G2 的事前啟動，也不保證通知或自動修復。不得為此自行新增常駐代理／多次重啟排程。
- P0 Forward Paper 08:35 真啟動、13:47 日級 reconciliation，仍依原 frozen plan；休市或 missed 08:35 須留 MISSED／NOT_EXPECTED，不得事後補造；5-Day Smoke 與 20-Day Gate 各自維持原標準。
- 15:00 夜盤如要另驗，使用夜盤真正新行情及正確上一個現貨交易日。**PR #89 官方現貨收盤基差是獨立候選，不是 PR #97 完成 P0 交付的前提**。

## 4. 兩個可重現的唯讀檢查入口

以下是**人工／既有已授權程序**的範例；不得作為未授權背景任務或交易命令執行。

1. 在 PR #97 原獨立工作樹以 Node 執行**來源前置檢查**（只讀，不接券商）：

       cd /d "D:\Taiwan stock\standalone-v1\data\worktrees\cru21-preopen-integrated-candidate-20261023"
       node scripts/check-cru21-preopen-readonly.mjs --expected-head 398b38daeb9e4c05e0c744d576a6646fa392d37e

   上述 cd /d 為 CMD 語法；PowerShell 請改用 Set-Location。結果只能是 PREOPEN_SOURCE_GATES_PASSED_ONLY；不能報 LIVE 或 OWNER_ACCEPTED。

2. 如既有服務確已由授權操作正常啟動，使用候選樹**唯讀健康快照**：

       node scripts/inspect-readonly-health.mjs --candidate --port 18722 --expected-head 398b38daeb9e4c05e0c744d576a6646fa392d37e

   當服務未啟動時，預期為 ATTENTION_REQUIRED、Bridge/Dashboard 不可達、exit2；**這是正確拒絕，不要為了換綠燈改檢查或反覆啟動**。

3. **正式舊版 binding 的 CheckOnly**：沿用原受監督 start-bound-daily-use.ps1 + 私有 active binding，限定 CheckOnly + NoBrowser；它會新增監督收據，並非零副作用的純讀取。10/24 已有真實 PREFLIGHT_PASS，若 SHA/設定未變不為補測而無限重跑；除非 Source/Process/Guard 變更，不重做已 PASS 的門檻。

## 5. 停止條件、回復及例外

**S0 市場沒有開**：官方當日休市則 MARKET_CLOSED_EXPECTED；期待新報價為否，不補零、不登入券商或重試，保留現有健康與原因。日曆缺證據則 UNAVAILABLE/HOLD，不自行當成開市。

**S1 啟動器與身份不符**：active binding SHA、Git HEAD、程序 creation time、單例鎖或捷徑指向有異；只保留收據並 STOP，不能用改 SHA、reset 工作樹、刪 guard、切換同名目錄繞過。

**S2 資料不可用**：只收到 provider ACK、沒有新 Tick+BidAsk、actualContract/session 不符、時間穿越、缺快照、報價退化或索引尚未合格；只標明 MISSING／STALE／QUALITY_INSUFFICIENT，不自動升格為 Broker 故障或策略方向。需 Owner 明確批准的受控診斷才可重新登入或啟停服務。

**S3 UI 不合格**：正常登入、API 與畫面數值/價格來源不符，或前端將未知當 0、日收盤冒充成交 Tick、過期 Flow 給 BUY/SELL、缺失 R:R 當可用；本次產品驗收 HOLD，即使 CI 綠燈亦不得合併。

**S4 審查／CI／回復不一致**：同一 exact HEAD 的測試失敗、後續新增程式、未解 blocking review、沒有可回復的正式部署方案；不合併、不部署。

**受控恢復只以已批准基線為目標**。10/24 原始 binding 備份 138972…記載的是**當時有誤的舊路徑**，僅作稽核與必要回復證據，不可當成「一鍵回到安全正式版本」直接套回。已修復 binding 707B…才是目前正式已批准舊版的綁定基線。正式 V2 尚未部署，**現階段沒有新版可 rollback 的運行程序**；未來部署或恢復須重新取得既有程序 PID/creation time、完整環境與資料根指紋及 Owner 精確批准。

## 6. 收據格式與判定

每次驗收保存最少：時段(Asia/Taipei)、官方公告/適用交易日、Git exact HEAD/tree/branch/dirty、approved formal binding SHA、process PID + creation time + listener ownership、資料 actualContract/session/tradeDate/sourceTime/receivedAt/availableAt/quoteType、增量事件數與尾段、品質與不可用原因、Producer owner/ledger ordinal/snapshot SHA、API/Browser 同版證據、測試命令/exit/CI URL、Owner 動作與授權、原始反例／重試次數／未知項。

**使用互不混淆的四級結論：**

| 結論 | 何時可寫 | 不能代表 |
| --- | --- | --- |
| PREOPEN_SOURCE_GATES_PASSED_ONLY | exact source、日曆、已批准綁定 CheckOnly／工程門檻有收據 | 不能代表服務啟動 |
| RUNTIME_SOURCE_QUALIFIED（待真行情） | 真開市的 Tick+BidAsk、Producer、API 時間和來源全部驗證 | 不代表 UI 全部合格 |
| OWNER_UI_ACCEPTED（待本人） | 正常帳號、桌面／手機、K 線/Flow/缺值/失聯均經本人同版驗收 | 不代表策略 Edge 或已 Merge |
| FORMALLY_DEPLOYED（需另授權） | 精確 PR stack 已核准合併、正式 8787 實際切換及 rollback 收據、重新驗收通過 | 不代表實盤下單授權 |

表中後三級是**SOP 的驗收分類名稱**，不是目前系統已回傳的狀態，尚不得標為 PASS。所有資料品質不足、未通過或無收據者保留為 FAIL / BLOCKED / UNKNOWN，不作主觀補完。

## 7. 既有文件與責任邊界

- 候選史料：[PR #97 開市前整合候選](https://github.com/mike0345721/taiwan-quant-trading-system/pull/97)，原 docs/operations/CRU21_PREOPEN_INTEGRATED_CANDIDATE_20261023.md 為 10/23 快照，其中「Dashboard SHA 不一致／PR97 尚未 review／PR94 P2 未結案」已由 10/24 修復與審查收據取代。
- 已批准啟動器語義以當前受控版本的 docs/operations/CRU21_BOUND_DAILY_USE.md、CRU21_STARTUP_SUPERVISION.md 為準；正式部署另遵守 CRU21_DASHBOARD_ROLLOUT_V2.md 所述安全門檻。
- [GitHub CI #321](https://github.com/mike0345721/taiwan-quant-trading-system/actions/runs/39979357850)／[PR97 10/24 repair receipt comment](https://github.com/mike0345721/taiwan-quant-trading-system/pull/97#issuecomment-6378196076)／[Linear CRU-21](https://linear.app/cruise41319/issue/CRU-21/dashboard-decision-workspace-v1today-snapshot-chatgpt-manual-decision)。
- PR #89 夜盤、PR #90/#92/#95/#96 L5/Outcome/OOS、歷史資料稽核三日缺口、Forward Paper 5-Day/20-Day Gate 仍各自保留，不能被這次 UI 開市前工程 Gate 冒充已完成。
