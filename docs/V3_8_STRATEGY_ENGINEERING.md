# V3.8.1 三策略工程驗證

這個模組只驗證凍結規則能否在官方5分鐘K棒上正確、可重現且不偷看未來地執行。它不是正式回測，也不產生操作建議。

執行：

```text
npm run intraday:strategy-engineering
```

固定規則：

- 開盤15分鐘區間突破、VWAP同向回踩續走、3根內假突破回歸。
- 完整訊號K收盤後，下一根K開盤才是假設進場。
- 停損`1R`、目標`1.5R`，30／60／120分鐘分開評估。
- 同一根K同時碰到停損與目標，一律保守採停損先到。
- 每個期限保存路徑高低、MFE、MAE及4／8／16點成本結果。
- 不跨交易日、日夜盤或期貨合約；每個「策略×方向」只保留一筆未結束事件。

輸出位於`data/intraday/research/v3.8.1-strategy-engineering/`：

- `strategy-events.ndjson`：候選最後成為觸發、取消或因重疊未進場的原因，不含未來結果。
- `strategy-outcomes.ndjson`：各觸發事件的30／60／120分鐘結果；期限資料不足時維持`null`。
- `strategy-engineering-summary.json`：固定規格指紋、樣本閘門、防前視稽核與工程計數。

目前官方5分鐘研究資料已累積135個完整交易日並跨越120日最低資料門檻；但本模組的逐根候選彼此高度重疊，不能直接當成獨立樣本。這個工程輸出仍只驗證規則生命週期，不因資料日數增加而自動取得績效宣稱或交易授權；所有輸出固定`researchOnly=true`、`executionAuthorized=false`及`performanceClaimAuthorized=false`。正式因子效果另依凍結協議、日期級樣本、Walk-Forward與歷史保留期研究。
