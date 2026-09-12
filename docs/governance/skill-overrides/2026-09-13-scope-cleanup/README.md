# CRU-51 canonical Skill override evidence

本目錄依 `ROOT_CAUSE_CONFIRMED / RECOVERY_READY` checkpoint 保存既有 `dev-workflow@1.0.1` override。`dev-workflow.patch` 與診斷時的既有 patch 位元組完全相同，沒有重寫 Skill 或下載 upstream。

## 證據與 hash 語意

- `manifest.json`：plugin identity、original/patched/replayed canonical SHA-256、local raw metadata、patch SHA-256、replay 輸出及既有驗證的沿用說明。
- `dev-workflow.patch`：零 context 的既有 patch，根目錄為解析出的外掛根目錄，`-p1` 後目標為 `skills/review-driven-development/SKILL.md`。
- canonical bytes 為 UTF-8、無 BOM、LF；移除 UTF-8 BOM、CRLF 轉 LF，拒絕 bare CR。不 trim 空白、不補刪 final newline、不改 Unicode code points。
- canonical hash 是 source identity 與 drift gate。local CRLF raw hash 只作環境相關的 secondary verification，不可與 canonical hash 混用。
- 原始 Temp 備份仍可保留；未來可用 canonical hash 完全匹配的外掛版本作基線，不以 Temp 作唯一恢復來源。不另外複製整份第三方原文。

## Drift detection 與 deterministic apply

1. 解析已安裝的 marketplace/name/version，再找 stable relative path。cache 絕對路徑只是觀察紀錄。identity 不符時 STOP review。
2. 讀取 source，按上述 contract canonicalize。若等於 patched canonical hash，表示已套用，直接停止；若不等於 original canonical hash，保持 BLOCKED，禁止硬套、fuzzy apply 或自動更新預期 hash。
3. 先將 patch 的隔離副本按相同 BOM／CRLF 規則 canonicalize，再檢查 patch SHA-256；不可改 hunks。這可排除 repository checkout 換行設定對 patch 檔案表示法的影響。在隔離暫存根目錄建立相同 relative path，寫入 original canonical bytes；再次確認 exact original canonical SHA-256。
4. 在隔離根目錄依序執行（`PATCH` 代表已驗 hash 的 patch 絕對路徑）：

```text
git -c core.autocrlf=false -c core.eol=lf apply -p1 --unidiff-zero --verbose --whitespace=nowarn --check PATCH
git -c core.autocrlf=false -c core.eol=lf apply -p1 --unidiff-zero --verbose --whitespace=nowarn PATCH
```

不使用 ignore-whitespace、3-way、reject、whitespace=fix 或 fuzzy fallback。若任何輸出出現 offset、fuzz、context failure，立即 STOP；不得因 exit code 為 0 就忽略偏移。

5. post-apply 必須是 UTF-8 LF canonical bytes，且 hash 完全等於 `canonical_patched.sha256`，否則保持 BLOCKED。
6. 如需驗證本機 cache 表示法，另將 canonical LF 轉成 manifest 記錄的 CRLF，再比 local raw hash。本機表示法不影響 canonical identity。寫回實際外掛目錄需具有效授權；本次 gate 只在隔離目錄重放。

## Restore

以 exact patched canonical hash 作回復前置條件，在隔離副本使用相同兩個 Git config 和 `-p1 --unidiff-zero --verbose --whitespace=nowarn`，先 `--reverse --check`，再 `--reverse`。回復結果必須等於 original canonical hash；需本機 CRLF 表示時另做轉換及 secondary raw 驗證。任何 drift／offset／context failure 都 STOP，不覆寫既有內容。外掛更新可能覆蓋 override；本證據不保證新版 upstream 相容。

## 本輪驗證與交付邊界

只重新執行這份 patch 的 deterministic reproducibility gate，PASS 輸出與 hashes 見 manifest。既有 5 Skills format、39 links、scoped diff check 沿用 checkpoint 的 PASS，本輪未重跑；治理／Skills candidate 內容未變動。

同一 local commit 僅包含既有 AGENTS.md、治理文件、兩份 repository Skills 及本目錄三個 evidence 檔案。兩份個人設計 Skills 仍在使用者目錄，本 patch 的保存範圍為外掛 cache override。研究／runtime 與暫存 helper 不納入提交。

包含本目錄的 commit SHA 由最後回報提供，避免文件自我引用。單一 local commit 完成後 STOP at `LOCAL_ENGINEERING_CHECKPOINT_READY`；沒有 push 或 remote read-back，不代表完整 remote delivery，也沒有 Merge／Promotion／Production Runtime／Execution 授權。
