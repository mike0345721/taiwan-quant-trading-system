# 台股籌碼神器資料字典

本文件說明目前正式資料的語意與使用邊界。SQLite 的實際欄位與型別仍以
`v2/migrations/*.sql` 為唯一 schema 權威；本文件不取代 migration。

## 共同資料原則

- 正式研究資料庫：`v2/data/research-v2.sqlite`（SQLite）。
- 原始快照與研究衍生值分層保存，不用衍生值覆蓋原始資料。
- `trade_date` 是資料所屬交易日；`available_at` 是當時可被模型使用的時間；
  `retrieved_at` 是系統實際取得時間。三者不可互換。
- 未取得、來源缺漏或不可計算的值一律保存为 `NULL`，不得補成 `0`。
- `0` 只代表官方資料明確為零；`NULL` 代表未知或缺失。
- `dataMode=mock`、`executionAuthorized=true` 或未通過來源稽核的資料不得進入正式研究。
- 回測只能使用決策時間以前已經 `available_at` 的資料，避免 look-ahead。

## 核心 SQLite 資料層

| 類別 | 主要資料表 | 用途 |
|---|---|---|
| 匯入與追溯 | `schema_migrations`, `import_runs`, `raw_snapshots`, `data_sources` | migration、匯入批次、原始快照、來源狀態 |
| 市場日資料 | `market_daily`, `global_market_daily`, `macro_observations` | 台股、期貨與跨市場日資料 |
| 法人籌碼 | `spot_institutional_daily`, `futures_positions_daily`, `institutional_futures_detail_daily` | 現貨及期貨法人部位 |
| 期貨 OI | `futures_contract_daily`, `futures_oi_daily`, `large_trader_futures_daily` | 契約、標準化 OI、大額交易人 |
| 選擇權 | `options_contract_daily`, `options_strike_daily`, `option_oi_changes` | 契約與履約價 OI、量價及變化 |
| 延伸研究 | `volatility_relative_daily`, `basis_term_structure_daily`, `option_volatility_daily`, `option_volatility_term_daily` | 波動、基差、期限結構 |
| 特徵與訊號 | `daily_features`, `signals_daily`, `research_input_registry_daily` | 可重算特徵、既有評分、研究輸入登錄 |
| 品質與回測 | `quality_issues`, `strategy_versions`, `backtest_runs`, `backtest_folds`, `backtest_daily_results` | 品質問題、版本與樣本外證據 |

完整資料表清單與欄位請查閱 `v2/migrations/001_initial.sql` 至目前最新 migration。

## 容易混淆的欄位

| 欄位 | 意義 | 缺值規則 |
|---|---|---|
| `foreign_net_e` | 現貨外資買賣超，單位依來源為億元 | 缺資料为 `NULL`，不得當成零買賣超 |
| `futures_positions_daily.foreign_net` | 期貨外資淨部位 | 缺資料为 `NULL`，不得當成零部位 |
| `market_open_interest` | 對應資料範圍的市場 OI | 必須搭配 product/expiry scope 解讀 |
| `near_scope_market_oi` | 近月範圍市場 OI | 無合法同契約資料時为 `NULL` |
| `all_contracts_market_oi` | 全契約市場 OI | 不可直接與近月價格做未標註比較 |
| `oi_pc_ratio` | Put OI / Call OI | 分母為零或資料缺漏時为 `NULL` |
| `max_pain` | 依公開 OI 推算的結算損益極小點 | 模型衍生值，不是莊家真實成本 |

## 盤中與事件資料

| 路徑 | 格式 | 使用邊界 |
|---|---|---|
| `data/intraday/archive/*-day.json` | 官方歷史重播 5 分 K | 日盤研究；須搭配同日 audit |
| `data/intraday/archive/*-night.json` | 官方歷史重播 5 分 K | 夜盤研究；不可與日盤時間軸混用 |
| `data/live-events/*.ndjson` | Shioaji 唯讀行情事件 | append-only、hash chain；目前無下單權限 |
| `data/live-events/futures-audits/*.json` | TX／MTX／TMF 即時驗收證據 | 同時要求 Tick、BidAsk、完整性、30分鐘、重啟與唯讀邊界 |
| `data/intraday/live-derived/*-futures-order-flow.json` | 逐筆期貨研究衍生值 | 供應商分類CVD、五檔交叉分類、逐筆VWAP；正式權重0 |
| `data/intraday/live-derived/*-option-greeks-probe.json` | 有限TXO本機估值探針 | Black-76中價反解IV／Delta／Gamma；timestamp Gate未通過時正式權重0 |
| `data/intraday/research/v3.10-restricted-wave3/aligned-discovery.ndjson` | 限制式第三輪歷史Discovery列 | 135日均為已檢視資料；不得稱為forward或untouched holdout |
| `data/intraday/research/v3.10-wave3-forward/restricted-frozen-models.json` | 限制式forward固定模型 | 12個Ridge linear-probability模型；只讀研究、不可重新訓練 |
| `data/intraday/research/v3.10-wave3-forward/restricted-forward-registry.jsonl` | 限制式forward登錄簿 | append-only hash chain；最早合格日2026-07-31，30日只作smoke test |
| `data/forward/v3.8-paper-events.jsonl` | Paper Event 狀態事件 | append-only、研究限定、不能視為成交紀錄 |

即時事件同時保留：

- `exchangeTimestamp`：交易所或供應商事件時間。
- `receivedAt`：本機接收時間。
- `sequence`、`duplicate`、`sequenceGap`、`clockSkewMs`：連續性與品質稽核欄位。

期貨即時事件另保存：

- `futures_tick`：逐筆成交，包含實際月份代碼、成交價、單筆量及供應商`tick_type`。
- `futures_bidask`：五檔委買／委賣陣列及各檔量。
- `_product_family`、`_subscription_alias`、`_target_code`：分別標示TX／MTX／TMF家族、訂閱別名與當次實際月份。

期貨Order Flow衍生值的口徑：

- `exactVwap`只表示「已通過稽核且實際捕捉到的逐筆串流」之
  `sum(price × volume) / sum(volume)`；若捕捉不完整，不得宣稱代表全市場完整VWAP。
- `cvd`使用Shioaji `tick_type`的供應商分類；`quoteCvd`使用成交價相對當時最佳Bid／Ask的推定。
- `classificationConflictRatio`保存兩種分類的衝突率。兩者都不是交易者身分或真實意圖的直接證明。

選擇權有限Greeks探針：

- `iv`：以期貨價格、履約價、到期時間、利率及Bid／Ask中價，使用Black-76反解的本機估計值。
- `delta`／`gamma`：由同一Black-76參數計算，並非券商或造市商提供的真實曝險。
- `providerSnapshotTimestamp`：保留供應商原始值；在時區／時間語意Gate通過前不得當成已驗證的交易所UTC時間。
- `timestampGate=PENDING_PROVIDER_SNAPSHOT_TS_SEMANTICS`時，所有Greeks只能作資料品質探針，
  `formalModelWeight=0`且`executionAuthorized=false`。

## V3.10 Frozen Forward Operations

- `restricted-forward-registry.jsonl`：凍結模型的append-only前向帳本。新增紀錄包含
  `registrySequence`、`previousRegistryHash`、`recordHash`及`idempotencyKey`。
- `feature_input`：09:00決策時點實際可得的凍結輸入快照；不得事後覆寫。
- `prediction`：12個凍結模型的前向預測，必須早於`targetAvailableAt`，正式權重固定為0。
- `outcome`：目標時窗完成後追加的固定事件結果，以`predictionRecordHash`連結原Prediction。
- `forward_day_accepted`：該日Prediction、Outcome、來源ledger、橋接健康及registry稽核均通過。
- `day_rejected`：啟動過晚、資料不完整、健康或完整性Gate失敗的日級拒絕；不得補造結果。
- `operations-status.json`：單次背景程序的即時工程狀態，不是績效或Promotion報告。
- `operations-acceptance.json`：整體`PASS`／`PENDING`／`FAIL`狀態；至少一個完整新交易日
  以前只能是`PENDING`，硬性完整性或安全邊界錯誤才是`FAIL`。

上述全部固定`researchOnly=true`、`executionAuthorized=false`、
`orderRoutesEnabled=false`及`formalModelWeight=0`。

## Dealer Flow 與未來欄位邊界

GEX、DEX、Gamma Wall、Gamma Flip、Dealer Balance Zone 等仍屬 ROADMAP 的
NEXT/FUTURE 研究範圍，不是目前正式交易欄位。公開 OI 無法證明 Dealer
真實持倉方向，因此任何 Dealer Position / Dealer Cost 都只能標示為模型推估。

## 資料品質最低要求

- 缺值不補零、不任意 forward-fill。
- 不同契約、到期別與日夜盤不可無標註拼接。
- 來源日期、取得時間、revision 與 quality status 應可追溯。
- 新增欄位先更新 migration、測試與本文件，再進入正式研究。
- 任何資料缺口都必須使依賴它的訊號保持中性或不可用，而不是產生假訊號。
