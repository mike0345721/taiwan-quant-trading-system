# CRU-33 — Market Control Causality Guardrail V1

Status: **DESIGN GUARDRAIL / RESEARCH ONLY / NO PRODUCTION WIRING AUTHORIZED**  
Linear: **CRU-33**

## 1. Why this guardrail exists

The Market Control research family observes contemporaneous relationships among executed-flow pressure, displayed liquidity, price response and path efficiency.

Those relationships are observational. They do **not** by themselves prove that one measured pressure variable caused the subsequent price movement, nor do they reveal participant identity, motive or hidden inventory.

This guardrail governs interpretation of the companion CRU-33 documents whenever wording such as `effective`, `control`, `absorption`, `producing`, `driving`, `pushes price`, or similar language could otherwise be read causally.

## 2. Required interpretation boundary

Use this operational meaning:

```text
Pressure
= observed directional executed-flow proxy

Response
= observed price change in the governed observation window

Control Observation
= pressure and price-response evidence are aligned / persistent / efficient enough to satisfy a future governed descriptive contract
```

Do **not** interpret `Control Observation` as proof that the measured pressure caused the price move.

The legal statement is:

> The observed price response is consistent with the observed pressure under the governed window and quality contract.

The illegal statement is:

> The measured buyers caused the market to rise.

## 3. Absorption boundary

A pattern such as:

```text
strong buyer-side pressure proxy
+
weak / opposite price response
```

may later be labeled only as an **absorption candidate / failed-control candidate** after thresholds and quality rules are validated.

It does not uniquely prove passive seller absorption. Other explanations may include, for example:

- classification error or low coverage,
- stale or incomplete quote context,
- liquidity withdrawal / replenishment dynamics,
- cross-instrument or cross-market offsetting flow,
- auction / session / contract-boundary effects,
- other unobserved participants or order types.

The UI and Decision Assist must preserve the word `candidate` or equivalent uncertainty until a future separate validation contract justifies stronger wording.

## 4. Participant identity boundary

Provider `tick_type`, best-quote inference, CVD proxy, depth imbalance and related research evidence do not identify a specific trader, institution, dealer or market maker.

Forbidden inference:

```text
buyer pressure proxy
→ foreign institutions are buying
```

unless an independent governed source actually provides that participant identity.

## 5. Temporal boundary

A pressure/response relationship is only legal when the observation contract explicitly freezes:

- eventTime semantics,
- receivedAt semantics,
- availableAt semantics,
- window start/end,
- quote pairing age,
- no-future-data rules,
- reconnect / session / contract-boundary behavior.

Until `availableAt` is first-class and validated for the future engine, no forward-looking causal or predictive claim may be promoted from CRU-33 research.

## 6. UI wording policy

Prefer:

- `買方施壓，價格同步上移`
- `買壓偏強，但價格反應弱`
- `觀察到買方有效候選`
- `出現賣方吸收候選`
- `控制品質正在下降`

Avoid:

- `買方把價格推高`
- `莊家正在吸收`
- `主力正在控盤`
- `這股買盤一定會推升價格`
- `吸收已證實`

unless a future independent evidence contract explicitly supports the stronger claim.

## 7. Research / prediction boundary

Market Control is initially a descriptive observation system.

It may later be tested for predictive value, but prediction must be a separate research question with separate historical / forward validation, outcome definition and promotion gate.

Therefore:

```text
observed control deterioration
≠ guaranteed reversal

observed efficient buyer pressure
≠ guaranteed continuation
```

## 8. Relationship to Market State

Market Control evidence may later become one input to Market State, but it cannot alone define `TREND`, `RANGE` or `TRANSITION`.

Market State must continue to preserve other governed evidence such as price structure, persistence, volatility/state context, breadth/leadership and cross-instrument conflict when applicable.

This prevents circular logic such as:

```text
Price rose
→ call it buyer control
→ use buyer control to prove uptrend
```

without independent pressure / quality / persistence evidence.

## 9. Acceptance consequence for the next engine package

The future `TX Intraday Pressure & Path Efficiency Research Engine V1` must keep these fields separable:

```text
pressure evidence
price response evidence
path-efficiency evidence
quality / coverage
conflict
observation state
supporting evidence
contrary evidence
invalidation evidence
promotion state
```

No single field named `cause`, `trueControl`, `confirmedAbsorption`, `dealerControl`, `mainForce`, or equivalent should be introduced in V1.

## 10. Safety

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

This guardrail does not authorize engine implementation, production Dashboard wiring, Market State promotion, strategy/risk permission or execution.