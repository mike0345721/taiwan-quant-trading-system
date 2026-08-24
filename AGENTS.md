# Codex專案治理

本文件只保存穩定、長期有效的協作規則。版本狀態、研究結果、功能清單與未來願望不得寫入本文件。

## Source of Truth 與權威順序

不同種類的資訊由不同系統負責，不再由單一 Markdown 同時承擔所有權威：

1. **Product Owner 明確決策**：最高權威。
2. **Notion**：產品願景、Owner Decision、架構、研究結論。
3. **Linear**：唯一 CURRENT／NEXT、工作包、Bug、Blocker、驗收狀態執行來源。
4. **GitHub main**：已批准的程式碼、測試、設定、Migration、Manifest與實際實作。
5. **Immutable Manifest／Ledger／Frozen Artifact**：研究與執行證據；不得為了救結果而事後修改。
6. Repository 內 `ROADMAP.md`、`CURRENT_STATUS.md`、`DECISIONS.md` 與歷史研究文件：提供可追溯背景與快照；若與上述即時來源衝突，不得自行以舊文件覆蓋 Linear／Notion／已驗證實作。

- `ROADMAP.md`不再是 CURRENT／NEXT 的唯一權威；CURRENT／NEXT 以 Linear 為準。
- `CURRENT_STATUS.md`是 GitHub 內的可驗證狀態快照，不構成新工作授權。
- NEXT、FUTURE、研究候選或技術上可行都不等於開發授權；只有 Product Owner 能改變工作方向或批准啟動。
- `NEXT_TASKS.md`僅為歷史索引，不構成開發授權。
- 文件不能取代程式、資料庫、測試、Manifest與Ledger的實際證據。

## Third-party Skills

- 第三方 Agent Skills 必須遵守 `docs/governance/CODEX_SKILLS_POLICY.md`。
- 任何 Skill 與本專案治理衝突時，以 Product Owner 明確決策、`AGENTS.md`、Linear 已授權 Scope 與對應 Project / Research Spec 為優先。
- Engineering Review 的 `APPROVE` 不等於 Product Owner 批准；未經 Product Owner 明確批准仍不得 Merge、啟用 Production Runtime、提升 Evidence / Market State、變更正式模型權重或開啟任何 Broker / Order / Position / Risk / Execution 能力。

## GitHub 工作流程

- `main`只保存已批准版本。
- 新工作原則上建立獨立 branch／PR，不直接修改 `main`。
- 未經 Product Owner 批准不得 Merge 回 `main`。
- Frozen baseline／tag／Manifest不得覆寫或 force push。
- 不得因技術方便而擴大 Scope。

## 本機 D 槽與 GitHub 同步

- GitHub 是正式版本來源；本機 D 槽是執行、測試與保存大型原始資料的工作環境。
- GitHub `main` 合併新版本後，本機不會自動更新；在執行新的本機測試、Observer、Shioaji或資料流程前，必須先同步最新 `main`。
- 禁止以手動複製單一程式檔的方式長期同步，避免版本混雜；應使用 Git pull／既定同步流程。
- `.env`、Shioaji憑證、SQLite、live-events、raw ticks與大型歷史資料只保留本機，不得因同步而上傳 GitHub。

## Task-based Context Routing

禁止把所有Markdown當成每次開工必讀集合。先讀最小集合，再依任務擴充：

| 任務 | 最小必要來源 |
|---|---|
| 一般維護 | `AGENTS.md` + Linear 當前工作包 + `CURRENT_STATUS.md` + `KNOWN_ISSUES.md` |
| 資料／Schema／Feature | 一般維護集合，再讀`DATA_DICTIONARY.md`及對應資料規格 |
| Dealer Flow | 一般維護集合，再讀`DEALER_FLOW_AI_MASTER_PLAN.md` |
| 研究／回測 | 一般維護集合，再讀對應Research Spec；只讀相關研究報告 |
| 安全／架構 | 一般維護集合，再讀`SECURITY.md`、`docs/ARCHITECTURE.md`及依主題搜尋`DECISIONS.md` |
| 版本追查 | GitHub commit／tag／PR，加上`CHANGELOG.md`對應版本或日期區段 |

- `CHANGELOG.md`不在一般任務中全文讀取。
- `DECISIONS.md`依主題或Decision ID搜尋，不每次全文載入。
- `DEALER_FLOW_AI_MASTER_PLAN.md`只在Dealer Flow任務讀取。
- `DATA_DICTIONARY.md`只在資料Schema或Feature任務讀取。
- Research文件只在對應研究任務讀取。

## 修改與驗證

- 不擴大使用者授權範圍，不因技術上可行而提前實作NEXT或FUTURE。
- 保護原始資料、append-only帳本、時間口徑與`available_at`語意。
- 缺值保持未知，不以0補造；公開資料推估不得冒充真實Dealer部位或成本。
- `executionAuthorized=false`，除非 Product Owner 明確另行授權。
- 未明確授權前不得新增 Broker Live Order Route。
- 修改後只執行與實際變更相稱的測試、資料稽核、安全掃描及文件更新。
- 不為一般修改無差別讀取或更新所有狀態、計畫、決策與歷史文件。
