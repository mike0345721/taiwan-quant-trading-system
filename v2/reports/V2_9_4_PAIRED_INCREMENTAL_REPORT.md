# V2.9.4 共同日期配對增量檢驗

產生時間：2026-07-16T01:08:50.099Z

Only a positive 95% lower bound is treated as paired incremental support. Reused holdout remains non-pristine and requires new forward confirmation.

| 持有 | 區間 | 比較基準 | 共同日 | 候選淨點差 | 95%區間 | 大於0機率 | 判定 |
|---:|---|---|---:|---:|---:|---:|---|
| 2日 | development_walk_forward | price_only_benchmark_h2 | 428 | 10572 | 573～19990 | 98.0% | 支持 |
| 2日 | development_walk_forward | price_oi_benchmark_h2 | 428 | 6239 | -2176～16112 | 91.8% | 不支持 |
| 2日 | development_walk_forward | foreign_price_ablation_h2 | 428 | 3277 | -2545～8872 | 86.4% | 不支持 |
| 2日 | development_walk_forward | matched_long_drift | 428 | 3306 | -3475～10051 | 82.3% | 不支持 |
| 2日 | final_holdout | price_only_benchmark_h2 | 147 | -1202 | -13549～10998 | 41.4% | 不支持 |
| 2日 | final_holdout | price_oi_benchmark_h2 | 147 | 4800 | -3724～14590 | 85.3% | 不支持 |
| 2日 | final_holdout | foreign_price_ablation_h2 | 147 | -1294 | -9738～6284 | 37.4% | 不支持 |
| 2日 | final_holdout | matched_long_drift | 147 | 1336 | -11787～16215 | 55.1% | 不支持 |
| 3日 | development_walk_forward | price_only_benchmark_h3 | 428 | -4610 | -14036～5041 | 18.9% | 不支持 |
| 3日 | development_walk_forward | price_oi_benchmark_h3 | 428 | 5125 | -2298～13431 | 90.1% | 不支持 |
| 3日 | development_walk_forward | foreign_price_ablation_h3 | 428 | 1461 | -6906～10622 | 59.4% | 不支持 |
| 3日 | development_walk_forward | matched_long_drift | 428 | -2094 | -8346～3419 | 22.3% | 不支持 |
| 3日 | final_holdout | price_only_benchmark_h3 | 147 | 12154 | -4649～29469 | 92.7% | 不支持 |
| 3日 | final_holdout | price_oi_benchmark_h3 | 147 | 4358 | -7267～17015 | 76.2% | 不支持 |
| 3日 | final_holdout | foreign_price_ablation_h3 | 147 | 6141 | -2025～14706 | 93.0% | 不支持 |
| 3日 | final_holdout | matched_long_drift | 147 | 1100 | -12219～16170 | 53.9% | 不支持 |

## 限制

- Bootstrap單位是每日淨點數差，保留5日區塊以降低序列相依造成的假精準。
- matched_long_drift只在候選實際交易機會上強制做多，用來檢查結果是否只是長期上漲漂移。
- 最終留出區已在舊版本檢視過，不能再稱為全新樣本。
