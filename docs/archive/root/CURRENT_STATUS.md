# 目前專案真實狀態

> 更新日期：2026-09-06  
> 文件角色：只保存「現在」的短版 snapshot。Linear 是唯一 CURRENT／NEXT；GitHub `main` 只代表 Owner-approved 實作；歷史請查 CHANGELOG / PR / Linear / immutable evidence。

## Approved Main

- `main`: `137dec1d42d172afe0ed200cd431245bacfa6987`
- 最近已合併：
  - PR #47：CRU-9 runtime repair
  - PR #48：CRU-37 Cross-Market Foundation V1
  - PR #49：CRU-39 Master Data Requirements V1

## Current Product Stage

專案目前定位：

> **Market Intelligence + Research Infrastructure + Forward Paper Operations**

不是單純籌碼面板，也尚未是可正式自動下單的交易系統。

目前核心責任鏈：

```text
Data / Reference / Truth
→ Position
→ Pressure
→ Expected vs Actual Response
→ Cross-Market
→ Path Efficiency
→ Market Control
→ Market State
→ Strategy Candidate
→ Risk
→ Paper / Future Execution
→ Outcome / Reconciliation / Failure Evidence
→ Research
```

## CURRENT Product Lane

**CRU-5 P0 Forward Paper Validation — In Progress**

目前 blocker：

**CRU-9 P0 Forward Observer — 等待 fresh eligible real-trading-day acceptance。**

驗收目標：

```text
08:35 Windows Task auto-start
→ P0 Observer
→ correct current TX contract
→ continuous intraday lifecycle
→ 13:47 reconciliation
→ persisted terminal evidence
```

通過後：

```text
CRU-10 P0 5-Day Smoke
→ CRU-11 P0 20-Day Operational Gate
```

不得 retrospective backfill。

## CURRENT Isolated Research Lane

**CRU-38 Cross-Market Source Readiness V1 — In Progress**

目前採 Historical-first：

1. 先查官方 / Vendor / Existing Data 是否足以直接支援 Backtest。
2. 再判斷最低必要粒度：Daily / 1m / Trades / BBO / Depth。
3. 再查 identity、license、retention / replay、timestamp、cost。
4. 只有歷史來源不足的必要缺口才考慮 Forward Capture。

目前第一輪：

- TWN 多年歷史：仍需 source evidence；IBKR 是低成本近期候選，不視為 3–5 年歷史主來源。
- NQ：CME DataMine 是強 Historical-first 候選，exact history / cost 尚待確認。
- SOX Daily：官方 Nasdaq historical candidate 已成立；SOX intraday 先等增量價值證明。
- USD/TWD Daily：官方 CBC historical source 可用；intraday economic object / source 仍需治理。

沒有授權 purchase、registration、scraper、collector activation。

## Recently Completed Foundations

- **CRU-34**：TX Intraday Pressure / Price Response / Path Efficiency Research Engine V1。
- **CRU-35**：Observed Flow Evidence UI Preview V1。
- **CRU-36**：Historical immutable CRU-34 materialization + bounded adapter。
- **CRU-37**：Cross-Market Data Foundation V1。
- **CRU-39**：Master Data Requirements V1。

## Master Data Requirements

Canonical registry：

- `config/data-requirements-v1.json`
- `docs/data/MASTER_DATA_REQUIREMENTS_V1.md`

目前 44 個 Dataset IDs 已治理；新資料需求必須先引用 Master，不得由各 Research / Collector 重新自創定義。

Data acquisition 原則：

```text
Official Download / Historical Vendor / Existing Data
/ Forward Capture / Derived / Own Record
→ Canonicalization
→ Quality / Lineage
→ Replay
```

## Data / Storage Truth

CRU-38 Storage Phase 0：

- D drive total：約 1.98 TB
- free：約 1.22 TB / 61.8%
- current capacity shortage：NO
- daily growth model：NOT_VERIFIED
- NORMAL_COMPLETE sample：N=1
- storage headroom：`WARNING_DUE_TO_LOW_CONFIDENCE`
- TWN tick capacity：UNKNOWN
- NQ tick capacity：UNKNOWN

不可把單日樣本推算成可信長期容量模型。

## Current Verified Capabilities

### Data / Market Semantics

- TWSE / TPEx / TAIFEX 官方日資料與研究資料。
- TX actual-contract live market-data bridge foundation。
- Append-only event evidence、identity / session / tradeDate / timestamp / quality contracts。
- Official 5m replay、VWAP / Opening Range / RVOL foundations。
- TX / TXO / TAIEX / institutions / OI / breadth / option structure research datasets。

### Market Intelligence

- Options Smart Radar / Wall / Max Pain / OI structure descriptive views。
- TX Pressure：BuyProxy / SellProxy / Unknown / classification coverage / conflict evidence。
- Price Response 60s / 300s。
- Path Efficiency。
- Observed Flow UI evidence surface。
- Cross-Market semantics for TWN / NQ / SOX / USD-TWD。

### Research / Validation

- Deterministic replay。
- Walk-Forward / Holdout / Bootstrap / Stress / MAE / MFE tooling。
- Forward evidence discipline。
- Negative result preservation。
- No-oracle / availableAt / no-backfill governance。

### Paper / Operations

- P0 Paper architecture and observer foundation。
- Windows scheduler repair 已 merged / local sync verified。
- 仍等待 fresh real trading day 證明 operational closure。

## Not Yet Promoted / Not Yet Available

- 沒有已證明可正式上線的穩健 Strategy。
- Market Control / Market State 尚未成為可正式交易依賴的 Promotion capability。
- Risk Engine V1 尚未完成。
- Position / Reconciliation 尚未完成交易級閉環。
- Broker Live Execution 禁止。
- 真實 Dealer Position / Dealer Cost 不可由公開 OI 推定。

## Safety Invariants

```text
formalWeight=0          # 對未 Promotion 研究能力
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

- Unknown / Missing 不得轉成 0 / Neutral。
- Historical data 可補 market path，不能補「系統當時知道什麼」。
- Frozen / immutable evidence 不得因研究結果不好而 rewrite / backfill。
- Existing Problem ≠ Current PR Blocker，但任何新 regression / scope expansion 必須 fail closed。

## Where to Look Next

- CURRENT / NEXT / blockers：**Linear**
- Product vision / Owner decisions / architecture：**Notion**
- Approved implementation：**GitHub main**
- Dataset requirement：`config/data-requirements-v1.json`
- Project identity：`docs/product/PROJECT_NARRATIVE_V1.md`
- Acceptance / authority：`AGENTS.md`

本文件不授權下一階段。