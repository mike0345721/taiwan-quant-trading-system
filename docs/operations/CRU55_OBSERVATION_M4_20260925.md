# CRU-55 M4｜當前連續觀測段主卡交付

Owner 授權：[PR73 comment 5826936270](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5826936270)，CRU-55 最新 Owner scope。實作及真資料受測 runtime exact HEAD：`a8deb04d15b3a4360f33794b68575901a2e1491d`，基線 `d8cd6cbace0714e2e5c206b784a07d8f06f722d4`。最終文件 HEAD 與 CI 另由 PR 查收留言記錄；不冒稱文件提交又重跑 runtime。

## 實作與原 null 的原因

新主卡主要數值改用版本化 `activeSegmentObservation`，只從 reader 已驗 immutable artifact 的 lawful chart.current／relationship.current 建立。綁定 artifact、generation、projection、cutoff、實際契約／交易日／盤別／epoch／segment／origin；不取歷史末點，不做新累加器。完整契約見 `CRU55_ACTIVE_SEGMENT_V1.md`。

原 M2 DAY chart 有值而 sessionContext null，是整份來源包含第二段，觸發舊 `CONTEXT_SINGLE_SEGMENT_REQUIRED`；NIGHT21806 是 #20010 重連事件後 pending，回 `NO_LAWFUL_PHYSICAL_CUTOFF`。這兩個舊欄位拒絕原因未修改。獨立的時間異常是末筆 availableAt < sourceTime；42987 時間合法但舊 context 仍 null，已證明不能把兩者混為一因。細節與原 M2 hash/page 診斷沿用 M3 報告。

新段有 lawful current 才顯示新段 CVD；pending 清值與起點。段值資格、clock anomaly、ΔCVD 窗口、Relationship 品質各自顯示。歷史不升 LIVE、長窗不升 READY、缺值不補0、有效0保留；Session Context 面板及 Data Quality 保留舊 null 與 reason。

## 受影響驗證及沿用界線

本機 current-agent 定向測試 27/27：projection 11、observation 6、background refresh 7、targeted API chain 1、formal entry 2。先前 test temp 指向不可讀使用者根目錄的 sandbox 環境錯誤，改用 worktree 的 ignored data/test-tmp 後通過，未改 runtime 隔離規則。

Level3 三方審查：current agent＋獨立 contract reviewer＋独立 UI reviewer。兩位均對 runtime exact a8deb04 回覆 APPROVE／B=0／S=0；contract reviewer 獨立跑 projection／observation／pipeline 28/28，UI reviewer 獨立跑 projection／observation／background refresh 24/24。合成 API fixture 僅是整合測試，真登入證據另列。最終證據文件 diff 的兩位覆核與 exact engineering verdict 另回存 PR 查收留言。

| 層級 | 本輪新增 | 沿用／不宣稱 |
| --- | --- | --- |
| L0 程式／契約 | additive adapter、主卡與Data Quality；binding、pending、同盤重連／換盤、0／unknown、clock、PARTIAL、checkpoint resume | producer、core累加器、舊context/frozen語意不變 |
| L1 自動化 | 定向unit／protected API chain／formal entry／background refresh；CI另記 | M2整套Auth/CSRF既有通過，不重開安全能力 |
| L2 真資料 API | 正常acceptance→managed→full-prefix→artifact→真認證API；六窗同artifact欄位一致，舊chart/context/relationship與artifact深度相等 | 原始bytes／順序／微秒字串不改；不是mock payload |
| L3 原面板 | 同一Chrome tab，自動推進主卡／chart端點／Δ／cutoff，pending清值，新段恢復、時間異常、Data Quality與受影響layout | 三尺寸、完整登入與恢復campaign沿用M2，不重跑 |
| L4 操作候選 | 正常managed隔離3068；僅新增段觀測驗收，保全與清理身份可查 | 長效能沿用M2工程成果及歷史FAIL，未重開優化 |
| L5 正式／全天 | 無 | 正式8787未切、全天NOT_ESTABLISHED、五日計數不改 |

## 真資料查收紀錄

使用 M2/M3 已有 2026-09-18 凍結62000筆完整原始前綴，84757597 bytes，SHA256 `71a3bfb12e0270963d602c1818764b4a57eb05aa53b06272a34e446f4450a3e2`。按原bytes完整 [0,N) 追加，沒有截掉前段、中斷或不良ticks。candidate run=`candidate-perf-m4-1790314035691`，原正常managed chain；Chrome tab=`1096307659`。私人 receipt／payload／raw／PNG不提交，去敏索引存 `docs/evidence/cru55-m4/bounded-evidence.json`。

| cutoff | 新主卡＝API active＝chart current | 1m ΔCVD | 舊 context 值／reason | available−source ms | 時效狀態 |
| --- | ---: | ---: | --- | ---: | --- |
| 16930 | 51 | -1 | 51 / PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE | 36 | STALE |
| 17042 | 56 | 4 | 56 / PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE | 24 | STALE |
| 17183 | 54 | 2 | 54 / PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE | 121 | STALE |
| 21806 | null | null | null / NO_LAWFUL_PHYSICAL_CUTOFF | -401 | UNAVAILABLE |
| 42987 | -40 | -38 | null / CONTEXT_SINGLE_SEGMENT_REQUIRED | 495 | STALE |
| 60000 | -53 | -7 | null / CONTEXT_SINGLE_SEGMENT_REQUIRED | -303 | UNAVAILABLE |
| 61000 | -24 | 15 | null / CONTEXT_SINGLE_SEGMENT_REQUIRED | -349 | UNAVAILABLE |
| 62000 | -44 | 3 | null / CONTEXT_SINGLE_SEGMENT_REQUIRED | -264 | UNAVAILABLE |

第一段 identity=TXFJ6／2026-09-18／NIGHT／TX:1，origin #29（00:00:01.154）；第二段 identity=TXFJ6／2026-09-18／DAY／TX:2，origin #21810（08:45:00.017）。pending 的新欄位 origin／identity／lastTrade 均 null。末筆 available−source 依產品毫秒精度，原微秒字串完整保留。

每個 cutoff 的六窗 API 都綁同一 artifact、相同新段 scalar／origin；原 chart、context（排除動態freshness）、relationship 與 frozen artifact 深度完全相等。前三個 artifact hash 與 M3 完全一致，直接證明新欄位沒有重写既有產出。第二段合法來源時鐘42987也能在主卡呈現，舊context仍null。

16930→17042→17183與60000→61000→62000均在原同頁自動推進，不重新登入或reload。六窗API均檢查；另用原UI切4h再回1m：42987的4h Δ=-40仍PARTIAL，段累積=-40不變。42987的1m觀測時長完整但分類品質不足，原presentation保持PARTIAL／證據有分歧；60000/61000的1m窗口READY不提升整段品質；62000的1m仍QUALITY_INSUFFICIENT／PARTIAL。三個時鐘異常仍回UNAVAILABLE／資料年齡未知，段值資格另列可顯示。圖表四pane、K/Volume/VWAP、Fast Scan、多窗表與原背景模組保留；Data Quality同時顯示新契約與CONTEXT_SINGLE_SEGMENT_REQUIRED。

已檢視17183主卡／曲線、21806 pending、42987第二段恢復、60000／62000異常clock畫面。受影響layout在實際1745×819 viewport檢查無水平溢出、主卡文字無裁切、全部12px；未另設三尺寸重測。browser error/warn紀錄為空。正常初始publication及未產生DAY時503保持fail closed，完成驗證才顯示。工具locator因原頁持續換DOM逾時，改用已觀察的可見Fast Scan正常点击確認切換，未改前端refresh語意。

同段重啟不重設：新增checkpoint序列化resume與API reader重建／source追加測試確認scalar與origin不變；原M2正常managed process恢復證據沿用，producer並未修改，本輪沒有重開恢復campaign。新欄位無持久化累積狀態，讀同一artifact即得到同一段起點。

runtime CI：[36098816156 SUCCESS](https://github.com/mike0345721/taiwan-quant-trading-system/actions/runs/36098816156)。最後文件commit另跑CI並讀回，連結在PR交付留言。

原凍結檔hash與候選最終62000筆完整bytes相等。隔離3068 reader/writer依PID、start、command、HEAD、binding、port核對後停止，所有raw/output/log/owner證據保存；正式8787唯讀仍e81c5259…、binding=null。私人畫面位於data/test-tmp/m4，交付索引只有去敏數值／長度／hash。


## 本機整版更新與停點

`CRU55_LOCAL_UPDATE_DECISION_20260925.md` 已更新：主卡語意已批准且完成，正式source起點推薦D日原始byte0／ordinal1；具體觀察D日09:00–09:45、15分鐘暖機、連續5分鐘積壓／停更退出；完整性或collector受阻立即退出。以上操作推薦待正式啟用exact gate，歷史效能FAIL不重標。

整版更新須保存上一正式 `e81c5259b5e38db6ad573242e9cf1ee4f305207f`／無binding，核准後依Git完整版本同步，不逐檔複製；新binding／outputVersion與source保護proposal需對應批准main。PR72仍不能套正式8787。回退只停止可驗本次reader/writer，恢復上版與原設定，保留全部失敗output／logs，不動raw、SQLite、collector、排程或五日證據。

停在候選查收；PR73未Merge／正式未啟用，CRU55 In Progress。安全旗標固定0／true／false／false。
