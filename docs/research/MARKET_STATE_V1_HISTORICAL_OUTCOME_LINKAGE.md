# Market State V1 Historical Outcome Linkage

CRU-18 is an isolated, research-only linkage gate. It reuses the frozen Market State V1 and Outcome Contract V1 without changing state definitions, outcome formulas, observation windows, sample policy, contract selection, or available-at semantics.

- Only `trend`, `direction`, `volatility`, `globalAlignment`, and `riskResearchContext` are analyzed, one axis at a time.
- The governed actual TX contract from the 137-session strict manifest is used. Continuous contracts are forbidden.
- Four intraday continuous outcome families use natural Tick replay. Opening Gap remains a separate coverage gate and is unavailable unless a governed prior-night same-contract close exists.
- All legal state groups are retained. Primary contrasts are frozen by the Outcome Contract request.
- `N < 20` is `DO_NOT_INTERPRET`; `20 <= N < 30` is `DESCRIPTIVE_ONLY`; effect size and deterministic 95% bootstrap CI are emitted only when both primary groups have at least 30 observations.
- Conclusions are restricted to `NO_INFORMATION_SIGNAL`, `WEAK_DESCRIPTIVE_DIFFERENCE`, `DESCRIPTIVE_DIFFERENCE_PRESENT`, or `INSUFFICIENT_SAMPLE`.

No multi-axis search, binary threshold optimization, PnL, PF, Sharpe, strategy backtest, Market State retuning, Signal, Paper, broker route, or execution is authorized.

`formalWeight=0`  
`researchOnly=true`  
`executionAuthorized=false`
