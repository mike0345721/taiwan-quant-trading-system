# Level-reaction study V1 (research only)

Question: when TX price reaches a predefined level, does a fixed reaction rule plus a fixed stop/target beat random entries at the same session and hour, after real costs?

- Levels: SWING (confirmed 2L/2R pivots), OB, FVG (from `src/market-structure-core.mjs`), OR (08:45–09:00 high/low), PD (prior day-session high/low).
- Reaction (decided at the close of touch bar + 2 bars): REJECT = all closes stayed on the approach side → fade; ACCEPT = all closes beyond → continue; otherwise CHOP = no trade.
- Exit: stop 1.5 × ATR14(5m), target 2R, 12-bar (60 min) time exit; stop wins if both hit in one bar; gap through stop fills at the open.
- Cost: `research/t0-v1/cost-policy.json` (TX NT$30/side, tax 0.00002, 1/2/3 ticks slippage per side). Primary view = 2 ticks.
- Control: for every event, a random entry bar and direction in the same session and hour with identical exits. p = share of control draws at least as good. Holm adjustment across all 10 cells (5 levels × 2 reactions). Day-clustered bootstrap CI.
- Spec is frozen: `STUDY_SPEC_HASH` in `src/level-reaction-study.mjs`. Any change = new version, new attempt count.

Synthetic validation (`node research/level-reaction-v1/validate-synthetic.mjs`):
pure random walk, 20 runs → 0 runs with a falsely significant positive cell; planted prior-day rejection edge, 10 runs → detected 10/10; look-ahead check on 7,342 events (future bars deleted or altered) → 0 changes.

Real data: `node research/level-reaction-v1/run-csv.mjs bars.csv --holdout-start YYYY-MM-DD --out result.json`.
Rows on/after the holdout date are refused. Cells with fewer than ~100 trades are descriptive only.
Limits: bar-based fills (intrabar order unknown), events are scored independently (not a portfolio), CVD and volume-profile filters are not used in V1 because they need tick data.
