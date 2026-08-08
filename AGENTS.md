# Codex專案治理

本文件只保存穩定、長期有效的協作規則。版本狀態、研究結果、功能清單與未來願望不得寫入本文件。

## 權威順序

文件衝突時依下列順序判定：

1. `ROADMAP.md`
2. `CURRENT_STATUS.md`
3. 對應任務的專項規格
4. `DECISIONS.md`
5. 歷史文件與研究報告

- `ROADMAP.md`的CURRENT／NEXT／FUTURE是工作範圍最高權威。
- NEXT或FUTURE不是開發授權；只有使用者能改變CURRENT。
- `NEXT_TASKS.md`是歷史索引，不得視為自動開發授權。
- 文件不能取代程式、資料庫與測試的實際證據。

## Task-based Context Routing

禁止把所有Markdown當成每次開工必讀集合。先讀最小集合，再依任務擴充：

| 任務 | 最小必要文件 |
|---|---|
| 一般維護 | `AGENTS.md`、`ROADMAP.md`、`CURRENT_STATUS.md`、`KNOWN_ISSUES.md` |
| 資料／Schema／Feature | 一般維護集合，再讀`DATA_DICTIONARY.md`及對應資料規格 |
| Dealer Flow | 一般維護集合，再讀`DEALER_FLOW_AI_MASTER_PLAN.md` |
| 研究／回測 | 一般維護集合，再讀對應Research Spec；只讀相關研究報告 |
| 安全／架構 | 一般維護集合，再讀`SECURITY.md`、`docs/ARCHITECTURE.md`及依主題搜尋`DECISIONS.md` |
| 版本追查 | 只搜尋`CHANGELOG.md`的對應版本或日期區段 |

- `CHANGELOG.md`不在一般任務中全文讀取。
- `DECISIONS.md`依主題或Decision ID搜尋，不每次全文載入。
- `DEALER_FLOW_AI_MASTER_PLAN.md`只在Dealer Flow任務讀取。
- `DATA_DICTIONARY.md`只在資料Schema或Feature任務讀取。
- Research文件只在對應研究任務讀取。

## 修改與驗證

- 不擴大使用者授權範圍，不因技術上可行而提前實作NEXT或FUTURE。
- 保護原始資料、append-only帳本、時間口徑與`available_at`語意。
- 缺值保持未知，不以0補造；公開資料推估不得冒充真實Dealer部位或成本。
- 未明確授權前維持只讀研究邊界，不新增委託路由。
- 修改後只執行與實際變更相稱的測試、資料稽核、安全掃描及文件更新。
- 不為一般修改無差別讀取或更新所有狀態、計畫、決策與歷史文件。
