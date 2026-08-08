# V3.10 限制式第三輪研究協議

> Product Owner核准：2026-07-30  
> 狀態：執行前凍結、historical discovery only  
> 安全邊界：`researchOnly=true`、`executionAuthorized=false`、正式權重維持0

## Owner Decision

- 第一輪與第二輪沒有任何因子通過晉升標準。
- 135個交易日全部視為開發／已檢視資料。
- 過去27日不得再稱為untouched holdout。
- 不回頭調參拯救失敗因子。
- 不大量新增因子、不搜索因子排列組合、不使用黑箱模型、不降低Holm或Walk-Forward門檻。
- 原始`p=0.044`的近次月價差不構成有效訊號。

## 研究目的

第三輪只回答兩件事：

1. 既有價格基準是否遺漏重要且不重複的價格狀態。
2. 三個預先登記的非價格因子，是否只在特定價格／波動狀態下，對固定事件風險具有增量描述能力。

任何歷史結果都只能稱為Discovery，不能產品化、不能調整正式權重。

## 決策錨點與資料時間

- 每個交易日只取09:00 Asia/Taipei錨點。
- 只使用barIndex 0、1、2三根已完成5分鐘K；`featureAvailableAt=09:00`。
- 前日資料必須`factorSourceDate < tradeDate`。
- 缺值維持`null`，不補0、不前後填補。
- 換月日若需要跨日價格比較且契約不同，該特徵維持`null`。

## 嚴格Price-only Baseline

正式比較固定使用下列八項，不增加其他技術指標：

| Key | 定義 | Available at |
|---|---|---|
| `gapReturn` | 當日08:45開盤／前一交易日收盤−1；換月日為null | 09:00以前 |
| `prior5dMomentum` | 前一日收盤／5個交易日前收盤−1；跨契約窗為null | 前一交易日收盤後 |
| `openingReturn` | 09:00收盤／08:45開盤−1 | 09:00 |
| `priorRv20` | 僅使用當日前20個已稽核日盤「開盤至收盤報酬」的樣本標準差，避免換月價差污染 | 前一交易日收盤後 |
| `openingRangeLocation` | `(09:00收盤−前15分鐘低)/(前15分鐘高−低)` | 09:00 |
| `previousSessionRange` | `(前日高−前日低)/前日收盤` | 前一交易日收盤後 |
| `openingLocationPrevRange` | `(08:45開盤−前日低)/(前日高−低)`；換月日為null | 09:00以前 |
| `openingPathEfficiency` | `abs(09:00收盤−08:45開盤)/前三根價格路徑絕對移動總和` | 09:00 |

`closeVsVwapReturn`與`logOpeningVolume`另列為Price+Volume資料，不得放入嚴格Price-only baseline。
RSI、MACD、均線及更多Momentum轉換不得加入本輪。

## 三個預先登記假說

### H1：Price Regime × 近次月價差bps

- 機制：期限結構只有在與既有中期價格趨勢一致時，才可能反映趨勢建立或壓力。
- 因子：前一日`termSpreadBps=(nextClose-nearClose)/nearClose*10000`的past-only percentile rank。
- Primary target：`largeMove60`。
- 唯一interaction：`prior5dMomentum × (termSpreadBpsPastRank-0.5)`。
- 預期方向：interaction係數為正。

### H2：Price／Volatility Regime × 25D Skew

- 機制：Put 25D IV相對Call 25D IV較高，若同時處於高已實現波動環境，可能提高下檔尾部風險。
- 因子：前一日`skew25d=put25dIv-call25dIv`的past-only percentile rank。
- Primary target：`downsideTail60`。
- 唯一interaction：`priorRv20PastRank × skew25dPastRank`。
- 預期方向：interaction係數為正。

### H3：Price／Trend Regime × 市場OI變化率

- 機制：OI增加本身沒有方向；只有在開盤趨勢已形成時，才可能表示新部位提高後續路徑幅度。
- 因子：前一日`marketOiDeltaPct`的past-only percentile rank。
- Primary target：`extremeExcursion60`。
- 唯一interaction：`abs(openingReturn) × marketOiDeltaPctPastRank`。
- 預期方向：interaction係數為正。

除上述三項外，不得事後新增interaction或因子組合。

## 固定Event／Risk Targets

每個Walk-Forward fold的事件門檻只能由該fold訓練資料計算：

| Target | 連續severity | 訓練窗事件門檻 |
|---|---|---|
| `largeMove60` | 未來60分鐘絕對收盤報酬 | past-only 80th percentile |
| `downsideTail60` | 未來60分鐘`abs(MAE)` | past-only 90th percentile |
| `extremeExcursion60` | `max(MFE,abs(MAE))` | past-only 90th percentile |
| `volatilityExpansion60` | 未來12根5分鐘收盤路徑平方報酬和平方根 | past-only 80th percentile |

Risk／No-Trade只作上述事件的研究語意，不建立正式交易規則。

## 固定模型與比較

- 模型：Ridge linear probability model，`lambda=1`，輸出裁切至`[0,1]`。
- Walk-Forward：至少60日訓練、1日purge、12日測試。
- 每個假說與target都使用完全相同日期。
- 固定比較：
  1. Price Only
  2. Price + Factor
  3. Price + Factor + 預登記interaction
- 評估：Brier Score、AUC、事件率、fold改善比例及interaction係數方向穩定度。
- 虛無對照：5日區塊置換1,000次。
- 12個「3假說×4 targets」形成同一Holm family，`alpha=0.05`。

## 歷史Discovery否決條件

下列任一成立即不支持：

- 完整模型相對Price-only的OOS Brier改善小於1%。
- 改善fold少於60%。
- OOS少於24日。
- 未通過12項Holm修正。
- Primary target的interaction係數預期方向穩定度低於60%。
- 結果主要由資料錯誤、換月、缺值處理或少數單日驅動。

即使全部通過，也只能標示`historical_discovery_requires_frozen_forward`。

## Frozen Forward Registry

- Forward起點是本協議與實作凍結後，第一個尚未完成、尚未檢視的交易日。
- 每日09:00先append模型版本、輸入hash、規格hash及預測；目標只能在60分鐘結束後append。
- 不覆寫、不回填、不把2026-01-02至2026-07-28重新包裝成forward。
- 30個全新乾淨日只作smoke test，不得提升正式權重。
- 任何模型／特徵／門檻變更都必須建立新版本並重新起算。
- 30日前只做資料品質稽核，不選最佳模型、不調參。

## 後續資料候選但不納入本輪

- Opening Range深化
- 精確逐筆VWAP
- 更完整Price Path
- Breadth
- 前十大權值股貢獻
- 真正Order Flow

上述資料不得因本輪失敗而立即擴充CURRENT。
