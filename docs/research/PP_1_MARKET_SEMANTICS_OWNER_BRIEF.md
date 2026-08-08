# PP-1 Market Semantics Owner Brief

> 狀態：提交Product Owner審查；PP-1尚未進入程式實作  
> 前置條件：Frozen Forward Operations Gate已於2026-07-31取得PASS  
> 邊界：不修改Frozen Models／Registry、不執行研究、不建立Signal／Strategy／Paper／下單  
> `formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`

## 目的

先凍結TX Price Path共用的Session、Trade Date、Contract、Timestamp及跨契約語意，
避免PP-1實作時以程式細節代替市場定義。本Brief不構成PP-1開發授權。

## 日期與Session

- `calendarDate`：事件在`Asia/Taipei`的實際日曆日期。
- `sessionTradeDate`：期交所歸屬的交易日。
- `tradeDate`：跨資料來源使用的標準研究鍵；期貨事件原則上等於
  `sessionTradeDate`，但兩欄均須保留來源與轉換依據。
- `sessionId`：可重算的市場、商品、交易日與時段識別。
- `sessionType`：`DAY | NIGHT | UNKNOWN`。
- `sessionStart`／`sessionEnd`：帶時區的實際時段邊界。

夜盤15:00至次日05:00歸屬次一一般交易時段；跨假日不得以日曆日直接加一天，
必須依正式交易日曆判定。PP-1必須測試日盤、夜盤、跨午夜、休市與到期日案例。

## 契約身分與四種角色

每筆資料必須保存：

- `instrumentCode`
- `contractCode`
- `contractMonth`
- `contractRole`
- `nearMonth`
- `nextMonth`
- `sourceContractCode`
- `isContinuousContract`
- `isRollover`
- `rollState`

同時明確拆分：

- `officialFrontContract`：依正式契約存續與到期規則判定的近月契約。
- `liquidityLeadContract`：依事前固定的成交量／流動性規則判定的主力契約。
- `selectedResearchContract`：特定研究規格明確選定的真實契約。
- `selectedTradingContract`：Paper或未來交易流程明確指定的真實可交易契約。

`contractRole`與上述角色均不得取代真實`contractCode`。成交量主力不得覆蓋
`officialFrontContract`；若兩者不同，必須同時保存並標記狀態。

## Timestamp與可得時間

必須分開保存：

- `exchangeTimestamp`：交易所事件時間。
- `sourcePublishedAt`：來源正式發布或提供檔案的時間；未知時保持`null`。
- `receivedTimestamp`：本系統實際收到資料的時間。
- `replayAvailableAt`：歷史重播中依原始發布、Session及Bar完成規則最早可用時間。
- `featureAvailableAt`：衍生特徵可被下游合法使用的時間。

即時資料必須滿足：

`featureAvailableAt >= receivedTimestamp`

歷史重播必須滿足：

`featureAvailableAt >= replayAvailableAt`

歷史檔案即使已完整存在，也不得提前使用未完成K棒、Opening Range、VWAP或Outcome。

## Gap來源與目標

每個Gap除了數值，至少保存：

- `sourceSessionId`
- `sourceTradeDate`
- `sourceContractCode`
- `targetSessionId`
- `targetTradeDate`
- `targetContractCode`
- `gapDefinition`
- `rollState`
- `featureAvailableAt`

日盤、夜盤與隔夜Gap必須使用不同`gapDefinition`。夜盤開盤與其前一日盤收盤通常
屬不同`tradeDate`，不得只保存單一Gap值而遺失來源與目標語意。每日結算價與最後
成交價也必須分開，不得互相代稱。

## 跨契約與連續資料

只要`sourceContractCode != targetContractCode`，必須標記`ROLL_TRANSITION`：

- 原始契約研究：拒絕或隔離，不得靜默相減。
- Paper成交模擬：不得以連續月替代真實契約價格。
- 長期圖表：可使用連續資料，但必須明示調整方法與來源契約。
- Regime描述：允許使用，但輸出必須帶roll標記。
- T0 Baseline：不得靜默混用跨契約Gap。

連續契約不得用於真實成交、契約別OI、保證金或部位重建。任何允許的研究用途
都必須保存連續化方法、版本、來源契約與調整值。

## 缺值與拒絕

- 缺少真實`contractCode`且無版本化映射證據：保留原始資料並標記`UNKNOWN`，
  但拒絕進入契約敏感的Price Path與成交模擬。
- 來源alias可解析時：同時保存`sourceContractCode`、解析後`contractCode`、
  映射版本與判定時間。
- Session、交易日、契約或Timestamp無法唯一判定：不得猜測或以其他商品補造。
- `qualityState`必須保留拒絕或降級原因，缺值不得改成0。

## PP-1啟動前仍待Owner確認

1. `officialFrontContract`在到期日結算前後的精確切換時點。
2. `liquidityLeadContract`的流動性衡量窗口與平手規則。
3. T0採用的Gap定義，以及換月日是否直接排除。
4. 連續資料允許的圖表／Regime調整方法與版本規則。

上述事項只可在PP-1 Owner Brief核准時凍結，不得由實作者事後依結果選擇。

## Owner Brief

### 1. 這一包要解決什麼問題？

目前歷史K棒、購買逐筆資料與即時Tick對於「交易日、日夜盤、跨午夜及實際契約」
使用不同或不完整的表示方式。PP-1要建立單一、可稽核的市場語意契約，避免同一筆
資料因日期或契約角色解讀不同而產生錯誤Gap、提前使用資料或跨月混價。

### 2. 完成後，使用者實際多得到什麼能力？

完成後，系統可以明確回答每筆TX Price Path資料：

- 發生在哪個日曆日、歸屬哪個交易日與哪個Session。
- 來自哪個真實契約，當時是正式近月、流動性主力或研究選定契約。
- 資料何時真正可用，品質是否足以進入後續Price Path研究。
- 日盤、夜盤、跨午夜與換月資料能否安全重播，或必須拒絕／隔離。

這是資料能力，不是交易訊號，也不宣稱具有獲利優勢。

### 3. 會修改哪些現有模組？

若Product Owner批准實作，預計只新增獨立契約與Adapter，並對下列既有資料入口做
最小接合：

- TAIFEX購買逐筆資料與歷史5分鐘Replay的正規化入口。
- Shioaji即時TX事件轉換入口。
- Intraday archive／replay catalog的讀取Adapter。
- PP-1專用的日夜盤、跨午夜、換月、deterministic及idempotent測試。

優先以Adapter包住既有格式，不為統一命名大規模重寫來源模組。

### 4. 明確不會修改哪些模組？

- Frozen Models、Frozen Spec、Forward Registry與既有Forward運算。
- Cash／Futures／Options因子研究、正式權重與Promotion判定。
- CVD、Greeks、DEX、GEX、Dealer Map產品化。
- Dashboard、Signal、Strategy、Paper、Position、Risk與Broker下單。
- 資料庫Schema；若後續確有必要，必須另行提出，不包含於本Brief授權。

### 5. 最嚴重的三種失敗模式是什麼？

1. **交易日錯置**：夜盤或跨午夜事件歸到錯誤tradeDate，造成look-ahead或錯誤對齊。
2. **契約混用**：流動性主力、正式近月與連續月被當成同一契約，形成虛假Gap或不可成交價格。
3. **可得時間提前**：歷史檔案已完整存在便提前使用未完成K棒或未發布資料，污染研究。

### 6. 出錯後是否能完整回復？

可以。PP-1採獨立資料契約與舊資料Adapter，不覆寫原始行情、既有archive或Forward
Registry。新輸出必須可刪除後由原始資料重建；切換前後以版本化契約及測試隔離。
若Adapter驗收失敗，停止採用新契約，既有唯讀資料流程保持原狀。

### 7. 如何證明沒有影響Frozen Forward？

- 實作前後核對Frozen Spec與Frozen Models SHA-256。
- 核對Forward Registry最後sequence、record count、latest hash及完整性稽核。
- PP-1測試不得寫入`v3.10-wave3-forward`目錄。
- 執行既有`v310-forward-operations`回歸測試。
- 驗收報告必須列出前後雜湊及「Forward產物變更數=0」。

### 8. 驗收需要哪些可見證據？

- 新資料契約及欄位字典。
- 舊資料到新契約的Adapter對照表。
- 日盤、夜盤、跨午夜、休市、到期／換月與未知資料的固定測試案例。
- 同一輸入重跑結果byte-stable，重複匯入不新增矛盾紀錄。
- 缺少Session、真實契約或合法時間時，依規格拒絕或降級並留下原因。
- 歷史Replay與即時資料均符合各自的`featureAvailableAt`限制。
- Frozen Forward前後雜湊與Registry稽核證據。
- PP-1 Acceptance報告及全部相關測試結果。

### 9. 哪些結果看似成功，但其實不能算PASS？

- 只有日盤案例通過，夜盤、跨午夜或換月未測。
- 能產生欄位，但`contractCode`其實是FRONT／近月alias而非真實契約。
- 連續月圖表看似平滑，卻沒有保留來源契約與調整方法。
- 歷史Replay結果正確，但使用了當時尚未完成的K棒或未發布資料。
- 為提高通過率而猜測未知Session、把缺值補0或靜默跨契約相減。
- Frozen Forward雜湊、Registry或既有資料遭到任何未解釋改動。

### 10. 完成後是否仍需人類批准下一階段？

是。PP-1工程驗收完成後只能提交：

`PASS | RETURN FOR REVISION | PAUSE`

不得自行標示為Product Owner Approved，也不得自動開始PP-2、Group State、
H0研究、Signal、Strategy或Paper工作包。

## PP-1核准實作範圍

只有Product Owner再次明確批准後，PP-1才可：

1. 定義統一資料契約。
2. 建立舊資料Adapter。
3. 建立日盤、夜盤、跨午夜、休市及換月測試。
4. 建立deterministic與idempotent測試。
5. 建立缺值、未知Session、未知Contract的拒絕／降級規則。
6. 建立研究用途`qualityState`。
7. 產生PP-1 Acceptance報告。

## 開始實作前的Owner決策點

以下市場語意若未凍結，PP-1不得進入實作：

1. `officialFrontContract`在到期日結算前後的精確切換規則。
2. `liquidityLeadContract`的觀察窗口、成交量定義與平手規則。
3. T0日盤及夜盤Gap的固定來源Session、價格欄位與換月日處理。
4. 連續資料是否僅限長期圖表／Regime，以及允許的調整方法。
5. `selectedResearchContract`與未來`selectedTradingContract`的選定規格是否必須各自版本化。

上述五項目前為Owner Review的`YELLOW`項目；在Product Owner做出明確決定前，
本文件不是PP-1程式實作授權。
