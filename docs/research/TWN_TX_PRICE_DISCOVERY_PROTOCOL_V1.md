# TWN–TX Price Discovery Protocol V1

> Work package: CRU-37
> Status: PRE-SPECIFIED RESEARCH PROTOCOL / DATA NOT AVAILABLE
> The protocol makes descriptive hypotheses, not trading or causal claims.

## 1. Research question

When both sources are eventually governed, describe how price information appears across SGX FTSE Taiwan Index Futures (`TWN`) and TAIFEX TAIEX Futures (`TX`) around Taiwan-relevant windows. The two products have related Taiwan equity exposure but different underlying index methodology, contract currency, multiplier, venue, holidays, liquidity and session design. Equality is not assumed.

Current execution status is `BLOCKED_TWN_SOURCE_NOT_GOVERNED`; no analysis run is authorized or claimed.

## 2. Required inputs

- actual TWN and TX contract events or bounded bars;
- explicit expiry and selected actual contract on each venue;
- exchange event time, local receipt time and eligible availability time;
- tradeDate/session assigned by each exchange calendar;
- bid/ask or trades, volume, and OI when truly supplied;
- contract multiplier, currency and underlying-index identity;
- source entitlement and raw payload hashes;
- missing-interval, stale, rollover and correction evidence.

No proxy may fill a missing TWN or TX interval. `MTWN`, an ETF, CFD, SGX webpage chart, or stale close cannot be silently substituted.

## 3. Frozen observation windows

All anchors below are Asia/Taipei (UTC+8). They are protocol boundaries, not claims that every venue produces a trade at the exact second.

| Window | Anchor | Purpose | Fail-closed condition |
|---|---|---|---|
| Prior US context | Last legally available NQ/MNQ/NDX/SOX/VIX/TSM observations before 05:15 | Label overseas context without giving it a causal vote | Any input unavailable after its source/session/availability gate |
| TWN overnight close | 05:15 | Record final eligible TWN T+1 state and overnight return | No valid actual TWN contract observation within the predeclared freshness tolerance |
| Premarket snapshot | 08:35 | Freeze evidence available before both 08:45 opens | Any value arriving after 08:35 is excluded; this is a knowledge cutoff, not a synthetic TWN price |
| Futures open discovery | 08:45–09:00 | Compare TWN T-session and TX DAY opening paths before cash open | Either venue has unresolved contract/session, gap or stale quote |
| Taiwan cash open | 09:00–09:15 | Observe whether prior futures divergence persists after TWSE opens | TWSE/TX/TWN clocks not aligned or 2330/index evidence unavailable |
| Taiwan continuous | 09:15–13:30 | Descriptive lead/lag and divergence stability | Coverage below predeclared threshold |
| Cash-to-futures close | 13:30–13:45 | Separate TWSE cash close from futures close | Do not reuse 13:30 cash value as a 13:45 live value without explicit carry-forward label |
| TWN T+1 reopen | 14:00–15:00 | Observe TWN after TX DAY closes and before TX NIGHT opens | SGX auction/session markers unavailable |
| TX night reopen | 15:00 onward | Observe two-venue overnight context | TAIFEX next-regular-session tradeDate attribution unresolved |

SGX currently publishes TWN T opening at 08:45, T close process after 13:45, and T+1 opening at 14:00 through 05:15 Singapore time on its [official product page](https://www.sgx.com/derivatives/products/twnfc?cc=MTWN). TAIFEX states that domestic index after-hours trading runs 15:00–05:00 and is attributed to the following regular session on its [after-hours page](https://www.taifex.com.tw/enl/eng4/aHIntroduction). Exchange holiday calendars may make one-sided windows legitimate; they must not be classified as capture failures.

## 4. Preprocessing

1. Select actual contracts independently for TWN and TX under a frozen rollover rule.
2. Keep auctions, continuous trading, T/T+1 and DAY/NIGHT labels separate.
3. Construct fixed 1-minute bars only from eligible events; empty minutes remain empty.
4. Use midquote when a two-sided, fresh quote exists; otherwise use a separately labelled last trade. Never switch price type silently.
5. Convert timestamps to UTC for ordering and retain Asia/Taipei labels for interpretation.
6. V1 compares only arithmetic normalized returns `P(t)/P(anchor)-1` and raw `R_TX-R_TWN`. Log returns, beta adjustment, volatility standardization and other transformations require a separately versioned future protocol. Raw index points and currency notionals are not directly comparable.
7. Winsorization, outlier removal or interpolation is prohibited unless a future version pre-specifies it before outcome review.

At 08:35 TWN is between T+1 close and T open. The snapshot may carry the last eligible 05:15 T+1 trade or midpoint only as `STALE_PRIOR_SESSION_REFERENCE` with its original timestamp; auction-indicative, last-trade and midpoint values are never interchangeable. No 05:15-to-08:35 return exists because there is no governed continuous TWN trading window between those anchors.

## 5. Descriptive measures

### 5.1 V1 normalized returns

```text
R_TX(t)  = P_TX(t)  / P_TX(anchor)  - 1
R_TWN(t) = P_TWN(t) / P_TWN(anchor) - 1
rawNormalizedDivergence(t) = R_TX(t) - R_TWN(t)
```

Each price must use the same actual contract and price type within its interval.

V1 does not fit beta and does not use log returns or volatility-standardized divergence. `compositionAdjustedDivergence` is prohibited until effective-date TSMC/Top-10 weights and both index methodologies are governed. Every raw comparison emits `STRUCTURAL_DIVERGENCE_POSSIBLE` because the TWN underlying is not TAIEX.

### 5.2 `TWN_OFFSHORE_REPRICING`

```text
P_TWN(anchor) = first eligible actual-contract TWN trade at/after 14:00:00 and before 14:01:00
P_TWN(pre1500) = last eligible same-contract TWN trade before 15:00:00 and at/after 14:59:00
TWN_OFFSHORE_REPRICING = P_TWN(pre1500) / P_TWN(anchor) - 1
```

If a governed fresh two-sided midpoint is later selected instead of trades, that is a new protocol version; V1 never switches price type within a sample.

### 5.3 `TX_NIGHT_OPEN_RESPONSE` and outcomes

```text
P_TX(preNight) = last eligible actual-contract TX DAY trade at/after 13:44:00 and before 13:45:00
P_TX(open) = first eligible same-contract TX NIGHT trade at/after 15:00:00 and before 15:01:00
TX_NIGHT_OPEN_GAP = P_TX(open) / P_TX(preNight) - 1
TX_NIGHT_OPEN_RESPONSE(T+H) = P_TX(15:00+H) / P_TX(preNight) - 1
TX_POST_OPEN_PATH(T+H) = P_TX(15:00+H) / P_TX(open) - 1
H = 5, 15, 30, 60, 120 minutes after the governed 15:00:00 session boundary
```

`TX_NIGHT_OPEN_GAP` preserves the immediate response at 15:00. `TX_NIGHT_OPEN_RESPONSE(T+H)` preserves the cumulative response from the last legal DAY reference and is the series used for cross-market alignment. `TX_POST_OPEN_PATH` reports subsequent NIGHT movement separately so an opening catch-up cannot be erased.

`P_TX(15:00+H)` is the last eligible same-contract trade at or before the fixed horizon boundary and after `15:00+H-60 seconds`. Every horizon is separately unavailable when its final minute is missing/stale or its session ends. If no eligible 13:44–13:45 DAY reference exists, or if the selected actual contract changes between DAY reference and NIGHT outcomes, all response values are unavailable. The first eligible open trade may arrive anywhere in 15:00:00–15:00:59, but it never shifts any T+H clock.

### 5.4 Alignment states

Compare `TWN_OFFSHORE_REPRICING` with each `TX_NIGHT_OPEN_RESPONSE(T+H)`:

- same non-zero sign: `CONFIRMATION`;
- opposite non-zero sign: `DIVERGENCE`;
- zero/near-zero or sign changes across horizons: `MIXED`;
- failed gate: `UNAVAILABLE`;
- every available raw comparison additionally carries `STRUCTURAL_DIVERGENCE_POSSIBLE`.

“Near-zero” is not optimized after results. For TWN repricing it is `abs(TWN_OFFSHORE_REPRICING) < max(2 × TWN minimum tick / TWN anchor price, P20 of past-only absolute TWN_OFFSHORE_REPRICING)`. For each TX horizon it independently uses the same formula with TX minimum tick, TX pre-night anchor and that horizon's past-only absolute `TX_NIGHT_OPEN_RESPONSE`. Each threshold requires at least 60 prior eligible paired sessions; otherwise the alignment state is `UNAVAILABLE` rather than guessed.

`TX catch-up` is a descriptive confirmation in which `TX_NIGHT_OPEN_RESPONSE(T+H)` shares the sign of `TWN_OFFSHORE_REPRICING` and reduces `abs(TX_NIGHT_OPEN_RESPONSE(T+H) - TWN_OFFSHORE_REPRICING)`, including catch-up already present in `TX_NIGHT_OPEN_GAP`. `TWN reversal` can only be evaluated from new post-15:00 TWN movement and must be separately labelled; it is not inferred from TX alone.

### 5.5 Local TX Pressure, Price Response and Path Efficiency

Pressure is a research proxy, not true aggressor intent. CRU-37 reuses the baseline versioned `buildExecutedPressureWindow` and `buildPriceResponsePathEfficiencyWindow` semantics; it does not create a second classifier:

```text
buyProxyVolume = executed volume with provider tick_type=1
sellProxyVolume = executed volume with provider tick_type=2
classifiedVolume = buyProxyVolume + sellProxyVolume
TX_PRESSURE(H) = (buyProxyVolume - sellProxyVolume) / classifiedVolume
CROSS_MARKET_CUMULATIVE_RESPONSE(H) = TX_NIGHT_OPEN_RESPONSE(T+H)
BASELINE_TRAILING_PRICE_RESPONSE(H) = (baselineWindowEndPrice - baselineWindowStartPrice)
                                      / baselineWindowStartPrice
PATH_EFFICIENCY(H) = baseline V1 absolute net tick displacement / tick-path length
```

For each fixed H, the baseline pressure/response/path window ends on the same final eligible T+H tick and uses `windowMs=H minutes`. Because the existing builder uses a lower-exclusive event-time boundary relative to the actual cutoff tick, this is explicitly a trailing baseline window and must not be described as an exact `[15:00:00, T+H]` aggregate. The cumulative `TX_NIGHT_OPEN_RESPONSE` remains the separate fixed-boundary price outcome. The existing contract requires same actual contract, trade date, session and continuity epoch; usable identity/availability lineage; valid price/volume; `classifiedCoverage === 1`; at least three path ticks; and no adjacent event-time gap over 30 seconds. Best-quote classification with maximum quote age 2 seconds is retained only as a cross-check; it does not replace provider `tick_type` side. Any incomplete provider classification remains `QUALITY_INSUFFICIENT`, even if quote classification is available.

`BASELINE_TRAILING_PRICE_RESPONSE(H)` uses exactly the first and last eligible ticks returned by the same baseline trailing window as `TX_PRESSURE(H)` and `PATH_EFFICIENCY(H)`. It is the only response used for pressure/effort/path classification. `CROSS_MARKET_CUMULATIVE_RESPONSE(H)` retains the DAY-reference/open-gap information and is used only for TWN/TX cross-market alignment and catch-up analysis.

If `classifiedVolume=0`, pressure is unavailable. If the baseline start price is unavailable/non-positive, trailing response is unavailable. If path length is zero, Path Efficiency is `UNAVAILABLE_ZERO_PATH`; it is not coerced to zero or one. Native sequence remains unavailable, so every output carries `PACKET_LOSS_CERTAINTY=UNKNOWN`.

- `PRESSURE_CONFIRMATION`: eligible pressure and `BASELINE_TRAILING_PRICE_RESPONSE` share a sign.
- `PRESSURE_DIVERGENCE`: those trailing-window signs oppose.
- `EXTERNAL_REPRICING_PRESSURE_CONFIRMATION`: eligible pressure shares the sign of `TWN_OFFSHORE_REPRICING`; this does not replace the response/path classification.
- `EFFORT_FAILURE_CANDIDATE`: `abs(TX_PRESSURE) >= past-only P80`, `abs(BASELINE_TRAILING_PRICE_RESPONSE) <= past-only P20`, and `PATH_EFFICIENCY <= past-only P20`, using at least 60 prior eligible sessions and identically defined trailing windows.

Without 60 prior eligible sessions or any quality threshold, these states are `UNAVAILABLE`. They never imply BUY/SELL or actor identity.

### 5.6 Secondary lead/lag diagnostics

- lagged return cross-correlation on synchronized eligible bars;
- first threshold-crossing timestamp for predeclared absolute V1 arithmetic normalized returns;
- response fraction over fixed horizons after a move on the other venue;
- quote-age and coverage-stratified results;
- results split by normal days, each venue’s holiday asymmetry, and rollover windows.

These are timing associations. They do not prove that one venue caused the other to move.

### 5.7 Other opening discovery diagnostics

- TWN prior-session 05:15 reference visible at the 08:35 knowledge cutoff, explicitly stale rather than a fabricated 05:15-to-08:35 move;
- 08:45 opening gap for each product relative to its own last legal reference;
- 08:45–09:00 return agreement/disagreement;
- 09:00–09:15 continuation, reversal or unresolved state;
- 13:30–13:45 cash/futures separation;
- 14:00 TWN and 15:00 TX reopen gaps under their own session references.

Labels such as `AGREEMENT`, `DIVERGENCE`, `ONE_SIDED_MARKET_CLOSED`, and `UNAVAILABLE` are descriptive states only.

## 6. Hypotheses and falsification

Pre-specified candidates:

1. TWN’s overnight path contains descriptive information about the initial TX DAY move.
2. TX/TWN disagreement before 09:00 is less persistent when the Taiwan cash market opens.
3. Lead/lag direction varies by liquidity, holiday asymmetry, rollover and global-volatility regimes.
4. Eligible local TX Pressure either confirms the external TWN repricing or exposes a descriptive divergence.
5. Large pressure with weak Price Response and low Path Efficiency identifies an `EFFORT_FAILURE_CANDIDATE`, subject to out-of-sample stability.

Each hypothesis fails if effects are unstable out of sample, disappear after quote-age/coverage controls, depend on one regime, or cannot pass the availability audit. A null or conflicting result is valid.

## 7. Sample and validation gates

- Both source/license states must be approved, actual `frontMonthIdentity` must be reproducible, and all raw hashes must pass.
- The 14:00 and pre-15:00 TWN anchors and 15:00 TX open must occur in the exact 60-second windows defined above; no nearest-value search outside those windows.
- Required one-minute bar coverage is at least 95% for each evaluated horizon, with no gap longer than two consecutive minutes. A sample failing one horizon may remain eligible for shorter complete horizons only.
- Trade anchors must be received/normalized within 5 seconds of `eventTime`; otherwise `STALE`/timestamp quality makes that horizon unavailable.
- Report effective days, missing days, venue holidays, stale minutes and rollover exclusions.
- Exclude expiry/rollover samples when either selected actual contract changes between anchor and outcome, or when `frontMonthIdentity` cannot be reproduced. Also report them separately as excluded—not rewritten.
- A day where either venue is officially closed is `ONE_SIDED_MARKET_CLOSED`, not a capture failure and not part of the primary paired sample.
- Missing records, reconnect gaps and corrections unresolved at decision time remain unavailable; no interpolation or retrospective repair.
- Extreme events are retained and flagged when absolute TWN repricing or TX response exceeds its past-only P99 after at least 60 prior sessions. Report primary results with extremes and a predeclared sensitivity table without them; never winsorize values.
- Separate development and untouched chronological validation periods.
- Use block bootstrap or another serial-dependence-aware interval method.
- Report effect size and uncertainty, not only significance.
- Re-run by year/regime and with reasonable predeclared freshness tolerances.
- Audit every derived row for `max(input.availableAt) <= decisionAt`, exact equality of each input's raw and availability ledger identities, writer epochs, epoch sequences, and clock-continuity epoch to the persisted decision `sourceCutoffs[]`, and both ledger-global ordinals being less than or equal to their matching identity-bound cutoffs. Verify hash-linked epoch-manifest succession across every restart. Cross-ledger scalar ordinal comparison, epoch reuse, and ordinal reset are prohibited.
- Bind the result to raw hashes, calendar versions, selected contracts and protocol version.

Historical data purchased later may be analyzed as historical evidence, but it must never be represented as previously captured forward evidence. Missed future collection intervals are never synthesized.

## 8. Explicit non-goals

- no prediction score, BUY/SELL label, strategy permission or risk veto;
- no T0/P0 tuning or Forward Paper mutation;
- no TWN/TX arbitrage or execution design;
- no new broker/order path;
- no claim that TWN, TX, NQ, SOX, USD/TWD or TSM ADR are independent votes;
- no CRU-10 or CRU-11 evidence claim.

## 9. Safety

Every output must carry `researchOnly=true`, `formalWeight=0`, `executionAuthorized=false`, and `orderRoutesEnabled=false`.
