# CRU-55｜Owner 回饋修訂 2（5–8 分鐘）
 
## 本次修正

依 Owner「燈號列先留著，把力道表還原；右側先按圖恢復顏色與表格」進行隔離 UI 修訂，等待實際查看效果。

1. K 線下的 Volume 改名 **成交量（口）**。此值仍是接受的價格 K 棒成交量；右側「觀測成交量」使用完整已觀測成交集合。真實 DAY 分別為 55 / 773 口，未改變資料定義。
2. 保留六時窗 Fast Scan，恢復原版九格分段力道條、選取時窗與壓力／價格反應／成交量／ΔCVD／Path／分類覆蓋率明細。點任一力道條可切換。
3. 右側恢復「即時盤況」、大字最新觀測價、彩色 CVD／ΔCVD／壓力、Path、覆蓋率、力價判定與資料狀態；五欄多時間表呈現週期／價格變化／CVD 變化／力價關係／狀態。
4. 週期控制併入 K 線標題列，三種桌面尺寸保留四個圖表 pane 及右側六列。下方市場模組可捲動到達。

## 版本／入口／啟動

- Source HEAD：`5ae0e6f885265b6e9f9cffbad9552bdbd3f4d33e`
- Branch：`codex/cru-55-premerge-ui-v1`
- [同一個 Draft PR #69](https://github.com/mike0345721/taiwan-quant-trading-system/pull/69)
- URL：http://127.0.0.1:3055/
- Worktree：`D:/Taiwan stock/standalone-v1/data/worktrees/cru55-premerge-ui-v1`
- 本次 runtime PID：`11996`。Codex 已登入預覽留在 SYNTHETIC / UI DEMO，方便檢查顏色與版面；真實 DAY／NIGHT 可在來源選單切換。

前提：Node.js 24、lockfile 相依套件已安裝（`npm ci --ignore-scripts`）、clean source HEAD、原有 private bundle、3055 埠可用。

```powershell
Set-Location -LiteralPath 'D:\Taiwan stock\standalone-v1\data\worktrees\cru55-premerge-ui-v1'
node scripts/start-cru55-preview.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b
```

另一個瀏覽器需在本機讀取 `data/cru55-private/runtime/session-11996.json` 的 `bootstrapUrl` 並開啟。此私人連結不外傳；重啟後使用新 PID 的 receipt。8 小時 session，重啟後舊登入失效。沒有私有 bundle 時，請依 [原始準備說明](../OWNER_REVIEW_GUIDE.md#啟動現有預覽已啟動)驗證 accepted sealed artifact 後再準備，不能只 clone GitHub 就宣稱重現真實資料。

## 快速檢查

- **0–2 分鐘：示範模式。** 六顆燈仍在，原版力道條是否回到你習慣的位置？依序點 1m／5m／30m。燈判斷力價關係；条帶呈現主動成交壓力，所以 1m 可同時是買方壓力與力價反方向，兩者不代表同一概念。
- **2–4 分鐘：右側。** 最新價、CVD、ΔCVD、Path、表格颜色與排列是否接近附圖？價格箭頭是窗口 Price Response 位移符號；CVD 箭頭是窗口 ΔCVD 符號，不是新增趨勢模型。紅漲綠跌仍沿用原產品價格慣例，可切換既有國際配色。CVD flow 顏色獨立。
- **4–6 分鐘：真實 DAY／NIGHT。** DAY 只有約 43 秒，六窗 PARTIAL，條帶與箭頭保持灰色；CVD +295，切換週期端點不變。NIGHT 約 22 秒、CVD +5，最新觀測價／Price Δ／K 線與成交量不可用，不能由 Price Response -2 補值。
- **6–8 分鐘：密度。** 確認 1366 可見 K／Volume／CVD／ΔCVD 與右側六列；向下捲動可看全部既有市場模組。請回饋力道表是否還要調整、右側是否夠像參考圖，以及燈號＋力道條是否重複擁擠。

未有完整盤別起點證明，所以保持「觀測累積」。沒有合法全盤高低、未平倉、VWAP或相鄰真實 Handoff，不照圖補數字。市場資料仍 STALE／捕捉 UNPROVEN；真實與示範不混合。

## 截圖

| 尺寸 | 真實 DAY | SYNTHETIC / UI DEMO |
|---|---|---|
| 1920×1080 | [真實](screenshots/day-1920x1080.jpg) | [示範](screenshots/demo-1920x1080.jpg) |
| 1536×864 | [真實](screenshots/day-1536x864.jpg) | [示範](screenshots/demo-1536x864.jpg) |
| 1366×768 | [真實](screenshots/day-1366x768.jpg) | [示範](screenshots/demo-1366x768.jpg) |

[NIGHT 缺值](screenshots/night-1920x1080.jpg) · [瀏覽器檢查](browser-audit.json) · [測試](tests.tap) · [修訂驗證與 review](VALIDATION.md)

**PREMERGE_UI_V1_ISOLATED_PREVIEW_READY_FOR_OWNER_REVIEW**

本次僅供 Owner 看效果，沒有 Owner Accepted／Product Ready／Merge／Production rollout。
`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`
