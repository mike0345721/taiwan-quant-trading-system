# Market State V1 — Data Collection Track

> Status: AUTHORIZED COLLECTION DESIGN / RESEARCH ONLY  
> Parent work package: CRU-12  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## 1. Purpose

This track exists to start accumulating high-value intraday and leadership evidence that cannot be reconstructed reliably later if it is not captured now.

Collection does **not** imply promotion into Market State V1, strategy permission, risk veto, paper trading, or live execution. Data must pass separate quality, time-contract, and validation gates before it can affect any formal state.

Premarket Market State V1 continues independently and must not be blocked by these collection gaps.

## 2. Owner-authorized collection scope

The following six evidence families are important enough to begin structured collection planning now:

1. TSMC Contribution
2. Top-10 Contribution
3. Long-horizon CVD / Aggressive Flow history
4. Intraday Options IV / Skew
5. True NQ Futures intraday data
6. Intraday USD/TWD

## 3. Priority model

### P1 — Start collecting forward as soon as a lawful, stable source is confirmed

These datasets lose historical value every day they are not captured:

- CVD / Aggressive Flow
- Intraday Options IV / Skew
- True NQ Futures
- Intraday USD/TWD
- TSMC and Top-10 intraday price / constituent evidence needed for future contribution analysis

### P2 — Historical backfill after source and semantics are proven

- TSMC historical index-point contribution
- Top-10 historical index-point contribution
- historical constituent / weight snapshots where licensing and source quality permit

Do not delay P1 forward collection while waiting for perfect historical backfill.

## 4. Canonical raw-event contract

Every newly collected intraday record must preserve at minimum:

```text
source
instrument
market
tradeDate
session
eventTime
receivedAt
availableAt
sequence / sourceId when available
rawPayloadHash
qualityStatus
researchOnly=true
executionAuthorized=false
```

Rules:

- preserve raw source timestamp separately from local receive timestamp;
- never overwrite raw events with derived values;
- deduplicate deterministically;
- preserve missing / stale / disconnected intervals explicitly;
- do not synthesize backfill for missed forward sessions;
- all derived Market State features must be reproducible from raw evidence.

## 5. TSMC Contribution

### Goal

Distinguish index movement driven mostly by TSMC from broad-market movement.

### Required evidence

- 2330 price path;
- TAIEX index path;
- official / governed constituent weight or contribution methodology;
- constituent effective-date history;
- corporate-action / index-rebalance handling.

### Collection-first rule

2330 price alone is **not** TSMC Contribution. Until weight / divisor / contribution semantics are governed, store the inputs but label contribution as `UNAVAILABLE`.

### Future outputs

```text
tsmcReturn
tsmcWeightEffective
tsmcIndexPointContribution
tsmcShareOfIndexMove
```

All outputs remain research-only until historical reproduction is validated.

## 6. Top-10 Contribution

### Goal

Measure whether the index is broad, concentrated, or dominated by a small set of heavyweights.

### Required evidence

- effective-date Top-10 constituent list;
- historical and current weights;
- intraday price path for each constituent;
- index methodology / corporate action handling.

### Future descriptive outputs

```text
top10ContributionPoints
top10ShareOfIndexMove
leadershipBreadth
narrowLeadershipFlag
```

Do not freeze a Top-10 list permanently; membership must be effective-date aware.

## 7. Long-horizon CVD / Aggressive Flow

### Goal

Build enough forward history to test whether transaction-flow confirmation or divergence adds descriptive value to intraday state.

### Raw inputs

- TX futures ticks;
- provider aggressor classification when available;
- synchronized Bid / Ask snapshots;
- quote age;
- unknown / inside-spread classifications;
- classification conflicts.

### Mandatory quality fields

```text
classifiedVolumeRatio
quoteClassifiedVolumeRatio
classificationConflictRatio
unknownVolumeRatio
quoteAgeDistribution
captureCoverage
```

Tick-rule or provider classification must never be described as proof of trader identity or true intent.

## 8. Intraday Options IV / Skew

### Goal

Observe how implied volatility and downside-tail pricing evolve during the Taiwan session instead of relying only on EOD snapshots.

### Required evidence

- option contract / expiry / strike;
- call / put bid, ask, last, volume;
- underlying price timestamp;
- IV or inputs sufficient to reproduce IV;
- delta / Greeks when source quality is governed;
- contract selection semantics;
- synchronized timestamps.

### Desired derived series

```text
atmIv
atmIvChangeFromOpen
skew25d
riskReversal25d
ivTermSpread
quoteCoverage
staleRatio
```

Do not interpolate across unavailable strikes without an explicit methodology and quality flag.

## 9. True NQ Futures

### Goal

Replace the daily `NDX_PROXY` limitation with actual Nasdaq-100 futures evidence during Taiwan-relevant hours.

### Required evidence

- actual NQ or explicitly chosen micro / equivalent futures contract;
- contract code and expiry;
- continuous-vs-actual-contract policy;
- exchange timestamp;
- intraday OHLCV or tick data;
- rollover handling;
- source and licensing status.

### Rule

Cash NDX, QQQ, CFD, and NQ futures must remain distinct instrument identities. No proxy may silently be renamed `NQ`.

## 10. Intraday USD/TWD

### Goal

Test whether Taiwan-dollar strengthening / weakening supplies useful intraday context for foreign-flow and Taiwan-risk state.

### Required evidence

- USD/TWD spot or clearly identified executable / indicative source;
- source timestamp and receive timestamp;
- bid / ask when available;
- trading-hours / stale semantics;
- holiday alignment.

### Future descriptive outputs

```text
usdTwdReturn5m
usdTwdReturn30m
usdTwdFromTaiwanOpen
usdTwdVolatility
fxAlignment
```

No causal interpretation is authorized before conditional validation.

## 11. Storage and retention principles

- raw intraday data remains local-runtime / large-data storage unless a small immutable manifest is approved for GitHub;
- GitHub stores schemas, collectors, tests, manifests, and documentation — not bulk raw market history;
- credentials / API keys remain local-only;
- collection must tolerate restart and produce explicit gap evidence;
- retention policy must be defined before high-volume expansion.

## 12. Collection readiness gates

A source may enter forward collection only after:

1. instrument identity is explicit;
2. timestamp semantics are understood;
3. rate limits / licensing permit intended use;
4. raw storage schema is defined;
5. reconnect / restart behavior is defined;
6. missing intervals are observable;
7. no trading/order route is introduced;
8. `executionAuthorized=false` is enforced.

## 13. Promotion gates

Collected evidence is **not** a Market State input until it passes:

```text
Raw Collection
→ Coverage / Quality Audit
→ availableAt Audit
→ Deterministic Replay
→ Descriptive Historical / Forward Validation
→ Owner Review
→ Shadow State Candidate
```

There is no automatic promotion from collection to formal factor.

## 14. Immediate implementation order

Recommended order when local implementation is authorized:

1. extend existing TX live-event path for durable CVD quality accumulation;
2. capture TSMC + effective Top-10 constituent raw price streams and membership snapshots;
3. add intraday USD/TWD collector;
4. add true NQ futures collector;
5. add intraday Options chain / IV-skew collector;
6. only then consider historical backfill for leadership contribution.

The exact external data vendors remain a separate source-selection decision. Do not bind the architecture to an unapproved vendor.

## 15. Non-goals

This track does not authorize:

- live trading;
- broker order routes;
- Market State trading filters;
- permanent factor weights;
- strategy tuning;
- ORB activation;
- synthetic reconstruction of missing forward sessions;
- bulk vendor purchase without Owner approval.
