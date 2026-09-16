# UI_CAPABILITY_FRESHNESS_AUDIT — Provisional Logo v0.1

Final source `669b99e4e221516252b7368829efb3999bc44cef`，2026-09-16。Scope/證據版本見README。UI capability的working不代表市場資料LIVE。

| Surface | Source / freshness | State | Actual evidence / limitation |
| --- | --- | --- | --- |
| Provisional Logo | Owner原始JPEG；40/34/30px | VERIFIED_WORKING | HTTP200 image/jpeg；hash相同；三樣式DOM與截圖 |
| Overview without Sidebar / Cockpit / six cards | 目前候選 | PRESERVED | 三desktop+640；sidebar false/cards6 |
| Top Workspace nav | 固定六工作區 | VERIFIED_WORKING | overview/spot/futures/options/global/research實際導航 |
| Six Bottom Cards V2 | 五路由+Risk drawer | VERIFIED_WORKING | card-routing.json；risk title/open記錄 |
| Settings / Data Trust / Scope | UI utilities | VERIFIED_WORKING | drawer title與內容核對 |
| Handoff / Context / selected change | Frozen evidence | VERIFIED_WORKING | 對應drawer；缺合法相鄰盤別明示UNAVAILABLE |
| Overview refresh | 既有投影重讀 | VERIFIED_WORKING | CVD295；不擷取新行情 |
| Copy snapshot | 本機剪貼簿 | VERIFIED_WORKING | 已複製隔離快照；不外傳 |
| Fit chart | 既有fitContent handler | WIRED_SMOKE_VERIFIED | click後chart正常；handler未改，未另做mousezoom幾何測试 |
| Six Fast Scan / table controls | DAY09-07短片段 | PARTIAL_WARMING | 1m到4h切換、CVD295不變、FastScan/table一致 |
| DAY / NIGHT / demo | 歷史片段／明確合成 | STALE_OR_HISTORICAL | DAY295/NIGHT5；demo不混real lower |
| Product / expiry selectors | 僅TX2026-09有bundle | UNAVAILABLE_WITH_REASON | MTX/10月清空，TX/09月復原 |
| Session / Path / Relationship | accepted session evidence | PARTIAL_WARMING | 觀測累積、UNPROVEN；不推完整盘别 |
| Transition disclosure / markers | synthetic合法轉換demo | VERIFIED_WORKING | 展開、checkbox、marker count；real無事件仍不可用 |
| Price palette | Taiwan / International | VERIFIED_WORKING | final三尺寸實切；K/Volume及price delta/percent改色 |
| CVD / DeltaCVD / state colors | Color Semantics Freeze | VERIFIED_INVARIANT | 三對pixels CVD/DeltaCVD0差；固定燈號/Trust/Risk顏色相同 |
| Ask GPT kind / question / close | 純介面預留 | PLACEHOLDER_DISABLED | 可試填；Send disabled；close清空/焦點返回；無backend |
| Spot / breadth context | 各來源09-15/09-16 | STALE_OR_HISTORICAL | 日期分開；貢獻排名缺來源不補造 |
| Futures institutional / OI | 09-16背景與同契約歷史 | STALE_OR_HISTORICAL | 法人背景非成交方向；缺比較明示不可用 |
| Options background | OI09-15 /獨立到期契約 | STALE_OR_HISTORICAL | Wall/MaxPain不冒充Dealer position |
| Global background | NDX/SOX09-09、USDTWD09-10 | STALE_OR_HISTORICAL | TrueNQ/TWN unavailable；NDX proxy不升格 |
| Risk context | 限制與證據來源 | UNAVAILABLE_WITH_REASON | 不產生總體風險分數/低風險結論 |
| Workspace sidebar / collapse | 原版DOM與candidate routing | VERIFIED_WORKING | 期貨collapse與功能跳轉 |
| Workspace refresh | 只重讀畫面 | VERIFIED_WORKING | busy disabled樣本保留；settled enabled，非dead control |
| Workspace Data Quality | 逐來源日期/供應商狀態 | VERIFIED_WORKING | 實際開啟；官方來源缺口保留說明 |
| Workspace LIVE chart-mode label | LIVE代表query mode不是freshness | MISLEADING_FIXED | 改行情檢視；真實UNAVAILABLE · TX_TICK_SOURCE_UNAVAILABLE保留 |
| Workspace current price/VWAP | 當時NIGHT無合法tick | UNAVAILABLE_WITH_REASON | 不可沿用前次LIVE證據；缺price/VWAP保持未知 |
| Workspace Flow | DAY09-16最後13:30片段 | STALE_OR_HISTORICAL | 明示資料過舊；不因原始ratio有數字稱live |
| Research replay | 09-09合法歷史60bars | VERIFIED_WORKING | 1→2→60；只讀歷史非execution |
| Options OI / V2 contract selectors | 快照與V2研究日期分離 | VERIFIED_WORKING | OI202610、V2 202609各自控制；V2資料09-10 |
| Formal backtest report | V2_BACKTEST_NOT_READY | UNAVAILABLE_WITH_REASON | 原版預期console診斷2則；未掩蓋/未造報告 |
| Data acquisition | 隔離candidate policy | DISABLED_WITH_REASON | 資料擷取未啟用，button disabled |
| Auth / new logo static route | 既有candidate auth/guard | VERIFIED_WORKING | 本輪重新login成功；logo公開static不含秘密；guard未改 |
| Manual journal / historical research deep controls | 原版unchanged handlers | CARRIED_FORWARD | 引用9f1bedd integration43-row audit；本輪不新增日誌或重跑研究 |

## Result

本輪範圍沒有仍活躍外觀卻未接線的控制。發現的 misleading LIVE query-mode badge 已修；沒有把它誤報為 producer故障。既有缺資料/研究未完成/停用功能仍以原因顯示，沒有升格LIVE或補0。

驗證包含實際browser actions與source接線檢查；明確列為carried-forward的深層歷史研究控制，不宣稱本輪全部重跑。前次完整43-row audit：evidence280ad8c6f32a71aed7ca429e2a8a77386cee0802/docs/ui/cru55/integration-v1/UI_CAPABILITY_FRESHNESS_AUDIT.md。其過去LIVE資料狀態不作現在事實。

Final desktop DOM：overflow0 / clipping0 / formal text<11px0，核心結構與六卡保留。只有頁面歷史workspace report缺失console診斷，Overview無blocking error。1920使用full-page補齊host截圖裁邊；非網頁overflow。

Stop: CRU55_PREMERGE_MERGE_READY_FOR_OWNER_GATE。Owner visual acceptance未取得；no Merge/formal rollout/GPT backend/execution。
