# T0 DAY SESSION TECHNICAL BASELINE — SPEC FREEZE 提案

狀態：`OWNER FINAL PATCH PASS／DATA-REPLAY GATE PASS／WORK PACKAGE CLOSED`。本文件是已納入 Owner Amendment 的規格基準；不代表 T0 歷史 H0 Run、Phase B、Signal、Strategy 或 Paper 已獲授權，也不宣稱 T0 具有 Edge。

## 1. 定位與永久邊界

- USER INTENT：建立不依賴 Cash／Futures／Options 候選因子的透明 TX 日盤 H0 Baseline，供 Phase B 比較增量價值。
- CODEX RECOMMENDATION：T0 v0 只使用 Opening Range 與價格路徑完成一筆可重播的基準交易；VWAP、RVOL、MAE／MFE及 False Breakout先作量測，不加入進場條件。
- Owner 已凍結：正式費用表、股價類期貨稅率、結算日納入分層政策、換月 Session 與跨契約 Gap 的處理。
- 不包含：Daily Bias、F3候選、正式Signal、Paper、夜盤、留倉、下單路由。

## 2. 規格決策矩陣

| 項目 | USER INTENT | CODEX RECOMMENDATION | 尚待 Owner 決定／替代方案 | 對樣本量與產品意義 |
|---|---|---|---|---|
| Instrument | TX日盤 | 使用真實TX月契約 | 是否同時納入MTX／TMF：v0建議否 | 單一商品可降低語意混淆，但樣本不增加 |
| Research Contract | 遵守PP-1 | `sessionFrozenLiquidityLeadContract`；真實contractCode必須存在 | 若流動性選擇UNAVAILABLE：NO_TRADE，不回退連續月 | 犧牲部分日期，保留可成交語意 |
| Session／Trade Date | 正確處理日盤 | PP-1 day session；08:45～13:45；到期契約最後交易日至13:30 | 結算日依相同規則納入並分層，不建立結算日專用參數 | 保留制度特殊日，但必須揭露集中度與依賴性 |
| Data Gate | 可重播、可稽核 | Session、contract、timestamp lineage、OHLCV、完整5分K皆PASS | DEGRADED是否只描述：建議是 | 嚴格Gate降低樣本，提升可信度 |
| Opening Range | 候選08:45～09:00 | 使用08:45、08:50、08:55三根完整5分K的最高／最低 | 10或30分鐘替代：本版不搜尋 | 15分鐘兼顧早期可用與區間穩定 |
| OR Available At | 禁止偷看 | 09:00:00之後，且三根K皆完成並可用 | 無 | 明確避免未完成K棒洩漏 |
| Breakout | 完整5分鐘站出OR | 09:00後第一根「收盤價」嚴格高於OR High或低於OR Low | 觸價、收盤加1 tick：不在v0同時測 | 收盤確認較少訊號但降低盤中假穿越 |
| Entry | 避免同棒偷看 | 突破確認後下一根5分K開盤價進場 | 確認棒收盤進場：較樂觀；下根開盤較保守 | 下一根開盤可重播，可能增加跳空成本 |
| Entry Window | 最晚候選10:00 | 僅接受09:00～10:00確認的第一個突破 | 09:30／10:30：本版不搜尋 | 短窗口降低交易數，但保持「開盤策略」意義 |
| Max Trades | 每日最多1筆 | 第一個合法方向候選後鎖定該日 | 反向再進：v0建議禁止 | 防止同日多次嘗試膨脹樣本 |
| Stop | OR另一側 | 多單OR Low；空單OR High | 固定R／ATR替代：留待新版本 | 透明但OR過寬時單筆風險較大 |
| Entry Gap-through Stop | 禁止建立已失效交易 | 多單進場開盤價`<= stopPrice`或空單進場開盤價`>= stopPrice`時，輸出`NO_TRADE / ENTRY_GAP_THROUGH_STOP`；交易、損益、手續費、稅與滑價欄位皆為null | 不延後進場、不修改Stop、不以Stop價模擬成交 | 保留合格Session與NO_TRADE診斷，但不列入交易數 |
| Time Exit | 候選60分鐘 | 進場後60分鐘的第一個合法5分K開盤／收盤需Owner擇一；建議收盤 | 30／90分鐘：不得同輪搜尋 | 影響持有期、樣本重疊與成本後結果 |
| Session Close Exit | 日盤內平倉 | 最遲13:40完整K收盤或到期日13:25；以較早者為準 | 是否使用最後成交：需資料Gate | 不留倉，避免跨Session風險 |
| Cost | Base固定2 ticks／side | Owner單邊手續費：TX 30、MTX 17、TMF 12、TXO 14元；稅率0.00002逐邊計算；正式視圖為Gross 0、Optimistic 1、Base 2、Conservative 3、Severe Stress 5 ticks／side | TX為主體；MTX／TMF無各自重播時僅為indicative cost scenario | 主要H0使用2 ticks；1 tick只作良好流動性參考，3與5 ticks強制壓力測試 |
| Gap | 明確來源／目標 | 只使用PP-1同真實契約Raw Gap；跨契約時`gapState=ROLL_TRANSITION`且`rawGap=null` | Gap不作T0 Entry Filter，只描述 | 跨契約Gap不可用，但不連帶否決契約內完整的盤中T0 |
| Roll／Settlement | 不靜默混用 | `INCLUDE_AND_STRATIFY`；結算日與rollSession使用相同T0規則分層報告 | 只有結算語意未知、契約未知或盤中契約不一致才NO_SAMPLE | 保留樣本，同時揭露結算依賴與換月敏感度 |
| VWAP | 必須量測 | 精確成交VWAP；只作entry／exit位置與路徑描述 | 是否成為T1確認：不屬T0 v0 | 不改交易數，為後續增量研究保留基準 |
| RVOL | 必須量測 | 使用同時段past-only歷史分母；未暖機則UNAVAILABLE | 分母窗口須在Data Gate另行凍結 | 暖機會減少可用日期，但避免未來資料 |
| Price Path | 必須量測 | 保存OR形成後至退出的5分路徑與exact tick replay reference | 無 | 支援MAE／MFE、假突破與重播 |
| MAE／MFE | 結果量測 | 從entry後到exit，以同契約合法路徑計算，零界限 | 無 | 是結果診斷，不得進場前使用 |
| False Breakout | 結果標籤 | 突破後3根完整5分K內收回OR且未先達有利1R | 回到OR中線等替代定義：不得同輪搜尋 | 可評估Risk Veto價值，不是T0參數優化工具 |
| NO_TRADE | 安全優先 | Session／契約／時間／資料品質未知、缺OR、結算狀態未知、盤中跨契約、異常Session、進場逾時皆NO_TRADE | 單純`isSettlementTradeDate=true`或`rollSession=true`不得自動否決 | 降低不可信樣本，同時避免錯殺合法結算／換月Session |

## 3. 固定輸出契約候選

每個交易日輸出：`tradeDate`、`sessionId`、`contractCode`、`settlementClass`、`rollSession`、`orHigh`、`orLow`、`orAvailableAt`、`breakoutDirection`、`breakoutConfirmedAt`、`entryAt`、`entryPrice`、`stopPrice`、`exitAt`、`exitPrice`、`exitReason`、`grossPnl`、`entryCommission`、`exitCommission`、`entryTax`、`exitTax`、`entrySlippage`、`exitSlippage`、`totalCost`、`netPnl`、`MAE`、`MFE`、`falseBreakout`、`VWAPContext`、`RVOLContext`、`qualityState`、`noTradeReason`、`inputDataHash`、`specHash`。

所有輸出固定：`researchOnly=true`、`formalWeight=0`、`executionAuthorized=false`。

## 4. Acceptance Gate

1. PP-1 Session／Contract／availableAt契約全部通過。
2. 相同輸入重跑產物Hash一致。
3. 未完成K棒、錯契約、跨Session、未來資料及連續月成交價格全部被拒絕。
4. 每個NO_TRADE有明確原因。
5. Entry、Stop、Exit、成本、MAE／MFE與False Breakout可逐筆重播。
6. Base與Stress成本分開報告，不以最佳成本情境挑選規格。
7. 本Gate只確認工程與語意，不以獲利判PASS。

## 5. Owner Final Patch

- 成本表權威檔：`research/t0-v1/cost-policy.json`。Owner手續費視為已含交易所／結算費，不重複疊加；未來若對帳單反證，必須建立新版本。
- 交易稅：股價類期貨每邊依實際成交指數、契約乘數及0.00002計算後四捨五入；稅與手續費分開保存。官方規則自2019-01-01生效。
- 滑價主結果固定為`baseTicksPerSide=2`；不得依歷史績效挑選較漂亮的情境。1 tick僅為Optimistic參考，3與5 ticks必須報告，5 ticks用於檢查策略是否依賴理想成交，不代表正常預期。
- 報告視圖固定為：`ALL_ELIGIBLE_SESSIONS`、`NON_SETTLEMENT_SESSIONS`、`SETTLEMENT_SESSIONS`、`SETTLEMENT_FINAL_CONTRACT`、`SETTLEMENT_NON_FINAL_CONTRACT`。
- 若All Sessions為正但移除結算日後轉負或顯著惡化，標記`settlementDependency=HIGH`；樣本不足只能`DESCRIPTIVE_ONLY`；1～3日主導時標記集中度警告。
- `ROLL_TRANSITION`只使跨契約Raw Gap不可用；同一真實契約內的OR、Entry、Stop、Exit、VWAP、MAE／MFE完整時，盤中T0仍可研究。
- JSON權威規格：`research/t0-v1/t0-final-spec.json`。最終Hash由Data／Replay Gate以canonical JSON計算並記錄。

## 6. 本工作包邊界

本次只完成Final Spec Patch與Data／Replay Gate。Time Exit、Entry Gap-through Stop及False Breakout語意已凍結，但本工作包不執行歷史績效模擬；T0歷史H0 Run、Phase B、F4、Signal、Strategy及Paper均未獲授權。
# T0 Final Patch 摘要（2026-08-02）

本段為已批准的 T0 Final Spec 與 Data／Replay Gate 語意摘要；不代表已批准執行 H0 績效研究。

- Opening Range 固定為日盤 08:45–09:00。
- 確認棒必須是 09:00 後第一根完整且收盤嚴格突破 OR 的 5 分 K；最晚確認棒為 09:55–10:00，並於下一根 K 開盤進場。10:00 後才可進場者一律 `NO_TRADE / ENTRY_WINDOW_EXPIRED`。
- 正常離場僅有 `STOP_EXIT` 與 `TIME_EXIT`。Time Exit 固定為進場後 60 分鐘；逐筆資料取該時點後第一筆合法成交，只有 5 分 K 時取第一根 `barStart >= timeExitAt` 的完整 K 棒開盤價。缺值不得以收盤價替代。
- Session Close 僅是 `HARD_SESSION_FLAT_DEADLINE` 安全保護，不是一般策略離場。
- 滑價固定輸出每邊 0／1／2／3／5 ticks，主要判讀使用 2 ticks；3 與 5 ticks 為壓力測試。
- RVOL20 只使用過去同日盤、同時間槽的最近 20 個合格 Session，至少需 15 個；排除當前、結算及換月 Session，且只作診斷量測。
- Strict 資格要求原始重播契約與 PP-1 `SELECTED_RESEARCH` 一致；Fallback 僅可描述研究，不可作主要 Phase B／F4 輸入。
- 多單進場開盤價`<= stopPrice`或空單進場開盤價`>= stopPrice`時，固定輸出`NO_TRADE / ENTRY_GAP_THROUGH_STOP`；不建立交易、不計費用，也不得延後進場或修改Stop。
- False Breakout只作診斷標籤：觀察突破確認後首3根完整5分K（含進場棒）；在先達有利1R前收回OR或於窗口內停損才標記為true，資料不足則為`UNAVAILABLE`，且不得改變交易或損益。
- `formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`。
