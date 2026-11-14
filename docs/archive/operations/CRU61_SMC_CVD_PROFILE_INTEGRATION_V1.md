# CRU-61 勢衡三模組整合 V1

Owner 2026-11-04 授權的候選工程；以 CRU-61 最新描述／評論與 PR109
`356d49500229410e826039672e16b0a36e2a0edf` 實際程式為起點。
原根目錄未提交研究報告、原 PR109、正式服務、來源資料與證據均保留。

## 可獨立驗收的每日修補

每日使用版基線仍是 PR109 的 356d495。新修補獨立 commit
`e1ce4f2583c5a7ba9affa378441f41ce6da9e478`，先排空跨午夜舊檔尾端，再切新檔。
48 項相關回歸通過，獨立來源審查無阻擋。詳見
`CRU61_CALENDAR_TAIL_DRAIN_V1.md`。未恢復歷史漏讀資料，亦未將兩個 GENESIS
冒稱同一條已證明連續串流。入口 TLS／原生預檢、每日 batch 的原有資料品質缺口、
真實新版本冷啟／手機遠端／正式部署仍分開驗收。

## 使用位置與操作

沿用原 Dashboard 同一工作區，在 Evidence Detail 前展開「SMC＋CVD＋成交量分布」。
API 為已認證的 `GET /api/v1/market-observation`，不另啟服務、行情收集器或 AI。

1. 選 1m／5m／15m／30m／1h／4h；SMC 使用該週期已確認 K，CVD 起點不隨週期重置。
2. 開關 SMC、CVD、成交量分布；滑鼠／觸控或左右方向鍵移動共用游標。
3. 讀取位置、成交力道、結構、反證及資料狀態；選事件查看接近／測試／確認後窗口。
4. Copy 使用畫面同一 snapshotId。原 Copy for ChatGPT 另附清楚標明身分與 cutoff 的觀測區塊。
5. 「記錄此事件」把同一伺服器快照鎖入原手動日誌，預設 NO_TRADE；使用者核對後儲存。
   Review／Outcome 沿用既有 recordHash 鏈，原始快照不覆寫。

這是原程式中的功能接線。沒有安裝或啟動新版本入口，舊網址不代表本版已部署。
本機可開啟的歷史 replay HTML 只屬驗收工件，不能當成正式看盤服務。

## 共用資料契約

- 同一 actualContract、tradeDate、DAY/NIGHT、continuityEpoch、sourceLedgerIdentity、cutoff。
- LIVE 只讀既有 Producer checkpoint 的 canonical 成交／報價片段。先驗原始 canonical bytes/hash，
  最多保留 20,000 筆起始事件，原 checksum 與縮減副本 checksum 分開保存。
  只累積新 physical ordinals，不相加重疊 Flow 窗口。
- CVD 沿 CRU50 已查收核心的 CRU54 實作，與 CRU34 共用分類及 quote eligibility。
  BUY_PROXY／SELL_PROXY／UNKNOWN、coverage、conflict、起點、reset reason 均保留。
- Provider 的合法十進位字串與本地時間在 adapter 明確正規化，保留來源字串／hash；
  null、空白與非法值不轉為零。原 classification／品質門檻不改。
- SMC bars 由同一合法 tick 片段建立。下一根成交首次證明前根已關閉時才可確認；
  保存圖形 anchor、nominal close 及首次可知 availableAt。遲到 tick 不改寫已確認 K。
- 事件 approach 是觸發 K 前三個週期；test 是觸發 K 的 eventTime `[start, close)`，
  且 availableAt 不晚於事件首次可知時刻；發現收 K 的下一根 tick 不計入 test。
  after 從首次可知時刻開始，最多三個週期，仍受目前 cutoff 限制。
- 本盤 profile 是已觀測片段；價格 bin=1、VA=70%、POC 同量取低、價值區相鄰擴張同量先低。
  VAH 是不包含的上緣。HVN/LVN 規則與 FVG/OB 失效詳見
  `../research/CRU61_STRUCTURE_PROFILE_RULES_V1.md`。
- 沒有獨立完整盤證據時，上一完整盤 profile 明示 unavailable；不以 OHLC 均攤成交，
  不把 EOF 當捕捉完整，也不把 profile 當持倉／主力成本。
- 共用價量證據不是三票；四種情境只輸出候選描述。沒有 BUY/SELL、勝率／信心分數或機構身分推論。
- 原始 physical prefix 保存有界的失效區間；重連恢復不抹除先前未知，第二次失效不污染已恢復的歷史。
  重連後時鐘倒退的整個連續段隔離，不讓新資料落入較早快照；須新的合法連續段才恢復。
  Producer 冷快照沒有歷史 noncanonical 紀錄，不能證明所有舊失效時刻；跨 epoch 未證明區間
  回報不可用，並保留 `PRODUCER_NONCANONICAL_HISTORY_NOT_RETAINED`。原始全量／增量一致，
  不等於這種不完整冷快照與完整 raw history 等價。

## 資源與故障邊界

仍使用原圖表 worker、8 秒請求期限、256 MiB V8 old-generation 上限、單一 active／單一 queued。
health 只 peek 原快取。Producer 原檔最多 96 MiB，私有快取最多 64 MiB，最多兩個 resident sources。
冷驗證與推導可分次完成，pending 明示，不延長期限掩蓋真實超時。
物理 source 只讀；derived checkpoint 存在既有 chart cache 子目錄。
重啟驗證、ordinal/hash overlap、source/identity/continuity 切換均有明示結果。
CVD 保留原 250k history／25k quote 上限，整合最多 250k trades／2k minute bars；
達上限回報 unavailable，不悄悄重置觀測起點或補造缺值。
圖上 CVD 為每分鐘最後可知點，最多 2k 點；摘要仍用同一累積值，最近 100 個事件供互動與日誌。
UI 價格最多 400 根、profile 最多 2k bins；超出時優先保留可見價格範圍並明示顯示／來源數量。
單模組不足／資料過期不阻擋原首頁與價格圖。

## 固定比較與資料限制

`market-observation-ablation.mjs` 凍結 BOS／CHOCH／sweep 事件 cohort、首次可知後下一根可用開盤、
五根 K 觀察期、4.11 點成本。A 僅結構；B 加 profile 邊緣；C 加同向且完整分類 coverage 的 ΔCVD；D 同時符合。
輸出成本後期望值、事件順序回撤、N、保留比例、濾掉虧損／好機會與未完成 outcome。
這是獨立事件的模擬成本假設，重疊事件回撤不是實際資金組合回撤，也沒有成交／滑價證據。
本版不讀 9–10 月保留集；CLI 僅允許已指定的 11 月檔。參數在讀價格前寫入新的 frozen-spec 工件。
不足樣本回報不足；fixture 數值不可作績效。

## 驗收分界

| 面向 | 可驗證成果 | 不代表 |
|---|---|---|
| 每日修補 | 獨立 commit、尾端排空與既有 Producer 回歸 | 正式換版／既有歷史資料已修復 |
| 候選工程 | 三核心、API／UI、Copy／Journal／Outcome、固定比較 | 所有真實資料合格 |
| Fixture | 全量／增量／重啟、量守恆、prefix、失效、桌機手機互動 | LIVE 或策略績效 |
| 真實歷史 | 指定 NIGHT 原始 prefix、DAY 已驗 Producer 片段 | 完整盤／當時在線 UI／OOS |
| LIVE | 原來源可讀性／實際 cutoff、過期及盤別檢查 | 正式部署或長期穩定性 PASS |
| 策略有效性 | 未建立；不提升權重 | 可交易策略 |

最終同版測試、CI、證據 hashes、事件案例與尚未通過的項目在本機
`data/cru61-integration-20261104/` 的交付收據及 PR 中列明。
`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`；AI 維持關閉。
