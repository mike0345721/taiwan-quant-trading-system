# Market State V1 — Outcome Contract Freeze

> Work package: CRU-16  
> Status: OWNER-APPROVED CONTRACT / RESEARCH ONLY  
> Owner approval date: 2026-08-09  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Purpose

Freeze the first Market State → Outcome research contract **before** any linkage result, PnL, PF, Sharpe, threshold optimization, or multi-axis combination search is viewed.

This contract defines how the historical market outcome is measured. It does **not** claim predictive edge and does not authorize Strategy Permission, Risk Veto, Paper Trading, broker routes, or live execution.

## Frozen research boundary

For the first linkage pass:

- Market State `trend`, `direction`, `volatility`, and `globalAlignment` semantics are frozen and must not be changed because of linkage results.
- Outcome linkage may consume only the separate **`riskResearchContext`** field. Canonical `state.risk` never emits `ELEVATED`.
- Primary outcome analysis is **continuous-first**. No Large-Move, Downside-Tail, Trend-Day, Range-Day, Gap, or First-60m binary threshold is authorized in V1 primary analysis.
- First pass is **single-axis only**. No Cartesian search across Market State axes.
- No PnL / PF / Sharpe / trade-entry optimization.
- Opening Gap coverage work does not block the other four outcome families.

## Common semantics

### Basis points

For two positive prices `P0` and `P1`:

`returnBps(P0, P1) = 10000 × (P1 - P0) / P0`

No value is fabricated when the required price, timestamp, session, source lineage, or actual contract identity is missing.

### Session and contract

- Reuse the governed PP-1 trade-date / session / contract-selection semantics.
- Use the actual `selectedResearchContract` for the target day session.
- Continuous-series prices are not legal outcome inputs.
- Settlement sessions remain included and must be separately traceable; no settlement-specific performance rule is introduced.
- Roll / contract-change conditions are retained as metadata and must never be silently bridged.

## Outcome 1 — OPENING_GAP

Primary continuous outputs:

- `gapPoints = dayOpen - priorNightClose`
- `gapBps = 10000 × (dayOpen - priorNightClose) / priorNightClose`

Exact boundary:

- `priorNightClose` = final legal trade from the prior night session for the **same actual contractCode** used by the target day session.
- `dayOpen` = first legal trade at or after 08:45 for the target day session and selected actual contract.

If prior-night close and target-day open do not share the same actual `contractCode`, output is `UNAVAILABLE` with reason `ROLL_TRANSITION`; raw Gap must not be synthesized from a continuous series.

`availableAt` must be no earlier than the legal day-open observation and no earlier than the maximum legal availability of all required inputs.

Current data status: **PARTIAL**. Row-level legality / coverage gate remains required.

## Outcome 2 — LARGE_MOVE_CONTINUOUS

Observation window: governed TX day session 08:45–13:45.

Required prices from the same actual selected contract:

- `sessionOpen`
- `sessionHigh`
- `sessionLow`
- `sessionClose`

Primary continuous outputs:

- `upExcursionBps = 10000 × (sessionHigh - sessionOpen) / sessionOpen`
- `downExcursionBps = 10000 × (sessionOpen - sessionLow) / sessionOpen`
- `maxExcursionBps = max(upExcursionBps, downExcursionBps)`
- `sessionReturnBps = 10000 × (sessionClose - sessionOpen) / sessionOpen`

No binary `LARGE_MOVE=true/false` threshold is authorized in the V1 primary analysis.

Outcome is available only after the full governed day-session observation window is complete.

## Outcome 3 — DOWNSIDE_EXCURSION

This is intentionally named **Downside Excursion**, not candlestick lower-tail / lower-wick.

Observation window: governed TX day session 08:45–13:45.

Primary continuous outputs:

- `downsideExcursionBps = 10000 × (sessionOpen - sessionLow) / sessionOpen`
- `closeRecoveryFromLowBps = 10000 × (sessionClose - sessionLow) / sessionOpen`

The existing T0 trade-level MAE/MFE may be used only as audit evidence. It must not masquerade as full-session downside excursion.

No binary Downside-Tail threshold is authorized in the V1 primary analysis.

## Outcome 4 — TREND_RANGE_STRUCTURE

Primary analysis stays continuous. V1 does not authorize a binary Trend-Day / Range-Day threshold.

Required governed day-session values:

- `sessionOpen`, `sessionHigh`, `sessionLow`, `sessionClose`
- deterministic governed 5-minute price path using the existing aggregation semantics; do not create a second bar-construction policy.

Primary continuous outputs:

- `sessionReturnBps = 10000 × (sessionClose - sessionOpen) / sessionOpen`
- `closeLocation = (sessionClose - sessionLow) / (sessionHigh - sessionLow)` when `sessionHigh > sessionLow`; otherwise `UNAVAILABLE`
- `pathEfficiency = abs(sessionClose - sessionOpen) / Σ abs(path[i] - path[i-1])`

For `pathEfficiency`, the ordered path starts from the governed session open and then uses the governed 5-minute path nodes through the session close. If the denominator is zero or the required path is incomplete, output is `UNAVAILABLE`.

Interpretation is descriptive only:

- higher `pathEfficiency` = more one-directional path
- lower `pathEfficiency` = more back-and-forth path
- `closeLocation` near 1 = close near the session high
- `closeLocation` near 0 = close near the session low

These are descriptions, not trading rules.

## Outcome 5 — FIRST60M_CONTINUATION

Observation window: 08:45–09:45.

Boundary prices must come from the same actual selected contract and reuse governed tick / 5-minute boundary semantics:

- `P0845` = governed day-session open
- `P0900` = governed price at the 09:00 boundary
- `P0945` = governed price at the 09:45 boundary

Primary continuous outputs:

- `openingLegBps = 10000 × (P0900 - P0845) / P0845`
- `continuationRawBps = 10000 × (P0945 - P0900) / P0845`
- `total60mBps = 10000 × (P0945 - P0845) / P0845`
- `continuationInOpeningDirectionBps = sign(P0900 - P0845) × continuationRawBps`

If `P0900 == P0845`, opening direction is undefined; `continuationInOpeningDirectionBps` is `UNAVAILABLE` with reason `FLAT_OPENING_LEG` rather than inventing a direction.

Outcome `availableAt` must be no earlier than 09:45 and no earlier than the maximum legal availability of all required inputs.

No binary persistence / reversal threshold is authorized in the V1 primary analysis.

## First-pass linkage design

### Single-axis only

Analyze each axis separately:

- `trend`
- `direction`
- `volatility`
- `globalAlignment`
- `riskResearchContext` (research-only mapping of the historical risk axis)

Do not enumerate multi-axis combinations in the first pass.

### Sample-size policy

This policy is frozen before outcome exposure:

- `N < 20`: do not interpret.
- `20 <= N < 30`: descriptive only.
- `N >= 30`: effect size / confidence interval may be reported, but this still does not establish trading edge.

No group may be promoted, dropped, merged, or redefined because its observed outcome looks attractive or unattractive.

## Data alignment gate

Before linkage statistics:

1. Produce an alignment manifest between frozen historical Market State records and legal outcome rows.
2. Report exact intersection count per outcome family.
3. Report missing / unavailable reasons.
4. Preserve source date, session, actual contract, source hash / lineage where available, and outcome `availableAt`.
5. For Opening Gap, report the separate row-level same-contract coverage gate.
6. Deterministic replay must produce byte-stable / digest-stable outcomes from identical governed inputs.

## Forbidden after freeze

After outcome results are viewed, do not change this contract merely to improve results, including:

- Market State semantics
- outcome formulas
- observation windows
- contract-selection rules
- missing-data rules
- settlement handling
- sample-size gates
- first-pass single-axis restriction

Any future alternative definition must be a separately versioned hypothesis / research package and cannot overwrite V1 evidence.

## Execution boundary

`formalWeight=0`  
`researchOnly=true`  
`executionAuthorized=false`
