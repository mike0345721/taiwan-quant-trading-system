# 台股籌碼神器：執行 Roadmap

> 更新日期：2026-07-29  
> 本文件用途：控制目前工作範圍，避免長期願景造成scope creep。  
> 本文件是CURRENT／NEXT／FUTURE工作範圍的唯一權威。若其他狀態、待辦或歷史計畫與本文件衝突，以本文件為準；詳細研究公式仍以各專項規格為準。  
> `NEXT_TASKS.md`僅為歷史索引，不構成開發授權。

## 一、目前實際階段

專案目前位於：

> **只讀 Market Intelligence／Research Infrastructure，正在累積與驗證資料。**

已完成的主要基礎：

- 安全的本機只讀Dashboard與每日官方資料流程。
- V2 SQLite研究資料庫、官方歷史、品質稽核、Walk-forward及留出研究骨架。
- 官方5分鐘歷史回放、價格／量能特徵與凍結策略工程骨架。
- Options Smart Radar、六軸影子評分及Transparent Dealer Map Beta。
- Shioaji股票唯讀接線、事件契約、append-only儲存與稽核工具。

尚未跨越的門檻：

- 股票唯讀即時事件已完成IX0001／2330連續時間戳、漏包、重複、受控重啟與重新訂閱驗收；後續維持每日監控。
- 期貨／選擇權唯讀權限與Greeks尚未完成接線及品質驗證。
- 正式盤中研究已累積135個完整交易日並跨越120日資料門檻；這不等於策略或因子已證明有效。
- append-only紙上前向帳本目前尚無正式前向事件。
- 沒有任何已授權的委託或實單能力。

## 二、CURRENT

CURRENT只允許維護與完成正在進行的台股籌碼神器核心工作。

### CURRENT 1：資料品質與連續累積

工作範圍：

- 維持官方日資料、選擇權逐履約價OI、5分鐘歷史與研究資料每日追加。
- 驗證資料日期、available_at、契約、到期日、日夜盤、換月及修訂版本。
- 保持缺值為未知，不補0；不同契約不硬接。
- 監控SQLite、JSON歷史、盤中原始檔、append-only事件與磁碟成長。
- 維持可重播、可重算及來源雜湊。

完成／退出條件：

- 每日更新流程可重複執行且不破壞既有資料。
- 主要資料源持續通過完整性與時間稽核。
- 正式盤中研究累積至少120個完整、通過品質檢查的交易日。

### CURRENT 2：只讀行情可靠性驗證

工作範圍：

- 在股票交易時段驗證IX0001／2330事件、雙時間戳、漏包、重複與斷線重連。
- 驗證append-only事件檔、SHA-256鏈、每日品質報告及過期警示。
- 保持券商程序與Dashboard隔離。
- 保持`researchOnly=true`、`executionAuthorized=false`及無委託路由。

完成／退出條件：

- 連續資料能被重播並重建一致的5分鐘K與VWAP。
- 斷線、重複、過期與時鐘偏差能被偵測並安全降級。
- 任何行情錯誤都不會轉成交易授權。

### CURRENT 3：既有功能穩定與研究規則凍結

工作範圍：

- 維持Dashboard、V2研究查詢、盤中回放、Smart Radar、六軸影子評分及Dealer Map Beta穩定。
- 修正資料或文件不一致、測試失敗與明確缺陷。
- 持續執行自動測試、秘密掃描及資料品質稽核。
- 保留已失敗的研究結果，不回頭調整舊規則。
- Dealer Map Beta只累積與驗證，不因短期表現改權重。

完成／退出條件：

- 既有功能在真實資料下穩定，沒有資料口徑或安全回歸。
- 當前研究輸入、公式、版本與結果可重現。
- 未驗證因子的正式權重保持0。

### CURRENT 4：V3.10 唯讀市場資料與第三波前向研究（2026-07-30授權）

本里程碑只授權依資料相依性逐級驗收，不授權一次平行開發全部NEXT頁面：

1. 先完成TX／MTX／TMF即時Tick與五檔Bid／Ask、日夜盤口徑、append-only ledger、
   30分鐘乾淨運行及受控重啟驗收。
2. 通過後保存供應商`tick_type`分類、最佳Bid／Ask交叉分類、分類衝突率、逐筆CVD與
   捕捉串流內精確VWAP；所有輸出維持候選研究、正式權重0。
3. 再以有限履約價與最近到期契約驗證選擇權唯讀行情。供應商若不直接提供Greeks，
   必須另以版本化本機估值及可追溯輸入交叉驗證，未通過不得進入下一Gate。
4. 只有Greeks資料Gate通過後，才執行DEX／GEX與Gamma結構的多情境研究；
   公開OI不得稱為Dealer真實部位。
5. IX0001既有上漲／下跌／平盤家數可先作廣度資料品質驗證；前十大權值股貢獻必須先有
   可追溯、具日期的權重來源，不得以固定或無來源權重冒充即時官方數據。
6. 第三波研究自2026-07-30開始只累積全新前向樣本；未收盤日不算完整樣本，
   單日結果不得用來調參或晉升。

仍保留在NEXT的項目：

- 完整「市場風向」與「台指期」頁面。
- 大量選擇權訂閱、正式Greeks資料層與正式GEX／DEX產品化。
- 任何方向分數、策略權重、Paper Trading或委託能力。

### CURRENT明確不做

- 不新增Option Income Engine。
- 不新增Position／Hedge Engine。
- 不新增交易級Risk Engine。
- 不新增委託、模擬下單或實單端點。
- 不因本願景擴充新AI模型。
- 不將Dealer模型稱為真實莊家部位或成本。
- 不為湊樣本偽造、複製或覆寫資料。

## 三、NEXT

NEXT只有在CURRENT穩定，且相依資料／權限通過品質門檻後才可另行規劃與授權。

### NEXT 1：Dealer Map Beta驗證與硬化

現況：V3.9.7 Beta已實作。

後續只做：

- 累積同契約OI重心、50%／70%／90%結構區、牆位及Max Pain歷史。
- 驗證換約、到期日、極端履約價及缺值行為。
- 建立可重算的版本與資料品質報告。
- 研究其對價格停留、回歸、突破及波動的描述能力。

首輪研究紀錄：

- 2026-07-29已完成135日、每日09:00單一錨點的時間安全因子研究。
- Max Pain距離與Call／Put Wall不對稱未通過開發期、歷史保留期及Holm多重比較後的晉升門檻。
- 本輪沒有可晉升因子，所有正式權重維持0；歷史保留期已檢視，後續必須使用全新前向資料。
- 同日完成第二輪歷史穩健性／反證測試：過去滾動排名、1日purge、Purged Walk-Forward及5日區塊置換均未找出通過Holm修正的因子。
- 第二輪仍沒有歷史穩健訊號或可晉升因子；近次月價差等弱觀察不得取代至少30個全新交易日的前向驗證。

限制：

- 不調高正式權重。
- 不稱為勝率。
- 不稱為真實Dealer Cost。

### NEXT 2：市場風向與台指期面板

啟動前置條件：

- 期貨帳戶與TX／MTX／TMF唯讀行情權限完成。
- 日盤／夜盤、近月／次月、換月、Tick／BidAsk、漏包、重複及斷線重連通過品質驗收。
- CURRENT的IX0001／2330即時事件與正式盤中資料累積維持穩定。

資訊架構：

- 現有「現貨與期貨」頁先保留；在期貨資料通過驗收後改為「市場風向」頁。
- 新增獨立「台指期」頁；在資料接入前不得先建立空頁或使用模擬即時數字。
- 「今日重點」只顯示市場風向、期貨狀態、選擇權攻防及資料品質摘要，詳細內容連到對應頁。
- 各頁只交換摘要，不複製完整圖表，避免同一資料在多頁重複維護。

市場風向頁預定內容：

- IX0001、2330及動態前十大權值股。
- 依可追溯權重估算個股及前十大對加權指數的貢獻點數。
- 台積電貢獻、扣除台積電後方向、上漲／下跌家數及產業廣度。
- Nasdaq 100／S&P 500期貨、VIX、美元兌台幣及台積電ADR的外部風向摘要。
- 權重若非正式授權資料，必須明示為估算，不得冒充官方即時權重。

台指期頁預定內容：

- TX／MTX／TMF近月價格、成交量、VWAP與IX0001期現貨對照。
- 正／逆價差、近月／次月價差、到期日及換月狀態。
- 日盤與夜盤分開呈現，保存夜盤相對日盤收盤的跳空與隔日風險。
- 在資料品質允許後研究主動買賣、CVD、Bid／Ask失衡及大單成交。
- 美國期貨只作外部風向與時段條件；相關性、領先性必須依Regime及Walk-Forward驗證，不設固定方向權重。

第一版最小輸出：

- 市場風向：偏多／偏空／分歧。
- 結構：全面、權值集中或內部轉弱。
- 台積電與前十大推估貢獻點數。
- TX相對VWAP、期現貨基差及日／夜盤狀態。
- 美國科技風向及是否獲得期現貨確認。

限制：

- 第一階段只作Market Intelligence與影子研究，不加入正式方向分數。
- 不因技術上可行而一次接入大量個股或海外商品；若樣本外改善不具實質意義，保留較簡單版本。
- 不新增委託、帳戶、部位或自動交易能力。

### NEXT 3：Greeks唯讀資料層

啟動前置條件：

- 期貨／選擇權帳戶及唯讀行情權限完成。
- Tick／BidAsk／Greeks的時間戳、漏包、重複、斷線、日夜盤與契約口徑通過驗證。

預定內容：

- 保存供應商IV、Delta與Gamma。
- 使用本機估值做交叉比對，不以單一來源為真理。
- 保存估值方法、利率、到期時間、標的價格與版本。
- 異常或缺值時保持unknown並降級。

### NEXT 4：DEX／GEX與Gamma結構情境

只有NEXT 3通過後才規劃：

- DEX／GEX基準情境
- Dealer持倉符號反向情境
- 參數敏感度
- Gamma Wall
- Gamma Center
- Gamma Flip
- Dealer Balance Zone v1

所有輸出必須標示：

- 模型假設
- 資料時間
- 情境而非真實Dealer帳本
- 正式權重0

### NEXT 5：四股力量影子構成

在資料足夠後，將Gravity／Momentum／Barrier／Acceleration分開保存。

第一階段只能是影子輸出，用於：

- Market Regime研究
- 結構衝突辨識
- 消融與樣本外比較
- Risk／No-Trade候選研究

不得直接成為委託指令。

## 四、FUTURE

以下項目已正式記錄，但目前禁止自行實作。

### FUTURE A：進階Research與Strategy Engine

- 完整Market Regime分類
- 凍結策略庫與Strategy Router
- 進階ML／AI模型
- 自動降級與模型漂移管理
- 多策略組合與資金配置
- 重大行情／大跌／大事件Event Study Framework研究候選
  （只登記方法論與Data Gate；詳見`docs/research/EVENT_STUDY_RESEARCH_CANDIDATE.md`，
  不改變優先級，也不構成開發或研究授權）

啟動門檻：至少完成Hypothesis、Backtest、Out-of-Sample、Walk-Forward及Stress Test。

### FUTURE B：Option Income Engine

- Theta與Volatility Risk Premium
- IV vs Realized Volatility
- Defined-Risk Option Structures
- Short Premium適用與禁止狀態
- 重大事件與負Gamma曝險限制

禁止將此項簡化成每日固定雙賣。

### FUTURE C：Position / Hedge Engine

- Portfolio Delta／Gamma／Theta／Vega
- Margin與Max Loss
- Dynamic Delta Hedge
- 小台期貨Hedge
- 部位與券商帳務核對

### FUTURE D：Risk Engine

Risk Engine未來擁有最高否決權，範圍包括：

- Max Position Risk
- Max Daily Loss
- Margin／Liquidity／Spread限制
- Data Integrity與API Health
- Position Reconciliation
- Partial Fill與Order Failure
- Kill Switch與Emergency Mode
- Defined Risk

在Risk Engine完成以前，不得啟用自動交易。

### FUTURE E：Failure Database

- False Breakout
- Wrong Gamma Regime
- Bad Hedge
- IV Shock
- Slippage
- Liquidity／Data／API／Model Error
- Unknown Failure

用途是研究模型如何失效，不是只保存成功案例。

### FUTURE F：資料生命週期與Adaptive Sampling

- Hot／Warm／Cold Data分層
- Parquet與壓縮封存
- 正常行情降採樣
- 高波動及重要行情提高精度
- 本機Feature先行、AI選擇性讀取

### FUTURE G：Paper Trading、Small Capital與Automated Trading

順序不得顛倒：

```text
研究通過
→ Paper Trading
→ 真實成本與成交落差驗證
→ Small Capital
→ Risk Engine與安全驗收
→ 使用者另行明確授權
→ 才可能考慮Automated Trading
```

Automated Trading不是既定交付，而是通過全部門檻後仍需重新決策的選項。

## 五、階段升級規則

任何NEXT或FUTURE項目啟動前，必須回答：

1. 為什麼理論上可能有效？
2. 目前資料是否足夠且時間口徑正確？
3. 是否有Out-of-Sample及Walk-Forward驗證方法？
4. 能否改善Expectancy、Drawdown或No-Trade辨識？
5. 在什麼Regime失效？
6. 最壞情況及降級方式是什麼？
7. AI、API或網路失效時如何保持安全？
8. Resource Budget是否說明Storage、Network／API、Compute與AI成本，且價值足以負擔增量？
9. Complexity Budget是否證明新增因子、依賴、模型與維護負擔，換來具有實質意義的Out-of-Sample改善？

若回答不了，項目保留在FUTURE，不進入CURRENT。

Resource／Complexity Gate只治理NEXT與FUTURE的升級提案，不改變CURRENT內容或優先順序。若較複雜方案只帶來微小改善，優先採用較簡單、可解釋、可降級的方案；通過此Gate也不代表已取得開發授權。

## 六、範圍變更流程

1. 新想法先寫入願景或FUTURE，不直接寫程式。
2. 只有使用者能授權NEXT轉為CURRENT。
3. 啟動前必須寫出資料需求、退出條件、失敗條件、不做事項、Resource Budget及Complexity Budget。
4. 每次只推進一個主要里程碑。
5. 階段完成後先驗證與更新文件，再討論下一階段。

最高原則：

> **活著 > 勝率 > 報酬率。**

> **不要證明模型是對的；讓資料持續挑戰模型。**
