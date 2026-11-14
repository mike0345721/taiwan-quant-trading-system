# V3.10 Frozen Forward T-1 Operational Preflight

> 執行時間：2026-07-30  
> 結論：`READY_WITH_MANUAL_CONDITIONS`  
> 正式Operations Gate：`PENDING`  
> `executionAuthorized=false`、`orderRoutesEnabled=false`

本次只作T-1唯讀與臨時目錄驗證，沒有啟動正式observer，沒有產生Prediction或
Outcome，正式Forward Registry執行前後檔案雜湊相同且仍只有2筆凍結紀錄。

## 排程與執行環境

| 項目 | 結果 |
|---|---|
| 排程 | `TwChipDashboard-V310FrozenForward`，Ready |
| 下次執行 | 2026-07-31 08:35 Asia/Taipei |
| 使用者／Logon Type | `user`／Interactive |
| 權限 | Limited |
| 工作目錄 | `D:\Taiwan stock\standalone-v1` |
| 執行環境 | `C:\Program Files\nodejs\node.exe`，Node v24.18.0 |
| 單一實例 | `MultipleInstances=IgnoreNew` |
| 最長執行時間 | 6小時，足以涵蓋08:35至13:47 |
| StartWhenAvailable | true；但08:45後補啟動會安全拒絕該日 |
| WakeToRun | false |
| 電池條件 | 使用電池不啟動，切換電池時停止 |

排程呼叫隱藏wrapper；wrapper持續等待長壽命observer。observer在08:35開始讀取既有
live event ledger，09:00完成Prediction、10:00後完成Outcome、13:47後檢查來源、
Registry及橋接工程Gate，最後自動執行acceptance audit。

## 橋接與行情

- 偵測到1個Python Shioaji唯讀橋接程序，PID與`/health`一致。
- `mode=market_data_only`、`subscriptionGeneration=1`、`sessionDown=false`。
- `symbolsReceived=6`，訂閱生命週期紀錄包含IX0001、2330，以及TX／MTX／TMF的
  Tick與BidAsk。
- 今日TX／MTX／TMF皆有收盤附近真實事件。
- 健康計數：`callbackErrors=0`、`dropped=0`、`writerErrors=0`、
  `eventQueueDepth=0`，queued與written一致。
- 單一instance mutex與8790綁定會讓第二個bridge在登入前失敗，避免多重登入與重複訂閱。

網路或Shioaji session中斷時，橋接會標示`sessionDown`並停止。當日資料會被Operations
Gate拒絕，不會補造資料；目前沒有承諾盤中自動重建同一日，下一個完整交易日重試。

## 凍結、儲存與重跑

- Frozen Spec SHA-256：
  `c9f2cbbb3404ef406732d22b8f2bd17fc7aa16e225f872771c448677477267f3`
- Frozen Models SHA-256：
  `68214197f25f951774d4889b871b06dd285023d132f1f88a92381ce14df76656`
- 兩者皆與`models_frozen`紀錄相符，模型數固定12。
- Forward輸出目錄與automation log目錄完成臨時寫入／刪除測試。
- D槽可用空間約1242 GB。
- 臨時Registry模擬重跑12筆Prediction與12筆Outcome：重複追加被idempotency key
  抑制，最後仍為24筆，hash chain稽核通過。
- 正式Registry沒有被臨時測試使用，測試前後檔案SHA-256相同。

若程序在部分Prediction或Outcome後中斷，重跑會先讀取正式Registry；相同
idempotency key不得重複追加。若重啟時點已晚於允許時窗，該日安全拒絕，
不試圖以不完整資料恢復或補造。

## 時間、電源與Windows狀態

- Windows Time來源為`time.windows.com`，最近成功同步為2026-07-30 09:18。
- 五次唯讀stripchart量測約為本機相對來源`+0.281`秒，遠低於現行5秒資料門檻；
  未調整系統時間。
- AC睡眠為停用；排程本身不會喚醒已睡眠的電腦。
- 系統沒有Windows Update或CBS的RebootRequired旗標，但有
  `PendingFileRenameOperations`旗標。這不證明一定會自動重啟，但建議第一個
  Forward日前先由使用者受控重新開機。
- 08:30既有Daily Update通常約5至11分鐘，可能與08:35 observer短暫重疊；
  不改排程，明日避免另行執行大型回測、掃描或手動資料工作。

## 明日人工最低條件

1. 08:35前完成受控重新開機並登入`user`。
2. 接上AC電源，保持電腦清醒至至少13:50。
3. 保持穩定網路，不在08:35–13:50執行Windows更新、重新開機或大量研究工作。
4. 不手動啟動第二個bridge或第二個Forward observer。
5. 不需手動產生Prediction／Outcome；13:50後只需檢查acceptance結果。

## 信心

在上述人工條件成立時，第一個Forward日完成工程閉環的信心評估為**中高**。
主要不確定性不是模型程式，而是Interactive排程、休眠／電池、網路中斷、
Windows重新啟動，以及08:30 Daily Update的短暫資源競爭。任一狀況發生時系統
應安全拒絕該日，而不是污染Registry。
