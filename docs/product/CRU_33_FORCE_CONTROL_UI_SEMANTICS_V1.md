# CRU-33 — Force / Control / UI Semantics V1

Status: **DESIGN CONTRACT / RESEARCH ONLY / NO PRODUCTION WIRING AUTHORIZED**  
Linear: **CRU-33**  
Companion docs:

- `docs/product/CRU_33_MARKET_CONTROL_CAPABILITY_TRUTH_AUDIT_V1.md`
- `docs/product/CRU_33_MARKET_CONTROL_UI_PRESENTATION_CONTRACT_V1.md`

## 1. Why this contract exists

The future TX Intraday Pressure & Path Efficiency capability must not use the word **力道 / strength** as an undefined visual label.

The product must distinguish at least four different questions:

1. **Direction** — which side is exerting more executed pressure?
2. **Magnitude / Relative Intensity** — how large is that pressure relative to a governed baseline?
3. **Persistence / Change** — is the pressure persisting, strengthening, weakening, or switching sides?
4. **Effectiveness / Control** — is that pressure accompanied by price response strongly and persistently enough to qualify for a separately governed control observation?

These are not interchangeable.

A large pressure reading does not automatically mean strong control. A side can apply large pressure and still fail to move price.

## 2. Core semantic separation

```text
Pressure
= how much directional executed-flow pressure is observed

Control
= a separately governed descriptive observation about whether pressure and price response align persistently enough to satisfy an explicit contract
```

Therefore, before Control promotion:

```text
Strong Pressure + Strong Same-Direction Response
→ evidence consistent with effective control

Strong Pressure + Weak / Opposite Response
→ evidence consistent with absorption / failed control
```

These are evidence patterns, not yet Control labels.

Only after a later promotion contract may the product expose candidate states such as `BUYER_EFFECTIVE_CANDIDATE` or `SELLER_ABSORPTION_CANDIDATE`.

The Dashboard must never label raw volume alone as `強勢控制`.

## 3. Force model — four dimensions

### 3.1 Direction

Candidate bounded directional pressure ratio:

```text
(BuyProxyVolume - SellProxyVolume)
/
(BuyProxyVolume + SellProxyVolume)
```

Expected range when denominator is positive:

```text
-1 ... 0 ... +1
seller ← balanced → buyer
```

Denominator zero must return `UNAVAILABLE`, not zero.

The ratio answers **direction**, not absolute strength.

### 3.2 Relative Intensity

Raw net contracts are not comparable across:

- different times of day,
- different volatility / activity regimes,
- TX vs MTX vs TMF,
- different observation windows.

Therefore a future qualitative strength label such as `弱 / 中 / 強` must be based on a governed relative baseline, not an arbitrary absolute-lot threshold.

Candidate research baseline questions include:

- same instrument,
- same session,
- comparable time-of-day bucket,
- same observation-window length,
- adequate historical sample,
- contract-roll normalization where required.

Possible research representation:

```text
relativeIntensityPercentile
```

Example only:

```text
88th percentile
```

means the observed pressure magnitude is larger than most comparable historical windows. It does **not** mean 88% probability, confidence, win rate, or bullish probability.

CRU-33 does not authorize the percentile sample design or qualitative thresholds.

Until that research contract is frozen and validated:

```text
pressure.relativeIntensity = RESEARCH_PENDING
```

The UI must not replace this pending state with `強 / 中 / 弱`.

### 3.3 Persistence / Change

The UI should not show only the current pressure value. It should preserve whether pressure is:

```text
STRENGTHENING
STABLE
WEAKENING
SWITCHING
INSUFFICIENT_EVIDENCE
```

These states require a frozen multi-window / slope / persistence contract before production use.

The intended user question is:

> 現在多強？正在變強還變弱？維持多久？

### 3.4 Effectiveness / Control

Effectiveness research compares observed pressure with actual price response.

Preserve independent evidence first:

```text
Pressure direction
Pressure relative intensity or RESEARCH_PENDING
Price displacement
Path Efficiency
Coverage
Conflict
```

Do not collapse them immediately into one score.

Candidate descriptive states reserved for a later validated promotion contract:

- `BUYER_EFFECTIVE_CANDIDATE`
- `SELLER_EFFECTIVE_CANDIDATE`
- `SELLER_ABSORPTION_CANDIDATE`
- `BUYER_ABSORPTION_CANDIDATE`
- `BALANCED_OR_CONFLICT`
- `QUALITY_INSUFFICIENT`

No threshold is authorized by this document.

For the initial TX Intraday Pressure & Path Efficiency Research Engine V1:

```text
control.observationState = RESEARCH_PENDING
```

unless a separate Control promotion contract has already passed its required gates.

## 4. Price-efficiency interpretation

Price Path Efficiency is intended to describe whether price travels directly or churns while reaching the same net displacement.

Candidate deterministic definition:

```text
abs(P_end - P_start)
/
sum(abs(delta P))
```

It must return unavailable when path length is zero or observation quality is insufficient.

Path Efficiency alone does not define trend or control. It becomes useful when interpreted together with pressure and response.

The V1 derivation contract still must define deterministic window inclusivity, start/end-price selection, same-timestamp ordering, observation sufficiency and session/contract boundaries before implementation is accepted.

## 5. Control-quality trend

The product should distinguish **Price Trend** from a future **Control Quality Trend**.

The table below describes research evidence patterns; it does not authorize Control or Market State labels:

| Price | Pressure | Response / Efficiency | Research evidence pattern |
| --- | --- | --- | --- |
| rising | buyer pressure elevated | response strong / efficient | consistent with healthy buyer-side effectiveness |
| rising | buyer pressure increasing | response weakening | consistent with deteriorating buyer-side effectiveness |
| flat | buyer pressure elevated | weak response | consistent with seller-side absorption pattern |
| flat / oscillating | pressure switches frequently | low efficiency | consistent with range / balanced evidence |
| breakout | pressure expands | price responds efficiently and persists | trend-transition supporting evidence |
| breakout | pressure expands | price fails to extend | failed-control / absorption supporting evidence |

This does not authorize prediction or Market State promotion.

## 6. Primary Dashboard card

The first-glance card should answer these questions in this order:

```text
1. Market State       → only if supplied by the separate governed Market State capability
2. Pressure Direction → which side has observed executed-pressure advantage?
3. Relative Intensity → promoted value or RESEARCH_PENDING
4. Force Trend        → strengthening / stable / weakening / switching, only after its contract is frozen
5. Price Response     → what did price do in the same governed window?
6. Path Efficiency    → deterministic value / unavailable
7. Control            → promoted observation or RESEARCH_PENDING
```

Conceptual initial-engine layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ TX · 近月 · DAY · 1m                         LIVE · 96%可信 │
│                                                             │
│ 市場狀態      由獨立 Market State 契約提供 / 未提供         │
│ Control       RESEARCH_PENDING                              │
│                                                             │
│ 成交壓力      買方占優       價格反應       同向上移         │
│ 賣方 ────────────●──── 買方   +18 ticks                    │
│                 +0.62                                       │
│                                                             │
│ 相對力道      RESEARCH_PENDING                              │
│ Path Efficiency 0.78                                       │
│                                                             │
│ 目前解讀：描述壓力與價格反應，不宣稱買方控制               │
│ 反向證據：有才顯示；無則不補造                             │
│                                                             │
│                                         [查看證據與細節 >]   │
└─────────────────────────────────────────────────────────────┘
```

All numbers and labels above are conceptual placeholders, not current market facts or authorized thresholds.

## 7. Force meter design

Prefer a horizontal bidirectional pressure bar rather than a circular gauge.

```text
                 成交壓力方向
賣方 ←──────────────┼──────────────→ 買方
                    0       ●
                           +0.62
```

The bar communicates **direction + bounded imbalance**.

It does **not** communicate probability or historically normalized strength.

A separate adjacent state communicates relative intensity and change:

```text
相對力道：RESEARCH_PENDING / governed percentile value
變化：RESEARCH_PENDING / STRENGTHENING / STABLE / WEAKENING / SWITCHING
```

Do not visually imply that `+0.62` means 62% bullish probability.

## 8. Pressure timeline

The time relationship should remain inspectable:

```text
Price Path
────────────────────────────

Executed Pressure
      ████
   ███████
──────────── zero
             ███
```

Use aligned time axes.

The user should be able to visually inspect:

- pressure arriving with a price move,
- persistent pressure alongside sustained price extension,
- pressure increasing while price response weakens,
- side switching and choppy response,
- patterns that may later support absorption / failed-control research.

Displayed Liquidity, when legally derived later, should remain a separate pane / evidence family rather than being added into executed pressure.

## 9. First-layer wording policy

Before Control / Relative Intensity promotion, prefer wording such as:

```text
買方成交壓力占優 · Control 研究中
賣方成交壓力占優 · Control 研究中
壓力方向頻繁切換 · 持續性研究中
資料不足，暫不判讀
```

After a later promotion contract, qualified descriptive wording may include:

```text
買方控制，力道增強
買方控制，但推動效率下降
買壓偏強，但價格推不動
賣方控制，力道穩定
多空力道頻繁切換，暫無持續控制
```

Avoid opaque labels such as:

```text
Control Score = 73
Bull = 78
Bear = 22
Confidence = 81%
```

unless a future separate validated probability / scoring contract exists and is explicitly promoted.

## 10. Evidence layer

The first evidence row should expose only the concepts needed to explain the primary result:

1. **成交壓力** — direction, net proxy, classified coverage.
2. **相對力道** — governed baseline percentile or `RESEARCH_PENDING`.
3. **價格反應** — displacement / ticks / direction relation.
4. **推動效率** — Path Efficiency + governed change state / pending.
5. **資料可信度** — Tick/BidAsk health, unknown/conflict/missing reason.

To keep the first view calm, these may be displayed as four visual tiles by combining Force direction + relative intensity into one tile while keeping pending state explicit.

## 11. Detail / audit layer

The drawer should provide the exact evidence behind every qualitative label.

Minimum future fields:

```text
window
buyProxyVolume
sellProxyVolume
unknownVolume
pressureRatio
relativeIntensityPercentile (or RESEARCH_PENDING)
pressureChangeState
pressurePersistence
priceDisplacement
priceDisplacementTicks
pathEfficiency
pathEfficiencyChange
classifiedVolumeRatio
quoteMatchedRatio
classificationConflictRatio
Tick health
BidAsk health
eventTime
receivedAt
availableAt
continuityEpoch
actualContract
session
tradeDate
methodology
limitations
promotionState
```

A user must be able to answer: **為什麼 UI 顯示這個力道 / Control 狀態？** without trusting an unexplained model label.

## 12. Research questions required before qualitative labels

Before production UI can show `弱 / 中 / 強`, the implementation/research path must answer:

1. What historical sample defines relative intensity?
2. Is the comparison time-of-day adjusted?
3. Are DAY / NIGHT baselines separate?
4. How are different windows compared?
5. How are contract roll and abnormal low-liquidity periods treated?
6. What minimum sample size makes percentile stable enough to display?
7. What quality / coverage threshold suppresses the label?
8. Does persistence add useful information beyond current-window intensity?
9. How is baseline versioning preserved so future threshold changes do not rewrite historical observations?
10. How are sample age / decay and regime shifts handled?

Until these are governed and validated, UI must show raw/bounded values or `RESEARCH_PENDING`, not invented `強/弱` thresholds.

## 13. Engine output consequence

The future engine output should separate:

```text
pressure.direction
pressure.ratio
pressure.relativeIntensity
pressure.changeState
pressure.persistence
response.displacement
response.directionRelation
pathEfficiency.value
pathEfficiency.changeState
control.observationState
control.supportingEvidence
control.contraryEvidence
control.invalidationEvidence
quality
promotionState
```

For the initial engine, fields whose contract is not yet promoted must remain explicitly pending rather than inferred by the UI.

This lets Dashboard and Ask GPT consume the same governed snapshot without reverse-engineering UI semantics from raw numbers.

## 14. V1 acceptance intent

The eventual UI should pass:

### 3-second comprehension

Without opening details, the user can tell:

- which side is applying observed pressure,
- whether relative intensity is available or still pending,
- whether pressure-change state is available or still pending,
- whether price is responding,
- whether Path Efficiency is available,
- whether Control is promoted or pending,
- whether the data is trustworthy.

### 10-second evidence check

With one interaction, the user can identify:

- why the pressure direction exists,
- why any qualitative force/control label exists if promoted,
- what supports the observation,
- what contradicts it,
- what is missing/stale,
- what would cause the observation to be downgraded.

## 15. Safety / promotion boundary

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

This contract does not authorize Engine implementation, Dashboard production wiring, Market State promotion, strategy permission, Risk Veto, broker/order route, position management or execution.