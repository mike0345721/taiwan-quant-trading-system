# V3.8.1 價格與一般量能研究資料

這個建置器只讀取已通過稽核的 `data/intraday/archive/*-day.json`，不修改官方封存檔，也不包含券商憑證、策略最佳化或委託功能。

執行：

```text
npm run intraday:features
```

輸出位於 `data/intraday/research/v3.8.1-price-volume/`：

- `bar-features.ndjson`：逐根價格、近似VWAP、開盤區間及同時段RVOL；每列只使用該根收完以前的資料。
- `daily-features.ndjson`：逐日盤後摘要。
- `future-labels.ndjson`：30／60／120分鐘未來報酬與MAE／MFE；與特徵實體分檔，且記錄標籤真正可得時間。
- `quality-summary.json`：資料閘門、缺值、前視稽核、來源指紋及警告。

重要限制：

- `vwapProxyHlc3`是5分鐘OHLCV推算值，不是逐筆成交的精確VWAP。
- 舊封存檔沒有保存`retrievedAt`，因此保留`null`，不得捏造或補0。
- RVOL只使用日期嚴格早於當日的20個已稽核交易日；暖機未滿20日時比值與基準都保持`null`，只保留樣本天數。
- 開盤15分鐘區間在第三根K棒收完以前保持`null`，避免偷看完整區間。
- 少於120個完整交易日只能作工程與描述性檢查；跨越120日只代表可以依凍結規格開始正式研究，不代表策略或績效自動有效。目前135日樣本的首輪因子研究結果另見`docs/research/V3_10_FACTOR_IMPACT_PROTOCOL.md`。
- 所有列固定`researchOnly=true`及`executionAuthorized=false`。
