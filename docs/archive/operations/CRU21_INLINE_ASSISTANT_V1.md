# CRU-21｜原面板訂閱問答 V1 — 整合候選

## Owner-visible Goal / Golden Path
2026-10-05 Owner在訂閱連線已真實通過後批准「可以，請繼續」。這次交付範圍是：登入既有Dashboard → 選保存的ChatGPT帳號與實際模型 → 本頁提問 → 封存當下受控市場快照 → 訂閱模型串流 → 原頁顯示完整回答、資料時間、模型、缺口與終止狀態。不是再做Copy/Open，也不是完整V3/V4或自動交易。

既有一次Terra連線成功收據保留，不重做。模型目錄不是所有模型皆已實測；自動問題分流與完整結構化證據驗證仍未完成。此版由本人選模型，不自動升級。

## Dependency / producer chain
已批准行情collector / CRU34投影 / chart / IX0001 → `currentDiscussionWorkspace()` → canonical snapshot validator → bounded context（40,000 bytes上限、來源／時間／缺值／安全旗標）→ own-app DPAPI OAuth vault → public OAuth models/Responses → terminal receipt → 原Dashboard內問答卡。

市場資料來自既有鏈，這項功能不啟collector、不讀原始憑證、不觸碰order routes。AI故障不得讓K線、成交量、Flow與收集流程停止。單次快照不能推論連續趨勢；部分貢獻排行不能宣稱全市場廣度。回覆分事實、可能解讀、缺口、觀察點；提示詞約束不等於V3事實驗證已落地。

## Activation matrix / one product truth
- `ASK_GPT_INLINE_ENABLED`預設關閉；未啟用不載入憑證、不改TLS信任、不呼叫模型。
- 僅支援明確127.0.0.1私人Dashboard；不支援CRU55候選／動態正式表面或遠端多租戶。
- Source in branch / source merged / formal activation是不同gate。未經Owner exact-tree批准，不Merge或更改正式8787設定。
- Copy/Open保留為明確標示的人工備援；新的原頁分析API與其分離。
- 候選測試使用18722、自有狀態與chart cache；ASK_GPT_CANDIDATE_READ_ROOT只把既有intraday／audit／forward等來源讀取對齊governed根目錄，不改private寫入。此參數在8787/8790/8791或非loopback直接拒絕，正式預設路徑不變。既有市場資料唯讀，不給Owner另一個假正式產品。

## Formal read-source activation

正式面板可使用 `DASHBOARD_FORMAL_READ_ROOT` 唯讀既有 governed intraday / audit / forward products；只允許 actual LIVE、127.0.0.1:8787、無 preview、非 CRU55，且來源必須是既存目錄。不得與 candidate read root 同時設定。這只選讀取來源，不改 config.dataDir 的 sessions、AI receipts 與 caches 寫入位置，也不豁免 identity / freshness / quality gates。

部署時逐項核對來源：此 read root、`TX_CHART_DATA_ROOT`、`V2_RESEARCH_DATABASE_PATH`、`V2_BACKTEST_REPORT_PATH` 必須指向實際持續更新的既有產品；CRU34 expected root / status / snapshot 則必須匹配 producer 宣告，不可因共用子目錄就把不同 root 宣稱相等。Data Operations manifest 沿既有批准綁定，不由此參數改寫。

啟用前保留原設定與 whole-version 回復點。正式更新仍需 Owner 授權、exact-tree review、同一 runtime 的 L0–L5；來源綁定本身不是 Product Ready。LIVE 主價格超過 120 秒會明示資料過期，歷史 K 線與原始品質仍保留；Scenario 同時停用過期觀察，不把歷史價格冒充當下判斷。

## Auth / usage / failure handling
RVOL 僅使用最新已完成 5 分鐘時段，並驗證來源時間、完成棒可用時間、連續性及來源／樣本品質；未知或不足不輸出數值。不可用時保留原來源時間與品質原因。現有 chart 的首棒時間是向下取整的時間桶，不能證明從開盤完整採集；V1 因缺少完整 session capture 證據，累積 RVOL 保持 null，UI 證據提示明示原因，不以缺量補零。

Market Change 每筆事件的 availableAt、sourceIds、qualityStatus／qualityReasons 需經 canonical snapshot 原樣傳入 bounded context；不以整體 chart 警告取代事件證據。缺少事件品質時保持 UNKNOWN。Data Health 已知總體 UNAVAILABLE 是有效彙總結果，不等同沒有 payload；只有缺少彙總欄位才顯示 missing fallback。

沿用正式Dashboard真實Session與CSRF，再對新增API要求精確loopback Host/Origin。憑證僅在原app-owned Windows DPAPI store，與既有Codex、瀏覽器、券商憑證分離。

OAuth access將到期時，在使用者請求內同步更新，跨程序exclusive lease序列化rotating refresh；新token一組原子保存。暫時网络錯誤不清空憑證；供應商明確的terminal refresh error清除不可用token並要求選原帳號重新授權。JWT簽章／issuer／aud／subject仍檢查；refresh省略nonce只在已驗subject綁定下容許。登入flow仍要求nonce。未識別credential lock不自動刪除。

Responses只用官方支援的store:false、stream:true、instructions及input array；不用max_output_tokens等不支援參數。timeout120秒、上游2MiB／可見回覆12,000字保護，不能宣稱為供應商計費硬上限。没有API Key fallback、重試、購買credits、升級模型或自動分析。每次請求需明確確認額外點數關閉；本機每天最多60個attempt及10秒間隔是額外執行保護，不是OpenAI剩餘額度。

requestId去重，同Session有權讀回衍生收據；頁面重整只讀回不重送。初始、分析、完成、失敗、取消、逾時保存在私人state；partial不是成功。收到response.completed且非空才完成。新模型文字一律textContent，不插HTML。不把生成分析寫入Forward／Research ledger。

未知或仍活著程序的request lock不清除；只有帶本程式schema、正確root及已證明不存在PID的衍生鎖才封存為interrupted-lease。此處不停止任何外部程序。

## Runtime Definition of Done
L0範圍與安全凍結；L1 exact source＋focused tests；L2真依賴；L3同一市場資料鏈；L4真登入／真快照／真模型completed；L5同Dashboard內實際點擊、答案／時間／模型可見，無裁切／溢出／阻擋錯誤，既有K線／成交量／Flow與資料品質表面保留。額度不足、斷網、未登入、CSRF拒絕、取消、逾時、重放與中斷恢复也需負向測試。

工程測試與真實市場／模型證據分開。功能交付仍需獨立Level3工程review與Owner exact Merge/rollout gate。不得以53項舊setup測試或一次短句連線冒充本項原頁完成。

## 目前工程驗證
2026-10-05：24項新增context／refresh／stream／session／HTTP／failure測試，加既有auth/setup/DPAPI/callback/Copy/Open/layout共77/77 PASS。秘密掃描及syntax/diff check通過。真實瀏覽器／完整市場分析與獨立review接續執行，未以此文件宣告PASS。

實際CI與精確HEAD／更新後驗收以PR82最新查收紀錄為準。正式main/8787仍4d8251686bdb4abbdb469bc00ae798717c0fd583；既有CRU59剩餘L5狀態不由本工作覆蓋。


## 2026-10-05 Owner Decision — Decision-first / Level Watch
Owner 對第一版同頁回答的功能鏈驗收為 PASS，但交易決策價值 FAIL：回答過度像資料與術語摘要。下一候選固定改成 Decision-first，先說「現在怎麼看」，再只列最值得盯的 2–3 個合法價位、為什麼、到價看什麼 Expected vs Actual Response、Confirm / Invalidate 與現在不要做什麼；工程欄位收進證據層。

關鍵價位採 Level first / AI second：
- deterministic decision-level-watch-v1 僅由 governed chart / completed 5m bars / lawful references 產生，預設最多三條；
- V1 包含 Session VWAP、已 frozen READY 的 OR High/Low、目前時段 High/Low、已完成且 availableAt 合法的 recent 5m swing、合法 prior references；
- forming bar、future availableAt、identity mismatch、missing price 不能產生價位；目前 chart 品質限制會傳遞到當前時段／swing level；
- K 線以細線＋短標籤低調顯示，Next Watch 只一行；Why / 到價看什麼 / 確認 / 失效放在展開層；
- local watcher 每 5 秒讀 /api/v1/decision-level-watch，不呼叫模型。AI 只有 Owner 主動提問時才使用同一 bounded level evidence；
- lifecycle 為 MONITORING / APPROACHING / TESTING / BREAKING / ACCEPTED / REJECTED / RECLAIMED / LOST，全部由 deterministic completed-bar/current-price 規則產生，不是模型判定。

安全語意不變：這些價位是「反應觀察點」，不是支撐／壓力保證，不提供 BUY/SELL、倉位或自動下單。

同一候選亦收斂上一輪三個工程 blocker：rotating refresh token 在消耗前先取得 cancellable identity prerequisite，token 回傳後不再 await 網路；requestId immutable identity 綁定 ChatGPT account fingerprint；component timeout 持久化為 TIMED_OUT 且 cancellation 優先。Provider completed 事件缺少合法 actual model 時 fail closed。

## 2026-10-06 Owner Review — Evidence-first Level Watch V2
Owner追問「為什麼這個價位值得看」後，Level Watch 不再以固定 priority + 距離作為重要性代理。V2 固定分離：
- **重要性**：合法結構來源、同區價位共振、價位形成後的獨立測試／價格離開反應；
- **當下確認**：只有價位進入觀察區時，附 CRU34 60s Pressure→Price Response、完成K RVOL／量能背景；品質不足不得升格；
- **提醒時機**：距離只決定何時提醒與 Next Watch，不代表價位本身較重要。

不輸出0–100信心分數。內部只使用可解釋的 PRIMARY / SECONDARY / CONTEXT 三層；RECENT_SWING 單獨存在時維持 CONTEXT，不因靠近現價或剛觸及就自動升格。

Swing 正式改稱「近期5分K局部高點／低點」，採三根 completed 5m local pivot；pivot 必須等**下一根5分K完成**後才可用，availableAt 綁 confirming bar，禁止把中間pivot bar時間當成已知時間。

VWAP 是動態參考。沒有合法 historical exact VWAP path 時，不以「目前 VWAP 數值」倒套前幾根K判 RECLAIMED / LOST / ACCEPTED / REJECTED；只顯示目前 ABOVE/BELOW + MONITORING/APPROACHING/TESTING。K線本身沿用既有 VWAP series，Level Watch 不再另外畫第二條 VWAP price line；同一個右側標籤整合為 DAY/NIGHT VWAP · 事件狀態。

Why drawer 必須揭露：
- source/形成與可用時間；
- 同一觀察區內的價位共振；
- 形成後獨立測試次數、15分鐘內是否曾離開 observation zone（只作同場描述，不是勝率統計）；
- 若當下接近，列 Flow/Price Response 與 RVOL/完成K量能是否可用；
- data quality / research-only 限制。

仍維持 formalWeight=0 / researchOnly=true / recommendation=false / executionAuthorized=false / orderRoutesEnabled=false，價位只是反應觀察點，不是已驗證支撐／壓力或策略Edge。

## 2026-10-07 Owner Decision — Scenario Watch + Directional Targets V1

在 Evidence-first Level Watch V2 之上新增雙向 Scenario Watch。核心 nextWatch 仍是唯一 decision node；系統不把「測試中」直接解讀為多或空，而是在 node 旁固定提供 Long / Short 兩個條件情境。

### Deterministic scenario semantics
- 當 node 位於 observation zone 內或處於 APPROACHING / TESTING / BREAKING，directionState = BIDIRECTIONAL_TEST；否則為 BIDIRECTIONAL_WATCH。
- Long confirmation threshold = node price + observation zone；Long invalidation threshold = node price - observation zone。
- Short confirmation threshold = node price - observation zone；Short invalidation threshold = node price + observation zone。
- 這些 threshold 是觀察／確認邊界，不是 entry / stop order，也不產生交易指令。

### Directional target
- Long target 必須位於 Long confirmation threshold 上方；Short target 必須位於 Short confirmation threshold 下方。
- Target 只能來自同一 lawful level universe，且 CONTEXT-only level 不得成為 directional target。
- Target eligibility 先要求 lawful / PASS / 非 CONTEXT；ranking 依 Owner 明確順序：structural rank → confluence → post-formation reaction → quality（本版只允許 PASS）→ distance tie-break。即時觸及與距離不能升級 importance。
- target 必須保留 id / family / sourceId / availableAt / qualityStatus / why / basisReasons；缺合法 target 就保持 null。

### Conditional structural R:R
- 若 confirmation / invalidation / lawful target 都存在，系統可計算：reward = confirmation→target，risk = confirmation→invalidation，R:R = reward / risk。
- R:R 僅表示結構幾何，不是歷史勝率、Expected Value、進場價、停損指令、position sizing 或交易推薦。
- 任一條件缺失時 state = UNAVAILABLE，不由 GPT 補造 target 或重算。

### UI / GPT
- Next Watch 第一層顯示核心 node，雙向測試時明寫「雙向測試」。
- 低調顯示「多方下一關 / 空方下一關」與條件式 R:R；Confirm / Invalidate / target why 收在「為什麼」展開層。
- K 線最多仍維持 3 個主要 level；角色標籤可顯示 decision node / 多方下一關 / 空方下一關。
- GPT 只能引用 backend scenarioWatch 的 threshold / target / rr；禁止自創價位、勝率、EV或多空信心分數。

Safety remains formalWeight=0 / researchOnly=true / recommendation=false / systemDirectionalSignal=false / executionAuthorized=false / orderRoutesEnabled=false.

## 2026-10-07 Scenario review repairs / runtime acceptance boundary

後續時間品質工作包的限定修訂見 [source-time structure contract](CRU21_SOURCE_TIME_STRUCTURE_V1.md)：
LIVE 幾何可使用獨立來源時間計算資格，原品質不改標 PASS；價格／Flow 確認不隨之放行。
下列原始 gate 與 REPLAY 語意保留，只有新契約明列的描述性計算例外適用。

沿 exact `19015fe13d7cd64ac55832c4b8c0dba265548ab2` 的同一 implementation 修補：
- 在去重／共振前排除 missing / future availableAt、missing source 與已知 contract/session/date mismatch；prior refs 保留合法前一交易日語意。
- 局部 pivot 要求三根連續且 PASS 的 completed 5m bars；availableAt 不早於三根輸入的最晚可用時間與 confirming bar 結束。形成中的 K 與形成前反應不能計入 lifecycle / reaction。
- 沒有合格 completed-bar range 不補預設 zone；node／當前 chart 品質不足時，threshold 保持 null，R:R UNAVAILABLE。目標品質不足不得被 chart PASS 蓋掉；Flow 缺品質、身分或可用時間不得當確認。
- Next Watch 明示雙向／方向未定；展開層完整列 target provenance / quality / reaction、兩邊 price/Flow confirmation 及幾何風險／報酬。更新失敗清除舊 Scenario；不同 chart identity／replay 不套用即時情境。
- VWAP 原 series 與 optional references 共用最多三個價位標籤的上限。

本輪交付停在 **READY_FOR_RUNTIME_ACCEPTANCE**；fixture / VM render tests 不是 L3–L5。最新 exact HEAD、focused checks、独立 review 與 CI 以 PR82 查收紀錄為準。

待新 exact candidate 的 runtime acceptance：
1. **L3**：既有 shared data roots → collector/ledger → CRU34 projection/materializer → server/API，確認 producer、identity、freshness、availableAt；不把 wiring failure 當合法 missing。
2. **L4**：同一候選的真實 chart / Flow / RVOL / Leadership 與 Scenario API；核对雙向門檻／合法 target／R:R 與 unavailable 狀態。舊 `19015fe`／更早收據不得代替新 HEAD。
3. **L5**：同一候選、同一 Dashboard 於 1536/1366/720 檢查 K線／量／Flow、三價位上限、展開層、失敗恢復、無裁切或阻擋錯誤；依既有 Owner 模型授權與額外點數確認做真實同頁 completed，驗固定八段與無自創數值。純工程測試不證明模型遵守。

本輪不重啟候選或正式 Runtime、不發真模型請求；PR82保持 Draft / unmerged，formal 8787 / main 保持 `4d8251686bdb4abbdb469bc00ae798717c0fd583`。
