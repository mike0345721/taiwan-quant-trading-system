# CRU55 發布耗時補充分析

Owner 最新一鍵更新範圍明示容量問題不能被更新封裝取代。本輪分析已保留的正常managed證據，新增僅對既有私人副本做讀取/hash基準；未重做UI、登入或prefix修復，未對正式raw加鎖或停collector。

原run程式版本仍為17d210dbaa5ac0ab833b9f272b54463fd5538ab2；本次分析基線1ad9ec7c1814e401f8352048638f0a398bcf74fe。兩份原managed log雜湊分別為ac0fcdd4737822d9783e07be013eb3f4359e5d330fffab75b4778c608eb9bced與e7df8554b2de6f37d42ed7645330b1ee7e7be0a9049c865d63bef8179e877e1f。共1723個完成cycle；被kill未完成的cycle不在此統計。

| cycle回傳階段 | 次數 | cycle時間總和秒 |
| --- | ---: | ---: |
| INGEST | 61 | 318.139 |
| PROJECT | 507 | 418.700 |
| VERIFY | 469 | 220.439 |
| VERIFY_PRIOR | 686 | 269.251 |

這是按**cycle結束時的phase**分桶，不是精確函式self-time；phase transition／publication可能混在回傳桶內。cycleMs不含managed caller的設定、source選擇、狀態I/O。推定sleep是依未改managedDelayMs算出的要求值，不是直接量到的實際睡眠。

追加起點13:40:11.825Z，原先13:39:47.467Z捕獲60000的round仍須完成。62000 round至13:45:15.268Z才開始，**先等待303.443秒**。該round位於第二log第569–857行，自己工作合計89.658秒：INGEST7.618、PROJECT44.071、VERIFY28.403、VERIFY_PRIOR9.567。中間輪巡另一source工作54.751秒，推定sleep81.500秒；round開始到首次pub觀察共358.447秒，剩132.539秒未歸因（managed overhead、排程、觀察間隔等）。加上capture等待，與原661.890秒觀察上界一致。

具體耗時來源：每次捕獲round重新投影全部archive並完整核驗current/prior；多檔輪巡也讓小型未增長source反覆驗較大DAY prior。2.47MB/1800筆檔有70個logged rounds，其中66次UNCHANGED、3次PUBLISHED、1次未完成。自己的cycle時間406.292秒，VERIFY_PRIOR桶225.308秒。prior變化可解釋相同ordinal的新artifact，卻不能消除66次UNCHANGED帶來的實際工作。此問題不同於已修好的append使驗證cursor重啟，不能歸咎缺原始資料或UI輪詢。

## 新增私人副本讀取量測

對既有84,757,597bytes私人copy，以512KiB區塊連續讀取＋SHA256三次：267.824、268.321、260.860ms，約301–310MiB/s。每次hash均為71a3bfb12e0270963d602c1818764b4a57eb05aa53b06272a34e446f4450a3e2；檔案identity/size/mtime不變，無prefixguard、無寫入。很可能是warm-cache，不是cold-disk測試。

這排除了把全部分鐘數直接當成該私人檔的必要順序hash成本；不測per-chunk路徑/metadata檢查、JSON/archive、投影、prior與managed工作。同速把1.95GB做純算術外推約6.00–6.17秒，**未在該量級測試，不是managed capacity PASS**，更不是正式I/O非干擾保證。正式量級約為私人片段23倍，但snapshot密度、session/prior與每publication歷史成本不可只按bytes等比例推論。

## 容量結論與下一個必要實驗

正式全天啟用仍NOT_ESTABLISHED。更新候選只處理小型切換正確性，不能解除此限制。

下一個針對性實驗應用正常managed、相同60000起點＋小型第二dated檔，在十分鐘內按宣告節奏追加同一frozen62000的合法原始suffix；保留完整核驗與原8-page/8MiB budget。初始追趕、持續追加、停止後drain分開；量測manager設定/輪巡/status、各phase transition、實際sleep、publication、backlog、RSS/CPU，完整記錄多檔交錯。計時instrumentation如改resolver，必須新輸出與版本身分。若未在bounded run完成，保留NOT_ESTABLISHED與非零backlog，不停collector救結果。

後續需要針對不必要UNCHANGED輪巡、全歷史投影及managed overhead比較方案；不能跳過每次真publication的完整prefix驗證或沿用失效lease。若Owner希望先試正式環境，仍須明確接受容量限制並批准來源保護、監看/停止/回退条件；目前未取得此批准。

私人可重現分析保存在本次worktree data/update-review-performance/{analyze.mjs,stage-analysis.json,read-throughput.mjs,read-throughput.json,README.md}，內含來源行號與雜湊；原raw與機器路徑未上傳。
