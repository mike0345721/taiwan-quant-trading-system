# V3.6.2 擴充因子正式研究

產生時間：2026-07-16T01:12:23.632Z

規格 SHA-256：`5b7f7c14962dc3c9fc639df041df09b350ea629d4f3909724e1359317e8874f1`

所有門檻只取開發期 Q25／Q75，訊號於下一日盤開盤才可使用，扣 8 點成本，缺值不補 0。正向策略與鏡像反向同時列出。

| 階段 | 因子 | 留出尾端樣本 | 高減低隔日點數 | 95%區間 | 正向PF | 反向PF | 高減低絕對波動 | 判定 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| R4 | 近週 ATM IV | 105 | -177.59 | -356.15～0.52 | 0.84 | 1.10 | 224.14 | risk_observation |
| R4 | 近週 25D Skew | 122 | -78.66 | -298.23～186.93 | 0.90 | 1.02 | 160.80 | risk_observation |
| R4 | 近週 IV-RV | 101 | -31.93 | -226.44～137.25 | 0.88 | 1.05 | -55.14 | not_supported |
| R4 | 月選減週選 IV 期限差 | 113 | 63.29 | -96.67～230.88 | 0.80 | 1.14 | -12.94 | risk_observation |
| R6 | 借券餘額 5 日變化率 | 67 | -63.59 | -323.69～176.57 | 1.10 | 0.83 | -64.05 | direction_observation_not_minimum_100 |
| R6 | 借券賣出餘額 5 日變化率 | 76 | -7.44 | -240.43～217.20 | 0.98 | 0.93 | -79.09 | risk_observation |
| R6 | 上市市場廣度 | 51 | -21.64 | -314.84～248.17 | 1.02 | 0.90 | 6.43 | direction_observation_not_minimum_100 |
| R6 | 上櫃市場廣度 | 57 | 101.96 | -207.75～423.60 | 1.26 | 0.73 | -13.92 | direction_observation_not_minimum_100 |

## 限制

- Calculated IV and Skew are research estimates from official settlement/close quotes, not official TAIFEX published IV.
- Daily data cannot establish intraday ordering.
- The final 20% is a reused historical holdout and is not pristine forward evidence.
- No missing value is converted to zero.
