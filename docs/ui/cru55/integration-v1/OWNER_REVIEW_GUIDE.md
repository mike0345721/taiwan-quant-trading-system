# CRU-55｜8 分鐘 Owner Gate 檢查

Source HEAD `9f1bedd0e6036ead82b55a225edb6533fef38d7b`  
Branch `codex/cru-55-current-main-integration-v1`  
[Draft PR70](https://github.com/mike0345721/taiwan-quant-trading-system/pull/70) · base main `d3702315b46a1a6c23384338ae40904b8bc589c2`

## 開啟

同一台電腦：[隔離總覽](http://127.0.0.1:3055/)。目前候選 PID48576；Codex 已登入分頁可直接看。

工作目錄 `D:/Taiwan stock/standalone-v1/data/worktrees/cru55-current-main-integration-v1`。

```powershell
node scripts/start-cru55-integration.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b
```

前提：Node 24、依 lockfile 安裝的套件（含 lightweight-charts 5.2）、clean exact HEAD、既有本機 private bundle、approved-main-runtime 的合法唯讀資料與 SQLite／CRU34 projection、3055 空閒。不要重複啟動已存在的候選。Launcher 產生獨立 run 資料夾與本機 session receipt；新瀏覽器使用 receipt 的 bootstrapUrl 登入。存取碼不得上傳或貼入工單。

## 檢查順序

1. **0–1 分鐘：總覽**。上方依序「總覽、台股現貨、台指期貨、選擇權、海外市場、研究回測」，總覽無側欄；Data Trust 一直可見。
2. **1–3 分鐘：核心 Cockpit**。真實 DAY 是 9/7 觀測片段，STALE／PARTIAL 合理。切換六窗，CVD 累積 +295 不變。可切明確 SYNTHETIC / UI DEMO 看完整坡度、正負 ΔCVD、燈號與表格；它不是真實市場。
3. **3–4 分鐘：六張背景卡**。圖示、微圖、數值、短摘要與資料日。點現貨／廣度／期貨／選擇權／海外卡到對應工作區，風險卡開證據。背景不是本盤 CVD 的同一 cutoff。
4. **4–6 分鐘：原版能力**。台指期貨 → 盤中價格 / VWAP / Flow 是原版當前 producer；台指期貨 → 歷史逐根回放可重置、下一根、完整日。選擇權兩組契約選單分別控制 OI 圖與研究資料。海外保留 NDX/SOX/USD/TWD 各自日期；沒有真正 NQ/TWN。
5. **6–7 分鐘：操作與狀態**。工作區側欄可收成 46px；資料品質為共用入口。無資料月份會清空舊行情；切回可恢復。Ask GPT 可試填，送出停用，關閉清空。
6. **7–8 分鐘：1366 舒適度**。確認 K 線主導、CVD／ΔCVD、右側 Session／Relationship、下方卡片是否舒服；背景卡需向下捲動。

## 仍需 Owner 決定

六工作區導覽與底部六卡是否符合使用習慣；背景卡密度、1366 舒適度、原版工作區與新總覽的一致感。Owner Visual Gate 1 核心已保留；此輪整體外觀尚待 Owner Gate，未宣稱 Owner Accepted／Product Ready。

## 截圖

| 尺寸 | 真實片段 | 明確合成示範 |
|---|---|---|
|1920×1080|[Real](overview-real-1920.jpg)|[SYNTHETIC](overview-demo-1920.jpg)|
|1536×864|[Real](overview-real-1536.jpg)|[SYNTHETIC](overview-demo-1536.jpg)|
|1366×768|[Real](overview-real-1366.jpg)|[SYNTHETIC](overview-demo-1366.jpg)|

[六張背景卡](context-cards-1920.jpg) · [原版價格/VWAP/Flow](workspace-futures-1366.jpg) · [海外背景](workspace-global-1366.jpg) · [Ask GPT](ask-drawer.jpg)

[能力／資料時效稽核](UI_CAPABILITY_FRESHNESS_AUDIT.md) · [必須保留能力](MUST_PRESERVE_AUDIT.md) · [L0–L5／測試限制](L0_L5_VALIDATION.md) · [GPT review packet](GPT_REVIEW_PACKET.md)

NO Merge / formal rollout / GPT backend / execution。formalWeight=0; researchOnly=true; executionAuthorized=false; orderRoutesEnabled=false。
