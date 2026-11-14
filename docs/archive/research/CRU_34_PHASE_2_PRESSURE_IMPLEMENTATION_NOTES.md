# CRU-34 — Phase 2 Executed Pressure Proxy V1 Notes

Status: **IMPLEMENTATION NOTES / RESEARCH ONLY**

This note records the bounded Phase 2 derivation that will be implemented on the Phase 1 canonical observation substrate.

## Provider-side pressure

For each governed trailing window:

```text
BUY_PROXY   = sum executedVolume where tick_type == 1
SELL_PROXY  = sum executedVolume where tick_type == 2
UNKNOWN     = sum executedVolume where tick_type is 0 / unsupported
classified = BUY_PROXY + SELL_PROXY
netAggressiveFlowProxy = BUY_PROXY - SELL_PROXY
pressureRatio = (BUY_PROXY - SELL_PROXY) / classified
classifiedCoverage = classified / totalExecutedVolume
```

`pressureRatio` is unavailable when `classified == 0`.

The provider-side classification is a deterministic research proxy only. It is not participant identity, true aggressor identity, dealer/主力/外資 identity, hidden inventory, or causal proof.

## Best-quote cross-check

For each Tick, only the latest physically prior, availability-safe quote in the same contract/tradeDate/session/continuityEpoch may be considered.

Best quote classification:

```text
trade price >= best ask -> BUY_PROXY
trade price <= best bid -> SELL_PROXY
otherwise                -> INSIDE_SPREAD
no legal quote            -> UNAVAILABLE
```

Best-quote evidence stays separate from provider classification.

Required quality outputs:

- bestQuoteBuyProxyVolume
- bestQuoteSellProxyVolume
- bestQuoteInsideSpreadVolume
- bestQuoteUnavailableVolume
- bestQuoteMatchedCoverage
- classificationConflictCount
- classificationConflictRate

Conflict is preserved as evidence and never majority-voted away.

## Direction wording

V1 may expose only bounded observed pressure direction derived from the sign of a legal pressure ratio:

- `BUY_SIDE`
- `SELL_SIDE`
- `BALANCED`
- `UNAVAILABLE`

This is not Relative Intensity. No `強 / 中 / 弱`, percentile, confidence, probability, Control, Absorption, Market State, BUY/SELL recommendation, or execution permission is authorized.
