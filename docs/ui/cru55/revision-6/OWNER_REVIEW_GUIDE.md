# CRU-55 Revision 6｜上方狀態列精簡

Source HEAD `bb4be2969b585ac7b00a8a4991a3934c22dee13d` · branch `codex/cru-55-premerge-ui-v1` · [Draft PR69](https://github.com/mike0345721/taiwan-quant-trading-system/pull/69)

依 Owner 三則註解：移除商品列重複價格/%；保留K線報價與Session Context。DataTrust/時間與商品/月分/盤別水平排列。Handoff採原圖橫向分格，顯示前段觀測末價、本段觀測起價、accepted觀測端點差、交接狀態。配對不可比較時前段末價不可用；本段起價僅在accepted current side無reason時顯示。端點差只呈現accepted AVAILABLE值，不另計算、不冒稱官方昨收/開盤。狀態簡短中文，完整enum/reason仍在tooltip與證據。

## 開啟與五分鐘檢查

http://127.0.0.1:3055/ · isolated PID2536，Codex已登入。

在 `D:/Taiwan stock/standalone-v1/data/worktrees/cru55-premerge-ui-v1` 執行：

```powershell
node scripts/start-cru55-preview.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b
```

前提Node24、lockfile dependencies、clean exactHEAD、既有privatebundle、3055可用。本機登入連結在 `data/cru55-private/runtime/session-2536.json` bootstrapUrl，token不外傳；重啟用新PIDreceipt。[先前準備說明](../revision-4/OWNER_REVIEW_GUIDE.md)。

1. 看商品列重複報價已消失，資料狀態水平對齊。
2. 看Handoff分格比例與原圖是否接近；真實DAY/合成各自只顯示已接受的本段起價，缺乏合法相鄰交接仍不可用。
3. 點交接證據查完整原因，切無資料月份所有交接值清空。
4. 檢查1366下方K線、CVD與右表舒適度。

## 驗證與限制

10/10 targeted testsPASS；三尺寸×realDAY/demo六畫面，水平overflow0、可見核心文字裁切0、<11px0、duplicateIDs0、scan/table一致。正常console0。瀏覽器實際無資料月份清空交接3格與K線quote；交接drawer可開啟。單一coordinatorreview APPROVE B0/S0（非独立review）：directID移除核對、failure清除、accepted handoff gate與無跨gap計算、三尺寸及缺值顯示PASS。

僅public/cru55-preview.html/css/js，無frozenproducer/server/contract變更；formalmain/runtime d3702315b46a1a6c23384338ae40904b8bc589c2、CRU52不變。真實短片段/STALE/UNPROVEN/VWAP與OI不足限制仍保留。既有18次時窗互動屬revision4，本次沒有重標為新HEAD。Owner試看尚未接受；Notion不升格OwnerAccepted。

| 尺寸 | 真實DAY | 合成UI DEMO |
|---|---|---|
|1920×1080|[real](screenshots/day-1920x1080.jpg)|[demo](screenshots/demo-1920x1080.jpg)|
|1536×864|[real](screenshots/day-1536x864.jpg)|[demo](screenshots/demo-1536x864.jpg)|
|1366×768|[real](screenshots/day-1366x768.jpg)|[demo](screenshots/demo-1366x768.jpg)|

[Audit](browser-audit.json) · [Tests](tests.tap)

PREMERGE_UI_V1_ISOLATED_PREVIEW_READY_FOR_OWNER_REVIEW
NoMerge / formalrollout / ProductReady / OwnerAccepted.
formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false
