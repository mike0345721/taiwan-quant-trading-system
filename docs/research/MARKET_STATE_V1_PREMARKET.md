# Market State V1 — EOD / Premarket Semantics

> Status: DRAFT / RESEARCH ONLY  
> Work package: CRU-12  
> Scope: EOD / premarket market-state description only  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## 1. Purpose

Market State V1 answers:

1. What kind of market environment is currently observable?
2. Which evidence blocks agree or conflict?
3. Is the environment directional, volatile, risky, or globally supportive/adverse?
4. What should be researched next?

It does **not** answer:

- whether the next bar will rise or fall;
- whether a trade should be entered;
- how large a position should be;
- whether a strategy is formally allowed;
- whether live execution is authorized.

Market State is intended to become a future strategy-permission / routing layer only after separate validation and Product Owner approval.

## 2. Product boundary

P0 Forward Paper Validation remains the only active Product lane.

CRU-12 is an isolated Research / Design lane. It must not modify:

- `T0_H0_PHASE_B_BASELINE_V1`;
- P0 paper-trading logic;
- Frozen Artifacts or immutable historical evidence;
- broker/order routes;
- live execution authorization.

## 3. Why V1 is split into Premarket and Intraday

The 2026-08-09 D-drive / SQLite coverage audit found that daily / EOD evidence is materially more mature than synchronized intraday cross-market evidence.

Therefore V1 is split into:

### Layer 1 — EOD / Premarket State

Uses only information legally known before the chosen `decisionAt` timestamp. This layer can be researched now.

### Layer 2 — Intraday State

Requires synchronized intraday TAIEX / weighted-stock leadership, TX order flow, options, global futures and FX. This layer is **not implementation-authorized** yet.

The two layers must never silently mix timestamps.

## 4. Canonical time contract

Every evidence item must expose:

```text
tradeDate
session
eventTime
availableAt
decisionAt
source
qualityStatus
```

A row is eligible only when:

```text
availableAt <= decisionAt
```

If `availableAt` is unknown or cannot be conservatively inferred, that evidence must be `UNAVAILABLE` for that decision point.

For EOD datasets without intraday publication timestamps, the safe default is to use the value only from the **next Taiwan trading session** unless an existing governed registry proves earlier legal availability.

No end-of-day value may be treated as known earlier in the same Taiwan day session.

## 5. V1 output axes

Market State V1 has five independent outputs.

### 5.1 Trend State

```text
TREND_UP
TREND_DOWN
RANGE
UNCLEAR
```

Purpose: describe persistent local price structure, not forecast direction.

### 5.2 Direction State

```text
BULLISH
BEARISH
NEUTRAL
CONFLICT
UNAVAILABLE
```

Purpose: summarize directional evidence across independent blocks.

### 5.3 Volatility State

```text
LOW
NORMAL
HIGH
UNAVAILABLE
```

Purpose: describe realized / implied volatility environment.

### 5.4 Risk State

```text
NORMAL
HIGH_RISK
UNAVAILABLE
```

Purpose: describe adverse-tail / event / liquidity conditions. Risk is intentionally separate from direction.

Examples that must be representable:

```text
Direction=BULLISH
Risk=NORMAL
RiskResearchContext=ELEVATED
```

and

```text
Direction=BEARISH
Risk=NORMAL
```

### 5.5 Global Alignment

```text
TAILWIND
HEADWIND
MIXED
UNAVAILABLE
```

Purpose: describe whether global / FX evidence is broadly supportive, adverse, or conflicting for Taiwan risk assets.

It is not a causal claim.

## 6. Evidence blocks

Highly correlated inputs must not be counted as independent votes.

### Block A — Local Price Structure

Candidate evidence:

- TAIEX return / medium-horizon price context;
- TX return;
- prior legal Opening Range / VWAP / RVOL only when the decision timestamp makes them valid;
- daily Basis where contract semantics are valid.

### Block B — Breadth & Leadership

Premarket V1 candidate evidence:

- TWSE / TPEx daily breadth.

Excluded from the first deterministic state:

- TSMC index-point contribution;
- Top-10 index-point contribution.

These remain data gaps and must not be approximated from stock price alone.

### Block C — Futures Positioning

Candidate evidence:

- governed market OI change;
- price × OI joint context;
- contract / rollover quality state;
- daily basis.

CVD / Aggressive Flow is excluded from historical Premarket V1 because the audited qualified history is insufficient.

### Block D — Options Volatility & Positioning

Candidate evidence:

- ATM IV;
- 25D Skew;
- OI PCR and Volume PCR kept distinct;
- raw strike / contract OI structure where legal.

Options evidence is EOD-only in historical V1. It must never be treated as same-day intraday-known data.

### Block E — Institutional Flow

Candidate evidence:

- foreign cash flow;
- trust flow / dealer flow may remain descriptive if coverage and semantics are governed.

Foreign flow is not a direct BUY / SELL instruction.

### Block F — Global & FX

Candidate evidence:

- `NDX_PROXY` — Nasdaq-100 cash index proxy, **not NQ futures**;
- SOX;
- VIX;
- USD/TWD.

NDX and SOX belong to one correlated US-growth / semiconductor block. They are not two fully independent votes.

### Block G — Event / Data / Liquidity Risk

Candidate evidence:

- settlement / expiry / rollover state;
- known macro-event risk when a governed event calendar exists;
- stale / missing / invalid data;
- contract-quality failures.

Data-quality failure may force a state to `UNAVAILABLE` or increase Risk State, but must not fabricate direction.

## 7. Evidence contract draft

The following rules are DRAFT semantics. They are pre-specified for descriptive validation and must not be performance-tuned without a new Owner decision.

### 7.1 Normalization

For continuous daily evidence with sufficient history, prefer a trailing, past-only empirical percentile.

Candidate standard:

```text
lookback = up to 252 prior eligible observations
minimumHistory = 60
```

No current or future observation may enter its own historical reference set.

Draft buckets:

```text
percentile >= 80  => HIGH / EXTREME POSITIVE CONTEXT
percentile >= 60  => POSITIVE CONTEXT
40 < percentile < 60 => NEUTRAL CONTEXT
percentile <= 40  => NEGATIVE CONTEXT
percentile <= 20  => HIGH / EXTREME NEGATIVE CONTEXT
```

These buckets are research labels, not trading thresholds.

### 7.2 TAIEX / TX return

Use price return only as local price evidence.

Candidate interpretation:

- positive short + medium horizon agreement => bullish local structure;
- negative short + medium horizon agreement => bearish local structure;
- disagreement => neutral / conflict;
- small or oscillating movement => range candidate.

Do not infer persistent trend from one daily return.

### 7.3 Breadth

Preferred raw measure:

```text
breadthRatio = advancers / (advancers + decliners)
```

Draft interpretation:

```text
>= 0.60 => BROAD_POSITIVE
<= 0.40 => BROAD_NEGATIVE
otherwise => MIXED_BREADTH
```

Limit / unchanged counts remain diagnostic.

The 0.60 / 0.40 cutoffs are draft descriptive cutoffs and must be validated for stability, not optimized for strategy PnL.

### 7.4 Foreign cash flow

Use governed daily net flow, preferably normalized by its own trailing distribution.

Draft interpretation:

```text
>= P80 => STRONG_INFLOW
P60-P80 => INFLOW
P40-P60 => NEUTRAL
P20-P40 => OUTFLOW
<= P20 => STRONG_OUTFLOW
```

Do not interpret foreign flow as proof of directional intent toward the index.

### 7.5 Basis

Basis must be calculated from the governed actual contract and compatible spot index timestamp / close.

Draft interpretation is descriptive:

- unusually positive basis => futures premium context;
- unusually negative basis => futures discount context;
- near historical center => neutral.

Basis is contract-sensitive and may be invalidated by rollover / contract-quality gates.

### 7.6 OI change

OI is not directional by itself. The canonical source is `futures_oi_daily.near_contract_oi`, whose governed product scope is explicitly `TX_MTX_TMF_EQUIVALENT`.

The delta uses only the immediately previous distinct usable source date when its `sourceContract` equals the current `sourceContract`. Contract mismatch, rollover / contract-change, or no valid previous observation produces no directional OI vote. Continuous contracts must not substitute for the actual contract.

Use the joint price / OI quadrant as descriptive evidence:

```text
Price up + OI up    => LONG_BUILD_CANDIDATE
Price up + OI down  => SHORT_COVER_CANDIDATE
Price down + OI up  => SHORT_BUILD_CANDIDATE
Price down + OI down=> LONG_LIQUIDATION_CANDIDATE
```

The labels are hypotheses about positioning mechanics, not proof of trader identity.

Rollover / contract-changed rows must be gated according to existing PP-1 quality semantics.

### 7.7 ATM IV

ATM IV primarily contributes to Volatility State and Risk State, not Direction State.

Candidate interpretation uses:

- trailing level percentile;
- one-day change percentile;
- optional IV-RV spread where already governed.

High IV must not automatically imply bearish direction.

### 7.8 25D Skew

Skew primarily contributes to tail-risk context.

Draft semantics:

- unusually expensive downside protection / adverse skew => Risk State upward pressure;
- normalization around historical center => neutral risk context.

Skew does not directly reverse a bullish Direction State.

### 7.9 PCR

OI PCR and Volume PCR remain separate evidence.

No fixed bullish / bearish interpretation is authorized for V1 before descriptive validation. PCR may initially be emitted as:

```text
LOW
NORMAL
HIGH
UNAVAILABLE
```

relative to its past-only historical distribution.

### 7.10 Call / Put OI structure

Raw strike OI is available, but a formal concentration formula is not yet frozen.

Therefore Premarket V1 may expose descriptive fields such as:

- top Call OI strikes;
- top Put OI strikes;
- contract OI totals;
- day-over-day strike OI change.

It must not create a new formal concentration score without a separate spec.

### 7.11 NDX_PROXY + SOX

These form one correlated global-growth evidence block.

Draft block state:

```text
both positive => US_GROWTH_POSITIVE
both negative => US_GROWTH_NEGATIVE
different signs => US_GROWTH_MIXED
missing one => PARTIAL
```

Magnitude may be normalized by past-only percentiles for diagnostics.

The field name `NQ` is prohibited for this historical source. Use `NDX_PROXY`.

### 7.12 VIX

VIX primarily affects Global Alignment / Risk State.

Draft interpretation:

- high level percentile + rising change => adverse risk context;
- low / falling VIX => supportive risk context;
- VIX direction does not directly set Taiwan Direction State.

### 7.13 USD/TWD

USD/TWD is treated as an FX-context hypothesis, not a proven causal signal.

Draft interpretation:

```text
USD/TWD rising => TWD weakening / candidate FX headwind
USD/TWD falling => TWD strengthening / candidate FX tailwind
```

The relationship must be validated conditionally with foreign flow and global risk state.

## 8. Block-state rules

Each evidence block first produces its own state. Only then can the five top-level Market State axes be derived.

No raw feature can vote directly into the final state if it already belongs to a block.

### 8.1 Direction blocks

Premarket directional candidates:

- Local Price Structure;
- Breadth;
- Futures Positioning;
- Institutional Flow;
- Global Alignment as contextual confirmation only.

Options volatility and VIX must not be treated as direct directional votes.

### 8.2 Conflict principle

`CONFLICT` is a first-class output, not an error.

Examples:

```text
Local Price = bullish
Breadth = bearish
Institutional = neutral
=> Direction may be CONFLICT
```

or

```text
Local Price = bullish
Breadth = bullish
Global = headwind
=> Direction may remain BULLISH while GlobalAlignment=HEADWIND
```

## 9. Top-level state semantics draft

### 9.1 Trend State

Trend State should be driven primarily by Local Price Structure plus Breadth persistence.

Draft concept:

```text
TREND_UP:
  local price medium-horizon structure positive
  AND breadth is not persistently negative

TREND_DOWN:
  local price medium-horizon structure negative
  AND breadth is not persistently positive

RANGE:
  local medium-horizon price structure lacks persistence
  AND breadth is mixed / oscillating

UNCLEAR:
  insufficient history or material evidence conflict
```

Exact persistence windows remain a research parameter and are not yet implementation-frozen.

### 9.2 Direction State

Draft agreement rule:

```text
BULLISH:
  at least two independent directional blocks bullish
  AND no equally strong bearish block set

BEARISH:
  at least two independent directional blocks bearish
  AND no equally strong bullish block set

NEUTRAL:
  most available independent blocks neutral

CONFLICT:
  material bullish and bearish blocks coexist

UNAVAILABLE:
  fewer than two independent eligible directional blocks
```

This is deliberately block-based rather than a weighted score.

### 9.3 Volatility State

Primary inputs:

- ATM IV level/change;
- realized-volatility diagnostics when legally available;
- VIX as global context, not a substitute for Taiwan volatility.

Draft concept:

```text
HIGH  => Taiwan IV / realized context materially elevated
LOW   => materially suppressed
NORMAL=> neither
```

### 9.4 Risk State

Risk State combines independent stress evidence without changing Direction State.

Candidate stress sources:

- extreme ATM IV / skew;
- elevated VIX;
- settlement / rollover / contract-quality risk;
- missing / stale data;
- future event-risk evidence when governed.

Draft concept:

```text
HIGH_RISK:
  multiple independent severe stress conditions
  OR one explicit hard data/contract/event veto condition

NORMAL:
  no canonical hard-risk condition

UNAVAILABLE:
  risk-critical evidence unavailable
```

`ELEVATED` remains available only in the separate research-only `riskResearchContext`; it is not a canonical `state.risk` value.

### 9.5 Global Alignment

Uses the Global & FX block only.

Draft concept:

```text
TAILWIND:
  US growth block supportive
  AND VIX not adverse
  AND FX not materially adverse

HEADWIND:
  US growth block adverse
  AND/OR VIX/FX adverse with sufficient agreement

MIXED:
  supportive and adverse global evidence coexist

UNAVAILABLE:
  insufficient legal data
```

## 10. Output schema draft

```json
{
  "schemaVersion": "market-state-v1-premarket-draft",
  "tradeDate": "YYYY-MM-DD",
  "decisionAt": "ISO-8601",
  "state": {
    "trend": "UNCLEAR",
    "direction": "CONFLICT",
    "volatility": "NORMAL",
    "risk": "NORMAL",
    "globalAlignment": "MIXED"
  },
  "riskResearchContext": "ELEVATED",
  "blocks": {
    "localPrice": {},
    "breadth": {},
    "futuresPositioning": {},
    "options": {},
    "institutional": {},
    "globalFx": {},
    "eventRisk": {}
  },
  "evidence": [],
  "conflicts": [],
  "unavailable": [],
  "researchOnly": true,
  "formalWeight": 0,
  "executionAuthorized": false
}
```

Every state must be explainable from the attached evidence list.

## 11. Descriptive validation plan

Market State V1 is not validated by strategy PnL first.

### 11.1 Primary descriptive targets

Daily / broad-history targets:

- next Taiwan session opening gap;
- next-session absolute move / large-move event;
- next-session downside-tail event;
- next-session close direction as a secondary diagnostic only.

Intraday targets where governed TX history exists:

- first-60m persistence;
- Trend-Day / Range-Day descriptive label;
- Opening Range breakout persistence.

### 11.2 Tests

For each block / state:

1. coverage and missingness;
2. conditional event rate versus unconditional base rate;
3. effect size with confidence intervals;
4. year / period stability;
5. settlement / rollover stratification;
6. sensitivity to reasonable draft thresholds;
7. no-lookahead audit using `availableAt`.

### 11.3 Required comparisons

Examples:

```text
P(LargeMove | Risk=HIGH_RISK)
vs
P(LargeMove)

P(TrendDay | Trend=TREND_UP or TREND_DOWN)
vs
P(TrendDay)

P(DownsideTail | Risk=HIGH_RISK)
vs
P(DownsideTail)

P(PositiveGap | GlobalAlignment=TAILWIND)
vs
P(PositiveGap)
```

Direction accuracy is not the sole promotion criterion.

### 11.4 Stability rule

A relationship that exists only in one short period must be reported as unstable, not promoted by adding filters.

No threshold may be changed after seeing holdout performance unless a new research version is explicitly opened.

## 12. Explicitly excluded from Premarket V1 implementation

Until separate evidence / contracts exist:

- TSMC index contribution;
- Top-10 index contribution;
- long-history CVD / aggressive flow;
- intraday options IV / skew chain;
- NQ futures history;
- intraday USD/TWD;
- intraday global futures;
- dealer Gamma / GEX as a formal state driver;
- permanent weighted Market State score;
- strategy permission / veto;
- position sizing;
- paper/live order routing.

## 13. Implementation readiness

Current status:

```text
Data Coverage Audit: PASS for design
Premarket Semantics Draft: CREATED
Historical Validation Spec: CREATED
Premarket Engine Implementation: NOT YET AUTHORIZED BY THIS DOCUMENT
Intraday Market State: NOT READY
Strategy Router Integration: NOT AUTHORIZED
Broker Execution: NOT AUTHORIZED
```

The next repository milestone should be a **read-only deterministic research evaluator** that consumes governed historical inputs and emits the draft state schema without touching P0/T0 or any execution path.

That implementation should occur only after this semantics draft receives Owner Review or an explicit continuation decision.
