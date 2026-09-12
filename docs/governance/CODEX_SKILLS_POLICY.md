# 台股量化交易系統｜Codex Skills 整合規格 V1

## 1. 目的

本規格定義第三方 Agent Skills，特別是：

- `review-driven-development`
- `taiwan-market-rules`
- `taifex-market-rules`
- `twse-market-rules`
- `tpex-market-rules`

如何整合進本專案既有的 Product Owner、Notion、Linear、GitHub 與 Codex 治理流程。

核心原則：

> **Skills 是執行工具，不是治理權威。**

任何 Skill 都不得改變 Product Owner 決策、專案 Scope、安全邊界、研究晉升門檻或交易授權。

---

## 2. 權威優先順序

發生規則衝突時，依以下順序處理：

1. **Product Owner 明確決策**
2. **專案 `AGENTS.md`**
3. **Linear CURRENT 工作包與已授權 Scope**
4. **Notion 已批准的產品／架構／研究 Decision**
5. **對應 Project Spec / Research Spec / Data Contract**
6. **Repository 內既有安全與治理文件**
7. **第三方 Agent Skills**
8. **Codex 一般預設行為**

第三方 Skill 不得覆蓋更高順位規則。

若 Skill 指令與專案治理衝突：

> 以專案治理為準，並在 PR 中註明衝突與處理方式。

---

## 3. 開工前 Context Routing

Codex 不得因安裝 Skill 而改變本專案既有 Context Routing。

依 `AGENTS.md` 的 Task-based Context Routing 選讀。唯讀說明、規則稽核及純文案修正只讀直接相關材料；涉及 CURRENT、授權或驗收判定時才查 Linear。一般開發維護優先讀取：

1. `AGENTS.md`
2. Linear CURRENT 工作包
3. `CURRENT_STATUS.md`
4. `KNOWN_ISSUES.md`

再依任務類型選讀：

- Data / Schema / Feature → `DATA_DICTIONARY.md` + 對應 Spec
- Dealer Flow → Dealer Flow 專項文件
- Research / Backtest → 對應 Research Spec
- Security / Architecture → `SECURITY.md`、`docs/ARCHITECTURE.md`
- Version / Historical investigation → 對應 commit / PR / `CHANGELOG.md`

禁止因 Skill 要求而：

- 全量讀取所有 Markdown
- 將歷史文件視為 CURRENT
- 將 NEXT / FUTURE 視為已授權工作

---

## 4. 標準開發流程

本專案採用：

```text
Owner Authorization
        ↓
Linear CURRENT Scope
        ↓
Issue / Requirement Research
        ↓
Codebase Research
        ↓
Market Rule Verification（需要時）
        ↓
Implementation Plan
        ↓
Isolated Branch / Worktree
        ↓
Implementation
        ↓
Tests / Validation
        ↓
Draft PR
        ↓
Engineering Review
        ↓
Fix
        ↓
Re-review
        ↓
ENGINEERING APPROVE
        ↓
Product Owner Review
        ↓
OWNER APPROVE
        ↓
Merge
        ↓
Main / Runtime Sync
```

---

## 5. Owner Authorization 原則

只要 Linear 工作包已由 Product Owner 明確授權：

Codex 可以在既定 Scope 內自動完成：

- Research
- Plan
- Branch / Worktree
- Implementation
- Test
- Draft PR
- Review
- Bug Fix
- Re-review

不需要每個 Phase 都重新向 Owner 詢問。計畫、審查強度及範圍內 B 類修復沿用既有授權與本規格，不另設階段批准；S／N 依第 7 節處理。完成要求的交付物、必要審查與相稱驗證後交付；只有新變更、新失敗或未解的相關風險才繼續迭代。必要 reviewer 不可用或仍有 Blocking Finding 時，揭露缺口，不標記 Engineering APPROVE；可繼續不依賴該缺口的工作。

但以下行為仍必須重新取得 Owner 授權：

- 擴大 Scope
- 新增資料來源
- 新增正式 Collector
- 啟用 Production Runtime
- 更改 Frozen Evidence
- 更改正式研究門檻
- Evidence Promotion
- Market State Promotion
- 正式模型權重變更
- Broker Integration
- Order Route
- Position / Risk / Execution
- Merge

---

## 6. Engineering Review 與 Owner Review 分離

必須明確區分：

### Engineering Review

回答：

> 「這份實作在工程上是否正確？」

檢查：

- Bug
- Code correctness
- Error handling
- Edge cases
- Regression
- Test coverage
- Type / schema correctness
- Existing pattern compliance
- Security regression
- Data contract correctness
- Runtime failure behavior

Engineering Review 可以得到：

```text
APPROVE
REQUEST_CHANGES
```

但：

> **Engineering APPROVE 不等於 Product Owner APPROVE。**

### Product Owner Review

回答：

> 「這個東西應不應該進正式系統？」

Owner Review 檢查：

- 是否符合原始需求
- 是否擴大 Scope
- 是否發明需求
- 是否錯誤提升研究成果
- 是否違反 No Fake Intelligence
- 是否改變產品語意
- 是否破壞 Data Trust
- 是否修改 Frozen Evidence
- 是否影響安全邊界
- 是否真的值得進產品
- 是否應進 main
- 是否應啟用正式 Runtime

只有 Product Owner 可以批准 Merge。

---

## 7. Review Findings 分級

統一使用：

### B — Bug / Blocking

代表：

- 明確 Bug
- 安全問題
- 資料正確性問題
- Regression
- 合約違反
- Test failure
- Edge case 可能造成錯誤結果
- 可能破壞 Evidence Truth

處理：

> **若修復仍在原 Scope 內，可自動修復並重新 Review。**

### S — Suggestion

例如：

- 順便重構
- 改善命名
- 增加非必要 abstraction
- 額外 caching
- 額外 UI 改善
- 非本次必要的效能優化

處理：

> **預設不實作。**

記錄在 PR 即可。

若 Suggestion 會擴 Scope，必須由 Product Owner 決定。

### N — Note

純資訊，例如：

- Future consideration
- Historical debt
- 技術觀察
- 非本 PR blocker

處理：

> 記錄，不修改。

---

## 8. Review 強度自動分級

不需要每次詢問 Product Owner。

### Level 1 — Single Review

適用：

- 文件
- 文案
- 非核心 CSS
- 小型 UI spacing
- 顯示文字
- 不改資料語意的 Presentation-only change

Reviewer：

- Current Agent / Code Reviewer

### Level 2 — Double Review

適用：

- API
- Dashboard Data Contract
- Feature
- Data Schema
- Migration
- Collector logic
- Research Pipeline
- Replay
- Data Transformation
- Calculation logic

Reviewer：

- Current Agent
- 第二獨立 Reviewer，例如 Codex reviewer

必須兩者均無 Blocking Finding 才能 Engineering APPROVE。

### Level 3 — Triple Review

適用高風險範圍：

- Shioaji Runtime
- Live Market Data
- Timestamp Lineage
- Session Mapping
- Contract Mapping
- Append-only Ledger
- Immutable Manifest
- Frozen Artifact
- Forward Shadow
- Market State Promotion
- Research Promotion
- Security
- Authentication
- Broker Integration
- Order Route
- Position
- Risk
- Execution

Reviewer：

- Current Agent
- Codex independent reviewer
- 第三獨立 reviewer

任何 reviewer 出現 Blocking Finding：

```text
REQUEST_CHANGES
```

修復後維持原風險等級所需的 reviewer 數量，重審修正 diff、原 Blocking Finding 與受影響的不變條件。修正跨越安全或資料邊界、影響範圍不明，或 Spec 明定時，才完整重新 Review。每位必要 reviewer 應確認先前結論是否仍適用於更新後的 exact HEAD；不得將舊版 APPROVE 直接當成新版批准。

---

## 9. Taiwan Market Rules 使用原則

Taiwan Market Rules Skill 為：

> **Domain Truth / Regulation / Technical Specification Layer**

不是：

> Trading Signal Layer

### 使用時機

#### TAIFEX

- TX / MTX / TMF
- TXO
- Futures / Options
- Contract
- Trading Session
- Settlement
- Margin
- Position
- Clearing
- Market Data
- TMP / FIX
- Sequence / Recovery
- Technical protocol

#### TWSE

- 上市股票
- 集中市場
- 現貨交易規則
- TWSE market data / broker rules

#### TPEx

- 上櫃
- 興櫃
- TPEx market rules

---

## 10. Market Rules Guardrails

禁止：

- 用 TWSE 規則推論 TAIFEX
- 用股票交易概念代替期貨 Position / Margin / Clearing
- 把公開文件描述誤當成 Shioaji 實際 API 行為
- 把歷史文件當成當前最新規定
- 把規則知識轉成交易方向
- 由交易規則推導 Alpha
- 把「合法可交易」理解成「值得交易」

若問題涉及：

- 最新交易規則
- 正式市場時間
- Margin
- Settlement
- Position Limit
- Production Connectivity
- Live Trading

應驗證最新官方來源。

---

## 11. Research 與 Market Rules 邊界

Market Rules 可以協助：

```text
Exchange Truth
↓
Correct Data Definition
↓
Correct Contract Mapping
↓
Correct Session Semantics
↓
Correct Evidence
```

但不得直接進行：

```text
Market Rules
↓
BUY / SELL
```

真正研究流程仍為：

```text
Evidence
↓
Position
↓
Pressure
↓
Expected / Actual Flow
↓
Liquidity
↓
Price Response
↓
Path Efficiency
↓
Market Control
↓
Market State
↓
Decision
```

---

## 12. Trading Safety Invariants

除非 Product Owner 另行明確批准，以下條件永久保持：

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

第三方 Skill 不得自行修改。

---

## 13. Evidence Truth Invariants

任何開發不得違反：

- UNKNOWN 不得補成 0
- Missing 不得補成 Neutral
- Stale 不得當 Current
- Delayed 不得標 Live
- Proxy 不得冒充 True Source
- Public OI 不得冒充 Dealer Position
- OI Center 不得冒充 Dealer Cost
- Max Pain 不得冒充 Settlement Prediction
- Estimated Greeks 不得冒充 Provider Greeks
- Historical Forward 不得冒充 Current Market State
- Research score 不得冒充 Confidence
- 未驗證模型不得冒充 Trading Signal

---

## 14. Frozen / Immutable Artifact 規則

以下類型一律視為高風險：

- Frozen Model
- Frozen Spec
- Immutable Manifest
- Append-only Ledger
- Formal Forward Prediction
- Formal Outcome
- Official MISSED
- Historical Acceptance Evidence

禁止：

- Backfill 救結果
- Rewrite
- Silent Restore
- Retune 後覆蓋舊結果
- 將已看過的資料重新稱為 Untouched Holdout

任何必要變更：

> 必須建立新版本、新 Artifact、新 Decision，不覆寫舊證據。

---

## 15. PR 標準格式

所有實作型 PR 至少包含：

### Purpose / Scope

此次工作的原始授權範圍。

### What Changed

實際修改內容。

### Evidence / Runtime Truth

程式、資料、Runtime 實際觀察結果。

### Validation

包括但不限於：

- Focused tests
- Regression
- Security scan
- Syntax / type check
- Data audit
- Replay validation
- Browser validation

只列實際執行過的驗證。

不得將部分 PASS 寫成 Full PASS。

### Known Limitations

仍存在的問題與不確定性。

### Safety Boundary

明列：

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

以及本次未啟用的高風險功能。

### Explicitly Out of Scope

清楚列出本 PR 沒有做什麼。

### Engineering Review

包含：

```text
Review Level:
Round:
Blocking Findings:
Suggestions:
Notes:
Final Engineering Verdict:
```

### Owner Review

最後必須寫：

> Draft only. Product Owner approval required before merge.

---

## 16. Scope Creep 防護

Review 中發現任何「順便可以做」的工作：

預設：

```text
DO NOT IMPLEMENT
```

除非：

1. 是修復本次 Scope 內的 Blocking Bug；或
2. Product Owner 明確批准。

尤其禁止：

- 順便重構整個 Module
- 順便增加資料源
- 順便加新 Feature
- 順便改善 Strategy
- 順便啟用 Collector
- 順便改 Market State
- 順便修改 Research threshold

---

## 17. Merge Gate

只有以下條件全部成立才可以請求 Owner Merge：

- 原 Scope 完成
- Required tests 執行
- Blocking Findings = 0
- Engineering Review = APPROVE
- Known limitations 已揭露
- Safety Boundary 未被突破
- Scope 未擴大
- PR 為 Review-ready
- GitHub diff 可被 Product Owner 檢查

即使全部成立：

> **仍不得自行 Merge。**

最後 Merge 永遠需要 Product Owner 明確指示。

---

## 18. 核心原則

本專案採用：

> **Owner Governance + Review-Driven Engineering**

而不是：

> AI Autonomous Development

角色分工：

```text
Product Owner
= 決定做什麼、為什麼做、能不能進產品

Linear
= 管理目前工作授權

Codex
= 執行工程工作

Review-Driven Development
= 驗證工程品質

Taiwan Market Rules
= 提供市場 Domain Truth

GitHub PR
= 保存可審查實作

GitHub Main
= 保存 Owner 已批准版本

Runtime
= 只執行已批准且完成同步的版本
```

最終原則：

> **工程上寫對，不代表產品上做對。**

> **Engineering APPROVE 不等於 Product Owner APPROVE。**

> **任何 AI Skill 都不得越過 Product Owner Gate。**
