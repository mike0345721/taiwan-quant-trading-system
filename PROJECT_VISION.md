# 台股籌碼神器：產品願景

> 文件性質：長期產品與工程治理原則  
> 更新日期：2026-07-26  
> 重要限制：本文件不是開發授權，也不會自動擴大目前工作範圍。實際執行順序以 `ROADMAP.md` 的 CURRENT／NEXT／FUTURE 邊界為準。

## 一、產品定位

「台股籌碼神器」目前是一套本機、只讀、可追溯的台股／台指期／台指選擇權資料與研究系統。

長期目標不是建立一個宣稱能預測每次漲跌的黑盒子，而是逐步形成：

```text
資料層
↓
Dealer Flow / Market Intelligence
↓
Research Engine
↓
Strategy Engine
↓
Position / Hedge Engine
↓
Risk Engine
↓
Paper Trading
↓
經充分驗證後才考慮 Automated Trading
```

系統最終希望回答五個問題：

1. 目前是什麼市場狀態？
2. 市場主要力量來自哪裡？
3. 哪些策略在此狀態下具有可重複、可驗證的統計 Edge？
4. 期貨與選擇權部位目前承擔多少曝險？
5. 即使判斷錯誤，帳戶如何繼續生存？

核心優先順序是：

> **活著 > 勝率 > 報酬率**

不追求暴利，不保證獲利，也不保證不虧損。產品追求的是 Robustness、Risk Control、資料可追溯，以及能被推翻的統計優勢。

## 二、目前可驗證的基礎

截至 2026-07-26，專案已具備：

- 本機登入、CSRF、Session、安全標頭、秘密掃描與 localhost 隔離。
- V1 JSON 快照、來源日期、舊快取與資料品質狀態。
- V2 SQLite 研究資料庫、原始快照雜湊、18批資料庫遷移、官方歷史與研究表。
- 現貨法人、融資融券、期貨法人／大額交易人、選擇權契約與逐履約價 OI。
- 官方盤中5分鐘歷史回放、VWAP近似、開盤區間、RVOL暖機與防前視資料契約。
- 凍結策略工程骨架、成本情境、MAE／MFE及append-only紙上事件帳本格式。
- Options Smart Radar、六軸影子評分及 V3.9.7 Transparent Dealer Map Beta。
- Shioaji 股票唯讀登入與券商中立事件格式；期貨／選擇權唯讀行情仍待權限與品質驗證。

目前沒有：

- 已證明可上線的穩健交易策略。
- 真實 Dealer 帳本、Dealer Position 或 Dealer Cost。
- 正式啟用的紙上交易流程。
- 部位、避險、訂單或實單執行引擎。
- 任何已授權的下單端點。

因此，目前的準確定位是：

> **只讀 Market Intelligence 與 Research Infrastructure 階段。**

## 三、分層架構與責任

### 3.1 資料層

負責收集、保存、稽核與重播原始資料，不負責給交易結論。

每一筆資料至少應知道：

- 來源與資料日期
- 抓取時間與市場可用時間
- 商品、契約、到期日與交易時段
- 是否為舊快取、缺值、修訂值或換月資料
- 品質狀態與可否用於研究

缺值不得補0，不同契約與不同口徑不得硬接。

### 3.2 Dealer Flow / Market Intelligence

負責描述市場結構與可能的避險力量，不直接等同交易訊號。

預計研究：

- Max Pain
- OI Center
- Call Wall／Put Wall
- Delta／Gamma
- DEX／GEX
- Gamma Wall／Gamma Flip
- Dealer Balance Zone
- IV
- VWAP
- POC／VAH／VAL
- CVD
- Order Flow

四股市場力量分開保存：

| 力量 | 核心問題 |
|---|---|
| Gravity | 價格容易被吸去哪裡？ |
| Momentum | 現在是誰在推動價格？ |
| Barrier | 哪裡存在可能的支撐、壓力或流動性牆？ |
| Acceleration | 結構突破後是否容易加速？ |

重要認知邊界：

- 公開 OI 無法辨識每一口的真正持有人及買賣方向。
- Dealer Position、Dealer Cost、DEX、GEX及Gamma Flip都依賴假設或模型。
- 系統只能標示「模型推估」或「情境分析」，不能宣稱知道真正莊家成本。
- Dealer Balance Zone 是透明結構區，不是神秘成本價。

### 3.3 Research Engine

研究引擎的工作不是證明想法正確，而是嘗試推翻它。

任何新指標、規則或AI模型都必須依序經過：

```text
Hypothesis
↓
Backtest
↓
Out-of-Sample
↓
Walk-Forward
↓
Stress Test
↓
Paper Trading
↓
Small Capital
↓
Production
```

至少評估：

- Expectancy
- Profit Factor
- Max Drawdown
- MAE／MFE
- Slippage與交易成本
- 不同Market Regime
- 不同年份及市場循環穩定性
- 參數敏感度、反向情境與消融結果

勝率只能是眾多指標之一。高勝率但尾端損失失控，不構成可用策略。

### 3.4 Strategy Engine

策略引擎未來只可選擇已凍結、已驗證的策略或「不交易」。

它不能：

- 盤中任意改參數。
- 因單日成功就提高權重。
- 將未校準分數稱為勝率。
- 跳過Risk Engine直接送單。

### 3.5 Option Income Engine（FUTURE）

這是一條不同於單純預測方向的未來研究線，研究：

- Theta
- Volatility Risk Premium
- IV與Realized Volatility差異
- Defined-Risk Option Structures
- 哪些Market Regime適合收取時間價值

它不是「每天固定雙賣」。

只有在例如正Gamma、波動收縮、IV相對昂貴、震盪且無重大事件時，才可能允許Theta策略候選。

負Gamma、波動擴張、重大事件、流動性惡化或單邊趨勢時，應禁止或降低Short Premium曝險。

此模組目前只列入FUTURE，不代表已授權設計策略或建立交易功能。

### 3.6 Position / Hedge Engine（FUTURE）

未來研究：

- Portfolio Delta／Gamma／Theta／Vega
- Margin與Max Loss
- Dynamic Delta Hedge
- 小台期貨Hedge
- 部位與券商帳務核對

目標不是由AI猜轉折，而是持續監控Portfolio Greeks，在曝險超過預先定義門檻時執行受控處置。

此模組目前禁止實作。

### 3.7 Risk Engine（FUTURE，最高權限）

Risk Engine一旦建立，必須擁有全系統最高否決權。

即使AI或Strategy Engine要求交易，只要Risk Engine判定不安全，就必須禁止。

未來範圍包括：

- Max Position Risk
- Max Daily Loss
- Margin Limit
- Liquidity Check
- Bid／Ask Spread Check
- Data Integrity
- API Health
- Position Reconciliation
- Partial Fill
- Order Failure
- Kill Switch
- Emergency Mode
- Defined Risk

原則：

> 能用部位結構本身限制Max Loss，就不要只依賴程式停損。

此模組目前禁止實作；在任何交易功能之前，必須另行完成需求、威脅模型與驗收規格。

## 四、Failure Database（FUTURE）

未來建立失敗案例資料庫，保存：

- False Breakout
- Wrong Gamma Regime
- Bad Hedge
- IV Shock
- Slippage
- Liquidity Problem
- Data Error
- API Error
- Model Error
- Unknown

目的不是替模型辯護，而是持續研究：

> 模型最常在哪些市場環境失效？

失敗、反向及無效結果不得因為不好看而刪除。

## 五、AI使用原則

LLM不處理所有即時市場資料，也不應成為核心風控或下單的單點依賴。

正式架構原則：

```text
Raw Market Data
↓
Local Quant Engine
↓
Feature Engineering
↓
ML / Rule Engine
↓
Risk Engine
↓
Execution
```

LLM／ChatGPT主要負責：

- 研究設計
- 解釋與文件
- 策略假說
- 異常與Failure Analysis
- 程式開發協助

核心風控與執行不得依賴LLM的即時可用性。

> **Compute locally. Store intelligently. Ask AI selectively.**

## 六、資料與實體資源管理（Resource Budget）

資源不是免費且無限的。任何新功能除了研究價值，也必須在進入開發排程前提出可檢查的Resource Budget：

| 類別 | 至少評估 |
|---|---|
| Storage | Database Size、Daily Growth、Raw Tick Retention、Hot／Warm／Cold Data成長 |
| Network／API | API Requests、Rate Limit餘裕、Bandwidth、資料抓取頻率與重試成本 |
| Compute | CPU、RAM、Backtest Time、Disk I/O與重算成本 |
| AI | LLM Calls、Token Consumption、Context Size，以及是否真的需要LLM |

每個提案都必須回答：

> **這個功能帶來的研究或交易價值，值得它增加的儲存、網路、運算與Token成本嗎？**

若資源需求明顯增加，但Out-of-Sample改善極小或沒有實質意義，應優先不採用、延後或改用較輕量方案。尚未建立精確上限前，也必須先記錄基準值、預估增量與監控方式，不得把成本視為未來再處理的問題。

長期資料分層方向：

| 層級 | 用途 |
|---|---|
| Hot Data | 短期高精度事件、重播與即時研究 |
| Warm Data | 降採樣後的中期特徵與研究資料 |
| Cold Data | Parquet或其他壓縮歷史資料與稽核封存 |

Adaptive Sampling屬未來研究：正常行情可降低採樣或衍生計算頻率，重要行情及高波動時提高精度。

AI不直接讀取大量Tick；先由本機Quant Engine萃取Feature，再選擇性提供給AI。

維持原則：

> **Compute locally. Store intelligently. Ask AI selectively.**

## 七、複雜度預算（Complexity Budget）

複雜度本身就是成本與風險。比較模型或功能時，除了績效，也必須比較：

- 因子數量與資料需求
- 外部API依賴與模型數量
- 維護成本與可解釋性
- Bug Surface與故障降級難度
- Token／Compute成本
- Overfitting風險

正式治理原則：

> **新模型若無法帶來具有實質意義的樣本外改善，不得僅因技術上可行而增加系統複雜度。**

例如，若5個因子的Model A在樣本外Profit Factor為1.42、Max Drawdown為-11%，而37個因子、3個ML／AI模型與大量Tick資料的Model B僅改善至1.44與-10.8%，在改善未達預先定義的實質門檻時，應優先選擇Model A。

> **簡單也是風控。**

系統越複雜，Bug、維護、資源及Overfitting風險通常越高，也越難定位失效原因，並增加事故時降級與復原的困難。Resource Budget與Complexity Budget都通過，才代表功能具備進一步規劃資格；這不等於已獲得開發授權。

## 八、控制專案規模

本願景中的多數模組不是目前開發需求。

範圍治理規則：

1. CURRENT只做資料品質、資料累積、既有功能穩定與目前已授權工作。
2. NEXT只有在CURRENT完成退出條件後才能啟動。
3. FUTURE不得因本文件存在而自行實作。
4. 新想法先記錄，不立即轉成程式碼。
5. 每次只允許一個主要階段為「進行中」。
6. 任何跨階段工作都必須取得使用者明確授權。
7. 不為了漂亮畫面擴充尚未驗證的指標。
8. 不破壞或重寫正在累積的原始資料與append-only帳本。
9. 重要架構、研究與策略決策寫入`DECISIONS.md`；日常小修改不進入Decision Log。

## 九、專案最高原則

任何功能進入正式系統前，都必須回答：

1. 為什麼理論上可能有效？
2. 台指歷史資料是否支持？
3. Out-of-Sample是否有效？
4. 加入後是否改善Expectancy或Drawdown？
5. 在什麼市場環境失效？
6. 最壞情況會發生什麼？
7. 如果AI、API或網路故障，帳戶如何生存？

我們不是要證明自己的想法是對的，而是：

> **讓資料持續挑戰我們的模型。**

## 十、非承諾事項

本專案不承諾：

- 保證獲利
- 保證不虧損
- 知道真正莊家成本
- 每日提供正確方向
- 以AI取代風控
- 未經完整驗證就自動交易

所有交易相關功能都必須晚於資料驗證、研究驗證、Paper Trading、Small Capital及Risk Engine驗收，並由使用者另行明確授權。
