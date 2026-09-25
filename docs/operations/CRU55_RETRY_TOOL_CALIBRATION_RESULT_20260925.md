# CRU55 私人工具補正與短校驗結果

依 [Owner 同意／固定契約 5834924057](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5834924057) 連續完成私人 helper 修正、獨立審查、小測及一次短校驗。**結論：TOOL_CALIBRATION_FAILED；產品 campaign 未啟動。不是產品 FAIL，也不是預算到限。** 第一案例不合格後依硬停點收尾，沒有第二案例或新一輪。

受測候選 exact HEAD：`ec457134defe59435e82bb03577af18f48e4147c`。產品 src／scripts／public／broker／package／lockfile 與既有產品基線 `e321c8748a742f5ebcd27d24e0a2299c6c46acff` 無差異；PR73 Draft、unmerged。原 campaign INCONCLUSIVE、M4、R1/R2、原效能 FAIL 與所有失敗證據保留。

## 工具改動及事前固定規則

- 唯讀核對 collector：原實作是 `O_APPEND → write → close`，沒有每小批 fsync。私人送入器改用固定單調時鐘絕對 deadline、原 bytes／順序／receivedAt 間距，完整 write 與 close 分別計時；取消額外逐批同步 flush，最後 fsync 另記。產品 fsync 不動。
- 保留 full-prefix、plain-path／fd identity、partial-write 處理與資源停止條件；修正 firstFailure 不被 exit／cleanup 覆蓋、重開啟動結束後再完成 owner 驗證清理。觀測器改為同頁固定 5 秒 deadline，保存耗時、缺口及跳過的採樣格；產品 campaign 未啟動，因此本輪沒有 UI 動態驗收。
- 七份 helper 在校驗前完成獨立工程 APPROVE、雜湊綁定及讀回。六個 JS 語法檢查與三個純函式案例通過：正常送入通過、漏尾及整段延遲兩秒不通過。這些不是來源重播或 CVD 測試。
- 校驗判定事先固定：逐筆 lateness p99 ≤100ms、max ≤1000ms；相同固定窗口的 1 秒 records／bytes L1 差異除以預定總量 ≤5%，60 秒 ≤1%；秒尖峰幅度誤差 ≤5%、尖峰位移 ≤1 秒、累積落後 ≤總量1%；全部預定紀錄須送達，尾端溢出格保留。理由是允許短抖動但辨識持續欠送及削平突發；未在看到結果後放寬。

## 唯一短校驗的實際結果

來源準備 38.532 秒（上限600秒），byte0 初始化副本 31,322 筆／42,903,318B。動態校驗為原 **08:45–08:50**，沒有 CVD 重運算或 writer。

校驗時間為 **2026-09-25 15:44:34.937–15:49:36.742 UTC**（臺北翌日00:44:34.937–00:49:36.742）；包含獨立 supervisor 的總時間 **305.434 秒**，低於600秒上限。原節奏完整流入300秒，實際新增 **19,247筆／26,326,193B／3,193批**。

| 固定判定 | 實際結果 | 判定 |
| --- | --- | --- |
| 逐筆 lateness p50／p95／p99／max | 12.117／20.095／**133.790**／967.643ms | **p99 不合格** |
| 超過100ms／超過1000ms | 267／0 筆；分母19,247筆 | 全樣本保留 |
| 1秒 records／bytes 差異 | 4.1773%／4.1817% | 合格 |
| 60秒 records／bytes 差異 | 0.1455%／0.1457% | 合格 |
| 秒尖峰 records／bytes（預定＝實際） | 749筆／1,020,840B；位移0秒 | 合格 |
| 最大累積落後 records／bytes | 50筆／68,430B，約總量0.26% | 合格 |
| 完整送達與最後落盤 | 19,247筆全送達；最後fsync 48.487ms | 合格 |

完整五分鐘的分母、302個含溢出格的秒級流量、全部延遲樣本及來源副本均保留。送入程序沒有 I/O exception；最終固定保真判定的唯一失敗項是 `P99_LATENESS`，不是 firstFailure 遺失。合併「路徑檢查＋開檔」計時 max956.693ms、write max262.652ms；只能證明私人送入路徑仍有抖動，不能從這些計時分離 OS 排程、檔案系統或其他主機活動的責任，更不能歸因 CVD。

11個 CPU 樣本最大82%，未觸發連續兩次>85%條件；沒有資源或時間 gate 退出。原最高 aligned minute **09:01–09:02／7,788筆**僅準備完整 byte0 前綴，**未啟動動態校驗**，不算第二輪或产品承載證據。

## 產品進度、未測與保留限制

| 項目 | 本輪可認列事實 |
| --- | --- |
| 校驗來源最終完整前綴 | 50,569筆／69,229,511B；逐byte等於 frozen byte0前綴 |
| 新產品候選來源 | 僅準備31,322筆／42,903,318B，未由CVD初始化 |
| CVD committed／published進度 | **NOT_MEASURED**；未啟writer，不能填0當量測 |
| append可見→publication／認證API／同頁延遲 | **NOT_MEASURED**；表中ms是送入遲到，不是產品更新延遲 |
| 原30分鐘流入／一次重開續收／有界排空 | **NOT_STARTED_AFTER_CALIBRATION_FAILED** |
| 產品積壓是否排空／恢復結果 | **NOT_MEASURED**，不得判成成功或產品失敗 |

校驗新增19,247筆沒有接到CVD，不能冒充已發布成功樣本，也不能混入產品右設限母體。原 campaign 未發布5,822筆、955批及91.678秒UI採樣缺口維持原紀錄；本輪未補成產品成功證據。原source／chain／hash／時間及品質null語意未改。

## 核對、交付與決策

去敏[固定規則、完整流量格、雜湊與核對收據](../evidence/cru55-growing-retry/calibration-evidence.json)。校驗副本 SHA256：`48af71e5f6becb0a9ab32560cfd3c498b309f806c878c1c5db66d829cf3feaf2`。三份已準備副本均逐byte核對原frozen前綴、frozen identity未變；3,193批起迄ordinal連續。停止後已確認所有自有測試程序退出、3070無listener、campaign-start不存在。helper原檔、原始失敗、原始量測與私人副本留本機，raw／SQLite／憑證／私人路徑／PID不上傳。

必要差異追加既有私人 UPDATE_AND_ROLLBACK §13；既有內容保留。**退回日常放行；本範圍未取得可解讀的產品持續流入證據，仍不建議投入7–11人日儲存整包，也不串接盲修或下一輪。** 不能以62k／09:45退出當日常交付終點；原當日CVD及整版更新要求仍未完成。

CRU55維持In Progress、daily V1 NOT_READY。本輪沒有新增產品延遲預算、正式容量或時段授權，沒有Merge、正式8787切換或本機整版更新。安全邊界維持 formalWeight=0、researchOnly=true、executionAuthorized=false、orderRoutesEnabled=false。
