# CRU-55｜Owner Review Guide（約 8 分鐘）

本次交付是可操作的隔離 Dashboard 預覽，等待 Owner 實際檢查。不是正式產品更新，沒有 Merge 或 Production rollout。

## 入口與版本

- 預覽：http://127.0.0.1:3055/
- Source HEAD：`0d5996707fbad7266753c41fba3ad832ee3919ca`
- Source branch：`codex/cru-55-premerge-ui-v1`
- [Draft PR #69](https://github.com/mike0345721/taiwan-quant-trading-system/pull/69)，stacked base 為 CRU-54 branch；PR #68 仍 open / draft / unmerged。
- Accepted CRU-54：`66de7e9a416e9f2386eed1c9e8688afea1b804ab`。
- Approved main/runtime baseline：`d3702315b46a1a6c23384338ae40904b8bc589c2`。
- 執行目錄：`D:\Taiwan stock\standalone-v1\data\worktrees\cru55-premerge-ui-v1`。
- 本文件／截圖保存在 `codex/cru55-ui-evidence-v1` 證據分支；執行預覽請使用上述 source worktree。

## 啟動（現有預覽已啟動）

前提：Node.js 24、`npm ci --ignore-scripts` 安裝的 lockfile 相依套件（lightweight-charts 5.2.0）、clean source HEAD、既有 private bundle、3055 埠可用。這個 bundle 只保留本機，不上傳 GitHub。

```powershell
Set-Location -LiteralPath 'D:\Taiwan stock\standalone-v1\data\worktrees\cru55-premerge-ui-v1'
node scripts/start-cru55-preview.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b
```

現有 session PID 為 `28864`。已登入的 Codex 預覽頁可直接檢查。若從另一個瀏覽器開啟，需要本次啟動連結：在本機讀取 `data/cru55-private/runtime/session-28864.json` 的 `bootstrapUrl`，貼到同一台電腦的瀏覽器。此連結只供本機使用，不貼到 GitHub／Linear。重新啟動後，改讀 launcher 新 PID 對應的 receipt。Session 有效期 8 小時，重啟即失效；網路或驗證失敗會清空市場答案。

若 bundle 尚未存在，可在 source worktree 執行 `node scripts/prepare-cru55-preview.mjs`，再把輸出的 bundleHash 交給上述 launcher。此準備流程要求 sibling CRU-54 worktree 維持 accepted clean HEAD、兩份原有 sealed context artifact 均可驗證，並以唯讀方式取用 primary `data/latest.json` 的指定公開市場背景欄位。沒有私有資料時不可只 clone GitHub 就聲稱已重現真實片段。

## 0–2 分鐘｜真實 DAY

1. 確認仍熟悉：原版導覽、header、商品身分、上方力道燈、主 K 線、右側說明、下方市場模組。
2. 讀取 `STALE`、`觀測累積`、`捕捉 UNPROVEN`；目前不是 Live，也未證明完整盤別。
3. CVD **+295** 表示買方主動成交累積較多。查看較大的藍色線圖，不能解讀成多方部位或交易指令。
4. 點 1m → 5m → 4h：累積端點應仍為 **+295**；窗口仍為 PARTIAL。上方燈號和右表必須一致。

真實 DAY 僅約 42.928 秒。合法 K 線只有 1 根，價格合法子集 Volume 55；全部觀測 Volume 773。差異是 frozen contract 的合法输入集合差異，沒有補造 K 棒或 Volume。

## 2–4 分鐘｜SYNTHETIC / UI DEMO

5. 在「觀測來源」選擇 **SYNTHETIC / UI DEMO**；確認醒目的合成標籤，真實下方背景不混入。
6. 看 K 線是否仍主導、CVD 坡度與轉折是否易讀、ΔCVD 正負柱和 0 軸是否清楚。CVD +2,026；切換週期端點不變。
7. 選 1m／5m／30m：比較 Fast Scan 與 Explain / Evidence。Path Efficiency 是原始比值，不是 0–100 智慧分數。
8. 點「關係變化」讀完整轉換時間與標籤；圖上僅保留事件點，避免遮住 K 線。

## 4–6 分鐘｜Context、Handoff 與原版模組

9. 點本盤背景 ⓘ／交接證據／最近變化「證據」。檢查 Relationship → Change → Rate/Persistence → Level 的明細次序是否自然。
10. 切到真實 NIGHT：CVD **+5**，合法 K 線 **0 根**；Price Δ 保持不可用，不能用 Price Response -2 代填。
11. Handoff 目前 UNAVAILABLE：真實片段非合法相鄰兩盤。DAY／NIGHT CVD 不連線、不相減、缺口不插補。
12. 左側「現貨與期貨」捲到下方：Spot/Index Contribution、Futures Flow、Options、Breadth、Risk 都保留，明細可開啟。背景是 **2026-09-10 STALE 歷史快照**，與本盤日期分開。VWAP、指數貢獻、本盤 Risk 沒有合法來源，保留 UNAVAILABLE。

## 6–8 分鐘｜尺寸與回饋

13. 檢查 1920×1080、1536×864、1366×768：核心雙欄保持可讀。1366 將重複說明收進明細，下方次要卡片可往下捲動；沒有用縮小字體解決密度。
14. 檢查原版紅漲綠跌／國際綠漲紅跌選擇；CVD 及 ΔCVD 顏色語意不跟著混用。

請回饋：是否仍像原 Dashboard？Fast Scan 是否約 1 秒可掃讀？K 線是否主導？CVD 正負與坡度、ΔCVD、Path、Session、Relationship 是否好懂？Handoff 是否夠精簡？Data Trust 是否明顯？1366 是否舒適？是否重複擁擠？深藍視覺是否一致？

## 截圖與證據

| 視口 | 真實 DAY | 明確合成示範 |
|---|---|---|
| 1920×1080 | [真實](screenshots/real-day-1920x1080.jpg) | [合成](screenshots/synthetic-1920x1080.jpg) |
| 1536×864 | [真實](screenshots/real-day-1536x864.jpg) | [合成](screenshots/synthetic-1536x864.jpg) |
| 1366×768 | [真實](screenshots/real-day-1366x768.jpg) | [合成](screenshots/synthetic-1366x768.jpg) |

[真實全頁與所有下方卡片](screenshots/real-day-full-page-1920.jpg) · [NIGHT 缺值](screenshots/real-night-1920x1080.jpg) · [下方模組](screenshots/real-lower-modules-1920x1080.jpg)

[瀏覽器測量](browser-audit.json) · [64 項測試原始記錄](tests.tap) · [工程／隔離／限制](VALIDATION.md)

`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`
