# CRU-31 Owner Browser Review Guide

目的：讓 Product Owner 在 10 分鐘內親自確認 CRU-31 的 Dashboard。這是「觀察與 UI 驗收」，不是交易測試；不要操作任何下單、買賣、取消、改單、平倉或反向功能。

## 1. 怎麼開目前 CRU-31 版本

### 最簡單的 CRU-31 production-path 啟動方式

1. 確認目前 checkout 是 Draft PR 的 branch：`codex/cru-31-ui-visible-surface-completion-v1`。
2. 確認主要專案 `D:\Taiwan stock\standalone-v1` 已有既有的本機 `.env` 與 `node_modules`。Review helper 只讀取 `.env`，並在 CRU-31 worktree 建立或重用一個指向既有 `node_modules` 的 ignored junction；若既有路徑指向其他位置會直接停止。它不會顯示或複製 secret，也不會啟動 broker/order route。
3. 在 PowerShell 執行，並保持這個 PowerShell 視窗開著：

```powershell
cd "D:\Taiwan stock\standalone-v1\data\worktrees\cru31-ui-visible-surface-completion-v1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-cru31-owner-review.ps1" -ProjectRoot "D:\Taiwan stock\standalone-v1\data\worktrees\cru31-ui-visible-surface-completion-v1" -PrerequisiteRoot "D:\Taiwan stock\standalone-v1" -Port 8788
```

4. 用內部瀏覽器開啟 `http://127.0.0.1:8788/`。
5. 使用既有本機 Dashboard 密碼登入。Review 完成後回到 PowerShell 按 `Ctrl+C` 停止這個 8788 review runtime。

這個 helper 使用正式 `server.mjs`、`NODE_ENV=production`、`MOCK_DATA=0`，但使用獨立的 `8788`，因此不會取代目前可能仍在 `8787` 的 approved runtime。請使用既有安全設定，不要把密碼、API key 或 Shioaji 憑證貼到 issue、PR、截圖或聊天。

- Shioaji：不是開啟 UI 的必要條件。未啟動時，依實際 contract 應看到清楚的 unavailable/source 狀態，而不是假資料。
- Real-data review：必須是 `MOCK_DATA=0`。Fixture 只能證明畫面 contract，不能代替真實 runtime review。
- 登入：正式 production path 需要登入。
- 正確版本：開啟 `http://127.0.0.1:8788/healthz`，`runtimeCommit` 應等於 Draft PR 最新 head SHA。`approvedMainCommit` 讀的是本機 `main` ref；若顯示舊的 `b0f5758...`，記錄為既有 `LOCAL_MAIN_STALE`，不要在 review 中自行 reset/覆蓋。此 PR 經遠端確認的 base 是 `3ff0dc24188e74e29477ad400470955e824124de`。Draft branch 尚未 Merge，因此 `syncState=MISMATCH` 是預期的版本差異，不代表可跳過 review。

## 2. 正常應該看到什麼

所有主要格子只能是：可信的值、清楚的 unavailable 原因，或 `RESEARCH_PENDING`。市場休市、EOD 未更新、來源未啟動時，看到誠實的 unavailable/delayed/stale/closed 狀態是正常的。

| 區域 | 正常預期 |
| --- | --- |
| Top Bar | `EXPECTED VALUE`：TX 實際合約、交易日/session、價格與可用時間；OI/basis 可為 `EXPECTED EOD / DELAYED`；缺來源時為 `EXPECTED UNAVAILABLE`，不可只顯示 `—` |
| K-line | `EXPECTED VALUE`：K 線 canvas 可見、可操作，日期/合約與 Top Bar 相容；level 缺資料時是 `EXPECTED UNAVAILABLE`，不可黑畫面卻顯示 Ready |
| Market Pulse | `EXPECTED VALUE`：price/VWAP/volume 等首頁既有 chart facts；Session high/low 在 K-line levels/detail；RVOL 是 `EXPECTED UNAVAILABLE · DERIVATION_NOT_IMPLEMENTED` |
| Futures | `EXPECTED VALUE` 或 `EXPECTED EOD / DELAYED`：TX、basis、法人淨額、OI；必須保留 actual contract、trade date、availableAt/freshness 真相 |
| Options | `EXPECTED EOD / DELAYED`：Call Wall、Put Wall、Max Pain、P/C；來源或合約不合格時是 `EXPECTED UNAVAILABLE`，不應推導 Greeks/GEX/DEX |
| Breadth | `EXPECTED VALUE`：完整來源的上漲/平盤/下跌數與描述性比例；Strength 是 `EXPECTED RESEARCH_PENDING` |
| Contribution | `EXPECTED VALUE`：IX0001 描述性貢獻列；來源等待或不可用時是明確狀態，不可生成替代貢獻 |
| Global | `EXPECTED VALUE` 或 `EXPECTED EOD / DELAYED`：latest-only global/FX 值；沒有正式時間序列時不應出現假折線 |
| Data Health | `EXPECTED VALUE`：整體與各 source readiness/freshness；缺少預期來源時必須 fail closed，不可誤稱 Live |
| Risk | `EXPECTED VALUE`：只顯示既有 risk status；component breakdown 是 `EXPECTED UNAVAILABLE`，Event/Trend 類未 promotion 能力是 `EXPECTED RESEARCH_PENDING` |
| Ask GPT | `EXPECTED VALUE`：手動 Copy Snapshot/Question 狀態；沒有 copy context 時是 `EXPECTED UNAVAILABLE` 且按鈕 disabled；沒有直接 GPT API |

Trend、evidence、changes、Data Health detail、journal 在頁面下方點「更多資訊」展開。Risk breakdown、Futures/Options/Breadth/Data Health 等卡片細節，點該卡右上角的 `更多 >` 開啟 drawer；按 `Esc` 或 drawer 的關閉按鈕返回。這是降低首頁噪音，不是刪除 roadmap capability。

## 3. 哪些情況算 FAIL

- 大量格子空白、只顯示 `—`，或看不出這格為什麼存在。
- 文字太小而無法正常閱讀，或在 1920×1080、1536×864、1366×768 擠出畫面。
- 卡片、數值、按鈕或 K 線重要區域被裁切；頁面可左右橫向捲動。
- K 線是黑畫面/空畫面，但狀態顯示 Ready；expand/restore 無效。
- Data Health 顯示 Live/Current，但 source 實際是 stale、delayed、EOD 或未啟動。
- API/network failure 被吞掉、舊值仍像目前值、或失敗後又自動變回 Ready。
- contract、trade date、session、actual contract、availableAt 顯示互相矛盾。
- `RESEARCH_PENDING` 被替換成分數、機率、方向、Neutral、BUY/SELL 等未批准 intelligence。
- Drawer、Details、更多資訊、FOCUS/REVIEW 或 nav 按鈕無效；drawer 鍵盤焦點跑到背景或關閉後不回到原按鈕。
- Copy 顯示 Ready 但實際沒有內容，或沒有 context 時仍可按。
- 登入成功卻無法進入正常 Dashboard，或 console 有 blocking error。

## 4. Owner Review Checklist

- [ ] Top Bar
- [ ] K-line
- [ ] Market Pulse
- [ ] Futures
- [ ] Options
- [ ] Breadth
- [ ] Contribution
- [ ] Global
- [ ] Data Health
- [ ] Risk
- [ ] Ask GPT / Copy Snapshot
- [ ] Drawer / Details
- [ ] FOCUS / REVIEW 與 nav
- [ ] No clipping / no horizontal overflow
- [ ] Font readable
- [ ] No meaningless blanks or `—`
- [ ] Truth states understandable
- [ ] Failure state remains visible and does not silently return to Ready

完成 checklist 不會自動 Merge。請明確回覆是否接受；CRU-31 在 Product Owner 明確批准前維持 Draft PR 與未 Done。

## 5. 如果發現問題

不需要查 code。請提供：

1. 一張包含問題區域的截圖；若可行，也截到 Top Bar 的合約/日期/狀態。
2. 區域名稱，例如「Options」「Data Health」「K-line」。
3. 畫面上實際看到的文字，例如 `Ready`、`—`、某個 unavailable reason。
4. 當時 URL、視窗大小，以及大約時間。
5. 若容易取得，附上 `http://127.0.0.1:8788/healthz` 畫面的 `runtimeCommit`；不要附任何 secret。

可直接寫：「區域：Data Health；看到：Live；但 source 顯示 stale；時間：14:20；viewport：1536×864」。工程 review 會依這些資訊重現，不需要 Owner 自行追程式。
