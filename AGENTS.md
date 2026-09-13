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
- 正式執行環境採用已合併版本，或啟動新的 Observer、Shioaji／資料流程前，須依既定流程同步已批准的 GitHub `main`；同步不等於啟用 Runtime 的授權。開發測試使用工作包指定的 branch／worktree 與 exact HEAD，依整合需求更新基線，不為每次測試強制 pull／rebase。
- 禁止以手動複製單一程式檔的方式長期同步，避免版本混雜；應使用 Git pull／既定同步流程。
- `.env`、Shioaji憑證、SQLite、live-events、raw ticks與大型歷史資料只保留本機，不得因同步而上傳 GitHub。

## Task-based Context Routing

禁止把所有Markdown當成每次開工必讀集合。先讀最小集合，再依任務擴充：

| 任務 | 最小必要來源 |
|---|---|
| 唯讀說明／規則稽核／純文案修正 | `AGENTS.md`＋直接相關材料；涉及 CURRENT、授權或驗收判定時才查 Linear |
| 一般維護 | `AGENTS.md` + Linear 當前工作包 + `CURRENT_STATUS.md` + `KNOWN_ISSUES.md` |
| 資料／Schema／Feature | 一般維護集合，再讀`DATA_DICTIONARY.md`及對應資料規格 |
| Dealer Flow | 一般維護集合，再讀`DEALER_FLOW_AI_MASTER_PLAN.md` |
| 研究／回測 | 一般維護集合，再讀對應Research Spec；只讀相關研究報告 |
| 安全／架構 | 一般維護集合，再讀`SECURITY.md`、`docs/ARCHITECTURE.md`及依主題搜尋`DECISIONS.md` |
| Market Control / Pressure / Flow / Efficiency | 一般維護集合，再讀`docs/product/MARKET_CONTROL_SYSTEM_BLUEPRINT_V1.md`與對應 Linear 工作包／Data Contract |
| Codex 額度／中斷／handoff／subagent／context compaction 恢復 | 一般維護集合，再讀`docs/operations/CODEX_QUOTA_AND_HANDOFF_RECOVERY_V1.md`與最新 Resume Packet |
| 版本追查 | GitHub commit／tag／PR，加上`CHANGELOG.md`對應版本或日期區段 |

- `CHANGELOG.md`不在一般任務中全文讀取。
- `DECISIONS.md`依主題或Decision ID搜尋，不每次全文載入。
- `DEALER_FLOW_AI_MASTER_PLAN.md`只在Dealer Flow任務讀取。
- `DATA_DICTIONARY.md`只在資料Schema或Feature任務讀取。
- Research文件只在對應研究任務讀取。
- Codex 在 quota/session/model/subagent handoff 或 context compaction 後，不得從記憶推測 Scope、完成度或 PASS；必須依 `docs/operations/CODEX_QUOTA_AND_HANDOFF_RECOVERY_V1.md` 重新對齊 Linear、GitHub exact HEAD、worktree 與驗證證據。

## 修改與驗證

- 不擴大使用者授權範圍，不因技術上可行而提前實作NEXT或FUTURE。
- 保護原始資料、append-only帳本、時間口徑與`available_at`語意。
- 缺值保持未知，不以0補造；公開資料推估不得冒充真實Dealer部位或成本。
- `executionAuthorized=false`，除非 Product Owner 明確另行授權。
- 未明確授權前不得新增 Broker Live Order Route。
- 修改後只執行與實際變更相稱的測試、資料稽核、安全掃描及文件更新。
- 不為一般修改無差別讀取或更新所有狀態、計畫、決策與歷史文件。

- 在已授權範圍內，完成要求的交付物、修復本次變更造成的問題，並完成相稱驗證後交付。只有新變更、新失敗或未解的相關風險才擴大或重跑驗證；無關既有問題須揭露，不自動納入修復。
- 既有授權不逐階段重問；可自行完成已授權且已確認不接觸正式環境的本機驗證與範圍內修復。必要授權尚缺時，先完成不依賴該授權的準備工作；不得將授權等待套用到獨立工作。
