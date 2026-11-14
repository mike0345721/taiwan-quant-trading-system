# V3.10 Price Path Data Gate v1（草案）

> 狀態：僅供下一工作包審查，不構成開發授權  
> 邊界：不研究因子、不建立模型、不修改Dashboard、不啟用策略或下單  
> `researchOnly=true`、`executionAuthorized=false`

Session、Trade Date、Contract、Gap及Timestamp的PP-1開發前語意另見
`docs/research/PP_1_MARKET_SEMANTICS_OWNER_BRIEF.md`。該Brief目前仍是規格候選，
不構成PP-1開發授權。

## 目的

建立一個最小、可重播、可稽核的 TX 日盤 Price Path 資料契約，讓後續研究能明確
區分「決策時點已知的價格路徑」與「目標完成後才可得的標籤」。本 Gate 只處理
資料正確性與時間因果，不判斷任何訊號是否有效。

## 允許的資料

- 已通過 hash／sequence／timestamp／queue 稽核的既有 TX live event ledger。
- 既有官方或已稽核5分鐘K，只作價格與交易時段交叉核對。
- 同契約、同日盤、日期嚴格早於當日的歷史基準。

資料不足時保持`null`或拒絕該日，不以0、forward-fill或其他商品補造。

## 最小欄位

| 欄位群 | 定義 | `available_at`原則 |
|---|---|---|
| Session Classification | 明確標示日盤、交易日及實際契約 | Session建立時可得 |
| Opening Range | 08:45–09:00三根完整5分鐘區間之OHLC與位置 | 09:00後 |
| Captured-stream VWAP | 已通過稽核且實際捕捉Tick的`sum(price×volume)/sum(volume)` | 隨每筆Tick累積 |
| Same-slot RVOL | 當日同時段量相對過去20個乾淨同時段基準 | 該時段完成後 |
| Price Path | 只用當下以前Tick形成的5分鐘OHLCV與累積路徑 | 每根完成後 |
| MAE／MFE | 自固定Anchor起至固定期限的最大不利／有利移動 | 目標期限完成後 |

`Captured-stream VWAP`不得簡稱為全市場完整VWAP；只要來源有漏包、sequence gap、
writer error或必要時窗不完整，該日精確VWAP資格立即失效。

## 時間與實體分離

- Feature與Outcome必須分檔或以不可混淆的event type保存。
- Feature不可包含其`available_at`之後的Tick、K棒、成交量、VWAP或路徑高低。
- MAE／MFE只能作Outcome／Label，不得回填至早期Feature。
- 夜盤與日盤不得無標註拼接；換月時不得跨契約計算Opening Range或Path。

## 品質 Gate

1. 來源ledger的invalid row、hash error及sequence gap皆為0。
2. `callbackErrors=0`、`dropped=0`、`writerErrors=0`。
3. TX實際契約與連續月alias關係可追溯。
4. 5分鐘bar連續、OHLC合法、成交量非負且交易時段分類正確。
5. Opening Range必須完整覆蓋08:45–09:00。
6. 每個Feature及Outcome保存來源範圍、`available_at`與品質狀態。
7. 以現有官方／已稽核5分鐘資料交叉核對OHLCV；不符即拒絕，不調低門檻。
8. 重跑結果必須byte-stable或具有相同內容雜湊，不得覆寫原始ledger。

## 明確排除

- CVD、aggressive buy／sell、Bid／Ask imbalance、absorption及Price × Flow。
- Greeks、DEX／GEX、Dealer推估、選擇權研究。
- 因子效果、interaction、模型、門檻最佳化及績效排名。
- Dashboard、Strategy Engine、Paper Trading與任何委託能力。

## 未來工作包驗收條件

- 資料契約、時間語意及拒絕規則有單元測試。
- 至少一個既有乾淨日可重播並產生一致Price Path。
- Feature與Outcome時間隔離測試通過。
- 正式原始ledger與Frozen Forward Registry完全未被修改。
- 所有輸出維持`researchOnly=true`及`executionAuthorized=false`。

## 停止條件

若來源資料不足以證明時段完整、逐筆連續、契約一致或`available_at`正確，停止該日
建置並保留失敗原因。不得為了完成Gate補造資料、降低品質門檻、加入Flow資料，
或提前開始研究與產品化。
