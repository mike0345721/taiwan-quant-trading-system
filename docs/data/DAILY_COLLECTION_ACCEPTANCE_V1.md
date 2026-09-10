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

可用 `--output-root` 將驗收輸出導向另一個 local-only 路徑。Builder 不發出 network request，也不啟動任何 runtime。

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

Pressure / Price Response / Path Efficiency 是 derived evidence，不是 raw Feed。Derived 不可用不得覆寫 TX Tick / BidAsk 的 raw capture truth。Phase A 若沒有同 `tradeDate` / session 的可追溯 projection evidence，derived row 維持 `UNKNOWN / PROJECTION_NOT_READY`。

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
- 現有 Daily Update status 缺少所有 first-wave batch Dataset 的 row-level source date / artifact identity，stage PASS 不會被升格為 dataset PASS。
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
