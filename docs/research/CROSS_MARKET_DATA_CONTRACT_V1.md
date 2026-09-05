# Cross-Market Data Contract V1

> Work package: CRU-37
> Contract status: DESIGN CANDIDATE / NOT IMPLEMENTED
> Scope: cross-market raw identity, time, quality and replay semantics only

## 1. Purpose and boundary

This contract defines how Taiwan and overseas market observations may be represented without collapsing unlike instruments, sessions or knowledge times. It does not authorize a provider, collector, backfill, feature promotion, strategy weight, trading signal, broker route, or live execution.

The contract is fail-closed. An absent field stays unknown. A proxy stays a proxy. A value fetched today does not prove it was available to a historical decision yesterday.

## 2. Canonical identity registry

| Canonical key | Venue | Asset / product | Identity rule |
|---|---|---|---|
| `SGX.TWN.<expiry>` | SGX-DT | FTSE Taiwan Index Futures | Actual `TWN` contract only; `MTWN` is a different micro product |
| `TAIFEX.TX.<expiry>` | TAIFEX | TAIEX Futures | Actual TX contract; never merged with TWN despite related Taiwan exposure |
| `CME.NQ.<expiry>` | CME | E-mini Nasdaq-100 Futures | Actual NQ contract, multiplier and expiry required |
| `CME.MNQ.<expiry>` | CME | Micro E-mini Nasdaq-100 Futures | Distinct from NQ; normalization may compare returns, never silently rescale identity |
| `NASDAQ.NDX.INDEX` | Nasdaq/provider | Nasdaq-100 cash index | `NDX_PROXY` when used as a substitute context; never labelled NQ/MNQ |
| `NASDAQ.SOX.INDEX` | Nasdaq/provider | PHLX Semiconductor Index | Index identity; a related ETF is not SOX |
| `CME.ES.<expiry>` | CME | E-mini S&P 500 Futures | Actual ES contract and expiry required |
| `CBOE.VIX.INDEX` | Cboe/provider | VIX spot index | Spot index, delayed display, daily close and VIX futures are separate series |
| `FX.USDTWD.<source>` | Named source | TWD per USD; base=`USD`, quote=`TWD` | Spot, indicative, fixing and futures are distinct price types |
| `NYSE.TSM.ADR` | NYSE/provider | TSM ADR | Distinct from TWSE `2330`; ADR ratio/currency/session must be explicit |
| `TWSE.2330.EQUITY` | TWSE/Shioaji | Taiwan Semiconductor common shares | Price alone is not TAIEX contribution |

An implementation must use a versioned reference table rather than infer identity from a display label.

## 3. Canonical raw observation

```json
{
  "schemaVersion": "cross-market-raw-v1",
  "source": "provider-and-feed-name",
  "sourceLicenseId": "owner-approved-license-ref",
  "licenseStatus": "APPROVED_INTERNAL_NON_DISPLAY",
  "nonDisplayUsageStatus": "APPROVED",
  "redistributionStatus": "PROHIBITED",
  "market": "SGX",
  "exchange": "SGX-DT",
  "assetClass": "FUTURE",
  "instrumentId": "SGX.TWN.202609",
  "instrumentType": "FUTURE",
  "productCode": "TWN",
  "contractCode": "provider-exact-code",
  "expiry": "2026-09",
  "frontMonthIdentity": {
    "selectedContract": "SGX.TWN.202609",
    "selectionRuleVersion": "governed-rule-version",
    "selectedAt": "ISO-8601-with-offset",
    "candidateEvidenceHashes": []
  },
  "rawSymbol": "provider-raw-symbol",
  "currency": "USD",
  "multiplier": 40,
  "priceType": "TRADE",
  "eventType": "TICK",
  "cadence": "EVENT",
  "tradeDate": "YYYY-MM-DD",
  "session": "T|T_PLUS_1|DAY|NIGHT|US_GLOBEX|UNKNOWN",
  "eventTime": "ISO-8601-with-offset|null",
  "receivedAt": "ISO-8601-with-offset",
  "normalizedAt": "ISO-8601-with-offset",
  "sourcePublishedAt": "ISO-8601-with-offset|null",
  "nativeSequence": null,
  "sourceMessageId": null,
  "ledgerIdentity": "sha256-or-immutable-ledger-id",
  "writerEpoch": "raw-writer-epoch-id",
  "writerEpochSequence": 7,
  "ledgerOrdinal": 1,
  "price": null,
  "bid": null,
  "ask": null,
  "bidSize": null,
  "askSize": null,
  "volume": null,
  "openInterest": null,
  "rawPayloadHash": "sha256",
  "collectionRunId": "opaque-id",
  "qualityStatus": "PASS|QUALITY_INSUFFICIENT|UNAVAILABLE",
  "qualityReasons": [],
  "researchOnly": true,
  "formalWeight": 0,
  "executionAuthorized": false,
  "orderRoutesEnabled": false
}
```

Raw payloads are append-only. Corrected provider events append a correction record linked to the original source identifier/hash; they do not overwrite history. `qualityStatus=PASS` is impossible unless `licenseStatus` and `nonDisplayUsageStatus` are approved for the exact use. License eligibility is an independent hard gate, not a data-quality inference.

Post-commit evidence is a second append-only record, never a field patched into the raw observation:

```json
{
  "schemaVersion": "cross-market-availability-v1",
  "rawRef": {
    "ledgerIdentity": "sha256-or-immutable-ledger-id",
    "writerEpoch": "raw-writer-epoch-id",
    "writerEpochSequence": 7,
    "ledgerOrdinal": 1,
    "rawPayloadHash": "sha256"
  },
  "state": "ACKNOWLEDGED|FAILED",
  "visibleAt": "ISO-8601-with-offset|null",
  "availableAt": "ISO-8601-with-offset|null",
  "availabilityLedgerIdentity": "sha256-or-immutable-ledger-id",
  "availabilityWriterEpoch": "availability-writer-epoch-id",
  "availabilityWriterEpochSequence": 4,
  "availabilityLedgerOrdinal": 2,
  "clockContinuityEpoch": "clock-continuity-epoch-id",
  "clockStatus": "USABLE|CLOCK_REGRESSION"
}
```

An eligible-observation projection is an immutable join of exactly one raw record and its matching availability acknowledgement. The join requires equality of every `rawRef` field. At decision/replay time, the acknowledgement must also be inside the decision's identity-bound availability cutoff; a later acknowledgement can never be joined into an earlier decision. The projection may expose `availableAt` and acknowledgement fields, but neither source record is mutated.

There is at most one terminal acknowledgement outcome for a complete `rawRef`. A byte-identical duplicate acknowledgement is idempotent and counted for audit but not appended as a second effective outcome. Conflicting duplicates, or any attempt to replace `FAILED` with `ACKNOWLEDGED` (or the reverse), are `ACK_CONFLICT` and make that raw reference ineligible; recovery requires a new raw record with a new identity, never mutation of the old outcome.

### 3.1 Ledger and writer-epoch invariants

- `ledgerIdentity` names one immutable append-only ledger/partition lineage and is never repurposed.
- Every writer start or restart must first append and durably commit an epoch manifest containing a globally unique, never-reused `writerEpoch`, a ledger-local strictly increasing `writerEpochSequence`, the previous epoch-manifest hash, and the recovered next ledger ordinal.
- `ledgerOrdinal` is strictly increasing across the entire `ledgerIdentity`; it never resets when the writer epoch changes. The availability ledger follows the same rule for `availabilityLedgerOrdinal`.
- A writer that cannot prove the durable ledger tail, previous epoch-manifest hash, next epoch sequence, and next ordinal must fail closed before appending.
- Reuse of an epoch ID, epoch sequence, or ledger ordinal under the same ledger identity is a hard integrity failure. No decision or replay may consume the ambiguous suffix.
- Deterministic physical order within a ledger is `(ledgerIdentity, ledgerOrdinal)`. `writerEpochSequence` plus the hash-linked epoch manifests proves restart succession; it does not replace the ledger-global ordinal. Records from different ledger identities have no implicit physical order.

## 4. Three-time contract

### 4.1 `eventTime`

The time the source says the market event occurred. It must retain the source offset/time zone and precision. A bar label is not automatically the last event time. A daily `tradeDate` is not an event timestamp.

### 4.2 `receivedAt`

The wall-clock time when this system first received the payload, expressed as UTC/offset time. Wall clocks are not assumed monotonic. It must never be reconstructed from file modified time.

### 4.3 `normalizedAt`

The writer-assigned wall-clock time captured after parsing, identity validation and integrity hashing, and stored atomically in the raw append-only record. It is pre-commit processing evidence, not proof that the record was durably visible. `ledgerOrdinal` is the strictly increasing writer-assigned physical order within a bound ledger/partition.

### 4.4 `availableAt`

The earliest time this system is allowed to expose the value to a decision or replay. It is derived under a named rule:

- trusted live event: `max(eventTime, receivedAt, normalizedAt, availabilityAck.visibleAt)` for fail-closed replay eligibility;
- provider publication with authoritative publication time: `max(sourcePublishedAt, receivedAt, normalizedAt, availabilityAck.visibleAt)`;
- historical batch with no authoritative publication time: current ingestion may use `availabilityAck.visibleAt`, but historical decision-time eligibility is `NOT_VERIFIED`;
- revised value: the revision has its own `availableAt`; it must not replace the earlier version in an as-of replay.

`availabilityAck` is created only after the raw record's durable commit callback succeeds. It binds the immutable raw reference to a named availability ledger's identity, writer epoch, later ordinal, and first post-commit wall-clock observation. Until a matching acknowledgement exists, the raw record has no eligible-observation projection, its effective `availableAt` is `null`, and it is ineligible. A pre-commit timestamp must never substitute for this acknowledgement.

If `receivedAt < eventTime`, clock/source lineage is inconsistent. Preserve both, set `TIMESTAMP_LINEAGE_INSUFFICIENT`, and use the latest governed boundary as the earliest eligible replay time. If event-time or availability-acknowledgement semantics are unknown, `availableAt=null` and formal eligibility is false.

### 4.5 Clock continuity and physical cutoffs

Wall-clock values are checked in physical ordinal order inside their bound ledger identity and writer epoch. A regression in `receivedAt`, `normalizedAt`, or `availabilityAck.visibleAt` sets `clockStatus=CLOCK_REGRESSION`, starts a new continuity epoch, and forces effective `availableAt=null` for the affected epoch until a separately persisted recovery record proves a usable wall-clock boundary. The system must not repair the timestamps, reorder records, or infer availability from an earlier clock value.

Every live decision persists exactly one `sourceCutoffs[]` entry for each participating (`rawLedgerIdentity`, `rawWriterEpoch`, `availabilityLedgerIdentity`, `availabilityWriterEpoch`, `clockContinuityEpoch`) tuple. If either writer restarts, or one writer epoch contains multiple clock-continuity epochs, each participating complete tuple has its own entry. A cutoff is the complete identity-bound tuple, never a free-standing scalar:

```text
rawLedgerIdentity
rawWriterEpoch
rawWriterEpochSequence
cutoffLedgerOrdinal
availabilityLedgerIdentity
availabilityWriterEpoch
availabilityWriterEpochSequence
cutoffAvailabilityLedgerOrdinal
clockContinuityEpoch
```

Replay eligibility requires all of:

```text
raw.ledgerIdentity = decision.sourceCutoff.rawLedgerIdentity
raw.writerEpoch = decision.sourceCutoff.rawWriterEpoch
raw.writerEpochSequence = decision.sourceCutoff.rawWriterEpochSequence
raw.ledgerOrdinal <= decision.sourceCutoff.cutoffLedgerOrdinal
availabilityAck.availabilityLedgerIdentity = decision.sourceCutoff.availabilityLedgerIdentity
availabilityAck.availabilityWriterEpoch = decision.sourceCutoff.availabilityWriterEpoch
availabilityAck.availabilityWriterEpochSequence = decision.sourceCutoff.availabilityWriterEpochSequence
availabilityAck.availabilityLedgerOrdinal <= decision.sourceCutoff.cutoffAvailabilityLedgerOrdinal
availabilityAck.clockContinuityEpoch = decision.sourceCutoff.clockContinuityEpoch
availabilityAck.state = ACKNOWLEDGED
availabilityAck.clockStatus = USABLE
eligibleObservation.availableAt <= decision.decisionAt
```

The ordinal comparisons above refer to the matching entry in `decision.sourceCutoffs[]`. A decision spanning writer restarts persists one entry for every participating epoch, all bound to the same ledger identity and its hash-linked epoch manifest. Ordinals are globally monotonic within that ledger identity, so restart-spanning physical order remains reproducible; ordinals from different ledger identities are never comparable. Thus neither a record from another partition, a reused epoch/ordinal, nor a physically later record can enter an earlier replay, even if a wall clock regresses.

## 5. Session and trade-date contract

All event timestamps are stored with offsets and normalized to UTC for ordering. Display conversion is separate. Exchange calendars, not local file dates, assign `tradeDate`.

### SGX TWN

The official product page currently describes Singapore-time T session opening 08:45–13:45 and T+1 opening 14:00–05:15. Singapore and Taiwan are both UTC+8, but calendar and holiday sets still differ. The provider/exchange trade-date field is authoritative; in its absence, a versioned SGX calendar rule must be approved before collection. T+1 events must not be assigned from the local calendar date alone.

### TAIFEX TX

Regular trading is a DAY session; the eligible domestic-index after-hours session is 15:00–05:00. TAIFEX states that after-hours trades are attributed to the following regular session. The existing governed TAIFEX calendar remains the only TX trade-date authority; CRU-37 must not create a second rollover/calendar implementation. See [TAIFEX after-hours introduction](https://www.taifex.com.tw/enl/eng4/aHIntroduction).

### CME NQ/MNQ/ES

CME product, contract and session calendars must be versioned from an approved source. Chicago session labels, maintenance breaks, US daylight-saving transitions, Taiwan local dates and expiry dates must remain explicit. A continuous symbol is derived research data; raw storage always preserves actual expiry contracts.

### Cash/index/FX series

NDX, SOX, VIX, TSM ADR, TWSE 2330 and USD/TWD retain their owning market calendar and price type. A prior US close can be legal Taiwan premarket context only when its derived `availableAt <= decisionAt`; publication, receipt and normalization are all inputs to that gate.

## 6. Contract and rollover rules

1. Store every actual futures contract unchanged.
2. Resolve a canonical comparison contract under a versioned, predeclared policy using observable volume/OI/expiry inputs available at that time.
3. Emit `rollState`, `selectionRuleVersion`, selected contract and every candidate used.
4. Never splice prices across expiries without an explicit adjustment series and method.
5. Around rollover, returns may be computed only within the same actual contract unless a separately approved continuous-series method is named.
6. If two venues roll on different dates, cross-market comparison is unavailable until both selected identities pass their own gate.

## 7. Quality and availability states

| State / reason | Meaning | Consumer behavior |
|---|---|---|
| `PASS` | Required identity, time, source and integrity fields pass | Eligible only for the approved descriptive consumer |
| `SOURCE_NOT_GOVERNED` | Provider/license/entitlement unapproved | Do not collect or consume |
| `SOURCE_PENDING` | Source exists conceptually but timestamp/license/interface is unresolved, including current intraday SOX | Do not claim availability |
| `IDENTITY_UNRESOLVED` | Product/contract/expiry ambiguous | Unavailable |
| `AVAILABLE_AT_NOT_VERIFIED` | Historical knowledge time cannot be proven | Exclude from as-of validation |
| `TIMESTAMP_LINEAGE_INSUFFICIENT` | Source/receive ordering or semantics invalid | Preserve raw; fail closed for formal replay |
| `COMMIT_VISIBILITY_UNVERIFIED` | No durable post-commit acknowledgement | `availableAt=null`; exclude from decisions/replay |
| `CLOCK_REGRESSION` | Wall clock regressed in physical writer order | Start new continuity epoch and fail closed until persisted recovery |
| `STALE` | Named cadence/session stale threshold exceeded | Display stale; no current-state inference |
| `SESSION_UNRESOLVED` | Calendar/session/trade date cannot be assigned | Unavailable |
| `ROLLOVER_UNRESOLVED` | Canonical contract selection cannot be reproduced | Unavailable for continuous comparison |
| `GAP_DETECTED` | Expected event/bar interval was not captured | Preserve explicit gap; never interpolate silently |
| `DUPLICATE` | Deterministic identity/hash duplicate | Retain audit count; do not double-count |
| `HASH_FAILURE` | Payload integrity failure | Reject payload |
| `CORRECTION_PENDING` | Provider correction relationship unresolved | Do not use corrected value as historical original |

## 8. Derived comparison contract

Cross-market features consume only eligible-observation projections whose joined acknowledgement passes every identity-bound cutoff and whose effective `availableAt <= decisionAt`. They must publish:

```text
featureId
featureVersion
decisionAt
decisionTradeDate
inputInstrumentIds[]
inputEventHashes[]
inputAvailableAtMax
sourceCutoffs[]
sessionWindows[]
normalizationMethod
value|null
qualityStatus
qualityReasons[]
researchOnly=true
formalWeight=0
executionAuthorized=false
orderRoutesEnabled=false
```

The V1 TWN/TX comparison is fixed to arithmetic normalized returns from governed same-instrument anchors:

```text
R_TX(t)  = P_TX(t)  / P_TX(anchor)  - 1
R_TWN(t) = P_TWN(t) / P_TWN(anchor) - 1
rawNormalizedDivergence(t) = R_TX(t) - R_TWN(t)
```

It does not estimate beta. `compositionAdjustedDivergence` is prohibited and must remain `null` while effective-date TSMC/Top-10 weights and index methodology are unavailable. Because TWN's underlying index is not TAIEX, the comparison must emit `STRUCTURAL_DIVERGENCE_POSSIBLE`; it must not call raw divergence mispricing or arbitrage.

Other prices with different index levels, currencies and multipliers are compared only through explicitly defined returns or future separately approved methods—not raw point subtraction. Correlated NDX/SOX/NQ evidence remains one US growth/semiconductor family unless independent-value testing later proves otherwise. Any substitute uses `instrumentType=PROXY`; NDX, QQQ and CFDs cannot use an NQ canonical key. Intraday SOX is `SOURCE_PENDING` until source, timestamps and license are governed.

## 9. Replay requirements

- Replay eligibility requires both `availableAt <= decisionAt` and the decision's persisted identity-bound raw/availability cutoff tuples. Each input must exactly match the raw and availability ledger identities, writer epochs and epoch sequences in its `sourceCutoffs[]` entry before either ordinal comparison is made. The joined acknowledgement itself must be at or before the persisted availability cutoff, preventing retroactive attachment to an earlier decision. Physical replay order is the ledger-global, never-reset `ledgerOrdinal`; hash-linked epoch manifests reproduce restart succession. Ordinals from different ledger identities are never compared. Native sequence/source message ID is retained for source-gap and duplicate audits but does not replace writer order.
- Native sequence absence remains `UNKNOWN_NO_NATIVE_SEQUENCE`; zero observed gaps is not proof of complete capture.
- Every replay binds source manifest, calendar version, contract directory, raw hashes and code/spec version.
- Replays never load records whose `availableAt` exceeds the simulated decision time.
- Missing intervals remain missing. No synthetic session or retroactive forward evidence may be created.
- A daily table without row-level bitemporal lineage may support present-day descriptive history, but not a claim that a historical decision lawfully knew the row.

## 10. Promotion boundary

The sequence is:

```text
SOURCE_AND_LICENSE_APPROVAL
→ RAW_COLLECTION
→ IDENTITY_AND_SESSION_AUDIT
→ COVERAGE_AND_QUALITY_AUDIT
→ AVAILABLE_AT_AUDIT
→ DETERMINISTIC_REPLAY
→ DESCRIPTIVE VALIDATION
→ OWNER REVIEW
→ OPTIONAL FUTURE EVIDENCE CANDIDATE
```

Nothing in CRU-37 advances an item beyond contract design.
