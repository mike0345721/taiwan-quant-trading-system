# CRU-55 / PR73 ROOT_CAUSE_PROBE — BLOCKED_WITH_EVIDENCE

2026-09-27。**未證明產品主要 CPU / wall / backlog 根因；停止，不做 runtime 盲修，不啟動第二次 G1-A，不使用保留的 retry。** 這次兩個量測目標尚未完整達成：分項計時仍有未分攤成本，全程序 CPU 歸因有必要程序漏樣。本報告不將工具缺口改稱產品結論。

依據：[GPT checkpoint 5853086004](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5853086004)、[CRU-55 最新 Owner 收尾授權](https://linear.app/cruise41319/issue/CRU-55)。診斷時核對的 PR73 本機及遠端 delivery HEAD 均為 `5f3634aa686091d106cb87bf094732880267872e`；base/main `1ad9ec7c1814e401f8352048638f0a398bcf74fe`，Draft / unmerged。後續 closeout commit 僅提交本目錄文件與去敏證據，不改受測 runtime。

## Owner 指定 closeout 記錄

- ROOT_CAUSE_PROBE = BLOCKED_WITH_EVIDENCE
- metadata 7 rounds / 8.319s，不足以證主要根因
- host CPU max 71.02%，未重現 >85%
- process attribution 漏掉 late-start writer/appender/server
- 沒有產品 root cause（未證明，不代表證明產品無缺陷）
- 沒有 runtime modification（沒有產品 runtime source 修改；既有載入時診斷 hook 已停止）
- SECOND_G1A_RETRY_UNUSED
- 不再重跑或盲修
- G1-A 不升 PASS，維持 FAIL / STOPPED
- G1-B / G1-C 不啟動
- 正式8787 / collector / raw / SQLite / scheduler 不變

本次 closeout 只執行去敏檢查、commit / push、CI、PR73 / CRU-55 回存與逐字讀回；完成後停止，不啟動新診斷。CRU-55 保持 In Progress；CI 成功不等於 G1-A PASS、Product Ready、Merge 或正式啟用授權。

## 結論與阻擋

- **主要根因未證明。** Metadata read 計得 **8.319s wall / 7.563s process CPU**，占整個 verify wall **56.692%**，但只占本段已完成 writer cycle work 的 **4.692%**。整個 verify 計得 14.674s，占 cycle work 177.291s 的 8.277%。這只證明局部成本存在；不能據此宣稱它是整條發布鏈、先前 91% host CPU 或 backlog 的主因。
- **目標一只有部分完成。** 39 次 verify 呼叫、7 個不同完成 round（流入後 6 個）。16 個 complete 回傳中有 9 個是同 round receipt fast return，不能冒充 16 次完整 verification。已記錄下表全部欄位；但 current `chunkPath() → name() → assertPlainPath()` 在 metadata timer 外，另有 bookkeeping / 計時成本。葉節點分項與 verify total 差額約 **5169.843ms**，不能把它當成已歸因成本。owner/context 是含 guard 的巢狀計時。
- **目標二未完成。** PDH wildcard 在取樣啟動時展開一次，後啟動的 writer / appender / server 未進入清單；它們的同窗 CPU delta / share 是 **UNKNOWN**。已捕獲 counters 的共同時間戳檢查成功，不代表覆蓋所有程序。不得用另存的 CIM 不同區間 CPU 補算。
- 90 個共同時間窗，host 加權平均 **30.989%**、p95 **54.869%**、最高 **71.019%**，**0 個 >85%**；歷史高負載未重現。已知 process CPU 只涵蓋 host busy 的 71.231%，剩餘 **28.769% 未歸因**，含漏樣、短命程序、interrupt/DPC 與計量差异等未知部分，不能全部歸給 writer 或外部程序。
- **不執行 runtime 修正、focused product tests 或 Level3 runtime review**：修正前置的根因證明未滿足，沒有產品 diff 可作此審查。這不是 Engineering APPROVE。G1-A 仍 FAIL / STOPPED；G1-B/C 與正式操作 gate 不變。

## 分項量測

主量測續段 21:24:29–21:27:53 +08，約 **203.588s**；固定來源實際流入 **120.618s / 9,624 筆**。前次隔離 INGEST checkpoint 續行，非全新 cold-start benchmark。CPU 為同步函式區間內的 process CPU，具 Windows 計數量化；0 表示本次計數差值為 0，**不證明真正零 CPU 成本**。bytes 是邏輯讀取/處理位元組，不是實體 HDD 吞吐。

| 階段 | calls | chunks | bytes | wall ms | CPU ms |
|---|---:|---:|---:|---:|---:|
| Metadata path validation / stat / read / UTF-8 decode | 1,861 | 1,861 | 1,265,227 | 8319.215 | 7563.000 |
| JSON parse | 1,861 | 1,861 | 1,265,227 | 42.284 | 32.000 |
| Metadata hash / chain verification | 1,861 | 1,861 | 1,265,227 | 112.953 | 31.000 |
| Target / pending / anchor / receipt checks | 3,822 | 1,846 | 0 | 31.631 | 0.000 |
| Raw full read | 749 | 749 | 131,026,787 | 73.859 | 79.000 |
| Raw suffix read | 54 | 54 | 9,302,710 | 4.229 | 0.000 |
| Raw hash verification | 803 | 803 | 140,329,497 | 363.429 | 362.000 |
| Guard acquire | 5 | N/A（5 個 guard ranges） | 0 | 67.870 | 31.000 |
| Guard assert | 82 | 0 | 0 | 488.977 | 378.000 |
| Guard release（部分） | 2 | 0 | 0 | 0.188 | 0.000 |
| Owner / context（含巢狀 guard，不可重複加總） | 39 | 0 | 0 | 665.828 | 454.000 |

Metadata 讀取/解析 1,861 次，高於產品已推進的 1,846 chunks，因 budget 不足時該 chunk 已讀 metadata、下一次又重讀；全部實際呼叫保留。JSON parse 與 hash/chain 不含前面 read 的時間。Guard bytes=0 指沒有在該分項直接讀 raw bytes，不代表未保護 prefix。Guard-acquire 的原始 chunks 欄位是 range acquisition 計數，不能當 metadata chunks。

載入時 hook 的原始 module SHA256：`77cef3f09c734a277e21d93743d080a639c5985918b763a494350b8f02baeed1`；instrumented source SHA256：`c4612db56b2c7c22f2d91032d69eceaa8e5fd721bbdbcad9aa576e2abfa3fe4d`。產品磁碟 source 未改；hook、transform 與量測檔獨立保存。正常 artifact code identity 不包含 hook，因此這些 artifact 只屬診斷且 research-ineligible，不能拿來做 acceptance / promotion。

已完成 cycle 的回傳 phase 分桶：INGEST work 45.331s、PROJECT 89.169s、QUERY 4.669s、VERIFY 26.587s、VERIFY_PRIOR 11.535s。這是現有每個 cycle 的回傳 phase 標籤，含 config / manager；**不是各底層函式的互斥 profiler**，不能另把它當成已證新根因。JSON 有原始 work / pipeline / config / manager / CPU 合計。

## 同窗 CPU：已量得部分與缺口

共同窗總計 193.330s，12 logical processors。每個有效 endpoint 都檢查 PDH Timestamp 與 SecondValue 一致；process 需同 PID / creation raw identity 才算 delta，無效 counter、出生/退出邊界保持未知。capacity%=CPU delta / (共同 wall × 12)；host busy share%=CPU delta / 同窗 host busy delta。下面缺樣組別的合計只含已量得區間，不是完整實際 CPU 的估計。

| 組別 | 已量得 CPU delta ms | 整機 capacity % | host busy share % | 覆蓋狀態 |
|---|---:|---:|---:|---|
| other | 204265.625 | 8.805 | 28.413 | unknown process-windows=4 |
| Chrome | 191937.500 | 8.273 | 26.698 | unknown process-windows=306 |
| Codex_ChatGPT_CUA_hosts | 55796.875 | 2.405 | 7.761 | unknown process-windows=0 |
| System | 44234.375 | 1.907 | 6.153 | unknown process-windows=0 |
| sampler | 12906.250 | 0.556 | 1.795 | unknown process-windows=0 |
| observer | 2265.625 | 0.098 | 0.315 | unknown process-windows=0 |
| PowerShell_other | 671.875 | 0.029 | 0.093 | unknown process-windows=88 |
| Defender | 15.625 | 0.001 | 0.002 | unknown process-windows=0 |
| writer | UNKNOWN | UNKNOWN | UNKNOWN | NOT_OBSERVED |
| appender | UNKNOWN | UNKNOWN | UNKNOWN | NOT_OBSERVED |
| server | UNKNOWN | UNKNOWN | UNKNOWN | NOT_OBSERVED |

Chrome 與 Codex/ChatGPT 是程序名稱層級歸因；沒有分出每個 tab / CUA task。本次未新啟 CUA UI polling，不能用它代表原 G1-A 的瀏覽器負載。PowerShell sampler 已獨立列出。全部已捕獲程序、PID、creation identity、每窗 delta 與 provider error 在本機 `cpu.ndjson` / `summary.json`，不將 raw machine inventory 放進本報告。

Top 10 其他已捕獲程序（按 CPU delta）：

| 程序 | CPU delta ms | 整機 capacity % | host busy share % |
|---|---:|---:|---:|
| dwm | 74078.125 | 3.193 | 10.304 |
| avp | 35140.625 | 1.515 | 4.888 |
| lsass | 15046.875 | 0.649 | 2.093 |
| systemsettings | 6750.000 | 0.291 | 0.939 |
| explorer | 5328.125 | 0.230 | 0.741 |
| svchost | 4984.375 | 0.215 | 0.693 |
| svchost | 4843.750 | 0.209 | 0.674 |
| audiodg | 4125.000 | 0.178 | 0.574 |
| svchost | 3703.125 | 0.160 | 0.515 |
| node | 3406.250 | 0.147 | 0.474 |

以上不能回推先前 91% host 樣本的原因；writer / appender / server 漏樣是本次量測器缺陷，不是它們沒有消耗 CPU。

## 流入、積壓、失敗與停止

- Source 40,946 筆 / 56,057,510B；清理後 committed 39,953 筆 / 54,698,108B；最後 API published 39,825 筆 / 54,522,861B。未發布 **1,121 筆 / 1,534,649B**。這不是同瞬間原子三方 snapshot；各口徑如上，沒有推全母體 latency PASS。
- 新 source 與原 frozen 的對應 prefix 逐 byte 一致，SHA256 `5e4fefea8a4fd2196132d39f173bc8894d7aab69e81757d3ba3fe8370a512d12`；frozen 的 dev/ino/birth/mtime/ctime/size 未變。未重新宣稱全 2GB hash 驗證。
- replay helper 及原 campaign 的 7 個 helper hash 與原 frozen contract 全部一致。100ms 工具未改；本次 append lateness p99 108.856ms，原 P99_LATENESS FAIL 保留，不作工具校驗/調參。
- 先後保留：沙箱 CIM 拒絕（5.660s，未啟 writer）；PDH 程序退出的 invalid counter 停止（30.298s）；診斷檔 Windows 分享鎖衝突停止（152.143s）；改用 pipe 後續段（203.588s）。合計 dynamic envelope 約 **391.689s / 6m31.689s**，另有短 CPU preflight。不是三次 G1-A 或三個改版候選，也沒有產品修正後的 retry。
- 最終停止原因 `MULTIPLE_VERIFICATIONS_HIGH_HOST_LOAD_NOT_REPRODUCED`。先前 sampler 失敗與 cleanup 暫時的程序退出競態保留；最終 controller 確認 writer / appender / server 與 3073 listener 不存在。未延長到 60min、未做 restart/drain acceptance。
- 原 CPU >85% 兩次且間隔≥30s、RAM≥6GiB、writer RSS≤2GiB、disk≥100GiB 的安全 gate 未放寬。正式 8787 前後回報 `e81c5259b5e38db6ad573242e9cf1ee4f305207f`；沒有正式 collector/raw/SQLite/Scheduler/五日計數操作。

## 交付與停止點

[去敏量測摘要](summary.json)；[本機證據 SHA256 清單](evidence-hashes.json)。完整私人檔案保留於 `data/test-tmp/root-cause-probe` 與 `data/test-tmp/root-cause-probe2`。早期 summary 的 anchor-check 限制敘述由 post-audit 更正：最後 hook 已包含 target / pending / receipt comparisons；未分攤的主要邊界是 chunkPath validation、bookkeeping 與 instrumentation。

下一步只交回 Owner：若日後另決定補足量測，必要缺口是 **每個 CPU endpoint 動態覆蓋當下全部程序，先驗證必要角色確實被捕獲；把 chunkPath 驗路徑成本納入互斥分項；仍須真正觀測到高負載才可歸因**。本次不啟動該工作，也不建立快取、弱化 guard 或延伸到其他產品優化。

Resume: CRU-55 In Progress / G1-A FAIL-STOPPED；runtime source HEAD 5f3634aa…；無產品 diff，只有診斷報告/私人工具。Product root cause=NOT_PROVEN；Runtime fix=NONE；Level3 runtime review=NOT_TRIGGERED；last G1-A retry=UNUSED；Merge/Promotion/formal activation=NONE。安全旗標保持 0 / true / false / false。
