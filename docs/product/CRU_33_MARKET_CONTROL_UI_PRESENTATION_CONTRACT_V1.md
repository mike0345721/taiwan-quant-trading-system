# CRU-33 — Market Control UI Presentation Contract V1

Status: **DESIGN CONTRACT / RESEARCH ONLY / NO PRODUCTION WIRING AUTHORIZED**  
Linear: **CRU-33**  
Companion audit: `docs/product/CRU_33_MARKET_CONTROL_CAPABILITY_TRUTH_AUDIT_V1.md`

## 1. Product Goal

The future TX Intraday Pressure & Path Efficiency capability must not end as a table of microstructure metrics.

The production experience should let a user understand, within a few seconds:

1. **Who is applying pressure now?**
2. **Is price responding to that pressure?**
3. **Is the price path efficient or noisy?**
4. **Is the evidence trustworthy enough to interpret?**

Then, with one additional interaction, the user should be able to see:

- supporting evidence,
- contrary/conflicting evidence,
- missing/stale evidence,
- the observation window and instrument identity,
- methodology and limitations.

The UI must assist judgment without pretending that research-only evidence is a trading signal.

## 2. Core UX Principle

Use the existing product hierarchy:

```text
Result
→ Evidence
→ Detail
```

Do not make the user mentally combine ten raw metrics before seeing the current descriptive result.

Do not reduce the entire capability to one opaque long/short score.

## 3. V1 Information Architecture

### Layer 1 — Result Strip

The first visible block should contain only:

```text
Instrument / Contract
Session
Observation Window
Data Trust
Primary descriptive observation
Research / Promotion status
```

Candidate descriptive observation labels, only after their deterministic contracts are frozen and validated:

- `BUYER_EFFECTIVE_CANDIDATE` → **買方施壓，價格有反應**
- `SELLER_EFFECTIVE_CANDIDATE` → **賣方施壓，價格有反應**
- `SELLER_ABSORPTION_CANDIDATE` → **買壓偏強，但價格推不動**
- `BUYER_ABSORPTION_CANDIDATE` → **賣壓偏強，但價格跌不動**
- `BALANCED_OR_CONFLICT` → **壓力與價格反應不一致**
- insufficient quality / coverage → **資料不足，暫不判讀**
- capability not promoted → **研究中 / 尚未升格**

These labels are descriptive research observations. They must not render as BUY / SELL / confidence / strategy permission.

### Layer 2 — Four Evidence Tiles

Keep the first evidence row to at most four compact concepts:

1. **成交壓力 Pressure**
   - buy proxy volume
   - sell proxy volume
   - net pressure / bounded pressure ratio when legal
   - classified coverage

2. **價格反應 Response**
   - window price displacement
   - ticks moved
   - direction relative to pressure

3. **路徑效率 Path Efficiency**
   - deterministic 0–1 value when available
   - no qualitative `high/low` label until thresholds are governed

4. **資料可信度 Trust**
   - LIVE / DELAYED / STALE / UNAVAILABLE
   - classification coverage
   - conflict ratio
   - missing required stream reason

Displayed Liquidity should be a separate evidence tile only after its own depth contract exists. Until then it must render `RESEARCH_PENDING`, not a fabricated neutral value.

## 4. Recommended Desktop Card

Conceptual layout only:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ TX · TXFxxxx · DAY · 1m                           LIVE · 研究中      │
│                                                                     │
│  買方施壓，價格有反應                                                │
│  買方成交壓力占優，價格同步上移；目前只作研究觀察。                    │
│                                                                     │
│  成交壓力         價格反應          路徑效率          資料可信度      │
│  +0.62            +18 ticks         0.78              96% coverage  │
│  Buy > Sell       同向              —                 conflict 4%   │
│                                                                     │
│  [ Price timeline ]                                                    │
│  [ Pressure bars  ]   ← same time axis, separate panes              │
│                                                                     │
│  反向證據：5m 壓力未同步增強 / conflict 上升（有才顯示）              │
│  注意：若壓力續增但價格停止延伸，可能轉為吸收候選。                    │
│                                                     [查看證據與細節] │
└─────────────────────────────────────────────────────────────────────┘
```

Values above are illustrative UI placeholders only, not production thresholds or current market facts.

## 5. Timeline Visualization

The most useful visual relationship is not another standalone gauge. It is the temporal relationship between pressure and price.

Use two vertically aligned panes sharing the same time axis:

```text
Price path
───────────
Executed Pressure bars
```

Why:

- the user can see whether pressure arrived before / with the price move;
- divergence and absorption become visually inspectable;
- separate panes avoid pretending pressure and price have the same numeric scale;
- the relationship is easier to understand than an opaque composite score.

V1 should prefer a small number of governed windows, for example a current window plus 1m/5m context after the contract is frozen. Do not expose every possible timeframe merely because it is easy to calculate.

## 6. Plain-language Interpretation Block

The UI may eventually generate a deterministic sentence from governed evidence.

Required structure:

```text
What we observe
→ Why
→ Contrary evidence
→ What would weaken this observation
```

Example pattern:

> 買方成交壓力目前占優，且價格在同一觀察窗內同步抬升；路徑效率顯示價格移動較直接。反向證據為分類衝突上升。若買方壓力持續增加但價格不再延伸，應把目前的「有效推動」降級為吸收／衝突候選。

The actual wording must be generated from explicit evidence fields and allowed states. It must not introduce facts that are absent from the snapshot.

## 7. Decision Assist Boundary

The Market Control card should help the user decide what to inspect, not tell the user to trade.

Allowed future decision-assist output:

- **目前觀察**
- **支持證據**
- **反向證據**
- **缺失 / 過期證據**
- **什麼情況會讓目前觀察失效或降級**
- **需要等待的確認**

Forbidden without a separate promotion contract:

- BUY
- SELL
- long / short permission
- confidence percentage
- win rate
- strategy permission
- risk veto
- execution authorization

`Ask GPT` may consume the same governed snapshot later, but GPT output is not a new source of market truth and is not trading authorization.

## 8. Detail Drawer

The detail layer should expose evidence lineage instead of cluttering the main card.

Minimum fields:

```text
instrument
product
venue / market
underlying
contract
tradeDate
session
window
source
eventTime
receivedAt
availableAt
Tick health
BidAsk health
classified coverage
UNKNOWN volume
classification conflict ratio
quote-match coverage
quote age contract
methodology
limitations
promotion status
```

If Displayed Liquidity is later added, also expose book-depth completeness, stale/reconnect boundary and depth methodology.

## 9. Failure / Unavailable UX

The UI must distinguish product states clearly:

- `LIVE`
- `DELAYED`
- `STALE`
- `UNAVAILABLE`
- `RESEARCH_PENDING`
- `QUALITY_INSUFFICIENT`
- `CONFLICT`

Examples:

```text
資料不足 · Tick LIVE / BidAsk MISSING
```

```text
研究中 · Path Efficiency 已可計算，Market Control 尚未升格
```

```text
無法判讀 · Classified coverage too low
```

Do not render a dash with no explanation when a governed reason exists.

## 10. Comprehension Acceptance

Before production wiring is accepted, the UI should pass two product tests.

### 3-second test

Without opening a drawer, a user can answer:

- who is applying pressure?
- is price responding?
- is the path efficient / available?
- is the data trustworthy?

### 10-second evidence test

With one interaction, a user can answer:

- what evidence supports the result?
- what contradicts it?
- what is missing or stale?
- what observation would weaken / invalidate the current interpretation?

If the interface requires reading raw Tick/BidAsk tables to answer those questions, the product presentation is not complete.

## 11. Visual Guardrails

- Desktop-first and compatible with the governed production viewport acceptance set.
- Do not rely on color alone; text/state labels remain mandatory.
- Taiwan market up/down colors may be used consistently with the rest of the product, but semantics must remain readable without color.
- Keep one primary descriptive conclusion per card.
- Keep the first row to four evidence concepts; deeper metrics belong in Detail.
- Use progressive disclosure for raw volumes, formulas, lineage and diagnostics.
- Avoid gauges that imply precision not justified by validation.
- Do not show a composite `Bull 78 / Bear 22` score in V1.

## 12. Engineering Consequence

The research engine output contract should be **UI-ready by design** even before production UI wiring is authorized.

A future observation object should preserve distinct fields for:

```text
identity
window
pressure
response
pathEfficiency
liquidity (or RESEARCH_PENDING)
quality / trust
conflict
supportingEvidence
contraryEvidence
invalidationEvidence
methodology
promotionState
```

This prevents the UI from reverse-engineering semantics from raw implementation fields and lets Dashboard and future Ask GPT consume the same governed evidence snapshot.

## 13. Work-package Boundary

For the proposed **TX Intraday Pressure & Path Efficiency Research Engine V1**:

- Engine/Data/Derivation work remains one bounded implementation package.
- This UI Presentation Contract is an input to the engine output schema and acceptance design.
- A static/research preview may be used to validate comprehension if separately included in scope.
- Production Dashboard wiring should be a follow-on package after engine Data Truth / Derivation / Replay gates pass and Product Owner explicitly authorizes UI wiring.

This sequencing avoids designing an engine that cannot be explained in the UI while also avoiding premature promotion of unvalidated research output into production.

## 14. Safety

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

This UI contract does not authorize Market Control promotion, strategy output, Risk Veto, broker/order routes or execution.
