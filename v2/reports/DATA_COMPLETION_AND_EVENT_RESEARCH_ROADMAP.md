# Data completion and future event research roadmap

Date: 2026-07-14

## Active decision

Complete and validate the daily research database before starting new large-move event studies or sector-rotation conclusions.

## Data acceptance gates

1. At least three contiguous years for TX, TAIEX, institutional spot flow, institutional futures positions, total OI and margin financing.
2. Taiwan VIX history extended as far as the official source permits and its shorter coverage disclosed.
3. Every observation records trade date, source date, fetch time and availability timing.
4. Missing core data never becomes zero and never generates a strong production recommendation.
5. Daily updates are resumable, rate-limited and followed by a quality report.

## Queued research target A: reverse large-move event study

- Define large rises, large falls and large ranges using rolling ATR or past-only volatility thresholds.
- Inspect 1, 3, 5 and 10-day precursor windows.
- Compare events with regime-matched non-event controls.
- Convert discovered patterns into forward rules and validate them on untouched holdout data.
- Primary outputs: large-move probability, trend/range probability, jump risk, MAE, MFE and no-trade conditions.

## Queued research target B: sector rotation and defensive concentration

The hypothesis is not "defensive buying causes a market fall." The testable hypothesis is that unusually concentrated buying in defensive sectors, combined with weak financials/cyclicals, narrowing breadth and index-level risk signals, may identify risk-off rotation.

Required future data:

- Daily stock returns and turnover.
- Per-stock foreign, trust and dealer net flows.
- Stable industry classification with history/versioning.
- Sector breadth, relative strength and turnover share.
- Defensive-flow concentration and financial/electronics confirmation.

Candidate outputs:

- Defensive rotation score.
- Cyclical participation score.
- Market breadth deterioration score.
- Probability of a large decline over the following 1, 3 and 5 days.

This research remains queued until the core daily database passes the acceptance gates above.
