# CRU-21｜Flow 新鮮度修復與唯讀研究證據接線

## 身分與範圍

修復分支 `codex/cru21-flow-freshness-repair-20261027`，基礎 PR97 exact `398b38daeb9e4c05e0c744d576a6646fa392d37e`。本文件為候選工程收據，不是正式 Producer/Dashboard 已部署、Owner G7 或 G8 授權。原正式 main `4d8251686bdb4abbdb469bc00ae798717c0fd583` 與 Producer `2e4c89e2dbf465bd0703d99b98e30ee83fa0267b` 未修改。

## 已修復的原因

1. `buildExecutedPressureWindow` 原本對每筆成交從完整事件陣列尾端重新尋找報價，4 小時窗口形成大量重複掃描。改為每次評估私有、依原始陣列順序查找的報價區間索引；最後仍呼叫原 `evaluateBestQuoteEligibility`。不以時間排序重寫歷史、不改 tick_type、分類覆蓋門檻、費用、方向或研究權重。
2. Producer 原本在計算開始取 `now`，耗時後才發布，log 可能仍寫 LIVE。現在在昂貴計算完成後讀取發布時鐘；已過期就標 STALE。`availableAt` 與來源時間加 30 秒的期限不變，不靠延長期限或重寫時間換取綠燈。固定 `now` 仍只供明示離線回放。
3. UI 顯示來源落後秒數與超期秒數。當下數值與方向仍 fail closed；另外以「最後快照・非即時・不作方向判定」顯示可追溯量，與 current 欄位分開，缺值不補零。合約/日期/盤別不符、來源未知或損壞時連歷史備援也拒絕。
4. health 的 Flow 檢查增加 `sourceFreshness`，明確區別可渲染與來源仍新鮮；此欄也不是方向或完整收集資格。

## 同資料實測（MSI，Node v24.18.0，非正式部署）

同一份被凍結的衍生 checkpoint：43,591 canonical events，25,233 ticks；輸入 SHA256 `11f2456bca30cd635281598719dc5d1b35b4b2f2180e4ee3cf844d6de3240fd6`。原件只讀，副本及 CPU profile 留在隔離 ignored data/flow-perf，不上傳行情資料。

| 測試 | 原 PR97 | 修復候選 |
|---|---:|---:|
| 多時窗計算 | 40,778.9563 ms | 263.908 ms |
| 凍結事件計算總耗時（含 checkpoint 驗證） | 41,798.691 ms | 1,188.1612 ms |
| 完整有界批次（4,838 新事件，含私有 snapshot/checkpoint 寫入） | 44,072.8006 ms | 6,783.9552 ms |

純計算輸出 semantic SHA256 `49fd6272a59c3dd6ea29988bb60d1fb1a0f6aa88c3af65034312572dbc86cbcf` 與 multi-window SHA256 `a33c5b11cbe3e71103781b6b18b0748192ae248ccb6577634503f0176b4fb5ea` 修復前後完全相同。

完整有界批次使用同一 ledger 前綴、checkpoint、明示回放時間。修復前後 snapshot SHA256 `fd2e485d178978a81a36a63b66a98af4ffc348b6f91cf8daa4ebd54009431944`，checkpoint SHA256 `b4756e222989794ce41bbf79bf2ea5839c502ecb9282c18e0c5a06791e40797a` 相同；舊來源依然 STALE，並未用加速改判歷史資料為 LIVE。

CPU profile 主耗時集中於原 pressure window / reverse quote matching；改後主要剩 checkpoint canonical hashing、檔案同步與讀寫。上述是一次固定資料 A/B，不外推為全交易日 p95 或任何硬體的速度保證。

## 三次即時來源有界計算（13:35，非 resident Producer）

只讀原始 ledger，從獨立 checkpoint 副本連續計算 3 次，輸出全部寫入獨立目錄，沒有啟動另一個持續收集服務或搶原 worker lock。

| 次序 | 計算耗時 ms | 完成時來源年齡 ms | 標準 reader 判定 | lagBytes |
|---|---:|---:|---|---:|
| 1 | 5517.2275 | 5078 | LIVE | 0 |
| 2 | 5497.1546 | 5198 | LIVE | 0 |
| 3 | 5320.9509 | 6269 | LIVE | 0 |

三次在原 30 秒期限內，exit 0。品質仍 `QUALITY_INSUFFICIENT`，不宣稱未知成交分類已消失或方向可交易。只有 3 次有界運算，不是正式服務長期穩定性／全日收齊驗收。

## 研究工作臺真正接入的內容

從 PR96 exact `936c20b4939e416d25565f3c3a0947e58dfd5b13` 選取既有 research evidence UI、L5/嚴格時間契約、costed Outcome/OOS 模組及對應測試，精確整合至 PR97 主線。不是把 PR96 整條未合併分支或 PR99 全部合併。

- 首頁研究區提供 `/research.html` 真正入口。
- `/api/v1/research-evidence` 位於原正常 Session 保護之內；只接受既有 GET，沒有新模型/券商/下單路由。
- L5 僅讀既有原始帳本最後至多 1 MiB 並核對 record hash；報價品質、時間/合約/盤別不符則不可用。
- 研究結果僅讀固定私有 `research-validation/result.json`，驗證格式、內容 hash、researchOnly、formalWeight=0 與執行/下單 false。不接受 caller 任意檔案路徑。
- 頁面分別顯示讀取時間與 Flow 真正來源時間，且本機到期時清除數值。390px/1366px synthetic browser 測試包含過期與不可用，不冒充 Owner 正常帳號實測。
- 無合格固定訊號 corpus 時 Outcome/比較保持 BLOCKED/null，不填造績效。市場狀態／不追價模型與 AI 辦公室自主部門未被本次接線升格為正式上線。
- 13:46 的真實來源唯讀 probe 保留深度/Flow 不可用、Outcome 0、comparison BLOCKED 的結果，沒有把模擬測試的正向數字灌進真實頁面。

## 驗證與交付界線

回歸涵蓋：逐筆 indexed lookup 對 exhaustive reference、錯身分/未來報價/延遲接收/倒序與同時刻、發佈時鐘/TTL、hash/checkpoint parity、空值與過期 UI、Session/CSRF/logout/唯讀研究 API、桌面/手機 synthetic browser。實際最終測試及 CI 結論以同一 exact commit 的 PR 收據為準；不把 skipped 算 PASS。

沒有改正式配置／帳本／資料庫／credentials／Launcher、排程或研究權重；沒有 Broker 登入、付費模型請求、下單、Merge 或正式切換。後續部署必須獨立驗證新 exact SHA 的服務入口、Producer/Reader 身分、限定 PID 的切換/回復與 Owner 核准；不可沿用舊 PR97 的 Browser Proof 宣稱新 SHA 已驗收。
