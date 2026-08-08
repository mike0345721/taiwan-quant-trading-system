# V3.6.2 跨市場大研究完整報告

產生時間：2026-07-16T01:17:14.612Z

協議 SHA-256：`93ff3606b33eafbc107b3ef1d4a090ab34ecde7370ac2e77b909eac9131c11d8`

## 先說結論

- 品質、涵蓋率與 available_at 時間閘門重新通過，`researchReady=true` 後才開始研究。
- 沒有任何方向模型達到證據等級3；目前不得調整首頁方向分數，也不得進入模擬或實單。
- 最高只到證據等級2：VIX上升仍較適合當波動／縮小曝險參考，不是做空訊號。
- 外資期貨5日變化、價格OI反轉2日、外資單日加空隔日雖通過舊版第一關，但共同日期配對增量在最終留出期全部未通過。
- R5沒有前置合格模型，因此依協議停止，沒有搜尋三市場交集。
- R7顯示大跌前較常見外資期貨偏弱及空單增加，但這是下一版假說，不能回頭當本輪有效策略。

## R0～R7總表

| 階段 | 判定 | 證據等級 | 說明 |
|---|---|---:|---|
| R0 | 未建立可超越基準的籌碼優勢 | 1 | 價格、價格＋OI、長期漂移的共同日期配對比較，在最終留出期沒有任何籌碼候選取得正的95%下緣。 |
| R1 | 3項通過舊版第一關，但均未升級 | 1 | 外資期貨5日變化、價格OI反轉2日、外資單日加空隔日共3項標示passed_first_gate；尚未通過配對增量與新前推。 |
| R2 | 跨市場增量未通過 | 1 | 最終留出配對通過 0 項；外資現貨＋期貨、投信及自營商組合未證明額外價值。 |
| R3 | 大額部位只保留結構觀察 | 1 | 大額交易人與隔日日盤方向的線性相關很低；轉倉日須獨立標記，不能直接解讀成多空。 |
| R4 | 選擇權攻防沒有方向候選 | 1 | 牆位與Max Pain策略未通過；ATM IV與Skew有波動線索，但Holm校正未通過。 |
| R5 | 未啟動 | 0 | R2至R4沒有配對模型通過最終留出增量門檻，依預註冊停止三市場交集。既有探索輸出不得算作R5證據。 |
| R6 | VIX保留為風險觀察，其餘不計分 | 2 | VIX上升對絕對波動的放大在前後期同向；不交易否決層仍因留出樣本不足而不能上線。 |
| R7 | 產生下一版假說，不回填本輪 | 1 | 辨識大漲50、大跌38、大區間85日；外資期貨5日變化在大跌前出現較一致差異，但只能前推驗證。 |

## 正向、反向與未通過概況

- 舊版完整策略共 52 項；通過舊版第一關 3 項。
- 鏡像報告：原方向支持 6、反向候選 2、只在留出期反向 5、不確定 16、樣本不足 23。
- 以上鏡像結果均未因此升級；反向規則須視為新假說並等待新前推資料。

## 共同日期配對增量

| 家族 | 期間 | 比較對象 | 共同日 | 差異點數 | 95%區間 | 判定 |
|---|---|---|---:|---:|---:|---|
| chip_incremental_h2 | development_walk_forward | price_only_benchmark_h2 | 428 | 10572 | 573～19990 | 通過 |
| chip_incremental_h2 | development_walk_forward | price_oi_benchmark_h2 | 428 | 6239 | -2176～16112 | 未通過 |
| chip_incremental_h2 | development_walk_forward | foreign_price_ablation_h2 | 428 | 3277 | -2545～8872 | 未通過 |
| chip_incremental_h2 | development_walk_forward | matched_long_drift | 428 | 3306 | -3475～10051 | 未通過 |
| chip_incremental_h2 | final_holdout | price_only_benchmark_h2 | 147 | -1202 | -13549～10998 | 未通過 |
| chip_incremental_h2 | final_holdout | price_oi_benchmark_h2 | 147 | 4800 | -3724～14590 | 未通過 |
| chip_incremental_h2 | final_holdout | foreign_price_ablation_h2 | 147 | -1294 | -9738～6284 | 未通過 |
| chip_incremental_h2 | final_holdout | matched_long_drift | 147 | 1336 | -11787～16215 | 未通過 |
| chip_incremental_h3 | development_walk_forward | price_only_benchmark_h3 | 428 | -4610 | -14036～5041 | 未通過 |
| chip_incremental_h3 | development_walk_forward | price_oi_benchmark_h3 | 428 | 5125 | -2298～13431 | 未通過 |
| chip_incremental_h3 | development_walk_forward | foreign_price_ablation_h3 | 428 | 1461 | -6906～10622 | 未通過 |
| chip_incremental_h3 | development_walk_forward | matched_long_drift | 428 | -2094 | -8346～3419 | 未通過 |
| chip_incremental_h3 | final_holdout | price_only_benchmark_h3 | 147 | 12154 | -4649～29469 | 未通過 |
| chip_incremental_h3 | final_holdout | price_oi_benchmark_h3 | 147 | 4358 | -7267～17015 | 未通過 |
| chip_incremental_h3 | final_holdout | foreign_price_ablation_h3 | 147 | 6141 | -2025～14706 | 未通過 |
| chip_incremental_h3 | final_holdout | matched_long_drift | 147 | 1100 | -12219～16170 | 未通過 |

## 新補齊因子

| 階段 | 因子 | 留出尾端樣本 | 正向PF | 鏡像PF | 高值減低值絕對波動 | 判定 |
|---|---|---:|---:|---:|---:|---|
| R4 | 近週 ATM IV | 105 | 0.84 | 1.10 | 224.14 | risk_observation |
| R4 | 近週 25D Skew | 122 | 0.90 | 1.02 | 160.80 | risk_observation |
| R4 | 近週 IV-RV | 101 | 0.88 | 1.05 | -55.14 | not_supported |
| R4 | 月選減週選 IV 期限差 | 113 | 0.80 | 1.14 | -12.94 | risk_observation |
| R6 | 借券餘額 5 日變化率 | 67 | 1.10 | 0.83 | -64.05 | direction_observation_not_minimum_100 |
| R6 | 借券賣出餘額 5 日變化率 | 76 | 0.98 | 0.93 | -79.09 | risk_observation |
| R6 | 上市市場廣度 | 51 | 1.02 | 0.90 | 6.43 | direction_observation_not_minimum_100 |
| R6 | 上櫃市場廣度 | 57 | 1.26 | 0.73 | -13.92 | direction_observation_not_minimum_100 |

ATM IV與Skew的高值組在留出期呈現較大絕對波動，但經同家族Holm校正後未通過；只能保留描述觀察。上櫃廣度的方向PF雖為 1.26，留出尾端僅 57 筆且信賴區間跨0，不是方向候選。

## R6風險層

- VIX 5日上升高值組的絕對波動放大：開發區約 1.38 倍，後段約 1.20 倍。
- 高波動否決層在留出期排除5筆後，保留交易PF由 1.43 提升到 3.30，但樣本未達門檻，判定仍為 `insufficient_holdout`。
- 基差及期限結構：沒有特徵通過最低時間序列驗證門檻；目前只顯示資訊，正式評分權重為0。

## R7大行情前兆

事件數：大漲 50、大跌 38、大區間 85。下表完整保留探索候選；它們只產生下一版假說。

| 事件 | 前置天數 | 因子 | 標準化差異 | 狀態 |
|---|---:|---|---:|---|
| large_fall | 5 | foreignFuturesDelta5d | -0.785 | candidate |
| large_fall | 1 | foreignFuturesDelta5d | -0.732 | candidate |
| large_fall | 3 | foreignFuturesDelta5d | -0.731 | candidate |
| large_fall | 5 | foreignShortDelta3d | 0.651 | candidate |
| large_fall | 1 | optionPc | -0.591 | candidate |
| large_fall | 1 | foreignSpot | -0.572 | candidate |
| large_fall | 3 | foreignShortDelta3d | 0.561 | candidate |
| large_fall | 3 | foreignFuturesDelta1d | -0.526 | candidate |
| large_range | 5 | foreignFuturesDelta1d | -0.517 | candidate |
| large_fall | 1 | foreignSpot3d | -0.512 | candidate |
| large_fall | 10 | optionPc | 0.473 | candidate |
| large_rise | 1 | marginBalanceDelta5dE | -0.464 | candidate |
| large_range | 5 | marketOiDelta1d | 0.463 | candidate |
| large_range | 5 | marketOiDelta3d | 0.445 | candidate |
| large_range | 1 | optionPc | -0.442 | candidate |
| large_fall | 5 | fredVix | -0.428 | candidate |
| large_rise | 5 | marginBalanceDelta1dE | -0.427 | candidate |
| large_range | 3 | foreignFuturesDelta5d | -0.409 | candidate |
| large_range | 1 | foreignSpot | -0.397 | candidate |
| large_rise | 10 | marginBalanceDelta5dE | 0.395 | candidate |
| large_fall | 10 | foreignSpot3d | 0.393 | candidate |
| large_fall | 1 | foreignShortDelta3d | 0.390 | candidate |
| large_range | 1 | marginBalanceDelta1dE | -0.386 | candidate |
| large_rise | 10 | fredVix | -0.360 | candidate |

## 所有正式策略結果

| 策略 | 閘門 | Walk-forward交易 | Walk-forward PF | 留出交易 | 留出PF |
|---|---|---:|---:|---:|---:|
| foreign_spot_5d | failed_walk_forward | 328 | 0.93 | 111 | 1.08 |
| foreign_futures_delta_5d | passed_first_gate | 294 | 1.07 | 89 | 1.04 |
| active_option_pc | failed_walk_forward | 304 | 0.92 | 93 | 1.07 |
| max_pain_convergence | failed_fold_stability | 202 | 1.39 | 51 | 1.10 |
| option_wall_migration | failed_walk_forward | 68 | 0.79 | 13 | 0.21 |
| option_wall_breakout_oi | failed_walk_forward | 16 | 0.85 | 5 | 0.19 |
| sox_overnight | failed_walk_forward | 306 | 0.91 | 104 | 0.63 |
| ndx_overnight | failed_walk_forward | 300 | 0.97 | 98 | 0.56 |
| usdtwd_previous | failed_walk_forward | 308 | 0.76 | 87 | 2.08 |
| global_tech_alignment | failed_walk_forward | 219 | 0.90 | 59 | 0.84 |
| composite_vote | failed_fold_stability | 198 | 1.05 | 35 | 1.50 |
| composite_bull_filter | insufficient_sample | 91 | 1.00 | 14 | 1.84 |
| composite_bull_long_only | failed_walk_forward | 62 | 0.76 | 8 | 3.59 |
| composite_bull_short_only | failed_holdout | 29 | 1.41 | 6 | 0.96 |
| foreign_futures_price_oi | failed_fold_stability | 65 | 1.22 | 20 | 1.99 |
| foreign_futures_price_oi_h2 | failed_fold_stability | 57 | 1.34 | 16 | 1.43 |
| foreign_futures_price_oi_h3 | failed_walk_forward | 44 | 0.77 | 15 | 2.32 |
| price_only_benchmark_h2 | failed_walk_forward | 238 | 0.74 | 72 | 1.16 |
| price_oi_benchmark_h2 | failed_walk_forward | 126 | 0.74 | 38 | 0.77 |
| price_oi_reversal_h2 | passed_first_gate | 126 | 1.19 | 38 | 1.23 |
| foreign_price_ablation_h2 | failed_walk_forward | 134 | 0.94 | 28 | 1.41 |
| foreign_price_oi_no_highvol_h2 | insufficient_sample | 53 | 1.32 | 11 | 3.30 |
| price_only_benchmark_h3 | failed_holdout | 153 | 1.15 | 46 | 0.72 |
| price_oi_benchmark_h3 | failed_walk_forward | 95 | 0.67 | 30 | 1.07 |
| foreign_price_ablation_h3 | failed_walk_forward | 97 | 0.86 | 22 | 0.92 |
| foreign_price_oi_no_highvol_h3 | failed_walk_forward | 42 | 0.68 | 10 | 2.90 |
| foreign_futures_price_oi_h5 | insufficient_sample | 34 | 1.20 | 11 | 2.11 |
| foreign_short_add_1d_h1 | passed_first_gate | 136 | 1.28 | 45 | 1.38 |
| foreign_short_add_1d_h3 | failed_walk_forward | 80 | 0.88 | 21 | 0.85 |
| foreign_short_add_1d_h5 | failed_walk_forward | 50 | 0.93 | 13 | 0.62 |
| foreign_short_build_3d_h1 | failed_fold_stability | 143 | 1.13 | 51 | 1.09 |
| foreign_short_build_3d_h3 | failed_walk_forward | 68 | 0.84 | 20 | 0.78 |
| foreign_short_build_reversal_h3 | failed_fold_stability | 68 | 1.07 | 20 | 1.24 |
| foreign_short_build_3d_h5 | failed_walk_forward | 46 | 0.98 | 16 | 0.75 |
| foreign_short_no_drop_h3 | failed_holdout | 27 | 1.30 | 14 | 0.75 |
| foreign_short_no_drop_h5 | failed_walk_forward | 19 | 0.74 | 11 | 1.05 |
| institutional_net_alignment_h1 | failed_walk_forward | 0 | 0.00 | 0 | 0.00 |
| institutional_net_alignment_h2 | failed_walk_forward | 0 | 0.00 | 0 | 0.00 |
| institutional_net_alignment_h3 | failed_walk_forward | 0 | 0.00 | 0 | 0.00 |
| institutional_delta_alignment_h1 | failed_walk_forward | 43 | 0.70 | 11 | 1.77 |
| institutional_delta_alignment_h2 | failed_walk_forward | 39 | 0.78 | 9 | 1.76 |
| institutional_delta_alignment_h3 | failed_walk_forward | 32 | 0.95 | 7 | 1.18 |
| institutional_delta_confirmed_h1 | failed_walk_forward | 11 | 0.29 | 0 | 0.00 |
| institutional_delta_confirmed_h2 | failed_walk_forward | 11 | 0.87 | 0 | 0.00 |
| institutional_delta_confirmed_h3 | failed_walk_forward | 11 | 0.94 | 0 | 0.00 |
| foreign_trust_delta_h1 | failed_holdout | 248 | 1.19 | 77 | 0.79 |
| foreign_trust_delta_h2 | failed_holdout | 157 | 1.05 | 48 | 0.59 |
| foreign_dealer_delta_h1 | failed_walk_forward | 131 | 0.97 | 48 | 0.92 |
| foreign_dealer_delta_h2 | failed_fold_stability | 98 | 1.20 | 33 | 1.05 |
| foreign_led_confirmed_h1 | failed_holdout | 46 | 1.11 | 12 | 0.72 |
| foreign_led_confirmed_h2 | failed_walk_forward | 41 | 0.98 | 12 | 1.52 |
| max_pain_atr_convergence | failed_holdout | 81 | 1.16 | 14 | 0.64 |

## 最終決策

1. 首頁方向評分不變，所有新因子研究權重維持0。
2. VIX可保留研究頁風險提示，但不得顯示成做多／做空。
3. 凍結R7的外資期貨前兆定義，至少收集30筆真正未看過的前推事件再複驗。
4. R5、模擬交易與實單都不啟動。
5. 本次歷史留出資料已被看過，後續不得再稱為全新驗證。
