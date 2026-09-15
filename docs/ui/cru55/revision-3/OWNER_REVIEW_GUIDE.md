# CRU-55｜六點註解修訂（5–8 分鐘）

**PREMERGE_UI_V1_ISOLATED_PREVIEW_READY_FOR_OWNER_REVIEW**

## 六點已實作

1. 移除 K 線上方整排「選取時窗力道數字明細」。六時窗燈號與原版分段力道條保留；需要資料可點「時窗明細」。
2. 觀測漲跌增加百分比：DAY +73點（+0.15%）、SYNTHETIC +100點（+0.24%）。分母是 accepted 觀測起點價，**不是昨收**；NIGHT 缺少合法首末價，百分比仍不可用。
3. 路徑效率移到盤況上方第5格，保留完整原始數字與同一比值微條。窄畫面精確值可換行，字體不小於11px。
4. 力價關係下方補回對 accepted enum 的固定解釋。
5. 右下改為「綜合評估」：僅描述累積主動成交差、觀測片段限制與 freshness。Data Trust／捕捉 UNPROVEN移到緊鄰下方可見列。
6. 「商品」「到期月份」「市場交接」分為3格。依 Owner 回覆，選單可切換；TX2026-10／11與MTX／TMF無資料時，所有行情、CVD、燈號、判讀與下方市場證據清空為UNAVAILABLE。只有 TX／2026-09綁定既有隔離資料，切回即恢復。這是預覽選單，不代表新增契約資料或交易能力。

## 入口／版本／啟動

- URL：http://127.0.0.1:3055/
- Source HEAD：`3f8b2edf33f3829f18581b2421f0d0cd46b63aaa`
- Branch：`codex/cru-55-premerge-ui-v1`
- [Draft PR #69](https://github.com/mike0345721/taiwan-quant-trading-system/pull/69)
- Worktree：`D:/Taiwan stock/standalone-v1/data/worktrees/cru55-premerge-ui-v1`
- 現有 runtime PID35104，已登入 Codex 預覽留在明確 SYNTHETIC / UI DEMO，方便檢查配色；真實DAY/NIGHT可切換。

前提：Node.js24、`npm ci --ignore-scripts` 安裝的lockfile套件、clean sourceHEAD、既有本機privatebundle、3055可用。

```powershell
Set-Location -LiteralPath 'D:\Taiwan stock\standalone-v1\data\worktrees\cru55-premerge-ui-v1'
node scripts/start-cru55-preview.mjs ffe569570d66f3ae2971ac319ef0568e5757d1d52fa1c90f1715e8c08678193b
```

其他瀏覽器在本機讀取 `data/cru55-private/runtime/session-35104.json` 的 `bootstrapUrl` 開啟。私人連結不外傳；重啟後使用新PID receipt，8小時session。Bundle缺少時依[原始準備說明](../OWNER_REVIEW_GUIDE.md#啟動現有預覽已啟動)先核對accepted artifacts。

## Review（5–8分鐘）

- **前2分鐘：**看數字明細移除後，K線與上下力道條的密度是否舒服；右側5格、漲跌%與說明是否符合六個註解。
- **第2–4分鐘：**商品TX、月份2026-09先看有資料；改到10月、11月或MTX/TMF應清空為不可用，不能顯示上一選擇的數值。切回可恢復。
- **第4–6分鐘：**選真實DAY，應保持STALE、觀測累積與六窗PARTIAL；NIGHT漲跌%不可用。分段力道條與燈號仍共用accepted truth。
- **最後2分鐘：**檢查1366的全部右表列、精確Path換行、摘要长度；向下仍可看既有市場模組。請回饋五格數字是否易讀、補充說明是否夠、三格控制區是否符合預期。

## 截圖

| 尺寸 | 真實 DAY | SYNTHETIC / UI DEMO |
|---|---|---|
| 1920×1080 | [真實](screenshots/day-1920x1080.jpg) | [示範](screenshots/demo-1920x1080.jpg) |
| 1536×864 | [真實](screenshots/day-1536x864.jpg) | [示範](screenshots/demo-1536x864.jpg) |
| 1366×768 | [真實](screenshots/day-1366x768.jpg) | [示範](screenshots/demo-1366x768.jpg) |

[無資料月份](screenshots/unavailable-month-1920x1080.jpg) · [Browser audit](browser-audit.json) · [10項tests](tests.tap) · [驗證與限制](VALIDATION.md)

No Merge／正式runtime／Product Ready／Owner Accepted。  
`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`
