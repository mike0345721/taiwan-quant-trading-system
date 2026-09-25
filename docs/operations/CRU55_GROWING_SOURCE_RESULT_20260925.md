# 現版早盤成長來源一次實測｜2026-09-25

依 [Owner／GPT 5833535445](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5833535445) 與 CRU-55 最新授權，完成唯一 campaign 並依量測器失真停點提前結束。**PREPARATION_OR_MEASUREMENT_INCONCLUSIVE；未完成30分鐘，不認列產品PASS或持續承載FAIL。** 本次不足以放行日常使用，也沒有新增足夠證據支持7–11工程人日批次提交整包投入；維持不建議整包施工，不串接盲修或自行再測。

### 執行與停止事實

- 實測 exact **6e0c6d913ea22854f5c8d6d74e357e7e229b110d**，與 e321c874 的產品 src/scripts/public/package/lockfile 無差異；僅新私人 helper、來源與output。PR73 Draft/unmerged，正式8787未切換。
- 固定R1凍結9/24來源，全檔1,510,562筆／2,074,014,548B，full SHA256沿原收據。準備49.364秒（上限600秒），起始byte0完整前綴31,322筆／42,903,318B。沒有重做M4／盤點／150萬cold。
- 預定08:45–09:15窗口108,341筆／148,442,620B，平均60.189/s；1秒p95/p99/max=123/219/749筆，整分鐘p95/p99/max=6,499/7,788/7,788筆（108.317/129.8/129.8每秒）。高於R1 DAY均35.887/s與分鐘p95=65.9/s，涵蓋R1最高aligned minute；不等於實際測完該窗口或覆蓋最高rolling60=137.3/s。預定續收09:15–09:20另14,070筆，未執行。
- 候選總運行 **22:11:07.501–22:20:34.668 Asia/Taipei，567.163秒**。初始化首publication267.227秒、首認證API267.294秒；同原頁已見NIGHT #31,322，品質不足照實保留。流入起點22:15:45.189，實際僅至原08:49:45.618341，**285.631秒／18,616新增筆／2,560完整批次**。
- 停止主因 **MEASUREMENT_DISTORTION**：私人helper啟動前自訂的保守送入容差max>1,000ms觸發（觀測max **1,074.157ms**）。這是量測工具判定，不是Owner批准的產品SLA，也不是10分鐘不發布或資源閾值被觸發。每筆排程遲到p50/p95/p99=16.290/307.892/547.109ms；小批次fsync p50/p95/p99/max=48.881/152.104/565.825/1,085.896ms。送入工具自身的同步flush成本改變實際到達節奏，不能據此判定產品無法承載。
- 原result的reason被退出callback覆寫成APPENDER_EXIT_INCOMPLETE；**原檔不改**，由measurement首failure及stop-flow還原主因，兩者並列保留。未另起campaign，未減速／換輕窗口救結果。

### 實際進度、延遲及未完成項

| 停止後已核對項目 | records | bytes |
| --- | ---: | ---: |
| 私人實際來源完整前綴 | 49,938 | 68,365,514 |
| durable committed | 48,220 | 66,013,891 |
| DAY published完整原始前綴 | 44,116 | 60,396,698 |
| NIGHT自身artifact原始前綴 | 31,322 | 42,903,318 |
| 未提交積壓 | 1,718 | 2,351,623 |
| 未發布積壓 | **5,822** | **7,968,816** |

NIGHT初始化1次，DAY後續3次（#33,409→39,215→44,116）；流入後首DAY發布87.723秒，DAY完成間隔84.251、81.094秒；含初始化最長完成推進間隔98.183秒。最後32.666秒尚無新發布只是右設限片段。各盤bytes讀各自immutable artifact，不共用最新pointer。

| append可見write完成→首次觀測（已成功完整批次；秒） | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: |
| publication | 119.465 | 160.468 | 163.957 | 164.934 |
| authenticated API | 119.529 | 160.532 | 164.022 | 165.013 |
| 同一原頁 | 130.267 | 164.780 | 168.252 | 169.276 |

分母2,560批次／18,616筆；只有**1,605批次／12,794筆**在三通道觀測到完整覆盖，**955批次／5,822筆**未覆蓋，完整母體p50/p95/p99不能由成功樣本代替。批次權重非逐筆權重；保留每批起迄ordinal、write可見與fsync完成、各通道首見及各自最後觀測界線。三通道均是輪詢首見上界，不是原子提交或render精確時刻。

API初始化225次503 PROJECTION_NOT_AVAILABLE；DAY首发前76次503 SELECTION_INVALID；之後合法值仍CLASSIFIED_COVERAGE_INCOMPLETE／QUALITY_INSUFFICIENT，不能因有數值標LIVE。原頁同一tab未重載／換頁掩蓋，48筆campaign單調樣本、1筆早期僅wall樣本及1筆停止後樣本分列；最長採樣缺口91.678秒。UI performance.now經本機wall/monotonic pair一次校準，殘差約1.5–3.5ms；原頁p值只能視粗採樣首見上界。停止後原頁清為不可用，另保存，不延長運行分母。

**正常流入未完成；一次重開續收NOT_MEASURED；有界排空NOT_MEASURED，積壓未排空。** 不是恢復失敗，也不是排空能力FAIL；因工具gate先停止，沒有執行這兩階段。CPU樣本max76%、writer RSS peak366,874,624B，未觸發原資源gate；不宣稱正式collector自然非干擾已驗收。原5/10秒FAIL、新120/180秒未批准提案與daily V1 NOT_READY保持。

### 收據、審查與更新包差異

去敏[逐60秒進度／延遲統計／hash收據](../evidence/cru55-growing-early/bounded-evidence.json)。來源停止後逐byte等於原凍結byte0前綴，49,938 hash-chain links、4 artifact hash/cutoff/bytes及停止後checkpoint核對通過；無partial tail，frozen identity/size/mtime/ctime未變。來源prefix SHA256 **aac2ad6ab6057d39e4d331916041a1d778504465ed8cd42f660a9bdd2db8c982**。

原始失敗與writer/送入/UI logs、owner locks、output保留本機；公開只放aggregate及hash，不含raw、SQLite、憑證、私人路徑或PID/nonce。私人Replay helper Level2獨立審查B0；結果／統計另核對，不冒充新的產品工程批准。22:22:47.592已驗本次writer/server/appender/supervisor均absent、3069無listener；未Merge或切8787，安全0/true/false/false。

本次去敏結論另存本結果摘要，並追加原私人UPDATE_AND_ROLLBACK；既有決策文件§1–11不改。整版更新仍NOT_READY；沒有新binding/outputVersion部署或正式容量／時段提升。62k／09:45有限試用不作日常交付終點；CRU21順序與當日CVD目標保留。**本輪結案為量測工具失真、承載結論不確定；保留現版並退回日常放行，不進新儲存施工。**
