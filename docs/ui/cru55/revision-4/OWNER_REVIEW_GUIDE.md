# CRU-55 Revision 4｜Owner Review（5–8 分鐘）

**PREMERGE_UI_V1_ISOLATED_PREVIEW_READY_FOR_OWNER_REVIEW**

## 已依最新兩則 Owner Decision 完成

- 同一條 Instrument Bar：商品、月份、唯讀實際契約、DAY/NIGHT、價格＋觀測漲跌%、來源 Data Trust。
- Fast Scan 燈號與主動成交壓力條合併六格。點六格選時窗；移除第三套週期按鈕。
- K 線轉換標記預設關閉。展開「關係變化」並勾選後才顯示，收合即隱藏；不是交易訊號。
- 左側圖表可伸展使用可用高度，維持 K 58%、Volume 9%、CVD 23%、ΔCVD 10% 的 pane hierarchy。
- Path 首屏兩位小數；完整原始值在即時盤況 ⓘ 明細與 tooltip，沒有新分數。
- Handoff 不可用時單列，依 accepted reason 顯示缺少／非相鄰盤別；證據仍可開啟。
- 預覽來源與合成提示位於 ISOLATED PREVIEW 旁。上方來源 freshness 與右側本盤證據品質分開命名。

## 開啟與重現

- URL：http://127.0.0.1:3055/
- Exact HEAD：`c20068a7f05959fc8837f40880c3dd3e62811b5f`
- Branch：`codex/cru-55-premerge-ui-v1`
- Worktree：`D:/Taiwan stock/standalone-v1/data/worktrees/cru55-premerge-ui-v1`
- [Draft PR69](https://github.com/mike0345721/taiwan-quant-trading-system/pull/69)
- 本次 isolated PID22016；Codex 預覽已登入。
- 前提：Node24、lockfile dependencies（npm ci --ignore-scripts）、clean exact HEAD、既有本機 private bundle、3055 port 可用。

```powershell
Set-Location -LiteralPath 'D:\Taiwan stock\standalone-v1\data\worktrees\cru55-premerge-ui-v1'
node scripts/start-cru55-preview.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b
```

其他瀏覽器在本機讀取 `data/cru55-private/runtime/session-22016.json` 的 bootstrapUrl 開啟；重啟用新 PID receipt。私人 token 不上傳，session 8 小時。若 bundle 缺少，先依[既有准备說明](../OWNER_REVIEW_GUIDE.md#啟動現有預覽已啟動)核對 accepted artifacts。

## 5–8 分鐘檢查

1. 前2分鐘：看整合控制列、六格盤中力道與右表。是否仍像原 Dashboard？K 線是否最突出？CVD斜率、正負背景、Δ柱是否容易讀？
2. 第2–4分鐘：依次選1m/5m/15m/30m/1h/4h。CVD累積值應不變；PARTIAL保持中性。燈號是力價關係、條是主動成交壓力，並非兩張投票。
3. 第4–5分鐘：看右側Session/Path兩位小數、關係說明與摘要；ⓘ可查raw Path。展開關係變化再勾選圖上標記，收合即隱藏。
4. 第5–6分鐘：切真實DAY/NIGHT。真實DAY是短片段、六窗PARTIAL；NIGHT價格不可用。STALE和捕捉UNPROVEN仍明示。
5. 最後2分鐘：切TX10月或MTX應清空為不可用，切回TX09恢復。打開Handoff證據，下捲確認現貨、期貨、選擇權、Breadth、Risk均可開啟。檢查1366是否舒服、重複／擁擠是否減少、深藍是否一致。

待Owner實際看效果；本次工程驗證不代表Owner Accepted或Product Ready。

## 截圖

| 尺寸 | 真實 DAY | SYNTHETIC / UI DEMO |
|---|---|---|
| 1920×1080 | [真實](screenshots/day-1920x1080.jpg) | [示範](screenshots/demo-1920x1080.jpg) |
| 1536×864 | [真實](screenshots/day-1536x864.jpg) | [示範](screenshots/demo-1536x864.jpg) |
| 1366×768 | [真實](screenshots/day-1366x768.jpg) | [示範](screenshots/demo-1366x768.jpg) |

[無資料月份](screenshots/unavailable-month-1366x768.jpg) · [Browser audit](browser-audit.json) · [Tests](tests.tap) · [Validation](VALIDATION.md)

No Merge / formal rollout。formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false。
