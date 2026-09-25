# CRU-55 Observation V1｜M2 工程交付

接續 GPT M1 comment [5825561529](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5825561529)。單一 lane：PR73／codex/cru55-cvd-performance-v1；baseline `6fc1fa4524b2049b3d4af8ac650bb05acc849d44`；受測程式 exact HEAD `ef8f0c16e45df5abfad67749de1dc2dedfb156b8`。交付文件提交之後的最終 SHA 由 PR 收據記錄；不得將文件提交冒稱重新啟動過的 runtime。

## 變更

主卡與頁首將舊 latencyMs 命名釐清為 observationAgeMs／「距最後成交／觀測資料年齡」，計算仍取最後成交 source／availableAt 到目前的較大值，quote／publication 不重置。「本次處理延遲」明確標示未量測，不能拿資料年齡当 append→API 耗時。

中文呈現缺時鐘、未來時鐘、逆序時鐘與 CVD 證據不可用原因；代碼保留於 title 及 Data Quality 明細。null 與 0、pinned 歷史來源、上游 STALE／UNAVAILABLE、不完整窗口與六窗數值語意不變。驗收發現展開右欄會把左圖拉高，僅以 align-items:start 解除拉伸；保留原圖表高度與 responsive 規則，未重做 UI。

## 同一完整候選路徑

完整 server.mjs → start-cru55-acceptance → 正常 start-cru55-managed.ps1 → STREAM_PAGED_V2 → 完整原始前綴驗證 → immutable artifact → 原認證 API → 原總覽。候選使用原 scrypt／Session／CSRF 後端與新私人候選密碼，**不是使用正式密碼，也不是 mock auth**。未認證401、登入200、無CSRF登出403、有CSRF登出200；瀏覽器由登入表單進入。同頁 reader 停止後清空 artifact／CVD／四圖层，正常入口重啟後以原持久 Session 恢復，不要求重新登入。

合法既有 frozen 前綴來自已驗2026-09-18資料：62000筆、84757597 bytes、SHA256 `71a3bfb12e0270963d602c1818764b4a57eb05aa53b06272a34e446f4450a3e2`。只複製並按序追加原 suffix；不改 receivedAt、source time、順序或原始bytes，不補造當日行情。私人 manifest／provenance／完整內容 hash 和已接受的6fc1 exact reconstruction證據沿用；未重跑無關效能測試。

3066 主驗收由新 output60000 起步，預先 attested stages60000/61000/62000；原 tab `1096307631` 保持，完成多次 cutoff 推進。首次發布前503保留；不是全程HTTP200，也不重新宣稱冷啟動速度 PASS。初次 bf05593 的26000前綴反例及布局圖亦保留，不能算作最终ef8f0c1验收。

每個時點 DAY／NIGHT × 六窗以真正登入取得API，完整 chart（除動態freshness）、context（除freshness）、relationship、handoff逐項與相同 immutable artifact比對，artifact內容 hash、originalRawPrefixVerified與exact HEAD核對。六窗原總覽再比數值、artifact、cutoff、品質、年齡和原因，不用畫面截圖取代數值核對。

驗收JSON中的 pass:true 僅代表HTTP／資料一致性路徑成功，不是資料品質READY、LIVE或全天PASS。

**真實資料限制必須明示**：60000／61000／62000末筆 TX 成交 availableAt 早於 sourceTime，卡片的年齡為未知、TRADE_CLOCK_ORDER_INVALID；session context cumulativeCvd為null時維持不可用。原圖表可展示已驗觀測曲線及合法K/Volume子集，不能將圖線末值補成完整session累積。原NIGHT21806同樣有時鐘異常。這些不是LIVE，資料處理路徑成功不等於證據品質READY。

自然老化補充使用另一个正常managed候選3067、同exact HEAD、真實原始前綴42987（source1789692603003，available1789692603498，未修改時間戳）。同artifact年齡從612410571ms增加到612447244ms；取樣相隔39895ms，差異包含5秒UI更新節奏。切1m→5m仍沿用原時鐘，年齡612527279ms，不重置。session證據仍不可用，所以state維持UNAVAILABLE，不能把數字年齡存在當資料品質PASS。

瀏覽器控制工具在切其他頁後仍回報visible，純工具hidden觀測 **NOT_VERIFIED**。Owner依指示親自切其他分頁約10秒後切回，回覆「以切回」；同頁讀回visible、相同artifact/cutoff與持續增加的612652269ms。此項為 **OWNER_ASSISTED_TAB_RESTORE**，不是自動化直接觀察hidden；visibility事件立即重算的精確時序仍由既有單元測試支持。歷史樣本不改成當日資料來製造LIVE→DEGRADED→DELAYED→STALE；邊界轉換由focused tests涵蓋。

## 實際 CSS 與原功能

實測 innerWidth/innerHeight：1920×1080、1536×864、1366×768。devicePixelRatio=1.100000023841858，CSS zoom=1、visualViewport.scale=1；scrollbar使visualViewport width較innerWidth小，原始值已保存。使用2112×1188、1690×950、1503×845覆寫取得上述實際CSS尺寸；不把requested override當成CSS，也不猜測browser UI zoom為100%。三尺寸真資料截圖均保存並檢視，無水平溢位或核心圖層遮擋；完整右欄及下方背景可正常垂直捲動，不宣稱全部內容在首屏。

最初 fullPage PNG 被瀏覽器截圖工具裁切，獨立複核發現後保留為反例；交付 PNG 改用 fullPage:false 的完整 viewport 捕捉，對應62000的viewport DOM量測。DOM幾何與截圖分開核對，不以被裁切圖宣稱視覺PASS。

真資料總覽四pane、合法K/Volume、觀測CVD／ΔCVD、六窗Fast Scan、Data Quality明細可用。相同Session開啟原workspace的Market Pulse、Observed Flow及Data Quality入口；隔離入口未啟用正式bridge／CRU34 live，保留來源不可用原因，不能宣稱這些來源已做正式live驗收。原HTML和認證邊界的既有回歸沿用。

## 工程審查與回歸

M2 focused observation6＋background7=13 PASS；formal-entry／preview／context／dynamic／production-closure／tx-chart共28 PASS，41 unique。CSS修改後受影響入口／preview12 PASS（重複子集，不另加為unique）；syntax、秘密掃描、diff check PASS。

两個獨立審查 context 對 ef8f0c16e45df5abfad67749de1dc2dedfb156b8 均 APPROVE、B0/S0；各自前輪15項focused PASS，CSS re-review未重跑不受影響測試。獨立審查是程式碼範圍，不冒稱審查者親自操作本機瀏覽器。整版更新／回退決策包另經獨立唯讀審查 APPROVE；same-SHA但binding不符需受控reader重啟的註記已納入。runtime SHA 的CI185／run36087202707 SUCCESS；最終文件SHA的CI及遠端讀回見PR收據。

另由獨立context直接核對API/DOM及三張补拍PNG，證據範圍APPROVE；另一context核對有效時鐘數值、Owner協助恢復收據及限制措辭，bounded evidence APPROVE。兩者不代替Owner產品核可。圖像與DOM表格支持實測範圍，並非所有來源已可用。

## 決策與停點

另附 `CRU55_LOCAL_UPDATE_DECISION_20260925.md`，包含整版版本／依賴、source／data-root／junction身分、必要binding/writer、正常啟動、collector非干擾與rollback。PR72隔離更新器不支援正式8787；需exact Merge與正式啟用最小差異決策。此輪沒有正式切換。

保留6fc1歷史效能 FAIL（API p95/p99 114.250/126.632秒）、自然全天NOT_ESTABLISHED，不做A.2、PlanB、SSD或新功能。PR73保持Draft／未Merge、CRU55 In Progress，交GPT與Owner真實畫面查收。工程交付不替代Owner acceptance，不把isolated歷史前綴等同日常持續使用。

Safety：formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false。正式8787仍e81c5259b5e38db6ad573242e9cf1ee4f305207f、cru55Binding=null；collector/raw/SQLite/排程／五天計數未改。私人raw、credentials、DB、Session與runtime狀態不上傳；公開只保存無秘密的摘要與證據hash索引，真實截圖留本機供Owner核對。

驗收完成後，依PID/start/command/port/HEAD/binding核對並停止兩組自有candidate reader/writer，保留全部輸入、輸出、logs及owner證據；瀏覽器測試頁關閉、暫時viewport override重設。cleanup後唯讀8787仍為上述原版本與無binding狀態。implementation/reviewer採本session既有路由，無模型降級；工具未獨立公開實際模型及reasoning設定，不臆填型號。
