# Research Candidate：重大行情／大跌／大事件 Event Study Framework

> 狀態：FUTURE Research Candidate  
> Origin：USER  
> 登記日期：2026-07-28  
> 範圍：研究方法論，不是模型、交易訊號、預測器或Dashboard功能  
> 授權邊界：本文件不授權開發、回測、資料抓取、調整CURRENT或提高任何正式權重

## User Intent

先預先定義真正關心的重大市場事件，再研究事件發生前可取得的共同特徵；以
Price-Only作為第一基準，驗證各資訊群是否在價格已知資訊之外提供穩定且具統計意義的
增量資訊。研究成功也包含證明熱門因子沒有增量價值、只在特定Regime有效，或價格本身
已足以解釋大部分結果。

這是一個Event Study研究框架。不得因探索到關聯就建立「大跌預測器」、正式方向訊號
或交易建議。

## Candidate Scope

未來Event Library候選包含：

- E1大跌日、E2大漲日、E3絕對報酬極端的大行情日
- E4隔夜跳空、E5極端日內波動
- E6趨勢延伸、E7快速反轉
- E8流動性／Order Flow異常（僅限盤中資料成熟後）

事件定義需區分日盤／夜盤、持有期與Market Regime。所有事件門檻只能由訓練資料決定，
必須在Validation前凍結，不得看到完整樣本結果後調整。

事件前觀察窗口候選為T-5、T-3、T-1、T開盤前，以及T盤中預先指定時間點之前。
所有Feature必須遵守當時可取得性，禁止Look-ahead、把缺值當0、事後修改`available_at`，
或用盤後資料預測同日早盤。

## Information Groups

研究按資訊群比較，避免高度相關指標重複投票：

1. Price Structure
2. Market Breadth／Weighted Stocks
3. Futures／OI
4. Options
5. Institutional Flow
6. Overseas／Macro
7. Intraday／Order Flow（通過盤中Data Gate後才可使用）

RSI、MACD、均線、Momentum等Price transformation應先視為同一資訊群。Dealer／Gamma
類因子只能在其資料與模型假設另行驗證後納入，不得冒充真實Dealer持倉。

## Required Baseline and Validation

每個Event Target必須先建立Price-Only baseline，之後才可做Price加OI、法人、Options、
Overseas或Order Flow的共同日期配對比較。禁止只報Full Model。

正式檢驗必須包含逐群Ablation、Walk-forward、獨立Holdout、Block Bootstrap、
Multiple-testing control、Regime split與凍結後Forward Evidence。探索階段的correlation
只能產生Candidate Hypothesis，不能作為有效證據。

主要研究指標可包含Event probability、Conditional probability、AUC、Lift、Quantile
monotonicity、Mutual Information、Calibration、Incremental AUC、Ablation difference及
Paired bootstrap confidence interval。只有研究升級為交易策略後，才另外評估成本後
Expectancy、PF、Sharpe、Max Drawdown、Tail Risk、連續虧損、交易成本與滑價。

研究流程固定為：

```text
Event Definition
→ Price-Only Baseline
→ Discovery
→ Freeze
→ Incremental Validation
→ Forward Evidence
→ Promotion Decision
```

不得從Discovery直接跳到策略、正式評分或Dashboard。

## Event Study V1 Data Gate（日級）

以下條件全部通過後，才可由使用者另行授權啟動：

- `dataQualityPassed = true`
- `priceBaselineReady = true`
- `eventDefinitionsFrozen = true`
- `availableAtAuditPassed = true`
- `lookaheadAuditPassed = true`
- `historicalSampleSufficient = true`
- `holdoutReserved = true`
- `researchProtocolReady = true`

V1可先研究Price、OI、Institutional、Options與Overseas。不必等待所有未來資料源，但缺少
某資訊群時必須明確標記為未評估，不得假裝該群已完成驗證。

## Event Study V2 Data Gate（盤中）

除V1適用條件外，以下條件也必須全部通過：

- `intradayCompleteDays >=` 既有V3.10正式門檻
- `orderFlowQualityPassed = true`
- `sessionClassificationPassed = true`
- `timestampQualityPassed = true`
- `restartAndDataContinuityPassed = true`

V2通過後才可研究Price Path、VWAP、RVOL、CVD、Aggressive Buy／Sell、Bid／Ask
Imbalance、Absorption與Flow-Price Divergence。不得為提前執行Event Study降低V3.10既有
資料品質或樣本門檻。

盤中研究優先檢驗Price × Flow interaction，例如大量主動買進但價格漲不動的吸收，
而不是將`CVD positive`直接解讀為看多。

## Promotion and Product Boundaries

完成研究以前：

- `researchOnly=true`
- `executionAuthorized=false`
- 不增加首頁正式方向權重、不宣稱勝率
- 不產生委託或下單指令
- 不因單次漂亮結果或事件關聯加入正式策略
- 未通過資料品質、Walk-forward、Holdout、Bootstrap、成本／滑價及Forward Evidence，
  只能保留為research observation
- 失敗與無增量結果必須保留，避免重複挖掘

任何升級仍須通過`ROADMAP.md`的Resource／Complexity Gate，並取得使用者明確授權。

## Existing Research References

- `V3_6_2_CROSS_MARKET_RESEARCH_PROTOCOL.md`：事件目標、資訊時點、共同日期配對、
  Ablation、Block Bootstrap、多重比較、證據分級及R7事件研究邊界。
- `V3_10_REGIME_ORDER_FLOW_RESEARCH_PLAN.md`：盤中資料品質、120個完整交易日、
  日夜盤／Regime拆分、Order Flow與反向驗證門檻。
- `docs/VALIDATION.md`：即時行情連續性、受控重啟、append-only帳本及CURRENT驗收。
- `v2/reports/V2_6_2_MULTI_TARGET_REPORT.md`：既有Price-Only／資訊群增量與逐群消融證據。
- `ROADMAP.md`：CURRENT／NEXT／FUTURE範圍及升級權威。

## Current Disposition

目前只完成Research Candidate登記。沒有建立模型、執行回測、抓取新資料、修改CURRENT、
改變Roadmap優先級或啟動任何產品化工作。
