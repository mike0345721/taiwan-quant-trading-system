# V3.10 即時選擇權 Greeks 有限探針報告

> 日期：2026-07-30  
> 性質：資料品質探針，不是正式因子或交易訊號  
> 安全邊界：`researchOnly=true`、`executionAuthorized=false`

## 結論

結果為 **PENDING**，不是 PASS。

Shioaji 可列出 TXO 契約並取得有限範圍的雙邊報價，但快照沒有直接提供
IV、Delta、Gamma。以最近月、價平附近五個履約價的 Call／Put 共十個合約，
使用期貨價格、買賣中價與 Black-76 進行本機估值，十筆均可計算，重定價誤差
絕對值均小於 `2e-11`。

供應商 snapshot timestamp 的時區／時間語意尚未完成驗證，因此這批結果只能
證明「估值程式可運作」，不能證明「盤中同步資料已通過品質門檻」。

## 探針範圍

- 標的：TXO
- 到期日：2026-08-19
- 履約價：40400、40500、40600、40700、40800
- 權利別：Call、Put
- 合約數：10
- 報價：十筆均有有效 Bid／Ask
- 模型：Black-76
- 正式模型權重：0

## Gate 狀態

| Gate | 結果 | 證據 |
|---|---|---|
| 唯讀契約可列舉 | PASS | 可見1,926個TXO契約 |
| 有限近價雙邊報價 | PASS | 10／10筆有效Bid／Ask |
| 本機IV反解與Greeks計算 | PASS | 10／10筆可計算 |
| Black-76重定價一致性 | PASS | 最大絕對誤差小於`2e-11` |
| 供應商直接Greeks | NOT AVAILABLE | 快照無IV／Delta／Gamma欄位 |
| snapshot timestamp語意 | PENDING | 尚未完成時區與同步性驗證 |
| 正式Greeks資料Gate | PENDING | 不得進入正式DEX／GEX |

## 限制與下一步

1. 先驗證 snapshot timestamp 的定義、時區與盤中同步性。
2. 再進行多時點、跨履約價、跨到期日的報價完整性與穩定性驗證。
3. 通過上述 Gate 後，才可把本機估值升格為研究資料層。
4. DEX／GEX仍只能在公開OI持倉方向假設下作多情境研究，不得宣稱是真實
   Dealer曝險或成本。

機器可讀證據位於：

- `data/readiness/shioaji-futures-access.json`
- `data/intraday/live-derived/2026-07-30-option-greeks-probe.json`

