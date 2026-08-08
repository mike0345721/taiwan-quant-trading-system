# 台股籌碼面板 V2.2 資料核心

V2.1先建立可靠、可追溯、可回測的本機研究資料庫。V1面板與`2_START.bat`保持不變。

## 安全範圍

- 只在本機建立資料庫。
- 不連接券商。
- 不保存券商帳號、密碼、憑證或Token。
- 不提供下單端點。
- 原始快照保留SHA-256，可檢查資料是否被改動。

## 為什麼目前使用SQLite

這台電腦目前沒有Docker與PostgreSQL，但已有Node.js 24。V2.1使用Node內建SQLite，因此不需安裝額外軟體，也不會開放資料庫網路連接埠。資料表刻意採用可移植設計；資料量或多人使用需求提高時，再遷移到PostgreSQL。

## 已建立的資料層

- 不可遺失的原始快照與SHA-256
- 每一資料來源的日期、抓取時間、成功、舊資料與錯誤狀態
- 加權指數、台指期、市場寬度與波動率
- 現貨法人
- 期貨法人與大額交易人
- 各選擇權契約
- 各履約價Call／Put OI
- 每日訊號與操作建議版本
- 1／5／20日特徵及隔日期貨報酬標籤
- 資料品質問題
- 策略版本與未來回測執行紀錄

## 新手操作

回到V1最外層資料夾，雙擊：

```text
5_V2_SETUP.bat
```

它會建立資料庫、匯入V1歷史、重建特徵並輸出品質報告。重複執行不會產生重複交易日。

資料庫位置：

```text
v2/data/research-v2.sqlite
```

品質報告：

```text
v2/reports/latest-quality.json
```

## 開發驗證

```text
cd v2
node --test tests/*.test.mjs
node scripts/setup-all.mjs
npm run target:feasibility
npm run target:research
npm run risk:excursion
npm run history:macro
npm run macro:feasibility
npm run history:taiwan-vix
npm run features:vix-relative
npm run vix:research
npm run features:basis-term
npm run basis-term:research
```

`target:feasibility`會重建`reports/target-feasibility.json`，盤點大行情、跳空風險、路徑效率、MAE／MFE及持有期研究所需的資料覆蓋。

`target:research`會重建V2.6.2多目標Walk-forward、留出、消融及區塊Bootstrap報告。

`risk:excursion`會建立V2.7的MAE／MFE持有路徑報告；`history:macro`會從官方FRED來源更新VIX與美國10年債殖利率；`macro:feasibility`會重建V2.8第一階段環境風險報告。總體資料在台灣交易日只使用日期嚴格早於當日的觀測值。

`history:taiwan-vix`會更新TAIFEX免費公開的最近4個月收盤前1分鐘平均VIX；`features:vix-relative`會對齊當時已知的美股VIX；`vix:research`重建V2.9相對波動研究。`6_V2_UPDATE_HISTORY.bat`已包含這三步。

`features:basis-term`會建立近月／次月價差、收盤基差代理、1日與5日變化及只使用過去資料的Z-score；`basis-term:research`會排除結算前兩日與跨換月結果，以前70%校準、後30%驗證是否能加入評分。V2.9.1目前未發現通過最低樣本外門檻的特徵，正式權重維持0。

## 更新官方歷史資料

在V1最外層雙擊：

```text
6_V2_UPDATE_HISTORY.bat
```

程式會先匯入V1最新快照，再從TAIFEX與TWSE補齊官方資料、重建OI變化並執行品質驗證。首次執行可能需要數分鐘；舊月份會使用SHA-256快取。

V2.2固定保存一般交易時段資料，夜盤不與日盤未平倉量混加。

## 下一階段

1. 等待授權後建立策略版本與Walk-forward回測。
2. 讓V1畫面讀取V2的履約價OI變化。
3. V3才加入5分鐘行情與模擬交易。
