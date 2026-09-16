# UI_CAPABILITY_FRESHNESS_AUDIT

Exact source `9f1bedd0e6036ead82b55a225edb6533fef38d7b` · 2026-09-16 · current-main integration candidate only.

Each row has one primary category; mixed-quality subcomponents are separately listed. UI-only controls use LIVE_OR_CURRENT_VALUE to mean current UI capability, not live market data. No BROKEN_OR_UNWIRED item remains in the audited route/control scope. This is not certification of every historical research result. Dates are captured evidence, not a promise of ongoing freshness.

| Surface | Expected role | Current source/date | Working? | Truth state | Action before merge | Blocker? |
|---|---|---|---|---|---|---|
| Top Workspace Navigation | 六工作區切換 | Owner IA freeze / current candidate | Yes, six routes | LIVE_OR_CURRENT_VALUE | 保留凍結名稱/順序 | No |
| Overview layout | 整體入口、不固定 sidebar | Current candidate | Yes, three sizes | LIVE_OR_CURRENT_VALUE | PASS | No |
| Workspace contextual sidebar / collapse | 各工作區功能入口 | Original main DOM + candidate routing | Yes, section click-through / 46px rail | LIVE_OR_CURRENT_VALUE | PASS | No |
| Settings gear / palette | 全域顯示設定 | Current UI setting, no data producer | Yes, drawer / existing palette handler | LIVE_OR_CURRENT_VALUE | Utility, not primary workspace | No |
| Overview product/month | 選取產品與到期月 | TX2026-09 accepted bundle only | Yes; 10月清空/09月恢復 | UNAVAILABLE_WITH_REASON | MTX/TMF/其他月明示無資料 | No |
| Overview DAY/NIGHT selector | 切換合法隔離片段 | DAY2026-09-07 / NIGHT2026-09-14 | Yes | STALE_OR_HISTORICAL | 保留日期/STALE/觀測片段 | No |
| SYNTHETIC/UI DEMO | 檢查視覺與互動 | Explicit synthetic fixture | Yes; real lower data suppressed | RESEARCH_PENDING / PLACEHOLDER | 非真實市場證據 | No |
| Identity / Data Trust | 商品盤別與資料信任 | Pinned accepted bundle | Yes; always visible | STALE_OR_HISTORICAL | 不改稱 Live | No |
| K-line / Volume / fit | 主要價格與成交量 | DAY合法K1根/chart55口; observed773口 | Yes real K/volume + fit | STALE_OR_HISTORICAL | 保留合法子集與整體觀測量差異 | No |
| Overview VWAP | 接受的價格結構 | Fragment lacks accepted VWAP | Yes, reason displayed | UNAVAILABLE_WITH_REASON | 原版即時VWAP在期貨Workspace | No |
| Cumulative CVD line / endpoint | 累積買賣代理成交差 | DAY+295 / NIGHT+5, exact cutoff | Yes 18 combinations | STALE_OR_HISTORICAL | line, lawful gaps, endpoint invariance | No |
| ΔCVD histogram | 所选滚动窗净增量 | Accepted signed delta projection | Yes | STALE_OR_HISTORICAL | signed axis; overlapping bars not additive | No |
| Fast Scan / six window buttons / table row buttons | 快速掃描與窗口證據 | Accepted same source/enum/quality | Yes, 18 loops and table match | PARTIAL_WARMING | 長窗不足不推定方向 | No |
| Session Context / observed change % / Path | 盤內觀測背景 | Accepted session projection; origin proven false | Yes | PARTIAL_WARMING | 非完整盤別; exact Path retained in evidence/title | No |
| Relationship answer / deterministic summary | Result→Evidence | Frozen accepted enums, deterministic copy | Yes | PARTIAL_WARMING | 不新增分數/買賣指示 | No |
| Market Handoff / evidence button | 前盤→gap→今盤 | No lawful adjacent pair | Yes, unavailable reason / drawer | UNAVAILABLE_WITH_REASON | 不跨gap相減CVD或插值 | No |
| Relationship transitions disclosure | 合法狀態變化 | Real unavailable; demo marked transitions | Yes, source/DOM preserved | UNAVAILABLE_WITH_REASON | 不補造真實事件 | No |
| Overview refresh / copy / version / evidence drawers | 快照重讀與追溯 | Current candidate auth/API/clipboard UI | Yes; drawer titles verified | LIVE_OR_CURRENT_VALUE | 不啟動collector；copy不是外傳 | No |
| Ask GPT / kind / textarea / Send | Decision Assistant互動預留 | No backend, no persistence | Yes, disabled send + Escape clear/focus | RESEARCH_PENDING / PLACEHOLDER | Send disabled; never answer or execute | No |
| Spot context card / icon / contribution microvisual | 現貨/指數結構入口 | TWII/OTC2026-09-15 | Yes, route spot | STALE_OR_HISTORICAL | 貢獻圖/正負排名缺來源另標不可用 | No |
| Index contribution rankings | 主要正/負貢獻 | No accepted weighted contribution producer | Yes, explicit empty reason | UNAVAILABLE_WITH_REASON | 不以假排名裝飾 | No |
| Breadth context card / ratio bar | 市場參與度入口 | Listed/OTC2026-09-15 | Yes, route breadth / actual counts | STALE_OR_HISTORICAL | failed source suppresses cached counts | No |
| Futures context card / position bar / OI path | 法人背景入口 | Institutional2026-09-15 + dated same-contract market OI | Yes, futures route | STALE_OR_HISTORICAL | 曲線標市場未平倉歷史；不冒充外資淨額 | No |
| Options card / structure microvisual | 選擇權結構入口 | 202609 / OI2026-09-15 | Yes, options route | STALE_OR_HISTORICAL | Wall/MaxPain非真實莊家庫存 | No |
| Global card / matrix / SOX spark | 海外背景入口 | NDX/SOX09-09;USD/TWD09-10 | Yes, Global route | STALE_OR_HISTORICAL | 依各市场日期；NDX代理 | No |
| TWN / true NQ | 跨市場真實來源 | No accepted source | Yes, unavailable cells | UNAVAILABLE_WITH_REASON | 不得拿NDX冒充NQ | No |
| Risk card / icon / evidence | 風險與衝突限制 | Current safety flags + dated evidence | Yes, risk drawer | UNAVAILABLE_WITH_REASON | 無完整風險結論；不是低風險 | No |
| Original main price / VWAP / volume / chart tabs | 目前盤中價格能力 | Existing formal producer2026-09-16 | Yes, three-size screenshots | LIVE_OR_CURRENT_VALUE | 獨立於Overview pinned CVD cutoff | No |
| Original 1m/5m pressure / response / Path | 保留CRU44讀取鏈 | LIVE source09:19:54; classified coverage insufficient | Yes, producer + UI | PARTIAL_WARMING | source LIVE不等於quality READY | No |
| Main RVOL / tracking quality pending | 原版尚未完成部分 | Original main research state | Yes, explicit RESEARCH_PENDING/尚未條件 | RESEARCH_PENDING / PLACEHOLDER | 不擴充研究scope | No |
| History replay / date / reset / next / full | 歷史逐根檢查 | Latest usable2026-09-09;60bars | Yes,1→2→60 | STALE_OR_HISTORICAL | 保留日期与只讀研究 | No |
| Spot / margin / breadth historical controls | 原版市場資料與历史 | Per-source historical main snapshot/history | Yes, all contextual entries | STALE_OR_HISTORICAL | 日別/来源保留；不拼成本盤 | No |
| Futures institutional / term structure | 法人與近遠月背景 | Main2026-09-15;V2latest09-10 | Yes, contextual entry | STALE_OR_HISTORICAL | 原版評分放在原版詳細證據，不升權重 | No |
| Options OI chart contract selector | 控制當前OI分布圖 | Main snapshot2026-09-15 | Yes,202610selected; original handler | STALE_OR_HISTORICAL | 獨立於V2研究契約選單 | No |
| V2 options contract / OI delta / range | 控制研究歷史資料 | V2SQLite latest2026-09-10 | Yes,202609selected; original handler | STALE_OR_HISTORICAL | 明示研究資料日;與上方當前OI來源不同 | No |
| Dealer Map / Smart Radar | 原版公开OI研究能力 | Original main projections / dated snapshot | Yes, sections reachable | STALE_OR_HISTORICAL | 不推定真實Dealer部位 | No |
| Global EOD / range / history entry | 原版海外研究背景 | NDX/SOX09-09;USD/TWD09-10 | Yes | STALE_OR_HISTORICAL | No NQ proxy promotion | No |
| Formal backtest result panels | 研究結論 | Formal report missing, API503 V2_BACKTEST_NOT_READY | Unavailable handling works | UNAVAILABLE_WITH_REASON | 替換無限讀取中；不自建研究報告 | No |
| Forward Shadow / live research notes | 既有研究摘要 | Current main governed files; UNKNOWN if unavailable | Reachable unchanged | RESEARCH_PENDING / PLACEHOLDER | 保持研究定位/零權重 | No |
| Snapshot lock / manual journal / filters | 既有人工記錄與證據 | Original UI, candidate-private journal | GET/CSRF/source wiring verified; no test entry inserted | LIVE_OR_CURRENT_VALUE | 所有寫入限本run；不觸正式帳本 | No |
| Data Quality / Data Operations / refresh | 當前資料健康入口 | Formal read-only artifacts/status2026-09-16 | Yes API200 + actual refresh | LIVE_OR_CURRENT_VALUE | 獨立utility，不列primary | No |
| Daily update / data acquisition | 正式擷取功能 | Explicit disabled candidate path | Disabled UI / POST403 tested | RESEARCH_PENDING / PLACEHOLDER | 必須維持停用 | No |
| Authentication / logout | 候選存取控制 | Main auth, distinct cru55_main_session | Yes HTTP login/logout/401/CSRF | LIVE_OR_CURRENT_VALUE | 不共用正式session/password | No |

## Evidence and limits

[39 DOM/control inventories](browser-audit.json), [18 window interactions](timeframe-browser.json), [five card routes](card-routing.json), [real APIs](api-audit.json), [producer chain](producer-readonly-audit.json), [replay](replay-interaction.json), [Ask](ask-interaction.json), [selectors](selector-truth.json), [drawers](utilities.json). Workspace contextual entries were exercised at1366; each main workspace has1536/1920 render checks. Details kept original main listeners rather than rewriting all research controls.

Three-size settled checks: overflow0, core clipping0, duplicateIDs0, visible text<11px0. An intermediate pre-font-floor options sample is retained alongside its successful settled recheck; see L0_L5_VALIDATION. One expected research-console missing-report message is retained, not hidden or counted as a blocking runtime error.

This audit supports isolated Owner/GPT review. Formal deployment and a later production startup verification are outside authorization.
