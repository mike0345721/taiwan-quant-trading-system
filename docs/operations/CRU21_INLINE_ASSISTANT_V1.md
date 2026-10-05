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
- 候選測試使用18722、自有狀態與chart cache，既有市場資料唯讀，不給Owner另一個假正式產品。

## Auth / usage / failure handling
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
