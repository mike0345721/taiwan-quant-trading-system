# 目前專案真實狀態

> 更新日期：2026-08-13
> 文件角色：只描述現在可由程式、資料與測試佐證的系統狀態，不保存版本歷史、不授權下一階段。Product Owner明確決策為最高權威；Linear保存live CURRENT／NEXT執行狀態，`ROADMAP.md`保存耐久策略／範圍地圖，GitHub `main`保存已批准實作。歷史變更請搜尋`CHANGELOG.md`。

## 2026-08-13 Approved Main Checkpoint

- DW-1中文優先Decision Workspace、DW-2 governed actual-contract TX多時間框架圖表、PR #19 timestamp-lineage chart availability hotfix、PR #20 Project Handoff V1，以及DW-3 Market Change Feed V1均已進入approved `main`。
- DW-3只輸出completed legal 5m VWAP／Opening Range／Session Structure evidence，分離Evidence Engine Availability與Data Trust，不是交易訊號。
- Timestamp lineage仍為`QUALITY_INSUFFICIENT / TIMESTAMP_LINEAGE_INSUFFICIENT`；native sequence仍為`UNAVAILABLE`。PR #19沒有消除底層品質問題。
- Market State／Forward Shadow維持`researchOnly=true`、`formalWeight=0`、`executionAuthorized=false`；正式歷史MISSED不得backfill或改寫。

## T0 Final Spec／Data-Replay Gate Closeout

- `T0 Final Spec = PASS`、`T0 Data／Replay Gate = PASS`，本工作包已關閉。
- Strict可重播樣本共137個Session；Fallback實際使用0、NO_SAMPLE 0，Strict覆蓋率為1.0。
- 進場開盤價已穿越初始停損時固定輸出`NO_TRADE / ENTRY_GAP_THROUGH_STOP`，不得建立交易或計入任何費用。
- False Breakout只作結果診斷：使用突破確認後首3根完整5分K，且不得改變Entry、Exit或損益。
- 全套測試結果為223 PASS、0 FAIL；重跑未改變既有Gate產物。
- 下一步目前只完成`T0 HISTORICAL H0 RUN Owner Brief`，尚未授權建立Runner或執行績效研究。
- 安全邊界維持：`formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`。

## 目前階段

專案目前是：

> **本機優先、只讀的台股／台指Market Intelligence與Research Infrastructure。**

目前工作仍集中於資料品質、連續累積、只讀行情可靠性及既有功能穩定。尚未進入交易級Strategy、Position、Hedge、Risk或Automated Trading。

## 現有系統

### Dashboard與API

- Node.js本機服務與瀏覽器Dashboard。
- 私人登入、密碼雜湊、Session、CSRF、登入限流及安全標頭。
- V1 Dashboard API、歷史查詢、回測摘要、盤中回放與V2研究查詢。
- 服務預設只監聽本機，Dashboard不持有券商秘密。

### 資料與研究核心

- V1 JSON快取與歷史快照。
- V2本機SQLite研究資料庫、Migration、官方資料回補、品質稽核及Feature資料。
- TWSE、TPEx、TAIFEX官方現貨、期貨、選擇權、法人、OI及延伸研究資料。
- 可重播的官方5分鐘資料、盤中Feature、凍結策略工程骨架與append-only紙上事件帳本。
- Walk-forward、Holdout、交易成本、MAE／MFE、Bootstrap及多目標研究工具。

### 市場情報功能

- 現貨、期貨與選擇權籌碼Dashboard。
- Call／Put Wall、Max Pain、P/C Ratio、同契約OI短趨勢與Options Smart Radar。
- 六軸影子構成與Transparent Dealer Map Beta。
- Dealer Balance Zone v0目前只使用公開OI Balance；Delta Neutral與Gamma Center仍未接入。

### 唯讀行情

- Shioaji股票唯讀橋接、IX0001／2330事件契約、append-only事件檔與稽核工具已存在。
- 即時事件稽核已具備正式驗收門檻，可檢查商品覆蓋、事件數、觀察時長、重複、序號缺口、時鐘偏差、亂序、疑似斷線空窗及受控重啟後重新訂閱證據。
- 2026-07-30已在正式環境完成唯讀登入驗證：期貨帳戶可見，TXFR1／MXFR1／TMFR1合約與快照均可讀，且三者皆有行情時間戳、成交價及成交量。
- 2026-07-30已完成TX／MTX／TMF即時Tick與五檔Bid／Ask驗收：最新乾淨工作階段約30分59秒，
  三商品時間長尾為0，重啟後三者均再次收到Tick與Bid／Ask；append-only ledger為0 invalid、
  0 hash failure、0 sequence gap、0 duplicate，queue／callback／writer錯誤均為0。
- 日夜盤跨時段、換月與次月契約仍須持續累積；TXO可列出1,926個契約，並已對最近月、
  價平附近五個履約價的Call／Put共10筆雙邊報價完成Black-76本機估值探針。
- 10／10筆可反解IV並計算Delta／Gamma，重定價誤差絕對值均小於`2e-11`；但供應商沒有直接
  回傳Greeks，且snapshot timestamp的時區／時間語意尚未驗證，因此正式Greeks Gate維持
  `PENDING`、正式模型權重為0，DEX／GEX不得提前啟動。
- IX0001即時事件已含上漲、下跌、平盤及漲跌停家數，可作盤中廣度原始資料；
  前十大權值股貢獻仍缺少可追溯、具日期版本的官方權重來源，不得硬編碼估計權重。
- 券商回傳的期貨帳戶`signed`旗標目前仍為`false`。此狀態不影響已驗證的唯讀行情快照，但不得據此宣稱正式交易已就緒。
- 股票即時事件已於2026-07-28完成IX0001／2330連續可靠性驗收；橋接仍為唯讀且不具下單權限。

## 目前資料與證據門檻

- 官方日資料、選擇權逐履約價OI、歷史5分鐘資料與研究結果持續累積。
- 目前有135個完整、通過既有稽核的官方5分鐘交易日，涵蓋2026-01-02至2026-07-28；正式盤中研究120日資料門檻已通過。
- 未驗證因子的正式權重保持0。
- 公開OI無法辨識真正Dealer買賣方向；GEX、DEX、Gamma Wall或Dealer Position只能作明示假設的情境研究。
- Max Pain不是結算保證，OI Center與Dealer Balance Zone不是實際成交成本。

### V3.10首輪因子影響研究

- 2026-07-29完成第一輪固定規格研究：135個交易日、每日09:00單一決策錨點、108日開發期與27日歷史保留期。
- 法人、OI、選擇權結構、IV及基差因子均只使用嚴格早於研究日的資料；時間違規為0。
- 9個候選因子中沒有任何一個通過Walk-Forward、歷史保留期、5日移動區塊Bootstrap及Holm多重比較後的晉升門檻。
- ATM IV、25D Skew與近次月價差只保留為描述性觀察；其餘因子判定為不支持或不穩定。
- 所有正式權重維持0，`researchOnly=true`、`executionAuthorized=false`，不產生交易建議。
- 本次歷史保留期已被檢視，不能再次稱為全新樣本；任何晉升必須等待真正新增的前向資料。
- 凍結規格與結果分別位於`docs/research/V3_10_FACTOR_IMPACT_PROTOCOL.md`及
  `data/intraday/research/v3.10-factor-impact/REPORT.md`。

### V3.10第二輪穩健性／反證研究

- 2026-07-29使用相同135日歷史完成第二輪反證，不新增因子，也不把已檢視資料重新稱為全新Holdout。
- 9個因子先使用只含過去至少20筆資料的滾動百分位，再執行60日以上訓練、12日測試、1日purge的Walk-Forward。
- 每個「因子×目標」均執行1,000次5日區塊置換，並在同目標9因子內使用Holm修正；時間違規為0。
- 沒有任何因子通過歷史穩健訊號門檻，也沒有可晉升因子。外資部位變化、市場OI變化、ATM IV、25D Skew與近次月價差只保留描述性觀察。
- 近次月價差在最強歷史目標`return30`的相對MAE改善為2.03%、正向fold為60%、未修正置換p值為0.0440，但未通過Holm，因此不得稱為有效因子。
- RVOL、Max Pain距離、Wall不對稱與期現貨基差判定為不支持或不穩定；所有正式權重仍為0。
- 協議與報告位於`docs/research/V3_10_FACTOR_ROBUSTNESS_PROTOCOL.md`及
  `data/intraday/research/v3.10-factor-robustness/REPORT.md`。

### V3.10第三波前向研究

- 2026-07-31已完成第一個合格全新前向交易日；這只代表工程閉環成立，不代表模型有效。
- Track A只追蹤前日25D Skew與近次月價差bps；Track B新增期貨逐筆VWAP、
  供應商分類CVD、最佳Bid／Ask交叉分類及衝突率。
- 單日輸出只作資料品質描述，至少30個全新乾淨日以前不得作中期判定，至少60日以前不得進行
  新的Purged Walk-Forward。
- 協議與狀態位於`docs/research/V3_10_WAVE3_FORWARD_PROTOCOL.md`及
  `data/intraday/research/v3.10-wave3-forward/status.json`；正式權重仍為0。

### V3.10限制式第三輪歷史Discovery

- Product Owner已正式接受第一、二輪失敗結果：135日全部視為已檢視資料，不再存在untouched holdout，
  不得回頭調參、擴大因子搜索、降低Holm／Walk-Forward門檻或修改正式權重。
- 2026-07-30完成嚴格Price-only audit：原4項baseline中`closeVsVwapReturn`與`logOpeningVolume`
  分別使用量能加權與成交量，不能再稱為純Price-only；新baseline固定為8個不重複價格狀態。
- 限制式第三輪只測3個預登記interaction、4個固定60分鐘Event／Risk targets、共12項同一Holm family；
  每項使用60日以上訓練、1日purge、12日測試及1,000次5日區塊置換，時間違規為0。
- H1 Price Regime×近次月價差、H2 Price／Volatility Regime×25D Skew、H3 Price／Trend Regime×市場OI
  的Primary target均未通過完整門檻，整體結論為`no_primary_hypothesis_supported`。
- H2在僅4個OOS日且該窗事件數為0的情況下出現表面Brier改善與Holm通過；因OOS低於24日而正式否決，
  不得描述為有效訊號或據此縮減baseline重跑。
- 歷史報告位於`data/intraday/research/v3.10-restricted-wave3/REPORT.md`；正式權重仍為0。
- 限制式forward規格、12個固定模型與append-only registry已凍結，最早合格日為2026-07-31；
  30個全新乾淨日只作smoke test，不授權晉升。

### V3.10 Frozen Forward Operations Gate v1

- Product Owner已核准既有12個凍結模型的工程閉環；不改模型、特徵、interaction、
  門檻、事件定義或正式權重。
- 唯讀觀察程序使用既有live event ledger，不另行登入Shioaji，也不建立第二個行情橋接。
- Prediction、Outcome及日級接受／拒絕紀錄使用append-only hash chain、sequence、
  idempotency key與Prediction hash linkage。
- 2026-07-31完成第一個合格新交易日：12筆Prediction、12筆Outcome及
  `forward_day_accepted`均依固定時序追加，當日`attemptStatus=ACCEPTED`。
- 全日Acceptance於13:47完成；來源ledger為0 invalid、0 hash failure、0 sequence gap、
  0 duplicate，TX目標時窗clock skew為0，Registry稽核28筆紀錄且0錯誤。
- 整體驗收狀態為`PASS`。此工作包已完成，Frozen Forward後續只作背景自動累積，
  30個乾淨日只作smoke test，60日以前不申請績效研究或Promotion。
- 規格與驗收輸出位於`docs/research/V3_10_FROZEN_FORWARD_OPERATIONS_GATE.md`及
  `data/intraday/research/v3.10-wave3-forward/operations-acceptance.json`。
- PP-1已依Product Owner核准範圍完成P00～P10隔離實作與驗收；最終Run為
  `data/pp1-market-semantics/run-2026-08-01-v3`。Product Owner已於2026-08-01批准Closeout：
  Design=APPROVED、Implementation=PASS、Acceptance=PASS、Work Package=CLOSED。
- PP-1未修改Frozen Forward或Phase A完成產物；正式權重仍為0，未建立Signal、Paper或下單路由。
- 既有官方日資料缺少兩候選契約的分Session參考成交量，因此實際流動性契約選擇安全降級為
  `UNAVAILABLE`，`SELECTED_TRADING.tradeEligible=false`；不得用全日成交量冒充夜盤／日盤參考量。
- 完整技術證據位於`docs/research/PP_1_ACCEPTANCE_REPORT.md`。
- `liquiditySelectionCoverage=PARTIAL`、`rawGapHistoricalCoverage=PARTIAL`；這是已接受的資料覆蓋限制，
  不得表述為所有Session均有流動性主力證據或所有歷史日期均有Raw Gap。
- `phaseAContractReconciliation=IDENTIFIED_NOT_EXECUTED`，實際重算維持等待獨立Product Owner授權。
- 下一個候選僅為`T0 DAY SESSION TECHNICAL BASELINE — SPEC FREEZE`，尚未啟動或取得實作授權。

## 安全與執行邊界

- `researchOnly=true`
- `executionAuthorized=false`
- 沒有委託路由、模擬委託或實單能力。
- 券商行情程序與Dashboard隔離。
- 原始市場資料、事件帳本與研究輸出維持可追溯、可重播及可重算。

## 當前未完成門檻

- 持續追加並稽核完整盤中研究日；120日最低門檻已通過，但不得因此宣稱策略有效。
- `live_ix0001_2330_acceptance.status=PASS`：2026-07-28原始ledger以修正後規則重新稽核通過；
  已完成超過30分鐘乾淨運行、受控重啟、重新訂閱，以及IX0001、2330重啟後真實行情驗證。
- 每日最新運行稽核保存於`data/live-events/audits/latest.json`；持久化里程碑驗收保存於
  `data/live-events/audits/acceptance.json`。後續較短的每日樣本不得把已重新驗證的PASS降級，
  但來源ledger若完整性或驗收條件失敗，仍必須失效。
- Paper Event尚未具備即時TX與已核准前瞻策略等前置條件，目前標示為延後項目，不作為CURRENT退出阻塞。
- 期貨唯讀行情的帳戶、合約、快照、TX／MTX／TMF即時Tick／BidAsk及受控重啟Gate已通過；
  證據位於`data/live-events/futures-audits/latest.json`。這不等於完整期貨頁或Greeks／GEX已完成。
- 唯讀期貨驗收工具與去識別證據位於`scripts/check-shioaji-futures-access.py`及`data/readiness/shioaji-futures-access.json`；結果固定`executionAuthorized=false`、`orderRoutesEnabled=false`。
- 選擇權有限Greeks探針證據位於`data/intraday/live-derived/2026-07-30-option-greeks-probe.json`；
  timestamp Gate仍為`PENDING_PROVIDER_SNAPSHOT_TS_SEMANTICS`，不得進入正式DEX／GEX。
- Dealer Map Beta目前只累積與驗證，不因短期表現調高權重。

## 驗證狀態

- 2026-07-30驗證：根目錄135項測試、V2資料核心95項測試及秘密掃描通過。
- 官方歷史資料驗證1,063／1,063通過；最新V2品質報告為0錯誤、0警告、6項資訊，時間可用性稽核0失敗。
- 最新官方日資料連續性稽核未檢出缺口；當日資料可能使實際涵蓋數暫時比已完成交易日基準多一日。
- 最早9日的法人期貨缺值不再可能經`Number(null)`轉成0；淨部位與衍生Delta均維持`NULL`，並有回歸測試。
- 2026-07-23官方回放的Paper Event完整生命週期離線驗證通過，且未修改正式帳本；正式事件等待即時TX與前瞻策略前置條件。
- Shioaji callback已改為有界queue與背景writer；斷線時結束bridge，交由既有啟動器以新process重新登入及訂閱。
- 2026年1至6月購買的TAIFEX期貨成交簡檔共116／116個交易日通過格式、日夜盤、契約、官方OHLC及成交量範圍驗證；
  其中99日新增、17日與既有檔逐根一致，正式盤中樣本增至135／120日。
- v3.10 evidence gate的CURRENT證據門檻已通過；這只代表可進行下一階段規劃審查，
  不代表自動取得NEXT開發授權，也不代表任何策略已證明有效。
- V3.10首輪因子影響研究已完成且沒有可晉升因子；正式模型權重未改變。
- V3.10第二輪歷史穩健性／反證研究亦無通過因子；不得以未修正p值或單一最佳目標晉升模型。
- V3.10限制式第三輪歷史Discovery亦無Primary假說通過；H2的小樣本表面結果已由OOS最低日數Gate否決。
- 2026-07-29重建資料完成度報告：市場、TWII、TX、現貨法人、期貨法人、融資券及選擇權核心資料均涵蓋747個對齊交易日，`unresolvedAlignedDates=0`；最新CURRENT readiness沒有阻塞項目。
- 每次工作仍須依實際修改範圍執行必要測試、資料稽核與安全掃描。
- 若本文件與程式、資料庫或測試結果不一致，以可驗證實況為準並修正本文件。

## 最小開工集合

一般維護只讀：

1. `AGENTS.md`
2. `ROADMAP.md`
3. `CURRENT_STATUS.md`
4. `KNOWN_ISSUES.md`

其餘文件依`AGENTS.md`的Task-based Context Routing選讀。
# 2026-07-26 歷史期貨法人部位缺口補值

- 2023-07-03 至 2023-07-13 的 9 個交易日已完成補值；期貨法人部位涵蓋率為 744/744。
- 期交所免費查詢僅提供交易日前三年資料，這 9 日已超出免費範圍；本次採 FinMind 保存的 TAIFEX 衍生歷史資料，並明確標記為次級來源，不冒充官方直連。
- 2023-07-03 已與期交所官方頁面數字交叉核對；全部 9 日均通過多方未平倉減空方未平倉等於淨額的驗證。
- 最新品質報告為 0 error、0 warning、6 info；本次未使用推估值，亦未改變 `researchOnly=true`、`executionAuthorized=false`。
