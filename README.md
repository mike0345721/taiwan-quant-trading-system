# 勢衡｜Market Decision Intelligence

> 台指期／台指選擇權市場決策情報系統（原「台股／台指市場情報與量化交易系統」）

「勢」代表成交與委託壓力、量價變化及實際價格反應；「衡」代表 Data Truth、Expected vs Actual 的證據衡量與風險否決。本階段為**研究與人工決策輔助**，不是已驗證獲利策略或已啟用自動交易。

本專案以台指期／台指選擇權為核心，建立一套 **Data Truth → Market Intelligence → Forward Validation → Validated Strategy → Risk-first Operations** 的本機量化研究與決策系統。

它已不只是「籌碼指標面板」。現在的核心問題是：

> **市場上有哪些部位與壓力？實際價格如何回應？跨市場是否確認？這些狀態未來結果如何？哪些證據真正值得進入策略與風控？**

## 核心責任鏈

```text
Data / Reference / Truth
        ↓
Position
        ↓
Pressure
        ↓
Expected vs Actual Response
        ↓
Cross-Market
        ↓
Path Efficiency
        ↓
Market Control
        ↓
Market State
        ↓
Decision / Strategy Candidate
        ↓
Risk
        ↓
Paper / Future Execution
        ↓
Outcome / Reconciliation / Failure Evidence
        ↓
Research
```

## 核心原則

- **Truth 不能打折；Intelligence 可以漸進成熟。**
  - Identity、Contract、Timestamp、`availableAt`、Missing、Source、Replay、Lineage 必須 fail-closed。
  - Market Control、Market State、Confidence 等解讀能力可以逐步成熟，但不能假裝已驗證。
- **活著 > 勝率 > 報酬率。** Risk 最終應擁有交易否決權。
- **Historical-first acquisition。** 先查官方、Vendor、Existing Data 是否已足以回測；只有必要缺口才 Forward Collect。
- **No Fake Intelligence。** 有資料 ≠ 可正式研究；有模型 ≠ 有 Edge；有 UI ≠ 有正式交易能力。
- **No persisted evidence = NOT_VERIFIED。** 未持久化的本機結果不能升格成正式專案事實。

## Data Acquisition & Evidence

Data 部門不是「什麼都自己收」。正式取得策略分成：

```text
Official Download
Historical Vendor
Existing Data
Forward Capture
Derived
Own Record
        ↓
Canonicalization
        ↓
Quality / Lineage
        ↓
Replay
```

全專案 Dataset requirement 的 canonical registry：

- `config/data-requirements-v1.json`
- `docs/data/MASTER_DATA_REQUIREMENTS_V1.md`

新增資料需求必須先進 Master Data Requirements，不得由各 Research / Collector 自行重複定義。

## 目前產品階段

### CURRENT Product lane

**CRU-5 P0 Forward Paper Validation**。

目前主要 blocker：**CRU-9 fresh eligible real-trading-day acceptance**。通過後才進入：

```text
CRU-10 P0 5-Day Smoke
        ↓
CRU-11 P0 20-Day Operational Gate
```

### Isolated Research lane

**CRU-38 Cross-Market Source Readiness V1**。

目前採 Historical-first，依 Master Dataset IDs 評估 TWN / NQ / SOX / USD-TWD 的歷史資料、授權、粒度、成本與 Forward necessity。

### 已完成的重要 foundation

- CRU-34：TX Intraday Pressure / Price Response / Path Efficiency Research Engine V1
- CRU-35：Observed Flow Evidence UI Preview V1
- CRU-36：Historical immutable CRU-34 materialization + bounded adapter
- CRU-37：Cross-Market Data Foundation V1
- CRU-39：Master Data Requirements V1

## 目前仍沒有

- 已 Promotion、可正式上線的穩健交易策略。
- 完整 Risk Engine V1。
- Broker Live Order Route。
- 已授權自動下單。
- 可被宣稱為真實 Dealer Position / Dealer Cost 的資料。

安全狀態維持：

```text
formalWeight=0        # 對未 Promotion 的研究能力
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

## 系統能力概覽

目前專案包含：

- 本機 Node.js Dashboard / API。
- Login / Session / CSRF / security headers / secrets scan。
- TWSE / TPEx / TAIFEX 官方資料與研究資料層。
- Shioaji market-data-only bridge 與 append-only live event evidence。
- TX / TXO / TAIEX / institutional / OI / breadth / IV / Greeks research foundations。
- Deterministic replay、Walk-Forward、Holdout、Stress、MAE/MFE、Outcome research tooling。
- Pressure / Response / Path Efficiency descriptive evidence。
- Paper Trading / Forward Observer operational foundation。
- Cross-Market TWN / NQ / SOX / USD-TWD semantics and source-readiness research。
- Dashboard Decision Workspace / Observed Flow evidence surfaces。

## Source of Truth

- **Notion**：產品願景、Owner Decision、架構、研究結論。
- **Linear**：唯一 CURRENT / NEXT、Work Package、Bug、Blocker、Acceptance State。
- **GitHub `main`**：Owner-approved code、tests、config、migration、manifest、registry、spec 與實作。
- **Immutable Manifest / Ledger / Frozen Artifact**：研究與執行證據。
- **Local Runtime / Preservation Evidence**：本機 operational truth。

GitHub 的 roadmap / status 文件只是 snapshot，不得覆蓋 Linear CURRENT 或 immutable evidence。

## 新工作如何開始

一般維護／開發先讀最小集合：

1. [`AGENTS.md`](AGENTS.md)
2. [`CURRENT_STATUS.md`](CURRENT_STATUS.md)
3. [`docs/product/PROJECT_NARRATIVE_V1.md`](docs/product/PROJECT_NARRATIVE_V1.md)
4. 與該工作相關的 Linear Issue / Master Dataset IDs

再依任務選讀專項規格。

長期願景與歷史設計背景仍可參考 [`PROJECT_VISION.md`](PROJECT_VISION.md)；它不是 CURRENT 授權來源。

## 每日啟動與停止

每日只用這兩個腳本（Windows PowerShell 5.1，在執行目錄 `D:\Taiwan stock\approved-main-runtime` 執行）：

- 啟動：`powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File scripts\start-daily.ps1`
  開機捷徑也執行這一行。它是一個看門狗，每 60 秒檢查 Bridge（8790）、Producer、Dashboard（8787），缺哪個補哪個；同時間只會有一個在跑。
- 停止：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\stop-daily.ps1`
  停止看門狗、Dashboard、Producer；Bridge 不停。
- 網址：`http://127.0.0.1:8787`
- 紀錄：`data\automation-logs\daily\start-daily-YYYY-MM-DD.log`，每輪一行三個角色的狀態。

其他 `start-*.ps1` 與 `.bat` 是舊啟動器，不再用於每日使用。

## Windows 本機初次設定

需要 Node.js 22.13 以上。

```bash
cd standalone-v1
cp .env.example .env
npm run password:hash -- "請換成至少12字元的高強度密碼"
```

將輸出的 hash 放入 `.env`，再啟動：

```bash
npm start
```

## 驗證

```bash
npm test
npm run security:scan
```

## 重要限制

- 公開 OI 無法辨識真正 Dealer 的持有人與買賣方向。
- GEX / DEX / Gamma Wall / Dealer Position 類能力若缺乏可驗證資料，只能標為模型推估或情境研究。
- Missing / Unknown 不得轉成 0 或 Neutral。
- 歷史資料可以補市場路徑，但不能補「系統當時真的知道什麼」。
- 未經 Product Owner 明確批准，不得建立或啟用 Broker Live Order Route。

詳細治理見 [`AGENTS.md`](AGENTS.md)；欄位與 Dataset 定義見 [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md) 與 [`docs/data/MASTER_DATA_REQUIREMENTS_V1.md`](docs/data/MASTER_DATA_REQUIREMENTS_V1.md)。