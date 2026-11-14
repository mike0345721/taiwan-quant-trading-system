# HISTORICAL CANDIDATE SCREENING v1

> 狀態：候選工作包，尚未批准執行  
> 前置條件：Frozen Forward Operations Gate 已取得真正 PASS，且 PP-1 已完成 Owner Review  
> 啟動條件：前置條件成立後，仍須 Product Owner 明確批准  
> 安全邊界：`formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`

## 目的

使用既有歷史資料，系統性判定：

1. 哪些因子資料品質與時間語意足以進入 F1。
2. 哪些因子與未來方向、波動或風險具有穩定描述關係，可進入 F2。
3. 哪些因子具有明確市場機制與產品用途，可進入 F3。
4. 哪些因子或 Group State 在固定 Technical Baseline 之上具有歷史樣本外增量，可列為 F4 候選。

本工作包不以尋找最高相關係數為目標。既有歷史資料最多只能支持到 F4 候選，不得據此直接升至 F5、F6 或 F7。

## 資料範圍

- 747 日 Cash／Futures／Options／Breadth／Cross-Market 日資料。
- 136 日 5 分鐘 K 資料。
- PP-1 完成後的 116 日逐筆期貨資料。

時間治理：

- 所有盤後資料只能用於下一交易日。
- 所有資料必須遵守 `available_at`。
- 已檢視的 135／136 日不得稱為 untouched holdout。
- 逐筆資料列數不得冒充獨立交易樣本數。

## 候選資訊群與順序

1. Cash Institutional Flow
2. Futures Positioning
3. Options Structure
4. Breadth
5. Cross-Market
6. Price／Technical
7. Data Quality／Risk Veto

Dealer、GEX、DEX、Absorption 與未成熟 Order Flow 不得優先進入本工作包。

## 第一階段：Descriptive Screening

每個因子至少檢查：

- 資料品質、缺值與拒絕規則。
- 時間合法性與 `available_at`。
- deterministic replay 與可追溯性。
- Pearson 與 Spearman 關係。
- 分位數單調性與效果大小。
- 年度穩定度。
- 高／低波動穩定度。
- 趨勢／震盪穩定度。
- 結算／非結算穩定度。
- 是否由少數極端交易日主導。
- 是否與其他因子高度重複。

Target 必須分開評估：

- Direction
- Volatility
- Tail Risk
- MAE／MFE
- ORB Success／False Breakout
- NO_TRADE 候選

方向預測無效，不得自動否決其 Regime、Risk Veto、Confirmation、Position Sizing 或 Exit 用途。

## 第二階段：Incremental Screening

開始前必須先凍結 T0 Technical Baseline，並逐次比較：

- S0：T0 only
- S1-Cash：T0＋Cash Block
- S1-Futures：T0＋Futures Block
- S1-Options：T0＋Options Direction 或 Risk Block
- S1-Breadth：T0＋Breadth Risk Block
- S1-Cross：T0＋Cross-Market Regime

每次只能加入一個事前定義的 Evidence Block，評估：

- 扣除成本與滑價後的 Expectancy
- Profit Factor
- Max Drawdown
- 勝率
- 平均盈虧比
- MAE／MFE
- 假突破率
- 交易保留率
- Long／Short 分項
- 獲利集中度
- 年度與 Regime 穩定度

## 組合限制

禁止：

- 暴力排列組合。
- 自動特徵搜索。
- 黑箱模型。
- 因結果失敗修改門檻。
- 因結果失敗更換 Target。
- 因結果失敗新增 interaction。
- 同時計入同義或高度重複因子。
- 以逐筆資料列數誇大獨立樣本數。

只允許執行 Product Owner 事前批准的 Evidence Block 與假說。

## Promotion 判定

每個因子輸出：

- `promotionStage`
- `evaluationStatus`
- `promotionEligible`
- `evidenceRole`
- `rejectionReason`
- `nextAllowedStep`

判定上限：

- F1：品質、來源、時間與重播語意通過。
- F2：具有穩定描述性關係。
- F3：具有明確市場機制、產品角色與預先登記假說。
- F4 Candidate：在固定 Baseline 之上，歷史 OOS 具有實質增量。

F5 仍須使用工作包完成後才開始累積的全新 Frozen Forward 證據，且須另經 Product Owner 批准。

## 預定輸出

1. 因子品質排名。
2. Direction 候選排名。
3. Risk Veto 候選排名。
4. Confirmation 候選排名。
5. 高度重複因子群。
6. 已有負面證據因子。
7. 建議升 F1、F2、F3 的因子。
8. 歷史 F4 候選。
9. 不應繼續研究的因子。
10. 下一個建議單一研究假說。

不得只產生最高相關係數排行榜，也不得在本工作包內執行任何 Forward 晉升。

## 非範圍

- 不修改 Frozen Models、Frozen Spec 或 Forward Registry。
- 不新增正式權重。
- 不建立 Group State、Trigger、Signal、Strategy、Paper 或下單路由。
- 不執行 F5、F6、F7 Promotion。
- 不將歷史結果產品化。
- 不改變 `executionAuthorized=false`。

## 停止條件

出現任一情況即停止並回報 Product Owner：

- PP-1 的 Session、Trade Date、Contract 或 `available_at` 契約尚未通過。
- T0 Technical Baseline 尚未凍結。
- 輸入資料無法 deterministic replay。
- 研究需要新增未事前批准的 Target、門檻、interaction 或 Evidence Block。
- 資料品質不足以分辨缺值、未知狀態或換月。
- 研究設計可能污染 Frozen Forward 或被誤用為正式權重。

