# CRU-21｜Blave 有用部分接入：TX 研究驗證 V1

**狀態：獨立隔離工程候選（research-only）。非正式 Market State／策略 EV／Paper／自動交易交付。**

## 固定來源與授權

- 參考來源：[Blave-TW/blave-agent](https://github.com/Blave-TW/blave-agent)，固定參考 commit b74f8eed252c625c576600a103fa408815126632；查核日 2026-10-23。
- 上游授權：Apache License 2.0；上游 [LICENSE](https://github.com/Blave-TW/blave-agent/blob/b74f8eed252c625c576600a103fa408815126632/LICENSE) 和 [NOTICE](https://github.com/Blave-TW/blave-agent/blob/b74f8eed252c625c576600a103fa408815126632/NOTICE)。商標「Blave」屬上游。
- **僅借鏡研究方法**，沒有複製上游 Python 原始碼、沒有打包 Blave Desktop／Runtime、沒有匯入任何金鑰或下單模組。以勢衡 Node ES modules 獨立實作。日後若實際複製程式碼，須另行履行授權與修改告知義務。
- 對照的上游設計：lib/validation.py MCPT、lib/walk_forward.py、lib/param_scan.py 參數平台、lib/quality_check.py 成本警示、AGENTS.md 先驗證再回報、版本收據。
- Blave 原 MCPT 在同一資料跨度排列報酬，**不是**獨立樣本外證據；勢衡既有區塊排列檢定／Holm／Purged Walk-forward，不重複複製。

## 接入位置、保留與不接項目

隔離分支：codex/cru21-blave-research-validation-v1-20261023。固定起點：PR #90 exact caf3573ebf005b54674ab352013d739449b6edd6；**不改動** PR #89／#90／#91、本機正式服務、原始行情帳本或其他 worktree。

- **保留**：手續費＋滑價＋稅費等值「點」的成本檢查；策略／資料 SHA-256 與官方交易日曆綁定；完整路徑及 as-of 時間守門；3×3 訓練集參數平台（只以訓練資料選擇）；原有 Purged Walk-forward 的時間序稽核。
- **沿用勢衡**：src/intraday-factor-robustness.mjs 的區塊排列、Holm、Purged Walk-forward；src/research-evidence-contract-v1.mjs 嚴格 timestamp 與交易日曆。
- **不接**：Blave 券商／交易所 API、金鑰／憑證、雲端下單、策略自動部署／排程、付費資料、完整 Python runtime；不把研究輸出直接接成勢衡 UI 買賣訊號。

## 新增程式與使用方式

- src/research-strategy-validation-v1.mjs：
  - auditCostedTxReplay：只接受已完成、時間順序正確且 approved calendar 一致的凍結歷史回放結果；feature available ≤ signal available ≤ entry < exit ≤ outcome available。同交易日僅一個事件，至少 24 個不同交易日；正式權重永遠 0。輸出描述性歷史點數、成本、最大回撤、可重算 SHA，**不宣稱正 EV、真實成交或可下單**。
  - selectTrainingPlateau：規則／資料／成本 hash 一致，至少完整 3×3 參數格；以 9 個相鄰訓練績效平均選參數，不能用 OOS 分數選參；已讀過的 OOS 不算 fresh holdout。
  - auditPurgedWalkForward：只檢查現有 folds 至少三輪／24 筆 OOS、train < purge < test，不重寫勢衡原模型驗證器。
- scripts/audit-research-validation-readonly.mjs：只讀**本隔離工作樹** data/research-validation/ 之下不大於 2 MB 的 JSON，載入治理的 2026 期交所交易日曆，JSON 只輸出 stdout。不發網路、AI、Broker，不回寫、不 Promote。
- tests/research-strategy-validation-v1.test.mjs：合成測試資料**僅驗證數學、時序及拒絕機制，不是實盤資格或結果**。

離線執行（僅在已具備獨立核可的完整、時間安全且凍結的回放資料後）：

    node scripts/audit-research-validation-readonly.mjs data/research-validation/frozen-input.json

JSON 結構：tradeReplay: {manifest,costs,trades}；可加 plateau: {cells,provenance} 和 purgedWalkForward: {folds,predictions}。

Manifest 要求 schemaVersion=tx-frozen-executable-outcome-corpus-v1、sourceSha256、frozenRulesSha256、costConventionSha256、governedCalendarHash、completeSessionCoverage=true、continuityVerified=true、asOfJoinVerified=true、origin=GOVERNED_REAL_TX_REPLAY、researchOnly=true、executionAuthorized=false、orderRoutesEnabled=false。

Cost 要求 feePointsPerSide、slippagePointsPerSide、taxPointsPerRoundTrip（單位皆為 TX 每口等值點數，**非實際券商費用帳單**）；依該三個欄位的固定順序 JSON 序列化後 SHA-256，填入 costs.conventionSha256 與 manifest.costConventionSha256。任何費用改動使一致性檢查失敗。

每個 trade 要有完整來源／時序／日盤身分、真實歷史回放證據、價格、成本與凍結規則 SHA。**PR #90 的 OBSERVED_PATH_BOUNDS_ONLY／UNVERIFIED 不可直接當成可計算盈虧的完整交易。** 上游 Manifest 的宣稱及其 hash 必須由獨立 corpus 稽核；單有 true 欄位不等於來源驗收。

## 已知限制與交付門檻

1. PR #90 現況只有採樣路徑下界，缺完整連續可執行成交／費用／全日資料，因此**本次沒有真實策略獲利或 EV 結論**。
2. 3×3 只管訓練資料。OOS／多重比較／交易成本壓力測試與前向 Paper 仍需各自完成。
3. 所有輸出 researchOnly=true／formalWeight=0／executionAuthorized=false／orderRoutesEnabled=false；本 adapter 不帶 BUY/SELL 指令、券商或訂閱模型呼叫。
4. 未完成 exact-head CI／獨立審查及 Owner 核准之前，**不得合併、正式部署、重啟行情服務、讀取或使用交易憑證、啟用模擬／實盤交易**。
