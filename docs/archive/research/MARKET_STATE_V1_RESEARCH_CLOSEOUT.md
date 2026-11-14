# Market State V1 Research Closeout

> Work package: CRU-19  
> Status: OWNER-APPROVED — PENDING PR MERGE  
> Baseline commit: `9c9bbaeae6260c7b660a4e3bcf18287ef05c0739`  
> Boundary: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`

## Purpose

This document closes the historical Market State V1 research phase. It does not add a factor, change any axis semantics or threshold, search another outcome, establish trading edge, or authorize Strategy Router, Risk Engine, Paper Trading, broker routes, or execution.

Historical evidence is limited to 753 Market State records and 137 governed strict TX outcome sessions. CRU-18 reported zero temporal-alignment violations and zero future-data violations. Canonical risk does not contain `ELEVATED`; that label remains confined to `riskResearchContext`.

Product Owner approved the CRU-19 Forward Gate on 2026-08-09. The gate is frozen before any new forward outcome is observed. Forward Shadow launch remains separately unauthorized until implementation, launch manifest, local validation, start date and explicit Owner launch approval are complete.

## Axis Disposition Matrix

| Axis | Historical finding | Sample limitation | Strongest allowed conclusion | Prohibited claim | Owner-approved disposition |
|---|---|---|---|---|---|
| Direction | The frozen primary comparison, `BULLISH` versus `BEARISH`, produced `DESCRIPTIVE_DIFFERENCE_PRESENT`. The strict-session counts were 38 and 40; `NEUTRAL` and `CONFLICT` were retained descriptively. | Only 137 strict TX sessions were linked. This is historical and already inspected evidence, not forward proof. | A predeclared single-axis descriptive difference exists and is eligible for a new forward-only check. | Trading edge, profitable direction signal, formal factor, Strategy Router permission, position-sizing rule, or causal relationship. | `PROMOTE_TO_FORWARD_SHADOW`. |
| Global Alignment | The frozen `TAILWIND` versus `HEADWIND` comparison produced `DESCRIPTIVE_DIFFERENCE_PRESENT`; counts were 43 and 35, with 59 `MIXED` sessions retained. | Only 137 strict TX sessions; global source coverage and state frequency may drift in forward operation. | A predeclared single-axis descriptive difference exists and is eligible for a new forward-only check. | Trading edge, cross-market timing rule, formal confirmation filter, or permission to combine with Direction. | `PROMOTE_TO_FORWARD_SHADOW`. |
| Trend | `TREND_UP` versus `TREND_DOWN` was `INSUFFICIENT_SAMPLE`; counts were 1 and 8, while 127 sessions were `UNCLEAR`. | Both primary states are far below the frozen descriptive comparison requirement. | No valid primary historical comparison can be interpreted. | No-information evidence may not be reframed as a negative edge, and `UNCLEAR` may not be redefined to rescue sample size. | `PAUSE_INSUFFICIENT_SAMPLE`. |
| Volatility | `HIGH` versus `LOW` was `INSUFFICIENT_SAMPLE`; counts were 89 and 4, with 44 `NORMAL`. | The `LOW` side is too sparse for the predeclared primary contrast. | State distribution is descriptive only; the primary comparison is not evaluable. | Volatility timing, risk veto, threshold retuning, merging `LOW` with `NORMAL`, or changing the axis definition. | `PAUSE_INSUFFICIENT_SAMPLE`. |
| Risk Research Context | `ELEVATED` versus `NORMAL` was `INSUFFICIENT_SAMPLE`; counts were 119 and 18. | The `NORMAL` side is below the minimum historical comparison size. `riskResearchContext` is not canonical product risk. | Research pressure context may be retained descriptively, without product authority. | Canonical `ELEVATED`, Risk Engine veto, Strategy Router permission, or a claim that elevated context predicts adverse outcomes. | `PAUSE_INSUFFICIENT_SAMPLE`. |

The other permitted disposition labels remain available for future Owner decisions:

- `KEEP_DESCRIPTIVE_ONLY`: retain a stable description with no promotion attempt.
- `REJECT`: close a candidate when valid evidence or governance makes continued validation inappropriate.

Neither label is newly assigned in this closeout.

## Final Owner Decision — Forward Gate Freeze

The Product Owner approved the following Forward Gate policy on 2026-08-09:

1. Forward axes are `direction` and `globalAlignment`, reviewed independently.
2. Trend, Volatility, and Risk Research Context remain paused.
3. Operational floor is at least **60 scheduled trading days** with one traceable official status record per scheduled day.
4. Statistical sufficiency requires **at least 30 clean accepted observations on each side** of each promoted axis's predeclared primary comparison.
5. The first frozen run has a maximum horizon of **180 scheduled trading days**. An axis that still lacks 30-per-side at that horizon closes as `INSUFFICIENT_SAMPLE`; no threshold rescue or horizon extension inside the run.
6. The only PASS/FAIL-determining forward outcome is `LARGE_MOVE_CONTINUOUS.sessionReturnBps`.
7. Direction PASS requires mean(`BULLISH`) - mean(`BEARISH`) `sessionReturnBps` > 0 and a deterministic 95% bootstrap CI entirely above 0.
8. Global Alignment PASS requires mean(`TAILWIND`) - mean(`HEADWIND`) `sessionReturnBps` > 0 and a deterministic 95% bootstrap CI entirely above 0.
9. Other existing Outcome Contract fields remain descriptive-only and cannot determine PASS/FAIL.
10. No separate economic/practical bps floor is imposed at this information-content gate. A PASS only permits a later Strategy Router design review; it does not establish trading edge or product authority.
11. No partial outcome-effect peeking is permitted. Operational checkpoints may inspect integrity/data quality only; statistical review occurs only at the frozen sample gate or 180-day horizon.
12. Hard integrity failures include future-data or temporal-alignment violation, deterministic replay mismatch, hash-chain failure, duplicate official state record, silent correction, or unauthorized execution. Ordinary missing/stale source data remains explicit session-level `UNAVAILABLE` and is never backfilled as forward evidence.

The detailed frozen rules are defined in `MARKET_STATE_V1_FORWARD_SHADOW_GATE.md`.

## USER INTENT versus prior CODEX recommendation

### USER INTENT / OWNER-FROZEN

- Close the historical Market State V1 research phase.
- Promote Direction and Global Alignment to forward-only validation, independently.
- Pause Trend, Volatility, and Risk Research Context without retuning.
- Freeze the forward evidence and PASS/FAIL contract before new forward outcome exposure.
- Keep Market State non-executable and require separate Product Owner approval for launch and any later product promotion.

### CODEX RECOMMENDATION — disposition after Owner review

The earlier Codex suggestion of `60 clean total + 30 per side` was refined during Owner Review to separate two different questions:

- **Operational duration:** 60 scheduled trading days.
- **Statistical sufficiency:** 30 clean accepted observations per required side.

The refined policy above is now the Owner-frozen gate. The planning expectation that uneven state occurrence may require roughly 120–180 trading days remains an estimate, not an additional PASS criterion.

## Remaining launch decisions — not part of historical research

Historical Market State V1 research is closed once this approved CRU-19 change is merged to main. Forward Shadow itself remains inactive until a separate launch/implementation review resolves:

1. the final merged main commit and immutable launch manifest;
2. the official forward start trade date;
3. collector/storage and append-only ledger implementation;
4. daily operating time, scheduler, late-start and missed-day mechanics consistent with the frozen gate;
5. local D-drive validation;
6. explicit Product Owner approval to activate Forward Shadow.

No Strategy Router implementation, Risk Engine integration, Paper integration, broker route, order path, or execution is authorized.

## Safety declaration

`multiAxisSearchPerformed=false`  
`pnlAnalysisPerformed=false`  
`pfAnalysisPerformed=false`  
`sharpeAnalysisPerformed=false`  
`marketStateRetuningPerformed=false`  
`formalWeight=0`  
`researchOnly=true`  
`executionAuthorized=false`
