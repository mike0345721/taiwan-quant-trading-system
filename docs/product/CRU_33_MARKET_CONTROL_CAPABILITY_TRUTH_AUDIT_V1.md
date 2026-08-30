# CRU-33 — Market Control Capability Truth Audit V1

Status: **DRAFT / AUDIT IN PROGRESS / RESEARCH ONLY**  
Linear: **CRU-33**  
Parent: **CRU-13**  
Approved baseline main: `6bc220841ecd9ac24ac4d45a9d51231222d1a45c`  
Implementation authorization: **NO**

## 1. Audit Question

Can the current approved repository and already-collected TX futures market-data capability legally support a first research-only chain of:

```text
Executed Pressure
+ Displayed Liquidity
        ↓
Price Response
        ↓
Price Path Efficiency
        ↓
Pressure → Price Response / Impact
        ↓
Absorption / Market Control observation
```

without fabricating aggressor truth, hiding UNKNOWN/CONFLICT, using future quotes, or promoting research output into Market State / trading direction?

This audit also asks whether the core design can later become a generic engine with instrument adapters instead of remaining TX-specific.

---

## 2. Executive Finding

### 2.1 What already exists

The repository already contains a meaningful **executed-flow research substrate**:

- Shioaji FOP Tick and BidAsk collection for TX / MTX / TMF.
- Tick events preserve actual contract identity and normalized aliases including `productFamily`, `subscriptionAlias`, `targetCode`, `actualContract`, `eventTime`, `price`, and `executedVolume`.
- Raw provider fields are still preserved, including `close`, `volume`, and `tick_type`.
- Append-only hash-chained ledger storage exists with `receivedAt`, `exchangeTimestamp`, duplicate / sequence-gap / clock-skew audit fields.
- Quote-type health separates Tick delivery from BidAsk delivery; subscribe acknowledgement is not treated as proof of delivery.
- Existing `buildFuturesOrderFlow()` deterministically derives provider-classified buy/sell volume, UNKNOWN volume, CVD, best-quote cross-check classification, conflict count/rate, captured-stream VWAP, and 1m/5m bars.
- Current Decision Workspace deliberately keeps `estimatedFlow` unavailable instead of silently promoting this research derivation.

### 2.2 What does NOT already exist

The repository does **not** currently contain a governed Market Control capability.

Specifically, approved main does not yet contain a governed derivation for:

- displayed five-level depth imbalance / liquidity pressure,
- depth depletion or refill,
- price response linked to a pressure window,
- Price Path Efficiency,
- Pressure → Price Impact Efficiency,
- absorption classification,
- Buyer/Seller Effective state,
- Market Control synthesis,
- production Dashboard wiring for these outputs,
- promotion into Market State / strategy / risk / execution.

### 2.3 Important correction to prior informal language

`quoteCvd` in `src/futures-order-flow.mjs` is **not five-level order-book imbalance**.

It is a trade-volume classification based on the executed tick price relative to the latest usable **best bid / best ask**. The function reads only `bid_price[0]` and `ask_price[0]` for this cross-check. It does not consume `bid_volume`, `ask_volume`, `diff_bid_vol`, or `diff_ask_vol`.

Therefore:

> Existing `quoteCvd` must be classified as a **best-quote inferred executed-flow proxy**, not Displayed Liquidity Pressure.

This distinction is required before any Market Control implementation.

---

## 3. Capability Truth Matrix

| Capability | Exists today? | Source | Exact semantics | Quality / Coverage | Timestamp / Identity | Gap | Reusable? | V1 requirement | Formal status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FOP executed Tick raw | YES | `broker/shioaji_readonly_bridge.py` → `data/live-events/*.ndjson` | Provider FOP executed tick; raw payload preserved | Tick has independent delivery health; malformed/rejected callback fails visibly | actual contract aliases preserved; exchange/event time + local receive time preserved | current connected audit cannot prove today's local runtime delivery from GitHub alone | YES | required | NATIVE_PROVIDER_TRUTH / RAW |
| FOP BidAsk raw | YES | same bridge / ledger | Provider five-level bid/ask prices and volumes; raw callback preserved | BidAsk has independent delivery health | actual contract metadata preserved in payload; exchange time + receive time available | no governed depth-pressure derivation yet | YES | required for displayed liquidity and quote cross-check | NATIVE_PROVIDER_TRUTH / RAW |
| Provider side classification | YES | Tick `tick_type` | Official Shioaji semantics: `1=外盤`, `2=內盤`, `0=無法判定` | UNKNOWN explicitly available | same Tick lineage | must not be renamed as proof of trader identity/intent | YES | preserve native state + UNKNOWN | NATIVE_PROVIDER_CLASSIFICATION |
| Provider-classified buy/sell volume | YES, research derivation | `src/futures-order-flow.mjs` | V1 maps `tick_type 1→buy`, `2→sell`, other→unknown | `classifiedVolumeRatio` measures classified volume coverage | exchange-time aggregation; actual product code required | naming must remain proxy/estimated aggressive flow | YES | keep UNKNOWN separate | DETERMINISTIC_RESEARCH_PROXY |
| Estimated CVD | YES, research derivation | `src/futures-order-flow.mjs` | provider-classified buy volume − sell volume; unknown excluded | coverage is available at product level; 1m/5m bars currently do not expose all product-level quality ratios | exchange-time bars | session reset / cumulative-scope contract must be explicit in future engine | YES | label `Estimated CVD / Provider Side Proxy` | RESEARCH_ONLY / NOT_PROMOTED |
| Best-quote trade cross-check | YES | `src/futures-order-flow.mjs` | tick at/above best ask → buy proxy; at/below best bid → sell proxy; otherwise inside spread/unavailable | quote matched volume ratio + conflicts available | current code checks exchange-time age only; V1 contract must additionally enforce availability cutoff and continuity epoch | explicit delayed-availability/future/stale/reconnect negative cases not yet implemented | YES | implement the §6 availability-safe pairing contract before reuse | DETERMINISTIC_RESEARCH_PROXY |
| Classification conflict | YES | same derivation | provider side and best-quote inferred side disagree | count + ratio retained | same pairing contract | future engine must preserve conflict as evidence, not majority-vote it away | YES | required | RESEARCH_QUALITY_EVIDENCE |
| Captured-stream exact VWAP | YES | same derivation | `sum(tick price × tick volume) / sum(tick volume)` over captured non-simulated ticks | only exact for captured audited stream | exchange-time scope | cannot claim complete-market VWAP if stream capture is incomplete | YES | optional context/response baseline | DETERMINISTIC_DERIVED_TRUTH WITH CAPTURE LIMIT |
| Displayed 5-level depth | RAW DATA AVAILABLE | BidAsk provider payload | five-level `bid_price/bid_volume`, `ask_price/ask_volume`; provider also exposes diff-volume fields | raw coverage depends on BidAsk delivery | event time + receive time present | no current validation contract for array completeness/ordering/zero/derived levels | YES | audit and freeze contract before derivation | RAW_PROVIDER_CAPABILITY, DERIVATION_UNIMPLEMENTED |
| Displayed Liquidity Pressure | NO | — | no approved depth imbalance formula | — | — | must remain separate from executed pressure | YES by design | new implementation package | RESEARCH_PENDING |
| Depth depletion / refill | NO | — | requires sequential book-state contract | — | — | cancellation/addition semantics are displayed-liquidity behavior, not executed flow | potentially | later sub-capability after raw contract audit | RESEARCH_PENDING |
| Price Response | RAW PRICE EXISTS; LINKED DERIVATION NO | Tick / governed TX chart | price path exists | governed chart already fail-closes on BidAsk-only input | tradeDate / contract / session governed in chart path | no pressure-window → response contract | YES | define same-window response | RESEARCH_PENDING |
| Price Path Efficiency | NO | — | intended form: net displacement relative to total traversed path | — | — | denominator-zero and minimum-observation semantics required | YES | deterministic research derivation | RESEARCH_PENDING |
| Pressure → Price Impact Efficiency | NO | — | response conditioned on executed pressure | — | — | raw `Δprice/netFlow` is unstable near zero flow; normalization contract required | YES | keep impact and absorption separate initially | RESEARCH_PENDING |
| Absorption observation | NO | — | strong pressure with weak/opposite price response | — | — | thresholds cannot be invented in this audit | YES | descriptive research state only | RESEARCH_PENDING |
| Buyer/Seller Effective | NO | — | pressure and price response align with adequate quality | — | — | requires deterministic window + quality gate | YES | descriptive research state only | RESEARCH_PENDING |
| Market Control synthesis | NO | — | higher-level synthesis of pressure, liquidity, response, efficiency and conflict | — | — | must not jump directly to one opaque score | YES | later promotion path | NOT_IMPLEMENTED |
| Decision Workspace `estimatedFlow` | EXPLICITLY NO | `src/dashboard-decision-workspace.mjs` | `unavailable('DERIVATION_NOT_IMPLEMENTED')` | truthful unavailable state | current workspace identity checks tradeDate/contract/session | no legal production wiring | YES | remain unavailable until governed capability passes | FORMAL_UNAVAILABLE |

---

## 4. Raw Provider Semantics Verified

### 4.1 Shioaji Tick

Current official Shioaji documentation defines FOP `tick_type` as:

- `1 = 外盤`
- `2 = 內盤`
- `0 = 無法判定`

The provider also exposes single-trade volume and cumulative side-volume fields.

Project interpretation boundary:

> `tick_type` is provider side classification. It is useful as an **estimated aggressive-flow proxy**, but it is not proof of trader identity, intent, or hidden order behavior.

The project should not rename it to `trueAggressorSide`.

Official source checked during this audit:

`https://sinotrade.github.io/zh/tutor/market_data/streaming/futures/`

### 4.2 Shioaji BidAsk

Current official Shioaji documentation exposes for FOP BidAsk:

- five-level `bid_price`
- five-level `bid_volume`
- `diff_bid_vol`
- five-level `ask_price`
- five-level `ask_volume`
- `diff_ask_vol`
- bid/ask totals and derived-level fields

This means the raw provider capability is sufficient to **research** displayed-liquidity pressure without adding a new source.

It does **not** mean a legal depth-pressure feature already exists. The project still needs a contract for valid levels, missing/zero arrays, quote age, book sequence behavior, session/contract boundary, and reconnect discontinuity.

---

## 5. Capability Chain Audit

### 5.1 Producer

`broker/shioaji_readonly_bridge.py`

Relevant behavior:

- TX / MTX / TMF each require Tick + BidAsk.
- Futures Tick contract must be governed by `FUTURES_METADATA`; otherwise callback is rejected.
- Normalized Tick aliases are added without discarding provider raw fields.
- Tick validation requires product family, actual contract, valid event time, positive price, positive executed volume.
- `simtrade` remains visible in the raw payload.

### 5.2 Contract

Current futures Tick payload contains both raw and normalized representations.

Useful normalized fields include:

```text
productFamily
subscriptionAlias
targetCode
actualContract
eventTime
price
executedVolume
```

Useful raw provider fields include:

```text
code
datetime
close
volume
tick_type
simtrade
```

BidAsk raw provider fields are preserved through the generic callback normalization path.

### 5.3 Storage

`broker/live_event_ledger.py`

Storage properties:

- append-only file writes,
- hash-chain `previousHash` / `recordHash`,
- event identity hash,
- duplicate flag,
- provider/native sequence when available,
- sequence-gap observation when a usable native field is present,
- `receivedAt`,
- `exchangeTimestamp`,
- clock-skew observation,
- safety flags fixed false / research-only.

### 5.4 Consumer / Existing derivation

`src/futures-order-flow.mjs`

Existing derivation is useful but should be treated as a **research substrate**, not the final Market Control engine.

It currently:

- filters duplicates,
- rejects unauthorized records,
- ignores simulated ticks,
- accepts only configured target codes,
- maps provider side to buy/sell/unknown,
- cross-checks with the latest non-future best quote up to 2 seconds old by exchange time,
- preserves inside-spread/unavailable quote classification,
- records provider-vs-book conflicts,
- builds 1m / 5m OHLCV plus flow fields,
- computes captured-stream VWAP.

Important limitation:

> The existing quote matcher is not yet availability-safe. Exchange-time ordering alone is insufficient for a governed replay because a quote with an earlier `eventTime` may arrive after the Tick. The next package must implement the §6 canonical `availableAt` contract before reusing best-quote classification as governed Pressure evidence.

### 5.5 Health / Failure modes

Current bridge and audit logic already contains an important capability-level principle:

> Tick LIVE and BidAsk LIVE are separate facts.

A sibling stream being live does not make the missing required stream healthy.

Existing failure modes handled by current code/tests include:

- malformed FOP Tick,
- event queue full/drop,
- writer health failure,
- missing Tick while BidAsk is live,
- reconnect resubscription for both quote types,
- bounded recovery attempts,
- stale delivery state,
- session-closed distinction,
- duplicate / hash / continuity audit,
- execution boundary violation.

For the future Pressure capability, the health condition must be stricter:

```text
Executed Pressure usable
= Tick delivery usable
+ Tick quality usable
+ identity usable
+ classified-volume coverage reported

Best-quote cross-check usable
= Executed Pressure prerequisites
+ BidAsk delivery usable
+ same contract / session / continuity epoch
+ quote.eventTime <= tick.eventTime
+ quote.availableAt <= tick.availableAt
+ quote age within contract
```

Displayed Liquidity Pressure additionally requires complete/valid depth arrays and a book-quality contract.

---

## 6. Timestamp / availableAt Audit

### 6.1 What exists

The durable ledger contains:

- provider/exchange event time (`exchangeTimestamp`),
- bridge callback time inside payload (`_received_at`),
- ledger append time (`receivedAt`).

The current order-flow derivation uses exchange time for quote matching and requires quote age to be non-negative and within 2 seconds.

### 6.2 Canonical V1 `availableAt` contract

The CRU-13 canonical collection contract requires explicit `availableAt`, but generic futures ledger records do not currently expose a first-class top-level `availableAt` field.

Do **not** silently equate exchange time with model availability.

For the first governed TX research engine, freeze this canonical rule:

```text
availableAt = durable ledger receivedAt
```

Rationale:

- `receivedAt` is already persisted on every governed ledger record and is replayable.
- It is conservative: a record is never considered usable before the project has durably observed/appended it.
- It prevents a replay from using a quote merely because its exchange `eventTime` is earlier when that quote actually reached the governed system later.
- `_received_at` remains useful diagnostic lineage, but it is not the canonical V1 availability timestamp.

The future adapter may materialize `availableAt` as a first-class canonical field from ledger `receivedAt`; it must not choose a different timestamp by convenience without a new reviewed contract version.

Formal status:

`AVAILABLE_AT_CONTRACT_FROZEN_FOR_NEXT_PACKAGE / IMPLEMENTATION_PENDING`

### 6.3 Availability-safe quote eligibility

A BidAsk quote may classify a Tick only when **all** of the following are true:

```text
quote.actualContract == tick.actualContract
quote.session == tick.session
quote.continuityEpoch == tick.continuityEpoch
quote.eventTime <= tick.eventTime
quote.availableAt <= tick.availableAt
0 <= (tick.eventTime - quote.eventTime) <= maxQuoteAgeMs
```

This explicitly separates two different no-future questions:

1. **Exchange/event-time future** — a quote describing a later market state cannot classify an earlier Tick.
2. **System-availability future** — a quote that arrived later cannot be retroactively used merely because its exchange timestamp is earlier.

If any required identity, continuity, `availableAt`, or quote-age field is missing/invalid, best-quote classification must fail closed to `UNAVAILABLE`; provider-side classification and UNKNOWN evidence remain separately preserved.

A reconnect boundary must start a new deterministic `continuityEpoch`. Quotes from a prior epoch cannot classify Ticks from a later epoch, even when timestamps appear close. The next implementation package may derive the epoch from governed subscription/reconnect lifecycle evidence, but it must not bridge a known reconnect gap silently.

### 6.4 Deterministic replay by availability cutoff

Replay must reproduce what the governed system could have known at each point in time.

Canonical V1 replay ordering:

```text
1. availableAt ascending
2. eventTime ascending
3. physical append-only ledger order as the deterministic tie-breaker
```

The replay reader must preserve ledger record order as a stable ordinal. It must not re-sort equal-time records using object iteration order or another unstable runtime property.

For every Tick decision at cutoff `tick.availableAt`, the eligible quote set is restricted to records with:

```text
quote.availableAt <= tick.availableAt
```

and then further restricted by §6.3 event-time, identity, continuity and age rules.

Any derived window/snapshot must publish:

```text
output.availableAt >= max(availableAt of every input record used)
```

For a deterministic research snapshot, set `output.availableAt` to the maximum canonical `availableAt` of its included/used inputs. A replay must never emit a snapshot at an availability time earlier than an input that contributed to it.

Required negative tests in the next package:

- `DELAYED_EARLIER_EVENT_QUOTE`: quote `eventTime <= tick.eventTime` but `quote.availableAt > tick.availableAt` → quote is ineligible.
- `FUTURE_EVENT_QUOTE`: quote `eventTime > tick.eventTime` → quote is ineligible.
- `STALE_QUOTE`: event-time age exceeds `maxQuoteAgeMs` → quote is ineligible.
- `RECONNECT_BOUNDARY`: quote and Tick are in different `continuityEpoch` values → quote is ineligible.
- `CONTRACT_OR_SESSION_BOUNDARY`: identity differs → quote is ineligible.
- `DETERMINISTIC_TIE`: equal `availableAt`/`eventTime` records replay identically using ledger order.
- `OUTPUT_AVAILABILITY`: derived output `availableAt` is never earlier than any used input.

The current `buildFuturesOrderFlow()` exchange-time guard remains useful research substrate, but it is **not sufficient by itself** for the governed V1 engine until this contract is implemented and tested.

---

## 7. Identity / Session Audit

Current producer preserves:

- product family,
- subscription alias,
- actual target contract.

Current Decision Workspace already requires current chart identity to contain:

- trade date,
- actual contract,
- session,

and fails closed on mismatch.

For a reusable Market Control engine, the canonical context still needs the Blueprint fields, including `instrument`, `product`, `assetClass`, `underlying`, `contract`, `expiry`, `tradeDate`, `session`, `tickSize`, `multiplier`, `eventTime`, `receivedAt`, `availableAt`, `source`, and `quality`.

Additional gap from CRU-13:

> Canonical collection calls for `market`; the Blueprint currently emphasizes instrument/product/assetClass but a future adapter contract should carry explicit `venue/market` rather than inferring it from symbols.

Options are not part of V1. Before options can use the same generic engine, option identity must add at least expiry, strike, right/call-put, and underlying linkage.

---

## 8. Generic Multi-Instrument Readiness

### Good reuse candidates

- append-only ledger principles,
- timestamp / quality contract,
- UNKNOWN / CONFLICT semantics,
- pressure-window interfaces,
- path-efficiency math,
- response math,
- result/evidence/detail output contract,
- Adapter + Instrument Profile architecture.

### TX-specific / current-code constraints

`buildFuturesOrderFlow()` currently accepts `targetCodes` and aggregates by actual provider product code. That is reusable across TX/MTX/TMF futures, but it is not yet a canonical multi-asset engine.

A future implementation should not solve this by adding scattered `if (TX)` / `if (MTX)` branches. Use:

```text
Canonical Event
        ↓
Instrument Adapter
        ↓
Pressure / Response Engine
        ↓
Instrument Profile
        ↓
Normalized Research Observation
```

TX should be the first reference implementation, not the permanent architecture.

---

## 9. Proposed Research Semantics for the Next Package

These are **audit recommendations only** and are not authorized implementation in CRU-33.

### 9.1 Executed Pressure

Keep the components explicit:

```text
AggressiveBuyProxyVolume
AggressiveSellProxyVolume
UnknownVolume
NetAggressiveFlowProxy
ClassifiedVolumeRatio
BestQuoteMatchedRatio
ClassificationConflictRatio
```

A bounded normalized pressure ratio may later be derived as:

```text
(buy - sell) / (buy + sell)
```

but denominator zero must return unavailable, not zero.

### 9.2 Estimated CVD

Use a label that exposes its nature:

> **Estimated CVD · Provider Side Classification**

Do not display `True CVD`.

Session reset / rolling-window / cumulative-day semantics must be frozen before user-visible use.

### 9.3 Displayed Liquidity

Keep this independent from executed pressure.

Candidate raw evidence:

```text
bid_volume[0..4]
ask_volume[0..4]
diff_bid_vol[0..4]
diff_ask_vol[0..4]
spread
quote age
```

Do not treat displayed depth as executed intent. Cancellation/spoofing risk means it is liquidity evidence only.

### 9.4 Price Path Efficiency

Candidate deterministic definition:

```text
abs(P_end - P_start) / sum(abs(delta P))
```

Range: `[0, 1]` when denominator is positive.

If path denominator is zero or observations are insufficient, return unavailable.

### 9.5 Pressure → Response

Do not start with a single opaque score.

First preserve independent facts:

```text
Pressure
Price displacement
Path efficiency
Coverage
Conflict
```

Then research descriptive states:

- buy pressure + effective rise → `BUYER_EFFECTIVE_CANDIDATE`
- buy pressure + weak/falling price → `SELLER_ABSORPTION_CANDIDATE`
- sell pressure + effective fall → `SELLER_EFFECTIVE_CANDIDATE`
- sell pressure + weak/rising price → `BUYER_ABSORPTION_CANDIDATE`
- mixed/low-coverage evidence → `BALANCED_OR_CONFLICT`

CRU-33 does not authorize thresholds.

---

## 10. Future Dashboard Contract

CRU-33 does not modify production UI.

A legal future output should follow:

```text
Result
→ Evidence
→ Detail
```

Example structure:

```text
Result:
Market Control: RESEARCH_PENDING / VALUE / UNAVAILABLE

Evidence:
Executed Pressure
Price Response
Path Efficiency
Displayed Liquidity
Coverage / Conflict

Detail:
contract
session
tradeDate
window
source
eventTime
receivedAt
availableAt
quality
methodology
limitations
```

Allowed state policy:

- qualified `VALUE`
- explicit `UNAVAILABLE_REASON`
- explicit `RESEARCH_PENDING`

Forbidden:

- missing → neutral
- unknown → zero
- low coverage → directional result
- research proxy → true source
- Market Control research observation → BUY/SELL

---

## 11. Minimal Next Implementation Package Recommendation

Suggested work package name:

> **TX Intraday Pressure & Path Efficiency Research Engine V1**

Recommended bounded scope:

1. TX only as reference instrument.
2. Reuse existing Tick + BidAsk collector; no new provider/source.
3. Materialize canonical `availableAt = ledger.receivedAt` and enforce the §6 availability-safe event/identity/continuity contract.
4. Preserve provider side, UNKNOWN, quote-inferred side, conflict and coverage separately.
5. Add deterministic windows; start with a minimal set rather than every timeframe at once.
6. Implement Price Path Efficiency.
7. Implement pressure + price-response evidence without a composite Market Control score.
8. Add explicit delayed-earlier-event, future-event, stale-quote, deterministic-tie, output-availability, Tick-only, BidAsk-only, low-coverage, reconnect-boundary and contract/session-boundary negative tests.
9. Replay by availability cutoff with stable ledger-order tie-breaking; produce deterministic replay artifact and audit report.
10. Keep production Decision Workspace `estimatedFlow` unavailable until the research capability passes its own gates and Owner separately authorizes wiring.

Explicitly out of scope for the next package unless separately authorized:

- new collector/provider,
- qualitative `弱 / 中 / 強` or percentile thresholds,
- displayed five-level liquidity-pressure derivation,
- absorption / formal Market Control promotion,
- Market State integration or promotion,
- production Dashboard wiring,
- strategy/filter/threshold tuning,
- Risk Veto,
- broker/order/position/execution,
- opaque long/short score,
- options/NQ/stocks expansion in the same PR.

---

## 12. Gate Status — CRU-33

| Gate | Applicability | Current status |
| --- | --- | --- |
| A Scope / Contract | REQUIRED | PASS — Linear scope is explicit and branch baseline matches approved main at audit start |
| B Data Truth | REQUIRED | PARTIAL — repository/provider contracts verified; current local real-provider runtime is not directly observable through GitHub connector |
| C Derivation / Replay | REQUIRED | PARTIAL — availability-safe replay contract now frozen at design level; implementation/tests remain for the next authorized package |
| D Engineering | REQUIRED | PENDING — prior independent review requested changes on old HEAD; B-01 design fix applied, exact-HEAD re-review required |
| E Dashboard Truth | NOT_APPLICABLE | no production UI change |
| F Production Browser | NOT_APPLICABLE | no browser/runtime change |
| G Decision Assist | NOT_APPLICABLE | no runtime interpretation change |
| H Owner Acceptance | REQUIRED | PENDING |
| I Merge | REQUIRED | PENDING |
| J Post-Merge Runtime | NOT_APPLICABLE | docs/audit only; no runtime-delivered asset/dataflow change |

---

## 13. Current Blocking Findings

### B1 — `availableAt` is not first-class on generic futures ledger records

Severity: **Implementation blocker for the next package; CRU-33 design blocker resolved by freezing §6.**

Reason:

The generic ledger does not yet expose first-class canonical `availableAt`, but the audit now freezes V1 semantics as `availableAt = ledger.receivedAt` and requires availability-cutoff replay, same contract/session/continuity epoch, event-time ordering, bounded quote age, deterministic ledger-order ties, and output availability no earlier than all used inputs.

Disposition:

`DESIGN_CONTRACT_RESOLVED / IMPLEMENTATION_PENDING_NEXT_AUTHORIZED_PACKAGE`

### B2 — Existing `quoteCvd` can be misread as order-book pressure

Severity: **Semantic blocker for Market Control design.**

Truth:

It is best-quote trade-side inference, not five-level displayed-depth imbalance.

Disposition:

Resolved at audit/design level by renaming/classifying the capability truth. No implementation edit authorized in CRU-33.

### B3 — current runtime provider evidence is not independently observable from connected GitHub state

Severity: **Evidence limitation, not proof of runtime failure.**

Committed project records state prior real-provider acceptance, but local `data/live-events` and readiness artifacts are intentionally not all committed. CRU-33 must not claim “currently LIVE now” from repository evidence alone.

Disposition:

For final Gate B, obtain a bounded real-provider audit receipt from the authorized local runtime or explicitly accept the audit as repository+historical-provider truth only.

---

## 14. Safety Boundary

Unchanged:

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

CRU-33 contains no implementation of a trading signal, Market State promotion, broker route, order route, position, risk, or execution capability.

---

## 15. Preliminary Audit Verdict

**The raw data foundation is sufficient to justify a bounded TX research implementation package without adding a new data source.**

But the system is **not yet entitled to claim Market Control**.

The correct next engineering move is not “add a CVD widget.” It is to build and validate a governed chain:

```text
Provider side classification + UNKNOWN
        ↓
Executed Pressure Proxy + Coverage/Conflict
        ↓
Price Response
        ↓
Path Efficiency
        ↓
Expected vs Actual Response
        ↓
Absorption / Effectiveness research observations
```

Displayed five-level liquidity should be a separate evidence channel and should only join after its own raw-contract/quality audit.

Final Engineering Review and Owner Acceptance remain pending.