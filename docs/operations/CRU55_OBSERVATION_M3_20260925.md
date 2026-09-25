# CRU-55 M3｜定點診斷與真資料正向補證

回應 [GPT M2 查收 5826101660](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5826101660)。沿 PR73，同一工作包。此次只新增文件與去敏證據索引，沒有修改 runtime、原始資料、分類、single-segment 或 frozen 語意。

受測 exact runtime：`1d0bc254547dadd35988a73c082ef2eaa92b2de3`。與 M2 runtime `ef8f0c16e45df5abfad67749de1dc2dedfb156b8` 的差異僅三份交付文件；執行程式相同。最終文件 commit 不冒稱另一次 runtime 測試。原 M2 登入／三尺寸／恢復／效能成果沿用，沒有重跑。

## 原 M2 為何有圖線但 context null

直接重讀原 M2 83 份證據並核對 bytes／SHA256 全數一致；從其 ingest head 沿 previousPageHash 讀取 486 個實際封存頁並核對內容 hash。範圍僅既有 2026-09-18、62000 筆 frozen prefix，未掃描其他 D 槽來源。機器可核對摘要：`docs/evidence/cru55-m3/bounded-evidence.json`。

| M2 cutoff／盤別 | chart.currentCvd | context scope／reason | context累積 | 1m ΔCVD | 末筆 available − source（ms） |
| --- | ---: | --- | --- | ---: | ---: |
| 60000 DAY | -53 | UNAVAILABLE／CONTEXT_SINGLE_SEGMENT_REQUIRED | null | -7 | -303 |
| 61000 DAY | -24 | 同上 | null | +15 | -349 |
| 62000 DAY | -44 | 同上 | null | +3 | -264 |
| 42987 DAY | -40 | 同上 | null | -38 | +495 |
| 21806 NIGHT（上述各份 API 相同） | null | UNAVAILABLE／NO_LAWFUL_PHYSICAL_CUTOFF | null | null | -401 |

差值依產品 Date.parse 毫秒精度；原始微秒字串保留於私人資料，未改寫。日盤四個 1m 窗口 complete=true，但不把數值存在等同整個品質 READY。

**context 原因：** 第一段從原始 ordinal **29** 開始，identity=`TXFJ6 / 2026-09-18 / NIGHT / TX:1`。**20010** 的 `futures_reconnect_resubscribe_started`（products 含 TX）首次觸發連續性中斷；20011／20012 TX quote-type 重訂閱再次保留中斷。這是 canonical 明列的 continuity event，不是從時間差猜測。

NIGHT 的實體 publication cutoff=21806，最後成交仍是19850；checkpoint 明確 `pendingSegment=true`，`snapshotInvalid=false`、`epochLineageInvalid=false`、`contextInvalid=false`。所以 finishProjectionJob 的第一個拒絕條件 `!valid` 成立，回傳 NO_LAWFUL_PHYSICAL_CUTOFF。21806 本身是 MTX quote，不是該筆 quote 的價格或時間造成失效；在它之前已經中斷。chart current 也為 null，不能把保留的歷史曲線末值當 current。

21807 是新日盤 TX quote，**21810** 新日盤 TX trade 才建立第二段，identity=`TXFJ6 / 2026-09-18 / DAY / TX:2`。此後 segmentCount=2、active index=1。60000／61000／62000 checkpoint 的 pendingSegment、snapshotInvalid、epochLineageInvalid、contextInvalid、displayClockInvalid 均 false，實體 cutoff 合法；接下來 `segmentCount !== 1` 明確拒絕 context。42987 API 同樣回報 SINGLE_SEGMENT，segment=1；不是缺少日盤觀測值，也不是 API 接錯 artifact。

chart 使用當前有效段，按 AVAILABLE_AT 繪製；context 則遵守 CRU54 Session Context V1 的整個輸入 single-segment envelope。兩者資格不同。不能把第二段 chart 末值塞入 context，或重置 segmentCount 來通過。

**時間原因另列：** 60000／61000／62000／NIGHT 的原始末筆 availableAt < eventTime，使 presentation 回報 TRADE_CLOCK_ORDER_INVALID／資料年齡未知。這不是上述 context 拒絕式的原因；42987 的 +495ms 是直接反例：時鐘合法，context 仍因多段而 null。frozen canonical 可容許原本的 local-clock skew；價格端點與 presentation 年齡另外採更嚴格時間條件，不能互相替代。未推定是主機或 vendor 哪方時鐘錯誤，亦未做校時或回填。

## 同版真資料正向與接續更新

沿用相同 frozen 62000 筆／84757597 bytes／SHA256 `71a3bfb12e0270963d602c1818764b4a57eb05aa53b06272a34e446f4450a3e2`。既有封存頁指出重連前有合法末筆時鐘，故採完整原始 **[0,16930) → [0,17042) → [0,17183)** 前綴，只按序追加原 suffix，沒有抽掉中間不良 ticks、移動起點或重寫 bytes。

正常 acceptance → managed launcher → STREAM_PAGED_V2 → FULL_PREFIX_BEFORE_PUBLICATION → immutable artifact → 原認證 API → 原總覽；隔離3068，專用私人憑證。首次 sandbox 啟動因 Git worktree owner 不同被拒；改用原使用者執行同一正常 launcher 後成功，未修改 Git 信任設定或 runtime。初次發布前503保留；不是長效能重測。

| cutoff | API context＝主卡＝chart末端 | 1m ΔCVD | 1m 品質／parity | available − source（ms） | artifact 前12碼 |
| --- | ---: | ---: | --- | ---: | --- |
| 16930 | +51 | -1 | READY／EXACT | +36 | 1f7882c98eb3f |
| 17042 | +56 | +4 | READY／EXACT | +24 | 7c25ecc29845 |
| 17183 | +54 | +2 | READY／EXACT | +121 | bedd5b434d9b |

共同 identity=`TXFJ6 / 2026-09-18 / NIGHT / TX:1`，segment=0。累積起點 ordinal29／00:00:01.154；三次末筆分別00:16:21.275、00:16:28.711、00:16:37.569（Asia/Taipei）。scope=OBSERVED_SEGMENT_TO_NOW，baseline=accepted pre-first-trade zero；並非完整夜盤。

1m 是末筆 eventTime 的 `(t−60s,t]`，完整窗口且 frozen pressure／ΔCVD parity EXACT；不是相鄰 publication 累積相減。圖中 ΔCVD 已驗端點依序累積為 [-1]、[-1,+4]、[-1,+4,+2]，重疊柱不得加總。Session Context 舊欄位的 ΔCVD=+51/+56/+54 是起點到現在的段累積，與主卡「1m ΔCVD」的範圍不同，非矛盾。

三次 API chart/context（排除動態 freshness）與同 artifact 深度比對、內容 hash、head、originalRawPrefixVerified 全通過；chart 曲線實際最後一點等於 context。Chrome 同一 tab **1096307653** 未重載或重登入，追加後原頁自動更新。DOM 的 artifact/head/endpoint/delta、主卡 cutoff／數值與 API 對照通過；已檢視真實圖表與主卡截圖。沒有重做三尺寸。

**可用：** 觀測段累積、合法1m ΔCVD、圖表已驗端點、同頁接續更新。**仍受限：** context 分類覆蓋不足（UNKNOWN volume=7），context quality=QUALITY_INSUFFICIENT／relationship 證據有分歧；5m及更長窗保留 PARTIAL；captureCompleteness=UNPROVEN、sessionStartProven=false、歷史 STALE。1m READY 不提升整段品質，不宣稱 LIVE 或全天可用。

結論：V1_POSITIVE_DATA_USABILITY 的有界正向案例已補齊；不能說現有資料完全沒有合格案例。日盤多段與重連後 current-context 的限制仍存在。若 Owner 要求跨段後仍顯示新段主卡，最小後續選項是**另定明示 active-segment context 範圍的新版本**，保留舊 context/null、identity、origin與原始前綴；這會觸及 frozen envelope，尚未實作／未默認批准。本輪不需該語意改動即可交付正向證據。

## 交付、操作建議與停點

具體 source 起點、45分鐘受控觀察與回退條件已補入 `CRU55_LOCAL_UPDATE_DECISION_20260925.md`。這是待批准操作推薦，並非改歷史 SLA，也非本輪正式切換。

驗證為本輪定點 API/artifact/DOM assertions、83份M2 hash、486頁hash與文件 diff check；runtime 未變，未重跑單元／登入／恢復／responsive／長效能套件。文件 Level1 current-agent review，無新 runtime engineering APPROVE 宣稱；沿用 M2 工程認列。

本機證據在候選 worktree `data/test-tmp/m3`，索引只回存去敏數值、檔案長度與 hash；raw、API完整payload、PNG、憑證及 Session 不上傳。cleanup 依 PID/start/command/HEAD/binding/port 核對後只停止本次3068 reader/writer，關閉本次tab，保留全部證據。清理後唯讀8787仍 `e81c5259b5e38db6ad573242e9cf1ee4f305207f`、binding=null。

原效能 FAIL、全天 NOT_ESTABLISHED 保留；CRU55 In Progress／PR73 Draft／未Merge。未改 collector、raw、SQLite、排程、五天計數、PR72。安全：formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false。
