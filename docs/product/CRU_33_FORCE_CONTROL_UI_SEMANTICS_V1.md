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
4. **Effectiveness / Control** — is that pressure actually producing price movement efficiently?

These are not interchangeable.

A large pressure reading does not automatically mean strong control. A side can apply large pressure and still fail to move price.

## 2. Core semantic separation

```text
Pressure
= how much directional executed-flow pressure is observed

Control
= whether that pressure is successfully producing / maintaining price response
```

Therefore:

```text
Strong Pressure + Strong Same-Direction Response
→ Effective Control candidate

Strong Pressure + Weak / Opposite Response
→ Absorption / Failed Control candidate
```

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

Effectiveness compares observed pressure with actual price response.

Preserve independent evidence first:

```text
Pressure direction
Pressure relative intensity
Price displacement
Path Efficiency
Coverage
Conflict
```

Do not collapse them immediately into one score.

Candidate descriptive states after validation:

- `BUYER_EFFECTIVE_CANDIDATE`
- `SELLER_EFFECTIVE_CANDIDATE`
- `SELLER_ABSORPTION_CANDIDATE`
- `BUYER_ABSORPTION_CANDIDATE`
- `BALANCED_OR_CONFLICT`
- `QUALITY_INSUFFICIENT`

No threshold is authorized by this document.

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

## 5. Control-quality trend

The product should distinguish **Price Trend** from **Control Quality Trend**.

Examples:

| Price | Pressure | Response / Efficiency | Research interpretation |
| --- | --- | --- | --- |
| rising | buyer pressure strong | response strong / efficient | buyer control healthy candidate |
| rising | buyer pressure increasing | response weakening | buyer control quality deteriorating |
| flat | buyer pressure strong | weak response | seller absorption candidate |
| flat / oscillating | pressure switches frequently | low efficiency | range / balanced evidence |
| breakout | pressure expands | price responds efficiently and persists | trend-transition evidence |
| breakout | pressure expands | price fails to extend | failed-control / absorption evidence |

This does not authorize prediction or Market State promotion.

## 6. Primary Dashboard card

The first-glance card should answer five questions, in this order:

```text
1. Market State       → where is the market structurally?
2. Control            → who is currently effective?
3. Force              → how strong is directional pressure?
4. Force Trend        → strengthening / stable / weakening / switching?
5. Efficiency         → is price still responding efficiently?
```

Conceptual layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ TX · 近月 · DAY · 1m                         LIVE · 96%可信 │
│                                                             │
│ 市場狀態      上升趨勢候選                                 │
│ 市場控制      買方控制                                     │
│                                                             │
│ 力道          強 ↓          價格反應       仍同向           │
│ 賣方 ────────────●──── 買方   +18 ticks                    │
│                 +0.62                                       │
│                                                             │
│ 相對強度      研究基準 percentile / pending                 │
│ 推動效率      下降 ↓                                        │
│                                                             │
│ 目前解讀：趨勢仍在，但買方控制品質惡化                     │
│ ⚠ 買方壓力仍強，價格延伸與 Path Efficiency 同步下降         │
│                                                             │
│ 若買壓續增但價格停止創高 → 吸收 / 衝突候選                 │
│                                         [查看證據與細節 >]   │
└─────────────────────────────────────────────────────────────┘
```

All numbers and labels above are conceptual placeholders, not current market facts or authorized thresholds.

## 7. Force meter design

Prefer a horizontal bidirectional pressure bar rather than a circular gauge.

```text
                 成交力道
賣方強 ←────────────┼────────────→ 買方強
                    0       ●
                           +0.62
```

The bar communicates **direction + bounded imbalance**.

A separate adjacent state communicates **relative intensity** and **change**:

```text
相對強度：RESEARCH_PENDING / percentile value
變化：STRENGTHENING / STABLE / WEAKENING / SWITCHING
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

The user should be able to visually identify:

- pressure arriving with a price move,
- persistent pressure with sustained price extension,
- pressure increasing while price response weakens,
- side switching and choppy response,
- potential absorption / failed control patterns.

Displayed Liquidity, when legally derived later, should remain a separate pane / evidence family rather than being added into executed pressure.

## 9. First-layer wording policy

Prefer plain-language descriptions:

```text
買方控制，力道增強
買方控制，但推動效率下降
買壓偏強，但價格推不動
賣方控制，力道穩定
多空力道頻繁切換，暫無持續控制
資料不足，暫不判讀
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
2. **相對力道** — baseline percentile or `RESEARCH_PENDING`.
3. **價格反應** — displacement / ticks / direction relation.
4. **推動效率** — Path Efficiency + change state.
5. **資料可信度** — Tick/BidAsk health, unknown/conflict/missing reason.

To keep the first view calm, these may be displayed as four visual tiles by combining Force direction + relative intensity into one tile.

## 11. Detail / audit layer

The drawer should provide the exact evidence behind a qualitative label.

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
actualContract
session
tradeDate
methodology
limitations
promotionState
```

A user must be able to answer: **為什麼 UI 說「力道強」？** without trusting an unexplained model label.

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

This lets Dashboard and Ask GPT consume the same governed snapshot without reverse-engineering UI semantics from raw numbers.

## 14. V1 acceptance intent

The eventual UI should pass:

### 3-second comprehension

Without opening details, the user can tell:

- which side is applying pressure,
- whether that pressure is relatively strong / unavailable,
- whether pressure is strengthening or weakening,
- whether price is responding,
- whether control quality is improving or deteriorating,
- whether the data is trustworthy.

### 10-second evidence check

With one interaction, the user can identify:

- why the force label exists,
- what supports the control observation,
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
