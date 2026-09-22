# CRU55 本機一鍵更新候選

依 Linear CRU55「本機一鍵更新」499e7962-4b7f-47d3-9b98-5d6114c4b39a 與 Owner 本輪隔離施工授權。PR71 已 source-only 合併至 1ad9ec7c1814e401f8352048638f0a398bcf74fe；不得再向已關閉 PR71 推修復。

## 入口與唯一確認

雙擊 repo 根目錄 `update-local.cmd`，讀取工程交付的私人 `data/cru55-update/update-plan.json`。或執行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/update-local.ps1 -PlanFile <私人計畫>`。確認前唯讀核對目前實際載入的 HEAD／程序／binding、已批准來源主線、固定目標、端口與目錄；只輸入一次完整 target SHA。它不追逐最新 main，不讓「Git成功」代表產品可用。

本版是 **ISOLATED_CANDIDATE only**；不能用本版安裝正式 binding、切 8787 或停止正式 collector。正式模式直接拒絕，即使計畫填了 Owner URL。目的是把受控流程包成能真實測試的最小交易腳本，不是部署平台或全域 updater。日常 `start-daily-use.ps1` 完全不改，也不在每天啟動時 pull。

## 自動階段

1. 檢查 controller 是本次隔離 branch/worktree，origin 與固定 approvedMainSha 一致，目標存在、由批准 main 衍生且屬 controller HEAD 祖先；拒絕 dirty、版本漂移、未知 listener／PID、重導路徑。所謂 approvedMain 是已核實來源版本，候選 target 不是正式部署批准。
2. 原 worktree 全版保留，另存原 route、私人候選設定與 tree/config hash；不 reset/clean 原樹。普通目錄排他 update.lock 阻止重複點擊；未知或中斷交易拒絕自動刪鎖。
3. 在 data/cru55-update/releases/<唯一ID> 建 Git worktree 固定 exact SHA，執行 npm ci、Windows Koffi native 探測。失敗保留目錄與 dependency log，舊程序繼續。
4. 所用真實片段必須已在本候選私人 inputs，來源SHA/manifest固定。只允許少量 dated NDJSON/provenance/latest/history JSON（每檔最多8MiB、總共16MiB）；不搬大型 raw、SQLite、.env 或正式憑證。正式大資料的保留與alias提案沿用 Runtime Binding 文件，本版不執行搬移。
5. 二次核對原 route/HEAD/程序精確 birthtime/commandline 後，只切相同隔離端口的 Dashboard 與 CRU55 managed。使用既有完整 acceptance launcher、原 scrypt/session/CSRF；新source/output與版本綁定，不改UI或資料語意。
6. 自動驗證真正登入、8項舊API欄位與seed一致、完整prefix已驗證的預期cutoff/hash/CVD及六窗artifact/HEAD/no-store一致。UI與既有接受檔案SHA對照；此為原UI證據沿用，不冒充每次自動執行瀏覽器render。工程交付另提供實際瀏覽器檢查，日後若UI改版需新UI驗收。
7. 實測通過才commit active.json route。中文分列版本準備、切換、資料片段、衍生發布、API、UI證據沿用、未驗自然LIVE/全天容量。productReady永遠不因此提升。
8. 新版啟動或資料驗證失敗：精確停止本次已識別程序、重新啟動保留舊版，再跑舊版預期cutoff/API驗證，成功才寫回route。回退也失敗、部分啟動無足夠PID身分、程序被重用或交易中斷時保留 RECOVERY_REQUIRED 鎖與全部證據，不誤殺未知程序。完成route後若journal寫入失敗不殺已驗證runtime，保留鎖供核对。

## 私人計畫

schemaVersion=cru55-local-update-v1；mode=ISOLATED_CANDIDATE；targetSha及approvedMainSha為完整40字SHA；decisionUrl為實際本repo PR/issue comment URL；lane為簡短英文ID；port限定3000–3999；timeoutSeconds 15–1800；seedRoot必須在本controller data/cru55-update/inputs內；seedManifestHash固定完整SHA256。expected包含view、ordinal、recordHash、cvd（可為null），uiFiles列既有接受 public 檔案及SHA256。沒有通用shell hooks、broker／collector指令或正式target override。

私人seed-manifest.files只可包含 source/YYYY-MM-DD.ndjson、source/provenance.json、app/latest.json、app/history/YYYY-MM-DD.json、app/input-manifest.json。沿用已授權的小型真實片段，缺少研究DB仍明示缺資料，不為更新試驗重搬大型DB或補造研究成功。

所有 update transaction、保留版本/設定及登入收據只在 ignored data/cru55-update 與 release 私人data中。不可上傳密碼、raw、SQLite；dependency及失敗logs保留。CLI只有隔離候選權限；停止candidate也須核對身分，不用kill port/process-name通殺。

## 正式切換決策仍需具體批准

此新PR需要exact版本工程審查及Owner Merge決策。即使合併，本版也不支援直接正式啟用。正式切換前應另確認容量/发布耗時處置、批准的整版SHA、實際loaded version、普通新binding/output位置、source alias身分、來源日期範圍和每次current[0,N)/prior[0,P)保護条件，及監看/停止/回退界線。

目前正式source約1.95GB，先前84.8MB歷史批量append→publication上界661.890秒；不能由小型fixture推論全天跟得上。容量分析與後續正常managed分段量測是同一CRU55待解風險，更新封裝不取代。自然LIVE、日夜/Handoff及五日驗收各自保留；formalWeight=0/researchOnly=true/executionAuthorized=false/orderRoutesEnabled=false。
