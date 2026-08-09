# Market State V1 Research Closeout

> Work package: CRU-19  
> Status: OWNER REVIEW DRAFT  
> Baseline commit: `9c9bbaeae6260c7b660a4e3bcf18287ef05c0739`  
> Boundary: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`

## Purpose

This document closes the historical Market State V1 research phase. It does not add a factor, change any axis semantics or threshold, search another outcome, establish trading edge, or authorize Forward Shadow, Strategy Router, Risk Engine, Paper Trading, broker routes, or execution.

Historical evidence is limited to 753 Market State records and 137 governed strict TX outcome sessions. CRU-18 reported zero temporal-alignment violations and zero future-data violations. Canonical risk does not contain `ELEVATED`; that label remains confined to `riskResearchContext`.

## Axis Disposition Matrix

| Axis | Historical finding | Sample limitation | Strongest allowed conclusion | Prohibited claim | Proposed disposition |
|---|---|---|---|---|---|
| Direction | The frozen primary comparison, `BULLISH` versus `BEARISH`, produced `DESCRIPTIVE_DIFFERENCE_PRESENT`. The strict-session counts were 38 and 40; `NEUTRAL` and `CONFLICT` were retained descriptively. | Only 137 strict TX sessions were linked. This is historical and already inspected evidence, not forward proof. | A predeclared single-axis descriptive difference exists and is eligible for a new forward-only check. | Trading edge, profitable direction signal, formal factor, Strategy Router permission, position-sizing rule, or causal relationship. | `PROMOTE_TO_FORWARD_SHADOW` candidate, pending Product Owner freeze and launch approval. |
| Global Alignment | The frozen `TAILWIND` versus `HEADWIND` comparison produced `DESCRIPTIVE_DIFFERENCE_PRESENT`; counts were 43 and 35, with 59 `MIXED` sessions retained. | Only 137 strict TX sessions; global source coverage and state frequency may drift in forward operation. | A predeclared single-axis descriptive difference exists and is eligible for a new forward-only check. | Trading edge, cross-market timing rule, formal confirmation filter, or permission to combine with Direction. | `PROMOTE_TO_FORWARD_SHADOW` candidate, pending Product Owner freeze and launch approval. |
| Trend | `TREND_UP` versus `TREND_DOWN` was `INSUFFICIENT_SAMPLE`; counts were 1 and 8, while 127 sessions were `UNCLEAR`. | Both primary states are far below the frozen descriptive comparison requirement. | No valid primary historical comparison can be interpreted. | No-information evidence may not be reframed as a negative edge, and `UNCLEAR` may not be redefined to rescue sample size. | `PAUSE_INSUFFICIENT_SAMPLE`. |
| Volatility | `HIGH` versus `LOW` was `INSUFFICIENT_SAMPLE`; counts were 89 and 4, with 44 `NORMAL`. | The `LOW` side is too sparse for the predeclared primary contrast. | State distribution is descriptive only; the primary comparison is not evaluable. | Volatility timing, risk veto, threshold retuning, merging `LOW` with `NORMAL`, or changing the axis definition. | `PAUSE_INSUFFICIENT_SAMPLE`. |
| Risk Research Context | `ELEVATED` versus `NORMAL` was `INSUFFICIENT_SAMPLE`; counts were 119 and 18. | The `NORMAL` side is below the minimum historical comparison size. `riskResearchContext` is not canonical product risk. | Research pressure context may be retained descriptively, without product authority. | Canonical `ELEVATED`, Risk Engine veto, Strategy Router permission, or a claim that elevated context predicts adverse outcomes. | `PAUSE_INSUFFICIENT_SAMPLE`. |

The other permitted disposition labels remain available for future Owner decisions:

- `KEEP_DESCRIPTIVE_ONLY`: retain a stable description with no promotion attempt.
- `REJECT`: close a candidate when valid evidence or governance makes continued validation inappropriate.

Neither label is newly assigned in this closeout.

## Owner Review Summary

### USER INTENT

- Close the historical Market State V1 research phase.
- Present Direction and Global Alignment as Forward Shadow candidates only.
- Pause Trend, Volatility, and Risk Research Context because the frozen primary comparisons lack sufficient samples.
- Define the forward evidence contract before any new forward outcome is visible.
- Keep all research non-executable and require Product Owner approval before every promotion.

### CODEX RECOMMENDATION

Use one forward sample policy for each promoted single-axis comparison:

- at least **60 clean, accepted forward trading days in total**; and
- at least **30 clean observations in each side of the predeclared primary comparison**.

This is not USER INTENT and is not frozen. The 30-per-side floor follows the existing descriptive bootstrap minimum rather than CRU-18 performance. The 60-day total adds an operational window long enough to expose scheduling, data-quality, unavailable-state, and replay failures. A planning range of roughly **120 to 180 trading days** is prudent because state occurrence is uneven; it is an estimate, not a gate requirement.

If one state remains rare, the axis remains `INSUFFICIENT_SAMPLE`. Do not merge states, change thresholds, relabel unavailable observations, retroactively backfill forward days, or extend the observation window to manufacture sufficiency.

### UNRESOLVED OWNER DECISIONS

Before Forward Shadow can start, the Product Owner must explicitly decide:

1. Whether Direction, Global Alignment, both, or neither enter Forward Shadow.
2. Whether to accept, revise, or reject the recommended 60-total / 30-per-side sample policy.
3. The Owner-approved statistical PASS criterion and whether a practical-effect floor is required; none is invented here.
4. The official forward start trade date and immutable evaluator / Outcome Contract hashes.
5. The accepted daily operating window, late-start policy, missed-day policy, and manual responsibilities.
6. Which data-quality conditions are hard `FAIL` versus session-level `UNAVAILABLE`.
7. Whether Direction and Global Alignment are reviewed independently; CRU-19 recommends independent review and prohibits multi-axis combinations.
8. What evidence is required before a later Strategy Router design review. No implementation is authorized by this closeout.

## Safety declaration

`multiAxisSearchPerformed=false`  
`pnlAnalysisPerformed=false`  
`pfAnalysisPerformed=false`  
`sharpeAnalysisPerformed=false`  
`marketStateRetuningPerformed=false`  
`formalWeight=0`  
`researchOnly=true`  
`executionAuthorized=false`

