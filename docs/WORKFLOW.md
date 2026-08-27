# 專案持續交接流程

## 每次開始工作：最小必要閱讀

一般維護只讀：

1. `AGENTS.md`
2. Linear 當前已授權工作包
3. `CURRENT_STATUS.md`
4. `KNOWN_ISSUES.md`

依任務再擴充：

- 產品願景／架構／Owner Decision：查對應 Notion 頁面。
- 資料／Schema／Feature：`DATA_DICTIONARY.md`與對應資料規格。
- Dealer Flow：`DEALER_FLOW_AI_MASTER_PLAN.md`。
- 研究／回測：對應Research Spec與相關報告。
- 安全／架構：`SECURITY.md`、`docs/ARCHITECTURE.md`，並依主題搜尋`DECISIONS.md`。
- 版本追查：GitHub commit／tag／PR，並只搜尋`CHANGELOG.md`的對應版本或日期。

禁止把全部Markdown當成開工必讀集合。`NEXT_TASKS.md`不代表授權；Live CURRENT／NEXT與工作包授權以Linear為準，`ROADMAP.md`只作耐久策略／範圍地圖，不得自行用舊快照覆蓋較新的Owner決策、Notion、Linear或已批准GitHub實作。

## 工作進行中

- 檢查實際程式、資料庫與測試，不只相信文件。
- 一次只允許一個主要階段進行；不得自行把NEXT或FUTURE升為CURRENT。
- 新發現且仍有效的問題記入`KNOWN_ISSUES.md`。
- 只有重要架構、研究、策略、安全或治理選擇才記入`DECISIONS.md`。
- 保護資料時間口徑、原始快照與append-only帳本。
- 非小型修改原則上使用獨立branch／PR；Codex本機工作完成後應回傳commit或Draft PR與實際驗證結果，ChatGPT再直接讀GitHub diff／CI做Review，不以純文字摘要取代實際變更證據。
- 需要Windows、localhost、Shioaji、SQLite、本機瀏覽器或local-only資料時交給Codex／本機環境；ChatGPT不得對不可見的本機runtime自行宣稱PASS。

## 每次完成工作

1. 只執行與修改範圍相稱的測試、資料稽核與安全檢查。
2. 實際功能或行為有變更時，才更新`CHANGELOG.md`的單一新條目。
3. 真實現況改變時，更新`CURRENT_STATUS.md`，但不複製版本歷史。
4. CURRENT／NEXT／FUTURE改變時，以Product Owner明確決策及Linear live execution state為準；如需同步`ROADMAP.md`，必須有使用者授權。
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
