# CRU-21｜勢衡 V2 開市前整合候選與 10/27 驗收計畫

**地位：隔離預備候選（SOURCE_ONLY / NOT_FORMALLY_DELIVERED）。** 不等於 Owner 真實行情驗收、正式 Merge、啟動、回復已測試或交易授權。此文件不改變任何現有安全治理。

## 1. 本輪真正整合的 P0 功能

- 候選基礎為 PR #94 exact c7cf3e77f543cbeda85fca5270d8a4ade1130472；它已沿完整 Git ancestry 包含 PR #86 統一工作臺、#87 當下觀察/R:R 條件、#91 已認可的桌面/手機 UI、#93 正常認證預覽入口與 #94 臨時休市/安全啟動邏輯。
- 本分支 codex/cru21-preopen-integrated-candidate-20261023 只新增**自身精確預覽入口**（限 127.0.0.1:18722、固定 SHA、乾淨樹、認證、LIVE-source identity），不新增券商/模型/下單路由、不改正式埠。
- P0 UI 與閱讀鏈：K 線／成交量、六窗 Flow、價格觀察、資料品質，休市與過期資料都不升格為合格當下訊號。Research Desk 保持 truthful status card；不將研究結果標為 live EV。
- 台灣 2026-10-23 颱風休市證據採 PR94 的**候選限定**分離雜湊 overlay。凍結年度交易日曆、10/22 夜盤歷史身份、真實行情帳本不改寫。10/26 既定休市；10/27 預定交易日，仍需查核最新公告。
- PR #89（TWSE 官方夜盤現貨收盤值）、PR #90/#92/#95/#96（L5、Outcome、OOS/研究頁）**維持獨立候選**，不是本次每日可用工作臺 release blocker；正式接入任何一條都須另有來源和身份驗證、審查與授權。

## 2. 目前最大實機阻擋：開機 launcher／Dashboard SHA 不一致

2026-10-23 夜間 MSI 實際只讀核對：
- 已有 bound-daily-use binding 檔 SHA-256：1389729446C1AF16D39BF9E94494E58ADA47E447E10444F5CDC383F584AFC9D8。
- launcher 應為 e52dc6745fe6c568a946bff3e924619a69112ef4，實際相符。
- Producer 應為 2e4c89e2dbf465bd0703d99b98e30ee83fa0267b，實際相符。
- Dashboard 應為已核准 main 4d8251686bdb4abbdb469bc00ae798717c0fd583，但原 binding 指向的執行樹實際 HEAD 為 9e176ebefb52e0f961b25d7cfb7dd590eca4b740。**MISMATCH**。
- 已批准 runtime 的獨立路徑仍有 4d8251686bdb4abbdb469bc00ae798717c0fd583。本輪只提供版本對照與安全方案，不把 binding 指向新未合併分支、**不改原捷徑、排程、檔案或執行中程序**。

必須以不同於本研究工作樹的部署流程處理：保留現場／帳本／憑證，辨認並核對原 Launcher/Producer/Dashboard 的正式 SHA 和 read-root；生成可還原的**完整新綁定與精確 CheckOnly**，先對已批准版本驗證可用性；若要正式切到新版，需 Owner 另行批准 exact head／影響範圍／回復方法。不可直接改舊 binding 的一行版本來繞過安全 gate。

## 3. 開市前可獨立完成的工程門檻

- GitHub：本候選 exact HEAD 的 CI SUCCESS、獨立非作者 review、未解 P2/Windows 原失敗範圍真實標示，不因個別重跑 PASS 隱藏 full Windows FAIL。
- 源碼一致性：本候選分支從 PR94 exact head 往前，approved main 為祖先；沒有額外研究代碼、Bridge/Producer修改、模型或交易行為。
- 正常 UI：休市、來源已過期、合法缺值、正常認證、Session/CSRF、PC/手機選 Flow／K 線與目前 PR94 時間/合約/收盤來源差異；原 PR94 的 normal-auth 關閉市場實機驗收可追溯，但需**此 exact head 新收據**才能宣稱完整候選驗收。
- 資料治理：正式開市前不該要求 TX/MTX/TMF 新 Tick；休市不誤觸重訂閱或啟用下單。真實來源不可用時保留 unavailable 原因，不以歷史收盤代替成交 Tick。
- 支援只讀自檢（在本分支提交、同步後執行）：
  node scripts/check-cru21-preopen-readonly.mjs --expected-head <本候選完整 SHA>
  只查 Git HEAD／分支／乾淨工作樹／兩個祖先、2026-10-23/26/27 治理日曆與候選身份；不向券商或模型連線、不寫任何資料。SOURCE_PASS **不是** LIVE_PASS。

## 4. 10/27 當日唯一新增的正式驗收需求

前提：交易所當日沒有新停市公告，實機網路、遠端和正式排程符合 Owner 已授權範圍。

- **08:15–08:35**：核對 MSI 時鐘、Remote、磁碟、launcher exact SHA，正式 8787／隔離候選 18722 及現有 Bridge PID/來源；只對已授權程序採用既定預檢/啟動，沒有授權不得自行修改或重啟。P0 Forward 離線/錯過起始仍留下 MISSED，不能補造。
- **08:45 後**：唯讀 Shioaji TX/MTX/TMF Tick + BidAsk 依 actualContract、session、tradeDate 各自增量；provider ACK 不算有行情。比對 source exchangeTime/receivedAt/availableAt、序號缺口/重複/clock skew、資料寫入尾端及 Producer 可追溯合法快照；不能以舊快照或假資料代替。
- **09:00 後**：在同一 exact HEAD、受正常認證保護的隔離候選，四路 API/真正 Chrome 畫面，K 線有正確來源和量、六窗 Flow 數值與品質、Market Pulse 日/夜盤語義、R:R 可用條件。若資料分類覆蓋不足，明示 UNKNOWN/UNAVAILABLE，不假設品質 PASS。
- **正向＋反向測試**：正常開市真 Tick 正向與行情中斷、缺價、換月/不合約、錯日期、過期/品質不足、登入到期／CSRF、窄版顯示等反例；不允許模型自行發送或多次重登入。
- 如有任何 fail，保留真收據，不修改已凍結研究、原 raw ledger、手動回填缺口、偽造來源時間或為了通過調低門檻。

## 5. Merge 和正式部署是兩個不同門檻

1. **工程 Gate**：整合 exact CI、獨立 review 0 blocking、版本/API/UI 保護、Windows 受影響失敗已可解釋且不隱藏、rollback plan 已確認。
2. **產品 Gate**：10/27 真正市場 Tick/BidAsk → ledger → Producer → authenticated API/UI 連續且方向資格誠實、Owner 親眼驗收。
3. **Owner Gate**：核准**特定 SHA、合併順序與正式部署/回復方案**；PR stack 的 base 依賴依次合併，不把未審 research PR 混入。
4. **營運 Gate**：正式 8787 更新要由既定版控/受監督 launcher 做完整切換並保存真實 rollback receipts。單單 GitHub MERGED 不是已切換正式 MSI。

正式允許以前執行授權均為 false，formalWeight=0；不得開 TXO/CVD 新訂閱、Broker Order API、Blave 付費 API 或背景 AI 模型請求。PR #89 夜盤/資料稽核三個歷史日期、P0 Forward Paper 的五日與二十日門檻仍列為**未完成**，不拿 UI 交付偷換成全面系統交付。

## 6. 可再現的待辦與不能誤稱事項

- 本次 Git 分支原始 base = c7cf3e77f543cbeda85fca5270d8a4ade1130472；本候選的 full SHA 必須以實際提交後的 git rev-parse HEAD 回報。
- PR94 曾有一條 GitHub P2 審查討論未標記 resolved。修正已在 base 內且附綁定日曆回歸測試，本候選仍必須取得獨立審查與結案證據，不可把 PR 預填「APPROVED」當真正審查。
- 原 PR94 Windows full lane 曾記錄 1 FAIL／1 CANCELLED；後續獨立重跑 PASS 不等於原 Windows 全套 PASS。任何新失敗保留。
- MSI 正式/候選目前均未聽 8787/18722，Bridge 8790 也未監聽。休市不代表這些程序已有健康驗收。不能宣稱候選服務已發布為網站。
