# V3.10 TX／MTX／TMF 即時行情最終驗收

> 日期：2026-07-30  
> 最終狀態：PASS  
> 證據：`data/live-events/futures-audits/latest.json`  
> `researchOnly=true`、`executionAuthorized=false`

## Gate 結果

| Gate | 結果 | 證據摘要 |
|---|---|---|
| 單一bridge程序 | PASS | 乾淨窗PID 52324；重啟後PID 37976；各階段只有一個Python bridge |
| 30分鐘乾淨工作階段 | PASS | 1,859,499ms，約30分59秒 |
| TX／MTX／TMF Tick與BidAsk | PASS | 乾淨窗三商品皆同時具有兩種事件 |
| callback／queue／writer | PASS | callbackErrors=0、dropped=0、writerErrors=0 |
| ledger完整性 | PASS | invalid=0、hash failure=0、sequence gap=0、duplicate=0 |
| 受控停止與重啟 | PASS | 三次reconnect evidence cycle；最終ready 10:49:34 |
| IX0001／2330重啟後新行情 | PASS | IX0001 12筆、2330 23筆 |
| 三期貨重啟後新行情 | PASS | TX 863、MTX 1,211、TMF 1,673筆 |
| 三期貨重啟後Tick與BidAsk | PASS | TX 199／664、MTX 370／841、TMF 602／1,071 |
| 執行邊界 | PASS | executionAuthorized=false、orderRoutesEnabled=false |

## 乾淨工作階段事件

| 商品 | 總事件 | Tick | BidAsk | >5秒時間長尾 | 最大商品事件間隔 |
|---|---:|---:|---:|---:|---:|
| TXFH6 | 28,778 | 7,078 | 21,700 | 0 | 1,248ms |
| MXFH6 | 46,143 | 15,666 | 30,477 | 0 | 1,240ms |
| TMFH6 | 61,887 | 23,522 | 38,365 | 0 | 1,119ms |
| IX0001 | 372 | — | — | 0 | 5,603ms |
| 2330 | 757 | — | — | 0 | 20,414ms |

## 時間戳

乾淨窗共137,937筆具有時間差的事件：

- p50：-101ms
- p95：-16ms
- p99：154ms
- min：-163ms
- max：1,727ms
- 超過5秒：0

`received_at - exchange timestamp`包含本機與交易所時鐘偏差，不能直接稱為純網路延遲。
獨立`w32tm`五次樣本顯示本機參考偏差平均約192.53ms，與負中位數量級一致。

## 首次失敗與根因

第一次30分鐘稽核為FAIL，整日資料出現1,815筆超過5秒時間差。事件高度集中在：

- 10:00:48至10:01:00
- 10:11:33至10:11:40

兩個區段分別對應全專案測試／秘密掃描，以及對成長中大型ledger執行舊式全量稽核。
三個期貨商品同時受影響，queue最終未丟資料，判定為本機CPU／磁碟競爭造成callback backlog。

修正：

1. 驗收改用完整bridge工作階段，不把整日不同負載區段混成同一個乾淨樣本。
2. 稽核先固定檔案位元邊界，稽核期間追加事件不混入同一份證據。
3. 重型測試、秘密掃描、全量ledger重算不得與正式高頻驗收窗同時執行。
4. 失敗區段保留在append-only ledger，不刪除、不覆寫，供後續Failure Analysis。

## 逐筆Order Flow候選

當日靜態ledger已重建：

- TXFH6：17,127 ticks，逐筆VWAP 40,783.3346，供應商分類CVD -287。
- MXFH6：36,030 ticks，逐筆VWAP 40,778.1030，供應商分類CVD -1,393。
- TMFH6：56,589 ticks，逐筆VWAP 40,785.9061，供應商分類CVD -961。

這些只屬單日描述性候選。VWAP只對捕捉串流精確；`tick_type`與Bid／Ask分類仍是主動方推定，
必須持續保存衝突率，不能稱為交易者真實身分或策略Edge。

## 尚未完成

- 日盤／夜盤跨時段、換月、次月契約及更多市場循環。
- 即時TXO有限契約帶資料品質與本機IV／Delta／Gamma估值Gate。
- DEX／GEX與Gamma結構情境。
- 可追溯權重來源下的前十大權值股盤中貢獻。
- 第三波前向研究至少30／60個全新乾淨日門檻。

以上未完成項目不得回頭改變本次期貨行情Gate，也不得自動取得交易授權。
