# V3.10 Frozen Forward Operations Gate v1

> 狀態：`PASS`；2026-07-31完成第一個合格 Prediction → Outcome → Acceptance 閉環  
> 最早合格交易日：2026-07-31  
> 安全邊界：`researchOnly=true`、`executionAuthorized=false`、`orderRoutesEnabled=false`

## 2026-07-31最終驗收

- Observer於08:35:01（Asia/Taipei）開始，09:00:01完成12筆Prediction，
  10:00:00完成12筆Outcome，13:47:01完成全日Acceptance。
- `tradeDate=2026-07-31`、`attemptStatus=ACCEPTED`、`overallGateStatus=PASS`。
- 來源live event ledger共觀察1,135,838行：0 invalid、0 hash failure、
  0 sequence gap、0 duplicate；TX 08:45–10:00目標時窗clock skew事件為0。
- Forward Registry共28筆，hash chain、sequence、idempotency、Prediction linkage
  與執行邊界稽核均通過，錯誤數為0。
- Frozen Spec SHA-256維持
  `c9f2cbbb3404ef406732d22b8f2bd17fc7aa16e225f872771c448677477267f3`；
  Frozen Models SHA-256維持
  `68214197f25f951774d4889b871b06dd285023d132f1f88a92381ce14df76656`。
- `formalModelWeight=0`、`promotionAuthorized=false`、`researchOnly=true`、
  `executionAuthorized=false`、`orderRoutesEnabled=false`。

本Gate至此完成，後續依既有排程背景追加全新Forward證據，不阻塞產品主線；
本結果不代表模型具有Edge，也不構成PP-1或其他工作包的自動開發授權。

## 定位與範圍

本 Gate 只讓既有12個凍結模型形成可稽核的前向運作閉環，不新增或修改特徵、
interaction、門檻、事件定義、模型或正式權重，也不產生模型排名、交易建議或
Dashboard 產品功能。

## 固定時序

本次只驗收完整日盤，不增加夜盤、跨午夜或換月範圍。

1. 08:15前開機、登入Windows並接市電。
2. 08:20確認只有一個行情Bridge，且登入、訂閱及行情健康。
3. 08:35 啟動唯讀觀察程序；不登入 Shioaji、不建立第二個行情橋接程序。
4. 自既有 append-only live event ledger 尾端開始觀察。
5. 08:45–09:00 取得 TX 前三根5分鐘資料，最晚於09:02完成 Prediction。
6. 09:00–10:00 繼續取得固定目標時窗，完成 Outcome。
7. 08:45–13:45保持完整運行；不得以人工補資料修復 Forward。
8. 13:47 後檢查全天工程 Gate，合格才追加 `forward_day_accepted`。
9. 執行接受稽核並停止；未有完整新交易日前整體狀態必須保持 `PENDING`。

Prediction 必須早於對應 `targetAvailableAt`；Outcome 必須在目標可得後追加，
並以 Prediction 的 record hash 建立不可變連結。

## 工程 Gate

- 凍結規格與模型 SHA-256 必須等於 `models_frozen` 紀錄。
- 模型數必須固定為12，正式權重固定為0。
- live event ledger 必須無 invalid line、hash failure、sequence gap及duplicate。
- 08:45–10:00的 TX 目標時窗不得有超過5秒的 clock skew。
- 行情橋接健康值必須為 `callbackErrors=0`、`dropped=0`、`writerErrors=0`。
- Opening Window 必須覆蓋08:45開盤附近至08:59:30以後。
- Outcome Window 必須覆蓋至09:59:30以後，且形成連續15根5分鐘資料。
- Registry 必須通過 hash、sequence、idempotency、Prediction linkage及時間因果稽核。
- 所有紀錄必須維持 `researchOnly=true`、`executionAuthorized=false`。

與研究無關的其他商品延遲只保留描述統計；本 Gate 的延遲否決條件只作用於
本次模型實際使用的 TX 08:45–10:00目標時窗，避免股票收盤競價等非輸入事件
誤判前向資料。

## 拒絕與重試

任何凍結雜湊、安全邊界或 Registry 完整性錯誤皆為硬性失敗。單日若因電腦未開、
08:45後才啟動、資料窗不完整、橋接不健康或延遲超標，追加具 idempotency key 的
`day_rejected`，不得補造 Prediction 或 Outcome；下一個合格交易日依原規格重試。

排程使用 `TwChipDashboard-V310FrozenForward`，週一至週五08:35啟動，
`MultipleInstances=IgnoreNew`。若錯過時點，即使 Windows 以 StartWhenAvailable
補啟動，程序也必須拒絕該日，而不是使用不完整資料。
觀察程序結束後會自動執行接受稽核並更新`operations-acceptance.json`；完整日通過前
維持`PENDING`，單日拒絕不會自動調整模型，下一個交易日依同一凍結規格重試。

## 驗收語意

- `PASS`：至少一個2026-07-31以後的新交易日完成12筆Prediction、12筆Outcome，
  且完整工程 Gate 通過。
- `PENDING`：凍結、安全及工程準備正常，但尚無完整合格新交易日。
- `FAIL`：凍結雜湊、Registry完整性、正式權重或執行邊界發生硬性失敗。

整體 Gate 狀態之外，每次實際嘗試必須另存 `attemptStatus`：

- `ACCEPTED`：該次交易日完整通過。
- `REJECTED_INCOMPLETE`：啟動過晚、必要資料窗不完整、Prediction／Outcome不完整
  或 Observer timeout。
- `REJECTED_DATA_QUALITY`：來源資料 invalid、hash、sequence、duplicate、clock skew
  或其他資料品質 Gate 未通過。
- `REJECTED_OPERATIONAL`：Bridge、登入、訂閱、session、callback、queue、writer
  或執行環境異常。
- `CORE_FAILURE`：Frozen hash、Registry完整性、正式權重或執行安全邊界失敗。

單日被拒絕時，`overallGateStatus`可維持`PENDING`，但必須保存`attemptStatus`、
`rejectionReason`及可稽核證據；不得只留下無原因的`PENDING`。

30個乾淨日只作 smoke test；60日以前不得申請新的績效研究或 Promotion。
本 Gate 通過後 Registry 轉為背景自動運作，不阻塞下一個已另行核准的
V3.10 Price Path 資料工作包。
