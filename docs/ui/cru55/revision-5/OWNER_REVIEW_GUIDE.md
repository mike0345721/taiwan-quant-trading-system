# CRU-55 原圖上方列修訂｜Owner Review（5分鐘）

Source HEAD: `e7b4a419a6b5e76c5cde64ca0fc7a75aa26f015b`
Branch: `codex/cru-55-premerge-ui-v1` · [Draft PR69](https://github.com/mike0345721/taiwan-quant-trading-system/pull/69)

依 Owner 最新原圖指示，最終採：藍色斜線 SVG Logo（參照原圖重繪）、總覽導覽列、左商品/月份/盤別/報價/信任＋右Handoff，K線標題顯示台指期/actualcontract/報價/%。這取代稍早將報價放在Handoff同一列的中間嘗試。選單為16px白色標題字。actualcontract由accepted source解析，不複製參考圖TXFJ6。兩處報價和漲跌%共用accepted Context端點；分母仍是觀測起點，非昨收。

## 開啟

http://127.0.0.1:3055/ · isolated PID47012，Codex已登入。

Worktree: `D:/Taiwan stock/standalone-v1/data/worktrees/cru55-premerge-ui-v1`

```powershell
node scripts/start-cru55-preview.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b
```

在上方worktree執行；Node24、lockfile dependencies、cleanHEAD、privatebundle、3055可用。存取連結見本機 `data/cru55-private/runtime/session-47012.json` 的bootstrapUrl，不外傳；重啟換新PIDreceipt。其他前提及bundle準備同[前版Guide](../revision-4/OWNER_REVIEW_GUIDE.md)。

## 檢查

1. 看Logo與總覽導覽是否接近原圖。
2. 看左側商品大字、並排Handoff與K線契約報價是否清楚。
3. 切真實DAY與示範，兩處報價一致；切無資料月份兩處均不可用。
4. 看1366時DataTrust會在左卡內換行，但核心圖表/右表仍完整。
5. 請回饋上方列比例、字型及Logo效果。

## 當前驗證

10/10 targeted tests PASS；三尺寸1920x1080/1536x864/1366x768，各realDAY+demo，共6 screenshots。DOM overflow0、coretextclipping0、<11px0、duplicateIDs0；scan/table一致。實際unsupportedmonth清空兩處報價/%/contract。正常console0。圖表與frozen語意未改；未重跑上一版18次時窗互動，舊證據保留原HEAD。

單一工程review（coordinator，非獨立review）：PASS/B0/S0/APPROVE。檢查3檔diff、accepted來源重用、failure清除、價格顏色與三viewport實際畫面。Logo無外部請求；inlineSVG。圖上參考的歷史回測/設定在隔離預覽連到範圍說明，未新增正式功能。

僅修改 public/cru55-preview.html/css/js。Formal main/runtime、CRU52、frozen producer/contract、server均不改。真實短片段/STALE/捕捉UNPROVEN/無相鄰Handoff限制不變。Owner實際驗收待定；此原圖對齊先試看，Notion不提升為OwnerAccepted。

## 截圖

| 尺寸 | 真實DAY | 合成UI DEMO |
|---|---|---|
|1920×1080|[real](screenshots/day-1920x1080.jpg)|[demo](screenshots/demo-1920x1080.jpg)|
|1536×864|[real](screenshots/day-1536x864.jpg)|[demo](screenshots/demo-1536x864.jpg)|
|1366×768|[real](screenshots/day-1366x768.jpg)|[demo](screenshots/demo-1366x768.jpg)|

[Audit](browser-audit.json) · [Tests](tests.tap)

PREMERGE_UI_V1_ISOLATED_PREVIEW_READY_FOR_OWNER_REVIEW
No Merge / formal rollout / Product Ready / Owner Accepted.
formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false
