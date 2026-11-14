# 每日資料收集驗收 V1

## 目的與邊界

`Daily Collection Acceptance V1` 是唯讀、離線、date-scoped 的資料驗收層。它回答某個 governed `tradeDate` 原本應收、實收、保存、完整性與研究使用資格；它不是目前這一刻的 Data Health，也不是 collector、scheduler、API、Dashboard 或研究 Promotion。

本階段不修改任何 raw ledger，不下載或回補資料，不改 CRU-34/44 語意或 30 秒 Path threshold。安全邊界固定為：

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

## Golden Path

```text
Master Data Requirements V1
→ existing governed ledger / daily-stage / projection evidence
→ fixed byte-cutoff streaming scan
→ deterministic daily-collection-acceptance-v1 JSON
→ DAY / NIGHT metadata-only verification
```

輸出只寫入：

```text
data/quality/daily-collection-acceptance/YYYY-MM-DD.json
data/quality/daily-collection-acceptance/latest.json
```

`data/**` 依現有 `.gitignore` 保持 local-only。Raw/live market data 不得提交 GitHub。

兩個 JSON 各自以 temporary file + rename 原子替換，但不是跨檔 transaction；`latest.json` 表示最後一次成功 invocation（即使該次是歷史 tradeDate），consumer 必須仍以檔內 `tradeDate` 判讀。

## 執行方式

`generated-at` 是 deterministic cutoff 的一部分，必須明確傳入；同一組 immutable input byte cutoffs、同一組 evidence 與相同 `generated-at` 會產生相同 JSON。

```powershell
node scripts/build-daily-collection-acceptance.mjs `
  --trade-date=2026-09-10 `
  --calendar-date=2026-09-10 `
  --generated-at=2026-09-10T12:40:55.197Z `
  --sessions=DAY,NIGHT `
  --data-root="D:\Taiwan stock\standalone-v1\data" `
  --ledger-cutoffs=2026-09-09.ndjson@2745991217,2026-09-10.ndjson@1903118644
```

可用 `--output-root` 將驗收輸出導向 data-root/quality/daily-collection-acceptance 下另一個隔離目錄；拒絕跳出範圍、symlink/junction 與 input/output 碰撞。Builder 不發出 network request，也不啟動任何 runtime。

對仍在 append 的當日 ledger，首次執行會把實際完整行 cutoff 寫入 `sourceArtifactIdentity.files[].cutoffBytes`。需要 deterministic read-back 時，必須用 `--ledger-cutoffs` 明確重放相同 boundary；`generated-at` 是報告與發布時窗語意，不能取代物理 byte cutoff。

## 證據模型

### Live event

每個 ledger 在開始掃描前先固定最後一個完整換行的 byte cutoff，之後逐行讀取到該 cutoff。報告保留檔名、cutoff bytes、完整 prefix SHA-256、第一與最後 record hash。只統計 `receivedAt <= generatedAt`，且與指定 `tradeDate`、session 與 canonical Feed 相符的非 `simtrade`、非 duplicate records。Feed 的 `calendarDate/calendarDates` 使用 governed Asia/Taipei session classification，不從 timestamp 字串直接切片；NIGHT 跨午夜時可同時出現兩個 calendar dates。

NIGHT 所需的任一 governed ledger 檔不存在時，檔名會保留在 `sourceArtifactIdentity.missingFiles`，相關 Feed 降為 `PARTIAL / LEDGER_NOT_FOUND`，不可由另一個存在的半時段檔案升格為 PASS。

既有小型 ledger 可在同一 invocation 重用 `auditLiveEventLedger`；大型 ledger 不做另一個無界全檔記憶體 audit。Persisted `futures-audits/YYYY-MM-DD.json` 只有在 bytes/latestHash/sequenceGaps 與本次 cutoff 相符、且已保存的 prefix SHA-256 也與本次 scan 相符時才可升格 integrity；舊 audit 缺 prefix digest 時保持 `UNKNOWN`。

`sequence = null`、缺少 sequence-gap evidence 或已觀測到 `sequenceGap > 0` 時，即使 ledger 有資料且 hash chain 可驗，也不得把完整性升格為 PASS。Native sequence 缺失時必須保留：

```text
captureState = PASS
persistenceState = PASS
integrityState = UNKNOWN
researchEligibility = READY_WITH_LIMITATION
reasonCodes += NATIVE_SEQUENCE_UNAVAILABLE
```

Hash PASS 只證明本機 append-only chain，不能證明市場逐筆完整。

`captureState=PASS` 只表示該 Feed 確實有 delivery，不表示整個時段完整。`coverageState` 另以既有 governed session start/end 判斷：尚未到 session end 為 `PENDING`；已結束但未從開盤邊界延伸到收盤邊界為 `PARTIAL`，並標記 `LATE_START` / `STALE_DELIVERY`。不新增寬限 threshold，也不以 subscription success 取代 delivery evidence。

Operational counters、reconnect 與 missing-ledger evidence 依 DAY / NIGHT 分開歸屬；某個 NIGHT 檔或錯誤不得污染已驗證的 DAY Feed。NIGHT calendar prior-date 無法由 governed calendar 解出時，CLI fail closed，不猜日期。

### Official / batch

`v3-daily-update-status.json` 的 stage truth 只證明批次階段是否執行，不單獨證明每個 canonical Dataset 已收到、保存或具備 row-level `availableAt`。沒有 dataset-specific source date / artifact evidence 時，capture 與 persistence 保持 `UNKNOWN`。

Daily Update status 是 mutable latest report；只有 `completedAt <= generatedAt` 才能被該 acceptance 使用。被後續批次覆寫、完成時間晚於 acceptance cutoff 的 status 會 fail closed，不得回填成當時已知 evidence。

當日 governed DAY session 尚未結束、官方批次仍沒有當日資料時，保守分類為：

```text
expectedState = PENDING
captureState = PENDING
reasonCodes = [NOT_PUBLISHED_YET]
```

這不是 failure denominator。13:45 是既有 TAIFEX DAY session boundary，不是對各來源另造發布 threshold；session close 後若仍沒有 dataset-specific evidence，保持 `UNKNOWN`，不猜官方發布完成時間。

### Derived research eligibility

Live Feed 只有在 `coverageState=PASS` 時才可成為 `READY` 或 `READY_WITH_LIMITATION`；`PARTIAL` 一律 `NOT_READY`，`PENDING / UNKNOWN` 保持 `UNKNOWN`。單筆 delivery 不得冒充完整 session research readiness。

Pressure / Price Response / Path Efficiency 是 derived evidence，不是 raw Feed。Derived 不可用不得覆寫 TX Tick / BidAsk 的 raw capture truth。若沒有同 `tradeDate` / session 的可追溯 projection evidence，derived row 維持 `UNKNOWN / PROJECTION_NOT_READY`。

### Storage accounting

`summary.totalRawBytes` 是「本次選取 ledger 的 immutable byte cutoffs 合計」，不是 whole-project daily storage。`storage` 另外保留 raw ledger、derived artifact、audit/report 三種 scope。三者沒有全部可證時，`totalBytes` 與 forecast 保持 `null / NOT_VERIFIED`；不得用 N=1 外推年度容量。

## Aggregate 規則

- `NOT_EXPECTED`、`NOT_ENABLED`、`NOT_PUBLISHED_YET` 不進 failure denominator。
- Required-and-due Feed 全部通過對應 acceptance，才可 `PASS`。
- 已證明 capture / coverage / persistence / integrity 的 `PARTIAL` 或 failure 時，overall 至少 `PARTIAL`；全部必要 evidence materially unusable 才 `FAIL`。
- Required-and-due evidence 不足時是 `UNKNOWN`，不得樂觀轉成 `PASS`。
- `Missing != 0`，`Unknown != Neutral`。

## V1 first wave

本版 canonical Feed rows 包含：

- Live：TX、MTX、TMF 的 Tick / BidAsk，以及 `equity_2330_raw_price`、`taiex_index`，各自區分 DAY / NIGHT。TX 使用 registry 的 `tx_actual_trade` / `tx_best_quote`；MTX/TMF 因 registry 尚無獨立 canonical Dataset ID，`datasetId` 保持 `null` 並標記 `CANONICAL_DATASET_ID_UNAVAILABLE`，不得自創 alias 或升格為 research-ready。
- Official/batch：`taifex_daily_market`、`tx_futures_oi`、`tx_institutional_positions`、`tx_large_trader`、`txo_strike_expiry_cp_oi`、`market_breadth_and_sector_leadership`。
- Derived：`derived_pressure_response_efficiency`。
- Future/non-enabled：`txo_intraday_trade_quote_candidates`、`twn_futures`、`nq_futures`，固定為 non-failure `NOT_EXPECTED / NOT_ENABLED`。

MTX / TMF live records 雖存在於 shared ledger，但 Master Data Requirements V1 尚未提供獨立 canonical Dataset ID。本階段仍回報 Feed-level capture metadata，但不自創 `mtx_*` / `tmf_*` 別名；待 canonical registry 另案治理後再補正 `datasetId`。

## Schema

Top-level：

- `schemaVersion = daily-collection-acceptance-v1`
- `calendarDate`、`tradeDate`、`marketDayState`、`generatedAt`、`overallState`
- `summary.requiredCount`、`capturedCount`、`persistedCount`、`researchReadyCount`
- `summary.totalRawBytes`、`totalRecords`
- `summary.firstLiveReceivedAt`、`lastLiveReceivedAt`
- `summary.daySessionState`、`nightSessionState`
- `summary.reconnectCount`、`callbackErrors`、`writerErrors`、`droppedEvents`
- `storage`
- `feeds[]`
- `safety`

每個 `feeds[]` row 保留 canonical `datasetId`、中英文 label、quote type、mode/source、calendar/trade/session identity、expected window、actual contract、時間與筆數/bytes、capture/coverage/persistence/integrity、research eligibility、reason code + 繁中說明、evidence strength、artifact identity、downstream impact 與 smallest next check。

## 已知限制

- Native sequence 大多不可用，所以 packet-loss certainty 保持 `UNKNOWN`。
- Batch adapter 以指定日期的 SQLite 列建立身分；缺少當時 availableAt 仍不提升 capture/research。Daily Update stage PASS 不會被升格為 dataset PASS。
- 目前 `futures-audits` 只覆蓋少數歷史日；其他大 ledger 的 hash-chain 狀態不在本 builder 內重做無界 audit。
- Current CRU-34/44 status 不等於歷史 tradeDate projection evidence；未匹配時 derived eligibility 保持 UNKNOWN。
- 本版不新增 MTX/TMF canonical Dataset identity。
- Storage forecast 固定 `NOT_VERIFIED`。

## Phase A 停止點

完成 focused tests、secret scan、真實 DAY 與 NIGHT-inclusive metadata-only run、GitHub Draft PR 與 Linear factual checkpoint 後，只能停在：

```text
CRU25_PHASE_A_OFFLINE_ACCEPTANCE_READY_FOR_OWNER_REVIEW
```

不得 Merge、frontend integration、production activation、collector/scheduler 變更或 CRU-44 修改。


## Phase A.1 — 非交易日證據加固

Phase A.1 繼續使用同一 PR #58。以最新 approved main rebase 後只新增/修改離線驗收模組、CLI、temp-fixture tests 與本規格。UI、API、producer/status/lock、啟動器、collector、scheduler、registry、frozen semantics 都不屬本包。

### Batch 身分與當時可用性

`src/daily-collection-batch-evidence.mjs` 直接使用 `node:sqlite` 的 `readOnly:true` transaction；不呼叫會建立/migrate 資料庫的既有 bootstrap。需要支援 `node:sqlite` 的既有 Node runtime。六個 canonical ID 的映射為：

| Dataset | 實際來源表／鍵 | 保留限制 |
| --- | --- | --- |
| taifex_daily_market | market_daily / trade_date | 目前列不單獨證明歷史 capture |
| tx_futures_oi | futures_oi_daily / trade_date | near_contract_oi 與等價商品總量分列 |
| tx_institutional_positions | futures_positions_daily / date；institutional_futures_detail_daily / date, participant | 不混淆市場／參與人與真實 Dealer |
| tx_large_trader | large_trader_futures_daily / date, product_scope, expiry_scope | 保留 TX_MTX_TMF_EQUIVALENT 來源範圍 |
| txo_strike_expiry_cp_oi | options_strike_daily / date, contract, strike；options_contract_daily / date, contract | CP／expiry 保留；來源缺值補零語意未驗證 |
| market_breadth_and_sector_leadership | market_breadth_history_daily / date, market | 只覆蓋 TWSE EOD breadth；sector UNKNOWN，整列最多 PARTIAL |

回傳 selected-row SHA-256、row-key SHA-256、各表筆數、來源日期、來源路徑、原有 timestamp lineage。Digest 表示被觀測到的選定欄位身分，不代表整個 DB hash 或完整來源稽核。沒有 table 或資料列時不借用 latest/別資料集；沒有已治理 `availableAt` 不把 imported_at/fetched_at/built_at 改名代用。

`observedAt` 是實際完成唯讀 snapshot 取得的時間。只有 `observedAt <= generatedAt` 才能支持當時 persistence；前五類目前仍缺可證明的 source availability，因此 capture/research UNKNOWN。`--database` 直接讀取是一個新的 mutable-input acquisition，不可拿來宣稱過去可用。可先用 `readDailyBatchEvidence` 取得 map，凍結成 `{byTradeDate: {date: map}}` 的本地 metadata JSON，再以 `--batch-evidence=<path>` 重複驗收。報告保存此檔 hash。Snapshot 不包含市場 raw rows，只有 count、hash 與 lineage metadata。

### Derived 身分

`--derived-artifacts=<absolute-path>|<absolute-path>` 只讀明確列出的既有檔案，不自動尋找最新 projection。沿用 CRU34 historical / live validator。逐一檢查 tradeDate、session、actualContract、availableAt、materializedAt/observedAt 及 artifact hash；每個指定 session 最多一個選定 artifact。相同最新 generation 時點有不同 semantic identity 時，CLI 以 `OWNER_SEMANTIC_DECISION_REQUIRED` 停止。

Historical artifact 的完整性驗證與 raw prefix 歸屬分開；research 正向資格還需要 reader 提供匹配 sourceLedgerIdentity、cutoffLedgerOrdinal/hash、date/session/contract/availableAt 的 `derivedCutoffProofs`。目前通用 CLI 不建立這種額外 prefix 證明，缺證保持 `DERIVED_SOURCE_CUTOFF_UNVERIFIED / PROJECTION_NOT_READY`。這是明示的證據缺口，不用弱化 validator 或生成新投影補滿。Live mutable envelope 也不直接成為 immutable historical evidence。較新交易日的 current/latest projection 絕不回填較舊日期。

已驗證窗口逐項保留 Pressure、Price Response、Path status；缺少擴展窗口仍 UNKNOWN。Raw capture 狀態完全由 raw feed 決定。研究 qualification 不改 Path 30s 或 CRU34/44 公式，也不提升 Market State、Strategy 或權重。

### 多日 sweep 與保存範圍

```powershell
node scripts/build-daily-collection-acceptance-sweep.mjs --dates=2026-09-09,2026-09-10,2026-09-11,2026-09-12 --generated-at=<fixed-ISO-cutoff> --sessions=DAY,NIGHT --data-root=<Owner-data-root> --output-root=<isolated-git-ignored-acceptance-root> --batch-evidence=<frozen-metadata-json>
```

CLI 循序一次掃描每日期，無網路資料取得、排程或背景服務。每日期保存 `.json` 與 `.inputs.json`，後者保留固定 scanner/adapter metadata 供純函式重播。相同 immutable inputs、cutoff 與 code 產生一致輸出；mutable artifact 改變不能當相同輸入。`--reuse-reports=true` 只重新彙整既有 dated reports，不代表重新稽核 raw。

`sweep.json` 保存 compact dates summary、所有未解決列的 evidence-gap matrix、capacity sample metadata。Raw bytes 仍是每份 acceptance 選取的實體 prefix 總和；record total 是已篩到該 tradeDate 的 first-wave live records，兩者範圍不相同且明示。

容量統計另使用唯一的 calendar-day ledger immutable prefixes：同檔案/相同 cutoff/hash 只計一次；同檔案在不同 report 有不同 identity 時拒絕混算。N 是實體日曆日檔案樣本數，不是完整市場交易日數；recordSampleCount 另列。Physical recordCount 是 prefix 的全部非空行，不只 TX、不移除 duplicates。Median 使用中間值/雙中間平均，p95 使用 nearest rank。休市沒有選取 ledger 就不補一筆零容量樣本。不因少數 convenience samples 做年度預測；forecast 固定 NOT_VERIFIED，絕不称作全專案每日容量。

### 驗證與停止點

Focused tests 覆蓋 dataset/source-date/hash/observation cutoff、mutable/latest future leakage、derived/session isolation、缺值與 UNKNOWN、資料庫只讀、容量 N／去重／conflicting cutoff、同固定輸入 determinism。驗收另外執行相鄰 ledger、Daily Update/data-health 及 CRU34/44 validator 測試、syntax、diff、secret scan；真實資料只做必要日期的有界唯讀掃描。

完成實測、獨立工程審查與 GitHub/Linear factual checkpoint read-back 後，目標僅為 `CRU25_PHASE_A1_READY_FOR_OWNER_REVIEW`。這不是 Owner Accepted、Merge 或 production activation。

多日 CLI 不接受全域 `--ledger-cutoffs`（每日選取檔案集合不同）。重播固定 byte cutoffs 時逐日使用 daily CLI，再以 sweep `--reuse-reports=true` 彙整。
