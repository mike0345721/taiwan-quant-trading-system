# CRU-55 Stream runtime binding／受控部署候選

依 PR71 GPT 查收 5776695482 更新。本文件是提案；未授權 Merge、正式部署、對正式 raw 加鎖或停止 collector。activationReady 只代表設定 preflight；fullDayReady=false、executionAuthorized=false 不變。

## 處理器與依賴

使用 STREAM_PAGED_V2／FULL_PREFIX_BEFORE_PUBLICATION。正常 scripts/start-daily-use.ps1 在同一 binding 下啟動或重用 scripts/start-cru55-managed.ps1，不再另啟 watch-cru55-dynamic.mjs。每次 publication 仍驗原始完整前綴；Windows 本機 NTFS 共享 prefix lease 保護捕獲範圍，尾端可追加。其他平台保留保守 stamp 驗證，不沿用 Windows 的驗通結論。

完整 checkout 執行 npm ci；鎖定 koffi=3.3.1，須能載入 Windows x64 native binary/kernel32。chart vendor 為 lightweight-charts=5.2.0；本次驗收 Node 24.18.0 x64。只複製 JS 或跳過 native 安裝不構成 runtime 驗收；依賴探測只用隔離檔。

resolver identity 包含 pipeline、prefix guard、相關語意程式、calendar、package-lock。新 resolver 使用新 outputVersion；舊 checkpoint/artifact 不得改標或強制接續。相同 resolver 才能接續原輸出。

## 私人設定格式

以下全部為佔位值；提案放私人 review 位置，不放正常啟動位置。

```json
{
  "schemaVersion": "cru55-runtime-binding-v1",
  "state": "PROPOSED",
  "runtimeRoot": "D:\\APPROVED_RUNTIME",
  "runtimeCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "dataRoot": "D:\\APPROVED_RUNTIME\\data",
  "sourceRoot": "D:\\APPROVED_RUNTIME\\data\\live-events",
  "sourceAlias": {
    "kind": "WINDOWS_JUNCTION",
    "physicalRoot": "D:\\APPROVED_SOURCE\\live-events",
    "targetIdentity": { "dev": "0", "ino": "0", "birthtimeNs": "0" }
  },
  "sourceSelection": { "kind": "DATED_CALENDAR_LEDGER", "startDate": "2026-09-22" },
  "outputVersion": "stream-paged-v2-prefix-v1",
  "outputRoot": "D:\\APPROVED_RUNTIME\\data\\cru55-runtime\\output\\stream-paged-v2-prefix-v1",
  "readerRoot": "D:\\APPROVED_RUNTIME\\data\\cru55-runtime\\output\\stream-paged-v2-prefix-v1",
  "sourceVerification": "FULL_PREFIX_BEFORE_PUBLICATION",
  "producer": "STREAM_PAGED_V2",
  "formalWeight": 0,
  "researchOnly": true,
  "executionAuthorized": false,
  "orderRoutesEnabled": false
}
```

正式啟用須有 Owner 明確決策 URL、state=OWNER_APPROVED。runtimeCommit 必須是 Merge 後批准的完整 SHA，等於實際 checkout 及已核實 origin/main。工程 APPROVE 或 URL 格式正確不等於 Owner 授權。實際 path、目錄 dev/ino/birthtimeNs、sourceSelection 起始日期須以部署當下唯讀核對值產生，不使用零值。

## 實際目錄與同一資料鏈

現有 approved runtime 的 data/live-events 與 data/runtime 都是指向主工作區的 junction。現行規則只允許 source leaf junction，不能把 runtime junction 當可寫路徑。因此新 binding 使用 **<dataRoot>/cru55-runtime/binding.json**；新 output 使用普通目錄 **<dataRoot>/cru55-runtime/output/<outputVersion>**。既有 junction、collector、frozen plain-path helper 不變。

正常 launcher 新舊 binding 同存時拒絕歧義。只有舊 binding 時保留既有查找；若其 alias 不合法仍 fail closed。dataRoot=<runtimeRoot>/data，sourceRoot=<dataRoot>/live-events，readerRoot=outputRoot。sourceAlias physicalRoot 與目錄身分必須符合批准值；輸入限普通單連結 dated NDJSON，拒絕重導與讀寫重疊。

| 階段 | 位置／限制 |
| --- | --- |
| source discovery | 起始日期至當日 YYYY-MM-DD.ndjson；逐檔獨立 genesis，不合併跨檔 CVD |
| source run | outputRoot/sources/<sourceKey>；physical path、file identity、genesis hash 綁定 |
| output | ingest、pages、chunks、immutable *.stream-view.json、stream-public.json |
| routing | stream-selection.json 分別指向 DAY/NIGHT 已發布 cutoff；reader 同一 outputRoot |
| owner/status | managed-owner.lock/owner.json、managed logs/state/status；核對 PID/start/command/HEAD/binding |
| restart | 同版本有效 checkpoint 接續；unknown owner 不殺、不刪；BLOCKED 不回退舊 READY |

## 完整隔離候選入口

node scripts/start-cru55-acceptance.mjs <private-candidate-config> 3056

此入口要求隔離 worktree 與 clean exact HEAD，啟動完整 server.mjs、真正 managed launcher、原 scrypt／twchip_session／CSRF，不使用歷史 preview adapter。候選真實 source 固定在 data/cru55-dynamic/real-inputs/<candidate-runId>；provenance 列各 stage bytes/ordinal/terminalHash/SHA256。啟動驗實際 source 全 hash；受控追加只從已驗 frozen max copy 追加原始 suffix，最後逐 publication 核對 frozen cutoff。這是歷史真實片段，不是自然 LIVE。

latest/history、研究 DB/reports、CRU34 snapshot/status 使用普通隔離副本與 manifest。私人密碼經原認證後端驗證，不複用正式密碼。候選停用擷取與正式 bridge 查詢，相關值明示 UNAVAILABLE；Session/journal/cache 僅写私人目錄。正式路徑保留原行為。URL 必須等 exact HEAD/binding health 讀回才宣告成功；失敗保存 logs/managed owner，不誤殺既有 worker。

## 合併與受控部署 gate

1. 先核准 Merge exact candidate；讀回 Merge 後批准 main，再另核准 controlled deployment 的 runtime、binding、source 日期範圍與 outputVersion。
2. 保存旧完整版本、binding/無 binding 狀態及 output。完整 Git 同步及 npm ci；不逐檔複製。普通 cru55-runtime 根不與既有 junction/來源重疊。
3. scripts/inspect-cru55-runtime-binding.mjs <proposal> plan 為唯讀。Owner 批准、設定實裝後才執行 activation-preflight。檢查本機 NTFS/native/磁碟/source alias/collector 寫入方式。
4. **先明列正式鎖定範圍**：選定日期檔當次捕獲 [0,N)；若驗 prior publication，另含其原始 prior 檔 [0,P)。不鎖未捕獲尾端或整個目錄。lease 期間拒絕 prefix overwrite、截短、换檔/刪檔。collector 必須是已驗 ordinary Python/CRT append，不能使用 writable mapping、truncate、rotate/replace 或不相容 sharing。writable mapped I/O 不在保證內。
5. Owner 批准正式來源保護範圍及非干擾條件後，才執行正常 daily-use。核對 owner/status、來源持續寫入、完整前綴驗證、publication backlog、API/UI及舊工作區。不符條件時保留 fail closed，僅停止本次新增且已識別的 writer/reader；不得停止 collector 救結果。

## 回退

只針對本次新增且確認身分的 CRU55 writer/Dashboard reader。保存失敗 logs、owner、checkpoint、artifact；恢復上一個批准完整版本及原 binding。原先無 binding 時移出新 cru55-runtime/binding.json 並清除此輪 shell override；不要留下 PROPOSED 或跨版本 binding。新 outputVersion 原封保存，不改標 resolver、不回填 ledger、不改五日計數。既有 source/runtime junction 及 collector 保持原位。

回退後核對原批准版本、健康與持續寫入。Merge、controlled deployment、自然日夜切換、正向真實相鄰 Handoff、完整自然交易日、五日驗收為不同 gate；本次隔離驗收不替代後幾項。

