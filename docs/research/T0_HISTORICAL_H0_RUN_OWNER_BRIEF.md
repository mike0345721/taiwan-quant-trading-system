# T0 HISTORICAL H0 RUN — OWNER BRIEF

狀態：`OWNER_BRIEF_REVIEW`  
文件版本：`t0-historical-h0-owner-brief-v2`  
本文件不是Runner、Smoke Test或137日歷史研究的執行授權。

## 1. 研究目的

以完全固定、透明的TX日盤Opening Range Breakout規則，建立Phase B未來比較Daily Bias、VWAP、RVOL或其他資訊群時的技術基準。T0即使成本後虧損，仍可成為固定Baseline；工程PASS與是否具有Edge是兩件不同的事。

## 2. 固定137日Strict Session輸入

- 商品：TX真實月契約。
- Session：日盤。
- 樣本：137個`STRICT_PP1_ALIGNED` Session，期間為2026-01-02至2026-07-30。
- 權威清單：`data/research/t0-data-replay-gate-v1/run-2026-08-02/T0_STRICT_PP1_ALIGNED_H0_MANIFEST.json`的`sessions[]`。
- Fallback：0；NO_SAMPLE：0；Continuous Contract：0。
- Runner若未來獲准，只能按Manifest順序讀取，不得增加日期、替換契約或改用Extended Manifest。

## 3. T0 Spec Hash

`c2baf6a63cf69407ae9e686af46bb5832adcebf9d859b170fe9096c8f7389253`

## 4. Cost Policy Hash

`ee9d6200150513164729d438998b609676f8dd373ec1c24b648e100814db0cfc`

## 5. Input Manifest Hash

Strict Manifest canonical semantic hash：

`87bbf9a01ccec29fcf29251f98ed71f55590ecab213693d6d3f95584b8d6f2ff`

執行前與恢復執行前都必須重新驗證此Hash；不一致時Hard Fail，不得混用新舊輸入。

## 6. Runner逐日確定性執行順序

若未來獲准，固定流程為：

1. 驗證Spec、Cost Policy、Strict Manifest與來源資料Hash。
2. 依`tradeDate`、`sessionId`升冪逐日處理，不平行改變事件順序。
3. 驗證PP-1 Session、真實契約、availableAt與資料品質。
4. 建立08:45～09:00 Opening Range。
5. 從09:00起依時間升冪尋找第一個合法Breakout確認棒。
6. 檢查Entry Window與Entry Gap Through Stop。
7. 若建立交易，依證據優先順序處理Stop、Time Exit及安全Backstop。
8. 交易生命週期固定後才計算MAE／MFE、False Breakout、VWAP與RVOL20診斷。
9. 計算五種成本視圖與分層欄位。
10. 先寫暫存檔，驗證Schema與Hash後原子提交該日產物。
11. 全部日期完成後，才從日級產物建立彙總；不得在彙總階段重算或改寫交易。

## 7. Opening Range算法

- 使用08:45、08:50、08:55開始的三根完整5分鐘K。
- `orHigh = max(三根K.high)`。
- `orLow = min(三根K.low)`。
- 三根K的真實契約必須相同且等於Manifest的`actualReplayContractCode`與PP-1 `selectedResearchContractCode`。
- `orAvailableAt`不得早於09:00，且不得早於三根K各自合法`featureAvailableAt`的最大值。
- 任一K缺漏、不完整、跨契約或availableAt違規，該Session為`NO_SAMPLE`，不得補值。

## 8. Breakout確認算法

- 從09:00開始，只檢查完整5分鐘K的收盤。
- Long：第一根`barClose > orHigh`的完整K。
- Short：第一根`barClose < orLow`的完整K。
- 觸價、等於邊界或未完成K都不算確認。
- 最後允許的確認棒起點為09:55，完成時間不得晚於10:00。
- 第一個合法方向確認後鎖定該Session；不允許反向重試或每日第二筆交易。

## 9. Entry Window與Entry Gap Through Stop

- Entry為確認棒下一根完整5分鐘K的開盤價，`entryTimestamp`不得晚於10:00。
- 逾時輸出`NO_TRADE / ENTRY_WINDOW_EXPIRED`。
- Long若`entryOpen <= stopPrice`，輸出`NO_TRADE / ENTRY_GAP_THROUGH_STOP`。
- Short若`entryOpen >= stopPrice`，輸出相同原因。
- 此情況計入Eligible Session與NO_TRADE，不計入Trade Count；Entry、Exit、Gross、Net皆為null，手續費、稅與滑價為0或不適用。
- 不得先成交再立即停損、修改Stop、假設Stop價成交或延後等待更好價格。

## 10. Stop與Time Exit算法

- Long初始Stop=`orLow`；Short初始Stop=`orHigh`，交易期間不得移動。
- Stop Fill使用第一個合法觸發後的不利成交證據；若發生價格跳越Stop，使用第一個合法不利價格，不得假設仍在Stop成交。
- `timeExitAt = entryTimestamp + 60分鐘`。
- Tick Replay：取`timeExitAt`當下或之後第一筆合法同契約成交。
- 5分鐘K Replay：取第一根`barStart >= timeExitAt`的完整K開盤價；禁止以K棒收盤替代。
- 缺少合法Time Exit價格時為`NO_SAMPLE / TIME_EXIT_PRICE_UNAVAILABLE`，不得以Session Close補值。

## 11. 同一根K內事件的保守排序

固定政策如下，不得依個別交易結果選擇較有利路徑：

1. 完整、有序且同真實契約的Tick證據可明確判斷先後時，以Tick時間順序為準。
2. 只有5分鐘OHLC且同棒同時可能發生Stop與有利事件時，採對策略不利的固定順序：`STOP_FIRST`。
3. Stop與Time Exit落在同一時間區間且無法確認先後時，Stop優先；若Time Exit恰為下一根K的`barStart`且前一棒已完整結束，則先以前一棒判斷Stop，再於下一棒開盤執行Time Exit。
4. Stop與有利1R同棒出現且無Tick順序時，視為Stop先發生；False Breakout不得宣稱先達1R。
5. OHLC High／Low可以證明價位曾落入該棒區間，但不得用來主張對策略有利的成交先後。
6. 同一timestamp仍無法排序的Tick事件，採不利事件優先並標記`AMBIGUOUS_SEQUENCE_CONSERVATIVE`。

此政策只消除不可識別的盤中順序歧義，不得依績效回頭修改。

## 12. Tick Replay與5分鐘K Replay優先順序

- 優先使用通過契約、時間、序號與完整性檢查的Tick Replay。
- Tick只可取代其實際覆蓋且品質合格的路徑區段，不得以部分Tick假裝完整Session。
- Tick完整性不足但5分鐘K完整時，退回確定性的OHLC保守規則，並標記`replayResolution=FIVE_MINUTE_OHLC`及`pathQuality=DEGRADED_CONSERVATIVE`。
- Tick與K皆不足以決定Entry、Stop或Exit時，交易生命週期為`NO_SAMPLE`；若只影響False Breakout診斷，保留交易並將診斷標為`UNAVAILABLE`。
- 不允許用K棒High／Low推論未觀察到的有利成交順序。

## 13. Hard Session Flat Deadline

`HARD_SESSION_FLAT_DEADLINE`只防止程式異常造成跨Session部位，是安全Backstop，不是正常T0 Exit，也不得用作缺失Time Exit價格的替代值。若Backstop實際被觸發，必須獨立標記工程異常，不能與一般績效混合。

## 14. False Breakout僅作事後診斷

- 觀察突破確認後前三根完整5分鐘K，包含Entry所在K與其後兩根。
- `R = abs(entryPrice - initialStopPrice)`。
- Long：首次`barClose <= orHigh`且此前有利偏移小於1R，標記`RETURNED_BELOW_OR_HIGH_BEFORE_1R`。
- Short：首次`barClose >= orLow`且此前有利偏移小於1R，標記`RETURNED_ABOVE_OR_LOW_BEFORE_1R`。
- 三棒內先Stop且此前未達1R，標記`STOPPED_WITHIN_FALSE_BREAKOUT_WINDOW`。
- 先有合法證據達1R後才收回OR，固定為false。
- Stop與1R同棒且無順序證據時依第11節採Stop First。
- 路徑不足時為`UNAVAILABLE`，但不得刪除交易。
- 此診斷不得改變Entry、Stop、Exit、NO_TRADE或PnL。

## 15. MAE／MFE算法

- 只計算Entry後至實際Exit為止的同一真實契約路徑。
- Long：`MFE = max(pathPrice - entryReferencePrice)`；`MAE = min(pathPrice - entryReferencePrice)`。
- Short：`MFE = max(entryReferencePrice - pathPrice)`；`MAE = min(entryReferencePrice - pathPrice)`。
- 同時輸出指數點、TWD及R倍數；`R=0`或資料不足時R倍數為`UNAVAILABLE`。
- Tick完整時使用Tick；只有OHLC時，Long的MFE／MAE分別使用High／Low，Short反向使用，但不得以High／Low推定發生順序。

## 16. VWAP與RVOL20只作診斷

- VWAP：使用同真實契約合法成交的`sum(price × volume) / sum(volume)`；無成交量時為`UNAVAILABLE`。
- RVOL20：目前Session截至相同時間桶的累積量，除以最近20個合格日盤相同時間桶累積量平均；至少15個Past-only樣本。
- RVOL排除當日、結算Session與Roll Transition Session。
- VWAP與RVOL20不得影響T0 Entry、Stop、Exit、NO_TRADE、樣本選擇或參數。

## 17. 稅、手續費與滑價計算順序

每一成本情境固定依序：

1. 取得未加滑價的合法`entryReferencePrice`與`exitReferencePrice`。
2. 依方向加入不利滑價：Long Entry加、Long Exit減；Short Entry減、Short Exit加。
3. 形成`actualEntryFillIndex`與`actualExitFillIndex`。
4. `grossPnl = directionSign × (exitReferencePrice - entryReferencePrice) × 200`，其中Long的`directionSign=1`、Short為`-1`。
5. 每邊手續費30元，不再重複疊加交易所或結算費。
6. 每邊交易稅=`round(actualFillIndex × 200 × 0.00002)`。
7. 每邊滑價成本=`slippageTicks × 1點 × 200元`。
8. `totalCost = entryCommission + exitCommission + entryTax + exitTax + entrySlippage + exitSlippage`。
9. `netPnl = grossPnl - totalCost`。

所有金額以TWD保存；稅、手續費、滑價必須分欄，不得只保存Net PnL。

## 18. 0／1／2／3／5 ticks成本視圖

- Gross：0 tick／side，不含手續費與稅。
- Optimistic：1 tick／side，含手續費與稅。
- Base：2 ticks／side，含手續費與稅。
- Conservative：3 ticks／side，含手續費與稅。
- Severe Stress：5 ticks／side，含手續費與稅。

另可輸出Tax＋Commission Reference，但不得取代五個固定視圖。

## 19. Base 2 ticks／side作主要結果

主要H0判讀固定使用`BASE_2_TICKS_PER_SIDE`。1 tick只作流動性良好參考；3與5 ticks為強制壓力測試。不得依歷史績效改選主視圖。

## 20. NO_TRADE與Eligible Session統計口徑

- `eligibleSessionCount`：137個Strict Session均計入。
- `tradeCount`：實際建立完整交易生命週期者。
- `noTradeCount`：資料合法但規則未建立交易者，包括`ENTRY_WINDOW_EXPIRED`、`ENTRY_GAP_THROUGH_STOP`及無Breakout等既定原因。
- `noSampleCount`：必要資料或語意不合法，不能進入研究計算者；不得與NO_TRADE混合。
- `eligibleSessionCount = tradeCount + noTradeCount + noSampleCount`，本次輸入Gate起點的`noSampleCount=0`，但Runner仍須防禦執行期資料破損。

## 21. PnL、Expectancy、PF與Drawdown公式

- 每筆交易依第17節產生Gross與各成本視圖Net PnL。
- `Expectancy = sum(netPnl) / tradeCount`；NO_TRADE不放入分母，另報告每Eligible Session平均結果。
- `Profit Factor = sum(positive netPnl) / abs(sum(negative netPnl))`。沒有虧損交易時輸出`UNDEFINED_NO_LOSSES`，不得輸出無限大冒充穩定結果。
- `Win Rate = winningTrades / tradeCount`。
- `Payoff Ratio = averageWinningTrade / abs(averageLosingTrade)`；任一側無樣本時為`UNAVAILABLE`。
- Equity Curve依tradeDate升冪累加Net PnL；`Drawdown_t = equity_t - runningPeak_t`；Max Drawdown為最小Drawdown及其起訖日期。
- 所有指標同時附`tradeCount`與有效樣本數。

## 22. Long／Short分層

使用完全相同規格，分別呈現交易數、Gross／Net、Expectancy、PF、Drawdown、Win Rate、Payoff、MAE／MFE、False Breakout及成本敏感度。不得建立Long／Short專用參數。

## 23. Settlement／Non-settlement分層

固定輸出：All Eligible、Non-settlement、Settlement、Settlement Final Contract、Settlement Non-final Contract。所有分層使用同一T0規格。結算狀態不完整者才是NO_SAMPLE；不得因結算日績效漂亮而調參。

## 24. Roll／Non-roll分層

固定輸出Roll與Non-roll Session。Roll不自動排除；跨契約Raw Gap不可使用，但當日OR、Entry、Stop、Exit及診斷均使用同一真實契約時可研究。不得建立Roll專用參數。

## 25. 月份與年度分布

- 按2026年1月至7月列出Eligible、Trade、NO_TRADE、Long、Short與Net PnL。
- 年度視圖因只有2026年，只揭露覆蓋，不宣稱跨年度穩定。
- 月份與年度分布只作穩定性及集中度描述，不作參數選擇。

## 26. Top 1／3／5日獲利貢獻

依Base 2 ticks Net PnL排序，分別計算Top 1、Top 3、Top 5交易日的Net PnL占全部正Net PnL及總Net PnL的比例；總Net PnL為0或負時仍輸出原始金額，但比例標記`NOT_MEANINGFUL_FOR_NON_POSITIVE_TOTAL`。

## 27. 樣本集中度警告

- 若Top 1日占全部正獲利超過30%，標記`TOP1_CONCENTRATION_WARNING`。
- 若Top 3日占全部正獲利超過50%，標記`TOP3_CONCENTRATION_WARNING`。
- 若移除Top 1／3／5日後總Net PnL由正轉為非正，分別標記依賴警告。
- 結算日1～3日主導時保留既定`settlementConcentrationWarning=true`。

上述門檻是Owner Brief候選治理門檻，需Owner核准後才能寫入Runner，不得用來刪除樣本。

## 28. 小樣本只能DESCRIPTIVE_ONLY

- 任一分層`tradeCount < 20`時，該分層固定為`DESCRIPTIVE_ONLY`。
- Settlement Final／Non-final、月份、Long／Short等所有子樣本都適用。
- 小樣本仍完整輸出交易數與原始統計，但不得稱為穩定、通過或有Edge。
- 20筆門檻是Owner Brief候選政策，需Owner核准後才能成為Runner規格。

## 29. Deterministic與Idempotency驗收

- 相同Spec、Cost、Strict Manifest、來源資料Hash與程式版本，兩次完整執行的日級事件、交易、診斷、彙總與Logical Output Hash必須完全一致。
- 日期與事件排序必須固定；數值序列化、null與`UNAVAILABLE`表示必須固定。
- 已完成且Hash有效的Run不得覆寫；相同Run重跑只能驗證或安全返回已完成狀態。
- 任一輸入Hash、Schema或程式版本不一致時Hard Fail，不得把結果寫入同一Run。

## 30. Output Schema

每個Session至少輸出：

- 身分：`runId`、`tradeDate`、`sessionId`、`contractCode`、`settlementClass`、`rollSession`。
- 品質：`eligibilityClass`、`qualityState`、`replayResolution`、`pathQuality`、`inputDataHash`、`specHash`、`costPolicyHash`、`manifestHash`。
- OR與訊號：`orHigh`、`orLow`、`orAvailableAt`、`breakoutDirection`、`breakoutConfirmedAt`。
- 交易：`tradeState`、`noTradeReason`、`entryAt`、`entryReferencePrice`、`initialStopPrice`、`exitAt`、`exitReferencePrice`、`exitReason`。
- 診斷：`maePoints`、`mfePoints`、`maeR`、`mfeR`、`falseBreakout`、`falseBreakoutReason`、`falseBreakoutQualityState`、`vwapContext`、`rvol20Context`。
- 每個成本視圖：`actualEntryFillIndex`、`actualExitFillIndex`、`grossPnl`、`entryCommission`、`exitCommission`、`entryTax`、`exitTax`、`entrySlippage`、`exitSlippage`、`totalCost`、`netPnl`。
- 安全：`formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`。

彙總輸出必須能只由日級完成產物重建，不得重新跑交易邏輯。

## 31. Output Hash與Run Manifest

若未來獲准，獨立Run Manifest至少保存：`runId`、`status`、`createdAt`、`completedAt`、Git／程式版本、Spec Hash、Cost Hash、Manifest Hash、來源資料Hash集合、Output Schema Version、Random Seed（即使本規則不使用隨機）、日級Job狀態、Output Hash、Failed Jobs及Resume Command。

日級產物先寫暫存、驗證後原子提交；Run只有在137日狀態完整、Hash有效且彙總可重建時才能標記完成。

## 32. Runner Smoke Test計畫

本節只是計畫，尚未授權執行：

1. 使用固定3個Session：一般日、Settlement Final Contract日、Roll日各1個。
2. 覆蓋Long／Short／NO_TRADE案例；若自然樣本未覆蓋，只能以獨立fixture測工程分支，不得寫入正式研究結果。
3. 驗證Tick優先、OHLC保守排序、Entry Gap Through Stop、Time Exit、False Breakout及五種成本視圖。
4. 執行兩次，要求Logical Output Hash一致且第二次零覆寫。
5. 人工中斷後以Resume恢復，已完成日不得重算。
6. Smoke產物使用獨立目錄，不得污染正式137日Run。

## 33. 完整Run Acceptance Gate

Engineering PASS必須同時滿足：

- 137個Strict Session全部有且只有一筆日級結果。
- Spec、Cost、Manifest與來源Hash全程一致。
- 契約、Session、availableAt與未來資料Gate零違規。
- Entry、Stop、Exit、保守事件排序與成本可逐筆重播。
- NO_TRADE與NO_SAMPLE原因完整且互不混淆。
- 五種成本視圖、所有必要分層與診斷完整。
- 零未解釋的Pending／Failed Job。
- 第二次執行零重算、零Hash變動。
- PP-1、Phase A、Reconciliation、Frozen Forward與T0 Closeout基準零變更。

工程PASS不以Expectancy、PF或是否獲利判定。

## 34. 預估CPU、RAM與時間

- 本機單次正式Run預估10～30分鐘，實際取決於Tick覆蓋與磁碟讀取。
- RAM目標低於1GB；新增產物預估低於500MB。
- 主要成本為本機CPU與Disk I/O，不需要LLM或網路即時運算。
- 以上為執行前估計，必須在Runner Smoke Test後重新校正；不得為符合估計而降低資料品質。

## 35. 預計新增／修改檔案

若Owner未來批准Runner Smoke Test，CODEX RECOMMENDATION為：

- 新增獨立Runner核心，例如`src/t0-h0-runner.mjs`。
- 新增獨立命令入口，例如`scripts/run-t0-h0.mjs`。
- 新增Runner、事件排序、成本、Resume及Idempotency測試。
- 新增獨立Smoke與正式Run輸出目錄。

不得修改T0 Final Spec、Cost Policy、Strict／Extended Manifest、Gate Evidence、Closeout Manifest、Settlement Scan及其Hash證據；也不得修改PP-1、Phase A、Reconciliation、Frozen Forward、Dashboard或Broker模組。

## 36. Scope Diff

本Owner Brief只定義未來候選Runner的確定性執行契約、輸出及驗收方式。相較已關閉T0 Data Gate，新增的只是尚未批准的H0執行設計；沒有新增Feature、Filter、參數、Target、交易商品或產品功能。本輪實際Scope Diff只有更新本文件及產生本文件Hash。

## 37. 明確禁止事項

- 不得修改已凍結OR、Breakout、Entry、Stop、60分鐘Time Exit、Entry Window、每日交易次數、Settlement政策、成本、滑價或137日樣本集合。
- 不得因結果不好加入VWAP Filter、RVOL Filter、Cash、Futures、Options、Daily Bias或Risk Veto。
- 不得把T0結果解讀為正式Signal、Paper資格或正式權重。
- 不得執行Phase B、F4 Promotion、Group State、Signal、Strategy、Paper或Execution。
- `formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`。

## 38. 完成後停止點

本輪停止於：

`T0 HISTORICAL H0 RUN — OWNER BRIEF REVIEW`

等待Product Owner選擇：

- `APPROVE RUNNER SMOKE TEST`
- `RETURN FOR REVISION`
- `PAUSE`

不得自動建立Runner、執行Smoke Test或執行137日歷史績效。

## H0成功定義與非聲明

T0 H0即使虧損，仍可成為Phase B固定Baseline。

Engineering PASS只代表規格忠實執行、資料合法、無未來資料、Replay可重現、成本正確、結果完整及Hash一致；不代表T0有Edge、適合實盤、可產生Signal、可進Paper或可配置正式權重。
