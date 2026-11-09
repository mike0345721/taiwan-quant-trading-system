# Level-reaction V3 — does order flow at the level add information? (training window)

Flow: tick-rule buy/sell volume per 5m bar, built on MSI from TAIFEX official tick files (159 days, 0 errors).
Validation: all 318 sessions match the official 5m OHLC and volume exactly; unknown-side volume ≤ 0.96%.
Events/exits: V2 (spec cfb0160d3c12). Flow spec 3f49896cc2c8 pre-registered before flow data existed. Holdout not read.

## Primary (Holm over 2)
| Test | n | flow-confirmed | mean net R confirmed | other | diff | pHolm |
|---|---|---|---|---|---|---|
| REJECT + absorption (push into level) | 4,942 | 2,348 | −0.073 | −0.056 | −0.017 | 0.79 |
| ACCEPT + push through | 4,817 | 4,684 | −0.052 | −0.098 | +0.046 | 0.55 |

Neither passes. ACCEPT split is near-degenerate (97% confirmed): closes beyond a level almost always come with tick-rule flow in the same direction, so the sign filter carries little new information.

## Descriptive
REJECT terciles of push (low → high): −0.032R, −0.071R, −0.089R. Stronger aggression into the level makes the fade worse, the opposite of the absorption idea. Not separately tested.

## Verdict
Tick-rule flow at 5m resolution adds no cost-surviving information to level reactions. FLOW_NO_INFO / NOT_PROMOTED / HOLDOUT_UNTOUCHED / NO_ORDERS. Cumulative attempts on this window: 24 primary (+ descriptive).
