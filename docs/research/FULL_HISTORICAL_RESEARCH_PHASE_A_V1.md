# FULL HISTORICAL RESEARCH PROGRAM v1 — Phase A

> 狀態：Product Owner原則批准；A10／A11／A12／A13已另行明確核准  
> 已允許：Snapshot、Inventory、Lineage、可恢復框架、Smoke Test、A10、A11、A12與A13  
> A20以後完整運算前置：另行取得Product Owner核准  
> 安全邊界：`formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`

## 目的與上限

Phase A使用截至2026-07-30的盤前日資料，完成Feature Inventory、Lineage、
品質與`available_at`稽核、單因子與Evidence Block研究、透明模型、有限非線性
Challenger、Walk-forward、Regime穩定性及負控制。

Phase A最多只能產生：

- `F1 PASS／FAIL`
- `F2 PASS／FAIL`
- 最多5個`F3_PREREGISTRATION_CANDIDATE`

不得直接判定F3 PASS，不得產生F4～F7、正式權重、Signal、交易建議或產品功能。
Phase B須等待PP-1完成後，才使用5分鐘與逐筆資料研究T0、ORB、VWAP、RVOL、
Price Path、MAE／MFE、False Breakout及Daily Bias增量。

## 不可變研究指紋

每次Run固定保存：

- Snapshot SHA-256
- Source DB SHA-256
- Git Commit；若本機沒有有效Git metadata，保存`null`及原因
- Code Manifest SHA-256
- 本規格SHA-256
- Target Spec SHA-256
- Feature Spec SHA-256
- Feature Version
- 固定Random Seed

任何指紋不一致時停止，不得混合新舊結果。

## 可恢復執行契約

1. 每個Stage可獨立執行。
2. Job Key包含`stage／factorId／targetId／foldId／modelId`。
3. Job狀態固定為`PENDING／RUNNING／COMPLETED／FAILED`。
4. `--resume`只執行`PENDING`、`FAILED`及Crash後被安全還原為`PENDING`的Job。
5. 每個Job輸出先寫入同目錄暫存檔，驗證後以rename原子提交。
6. 已完成且Hash有效的輸出不得覆寫；Hash不一致立即停止。
7. Crash留下的`RUNNING`Job在驗證不可變指紋後才可恢復。
8. 報告彙總只讀取已完成Job產物，不重跑模型。
9. Run目錄必須持續產生：
   - `RUN_STATUS.json`
   - `COMPLETED_JOBS.csv`
   - `FAILED_JOBS.csv`
   - `NEXT_RESUME_COMMAND.txt`
10. 同一Run同時只允許一個Writer；使用PID Lock防止重複程序。

## Stage與三層漏斗

| Stage | 名稱 | Round | 執行授權 |
|---|---|---:|---|
| A00 | Preflight與不可變指紋 | Prepare | 已完成 |
| A01 | SQLite唯讀Snapshot與Manifest | Prepare | 已完成 |
| A02 | Raw Feature Inventory | Prepare | 已完成 |
| A03 | Canonical Feature Lineage | Prepare | 已完成 |
| A04 | Resume／Atomic Commit Smoke Test | Prepare | 已完成 |
| A10 | Data Quality與available_at | Round 1 | 2026-07-30 Owner核准 |
| A11 | Canonical Feature Materialization | Round 1 | 2026-07-30 Owner核准 |
| A12 | 單因子Direction／Risk／Regime | Round 1 | 2026-07-30 Owner核准 |
| A13 | 低成本Placebo／Random Feature | Round 1 | 2026-07-30 Owner核准 |
| A20 | Redundancy Cluster | Round 2 | 禁止 |
| A21 | Cash／Futures／Options Evidence Block | Round 2 | 禁止 |
| A22 | Transparent Models與Walk-forward | Round 2 | 禁止 |
| A23 | Rolling／Regime／強負控制 | Round 2 | 禁止 |
| A30 | 最多5個F3候選凍結 | Round 3 | 禁止 |
| A31 | Explainable GAM Challenger | Round 3 | 禁止 |
| A32 | 2,000次Placebo／Block Bootstrap | Round 3 | 禁止 |
| A33 | Promotion Board與Phase B Queue | Round 3 | 禁止 |
| A40 | 從完成產物重建報告 | Aggregate | 禁止 |

Round 1失敗的因子不得進Round 2最高成本運算；Round 2未通過者不得進Round 3。

## A10／A11資料契約

### A10：Data Quality與available_at

- 每個Canonical Factor各自一個可恢復Job，另有一個Stage Summary Job。
- 盤後本地官方日資料只允許用於下一個`market_daily`交易日，保守視為來源日
  `23:59:59+08:00`前可用。
- 美國市場日資料以來源交易日後一個日曆日`06:00:00+08:00`作保守可用時間，
  且只取`sourceTradeDate < decisionTradeDate`的最近資料。
- 有明確`available_at`的選擇權波動資料使用原始時間戳。
- 只有`observation_date`、沒有發布或擷取時間的Macro資料標記
  `BLOCKED_AVAILABLE_AT`，不得假設當日已知。
- 重複主鍵、`available_at >= decisionAt`、無映射公式或無可信時間語意均不得靜默通過。
- A10可以`PASS_WITH_EXPLICIT_QUARANTINE`；這只表示不可信因子已隔離，不代表因子升級。

### A11：Canonical Feature Materialization

- 決策時間固定為每個交易日`08:30:00+08:00`，每列保存
  `decisionTradeDate`、`decisionAt`、`sourceTradeDate`、`availableAt`與來源契約。
- 缺值保持`null`；Blocked、Warmup、Zero Variance與來源品質警告均保留明確狀態。
- `past_only_z60`只使用當前值之前的60個不同來源日，不含當前觀察。
- `delta_1d`比較前一個不同來源日；3日／5日轉換不得把同一外部市場來源日重複計算。
- Cash Flow、報酬及Breadth Balance使用滾動加總；部位與水位使用期末減期初。
- Breadth使用標準化Balance：`(positive-negative)/(positive+negative)`。
- Max Pain距離與Wall不對稱均相對來源日TX收盤標準化。
- 選擇權契約使用在決策日尚未到期的最近到期契約；選擇權波動率採同規則並以
  observations作同到期日排序依據。
- 逐因子產物為NDJSON；Stage完成後建立唯讀Canonical SQLite，保存資料Digest與
  全部Immutable Hash。
- 同一Snapshot與Spec重播必須得到相同資料Digest，否則A11失敗。

### A12：單因子Direction／Risk／Regime描述

- Job單位固定為`factorId × targetId × CHRONO_70_30_PURGE_1 × DESCRIPTIVE_UNIVARIATE`。
- 固定Target為Target Spec中的7項；換約日不得計算契約敏感Target。
- 前70%日期只作Development，接續1日完全Purged，剩餘日期作Evaluation。
- Large Move 80%與Downside Tail 10%門檻只能由Development資料計算。
- 每個Job保存Pearson、Spearman、Evaluation Quintile、年度、波動、趨勢、
  結算窗口及極端日集中度。
- A12不計算p值、不作多重比較判決、不產生排名、不判定F2／F3通過。
- A12完成只能標記`DESCRIPTIVE_COMPLETE`或`INSUFFICIENT_DATA`；
  是否值得進A13必須另行取得Product Owner批准。

### A13：低成本負控制與Round 2運算分配

- Job單位固定為`factorId × targetId × CHRONO_70_30_PURGE_1 × LOW_COST_NEGATIVE_CONTROLS`。
- 只使用A12固定Evaluation區段；不得重新切分、重選Target或改變Development門檻。
- 固定執行200次、5交易日Moving Block Factor Permutation，以及50個固定種子的
  Gaussian Random Feature競爭。
- 同時檢查Evaluation的Spearman效果量、Quintile效果量、前5日貢獻集中度與
  未來一期Factor Lead Dominance。
- Round 2暫定運算分配門檻固定為：
  `abs(Spearman)>=0.05`、Block Permutation empirical p值`<=0.10`、
  超過Random Feature絕對Spearman第95百分位、標準化Quintile差`>=0.10`、
  前5日貢獻`<=40%`，且不得被未來一期Factor明顯支配。
- empirical p值只作低成本漏斗，不作Holm、多重比較或Promotion判決。
- `PROVISIONAL_ROUND2_PASS`只代表值得申請A20運算，不代表因子有效、F2／F3通過、
  可設定權重或可進入產品。
- A13完成後必須停止；A20仍需Product Owner另行核准。

## Operations隔離

- 正式DB只用SQLite read-only連線建立Snapshot。
- 研究只讀Snapshot，不再開啟正式DB。
- 研究Allowlist不包含`data/live-events`、Bridge、Frozen Models或Forward Registry。
- 08:15～13:50禁止完整研究運算。
- Heavy Stage最多2個Worker，目標記憶體上限6GB，程序優先權為Below Normal。
- Phase A不匯入Broker模組、不連接8790、不使用外部API。
- 研究前後保存正式DB、Frozen Spec、Frozen Models與Forward Registry的Hash證據。

## 模型與驗證固定邊界

- 透明模型：Ridge Logistic／Ridge Regression／Huber敏感度。
- Challenger：第一版只允許Explainable GAM；Shallow Boosting須另行批准。
- Expanding Walk-forward：最少360日Train、1日Purge、60日Test。
- Rolling Robustness：252日Train、1日Purge、63日Test。
- Rolling／標準化只能使用當時以前資料。
- 只允許Feature Spec列出的固定尺度，不進行無限制窗口搜索。
- Round 3固定2,000次5日與10日Moving Block Bootstrap／Placebo。
- 同Target Family使用Holm修正，不以單一p值決定Promotion。

## 暫停與失敗

出現下列任一情況即停止：

- Snapshot、Spec、Target或Feature Hash改變。
- 完成Job輸出Hash失配。
- 正式DB、Frozen或Registry保護Hash在研究期間改變。
- 研究需要未預先登記的Target、窗口、interaction或模型。
- Operations Observer仍在執行或進入禁止運算時段。
- 記憶體、磁碟或資料品質無法安全維持。
