# 專案持續交接流程

## 每次開始工作：最小必要閱讀

一般維護只讀：

1. `AGENTS.md`
2. `ROADMAP.md`
3. `CURRENT_STATUS.md`
4. `KNOWN_ISSUES.md`

依任務再擴充：

- 資料／Schema／Feature：`DATA_DICTIONARY.md`與對應資料規格。
- Dealer Flow：`DEALER_FLOW_AI_MASTER_PLAN.md`。
- 研究／回測：對應Research Spec與相關報告。
- 安全／架構：`SECURITY.md`、`docs/ARCHITECTURE.md`，並依主題搜尋`DECISIONS.md`。
- 版本追查：只搜尋`CHANGELOG.md`的對應版本或日期。

禁止把全部Markdown當成開工必讀集合。`NEXT_TASKS.md`不代表授權，實際範圍只看`ROADMAP.md`。

## 工作進行中

- 檢查實際程式、資料庫與測試，不只相信文件。
- 一次只允許一個主要階段進行；不得自行把NEXT或FUTURE升為CURRENT。
- 新發現且仍有效的問題記入`KNOWN_ISSUES.md`。
- 只有重要架構、研究、策略、安全或治理選擇才記入`DECISIONS.md`。
- 保護資料時間口徑、原始快照與append-only帳本。

## 每次完成工作

1. 只執行與修改範圍相稱的測試、資料稽核與安全檢查。
2. 實際功能或行為有變更時，才更新`CHANGELOG.md`的單一新條目。
3. 真實現況改變時，更新`CURRENT_STATUS.md`，但不複製版本歷史。
4. CURRENT／NEXT／FUTURE改變時，只更新`ROADMAP.md`，且必須有使用者授權。
5. 有重大且長期有效的新決策時，依Decision Log格式更新`DECISIONS.md`。
6. 不因小修改無差別更新所有治理文件。

## 狀態用語

- `未開始`：尚未執行任何實作。
- `進行中`：已有實作但尚未達成驗收條件。
- `已完成`：功能與必要測試完成。
- `已驗證`：除完成外，已通過資料或使用情境驗收。
- `暫停`：刻意停止，等待使用者授權或外部條件。
- `受阻`：技術或外部問題使工作無法繼續。

「已完成」不等於「已證明能獲利」；交易策略必須另外通過回測、模擬及風控驗收。
