# Cross-Market Dashboard Contract V1

> Work package: CRU-37
> Status: PRODUCT CONTRACT ONLY / NO UI IMPLEMENTATION
> Audience: research and operational evidence review

## 1. Product purpose

The future Cross-Market view should help a human see what each venue actually did, when the system knew it, and where evidence is missing. It must not convert correlation, timing or proxy data into a recommendation.

No panel in this contract is authorized for current implementation. Missing data is a product truth, not a blank to fill with a convenient proxy.

## 2. Required visible header

The header must show:

- decision/view time and time zone;
- data mode: `LIVE`, `DELAYED`, `EOD`, `REPLAY`, or `MIXED`;
- source maximum `availableAt`;
- overall coverage, quality and promotion as separate axes;
- selected actual futures contracts and expiry;
- `researchOnly=true`, `formalWeight=0`, `executionAuthorized=false`, `orderRoutesEnabled=false`.

No generic green “fresh” state is allowed when sources have different trade dates, legal publication times or cadences.

## 3. Information architecture

### 3.0 Homepage summary contract

The homepage contains exactly six compact evidence summaries. Their allowed analytical state vocabulary is `CONFIRMATION`, `DIVERGENCE`, `MIXED`, `UNAVAILABLE`, and `STRUCTURAL_DIVERGENCE_POSSIBLE`. Quality/coverage/promotion remain separate metadata and cannot be encoded as an analytical state.

| Summary | Evidence | Required output |
|---|---|---|
| TWN Repricing | Governed `TWN_OFFSHORE_REPRICING` from 14:00 to pre-15:00 | normalized return or `UNAVAILABLE`; source contract and anchors |
| TX Response | `TX_NIGHT_OPEN_GAP` plus `TX_NIGHT_OPEN_RESPONSE` at T+5/T+15/T+30/T+60/T+120 | opening gap and horizon returns or `UNAVAILABLE`; actual TX contract |
| Cross-Market Alignment | Sign/path comparison of TWN repricing and TX response | `CONFIRMATION`, `DIVERGENCE`, `MIXED`, or `UNAVAILABLE` |
| Composition Warning | TWN underlying differs from TAIEX and weights/methodology may be missing | `STRUCTURAL_DIVERGENCE_POSSIBLE` whenever raw comparison is shown; no composition-adjusted value until governed |
| Global Tech Context | NQ/MNQ if actual and governed; otherwise explicit NDX proxy/SOX/TSM availability | context facts plus proxy/source labels; never a vote or recommendation |
| Data Trust | Per-source identity, availability, freshness, coverage, license and replay status | independent coverage/quality/promotion axes and exact failure reasons |

Homepage copy must not contain `BUY`, `SELL`, `STRONG BUY`, `STRONG SELL`, “補漲必然”, or “套利機會”.

### 3.1 Taiwan price-discovery panel

Display TWN and TX as two separate rows with venue, product, contract, expiry, session, latest event time, received time, eligible availability, quote age and quality. Supported descriptive comparisons are normalized return, agreement/divergence and one-sided-market-closed state.

Never display:

- TWN when the value is TX, MTWN, an ETF or CFD;
- continuous futures without the actual source contracts;
- a lead/lag or “price discovery winner” when coverage/clock quality fails;
- a manual or retroactive observation as forward evidence.

### 3.2 US growth / semiconductor panel

Keep these identities separate:

- actual NQ or MNQ futures;
- `NDX_PROXY` cash-index daily context;
- SOX index;
- TSM ADR.

NDX and SOX should be visibly grouped as correlated context. Missing NQ must render `TRUE_NQ_UNAVAILABLE`, never a relabelled NDX value.

### 3.3 Risk / FX panel

Show VIX spot/daily/delayed source identity and USD/TWD price type/cadence. Daily VIX or FX may be useful prior-close context, but must not look like an intraday quote. Spot, fixing, indicative, futures and delayed web values require separate labels.

### 3.4 Taiwan leadership panel

Show `2330` raw price only as `TSMC_TW_PRICE`. Show TSM ADR separately. Top-10 membership, effective weights and contribution remain unavailable until all inputs and methodology are governed.

Forbidden transformations:

- `2330 return → TSMC contribution`;
- `TSM ADR return → 2330 current return`;
- current Top-10 list applied to historical dates;
- price-weighted sum presented as index-point contribution without divisor/corporate-action rules.

### 3.5 Evidence details drawer

Every displayed value must expose:

```text
source
instrumentId
rawSymbol
contract/expiry
tradeDate/session
eventTime
receivedAt
availableAt
rawLedgerIdentity/rawWriterEpoch/rawWriterEpochSequence/rawLedgerOrdinal
availabilityLedgerIdentity/availabilityWriterEpoch/availabilityWriterEpochSequence/availabilityLedgerOrdinal
clockContinuityEpoch
cutoffLedgerOrdinal/cutoffAvailabilityLedgerOrdinal
cadence/priceType
stale threshold
qualityStatus/reasons
rawPayloadHash or sourceRunId
licenseStatus
promotionStatus
```

### 3.6 Detail-page drill-down

The future detail view may contain only these evidence surfaces:

1. TX vs TWN normalized-return chart using `P(t)/P(anchor)-1`, with raw `R_TX-R_TWN` and `STRUCTURAL_DIVERGENCE_POSSIBLE`.
2. 14:00–15:00 TWN repricing, showing exact 14:00 and pre-15:00 anchors.
3. 15:00 TX response with separate T+5/T+15/T+30/T+60/T+120 outcomes.
4. NQ/MNQ, SOX and USD/TWD context with identity/cadence/license labels; NDX remains `instrumentType=PROXY`.
5. Pressure / Response / Efficiency, including classified-volume coverage, packet-loss uncertainty, price response and path efficiency. Effort-failure is only `EFFORT_FAILURE_CANDIDATE`, never a trade instruction.

## 4. View model

```json
{
  "schemaVersion": "cross-market-dashboard-v1",
  "viewAt": "ISO-8601",
  "mode": "MIXED",
  "coverageState": "SUFFICIENT|PARTIAL|UNAVAILABLE",
  "qualityState": "PASS|QUALITY_INSUFFICIENT|UNKNOWN",
  "promotionState": "RESEARCH_ONLY|NOT_PROMOTED",
  "allowedEvidenceState": "CONFIRMATION|DIVERGENCE|MIXED|UNAVAILABLE|STRUCTURAL_DIVERGENCE_POSSIBLE",
  "sourceCutoffs": [],
  "summaries": {
    "twnRepricing": {},
    "txResponse": {},
    "crossMarketAlignment": {},
    "compositionWarning": {},
    "globalTechContext": {},
    "dataTrust": {}
  },
  "panels": {
    "taiwanPriceDiscovery": [],
    "usGrowthSemis": [],
    "riskFx": [],
    "taiwanLeadership": []
  },
  "unavailable": [
    {"capability": "SGX.TWN", "reason": "SOURCE_NOT_GOVERNED"}
  ],
  "researchOnly": true,
  "formalWeight": 0,
  "executionAuthorized": false,
  "orderRoutesEnabled": false
}
```

The three states—coverage, quality and promotion—must never be collapsed into one readiness badge.

## 5. Missing, stale and conflict behavior

| Condition | Required UI behavior | Prohibited behavior |
|---|---|---|
| Source missing | Keep named empty state with exact reason | Hide the gap while showing a proxy under the target name |
| Market legitimately closed | `MARKET_CLOSED` plus next/last session | Classify as collector failure |
| Expected interval missing | `CAPTURE_GAP` with bounds | Interpolate or carry forward silently |
| Stale daily value | Show source date, cadence and stale age | Present as live/current-session evidence |
| Clock lineage invalid | Quality warning and exclusion from derived comparison | Reorder by guessed timestamps |
| Proxy present, target absent | Show both `NDX_PROXY_AVAILABLE` and `TRUE_NQ_UNAVAILABLE` | Rename proxy |
| Inputs disagree | First-class `CONFLICT` / `DIVERGENCE` | Force directional consensus |
| License unresolved | Technical state `SOURCE_NOT_GOVERNED`; no data display from that source | Scrape public webpages |

## 6. Narrative and copy contract

Allowed:

- “TWN and TX normalized returns diverged during the eligible 08:45–09:00 window.”
- “NDX prior close is available as proxy-only daily context; true NQ futures are unavailable.”
- “USD/TWD value is daily and was first received after the historical decision cutoff.”

Forbidden:

- “TWN predicts TX.”
- “Global markets say buy/sell Taiwan.”
- “No gap detected” when native sequence is unavailable.
- “TSMC contributed N points” without governed effective weights/divisor.
- Any claim of live, forward or formal evidence based on manual/replayed/backfilled data.

## 7. Interaction and export boundary

Filters may select source, actual contract, session, cadence and time window. Defaults must not merge contracts or carry values across session boundaries. Every displayed derived value and every export must carry the exact `sourceCutoffs[]` tuples used to build it: raw ledger identity, raw writer epoch and epoch sequence, raw cutoff ordinal, availability ledger identity, availability writer epoch and epoch sequence, availability cutoff ordinal, and clock-continuity epoch. Exports must also include all visible lineage and safety fields. “Copy for ChatGPT” or equivalent text must preserve proxy, cadence, stale and unavailable labels; it may summarize cutoff tuples but must retain a stable reference to the full exported evidence.

There is no order ticket, position control, broker button, strategy toggle, recommendation badge, or automated action in this product contract.

## 8. Acceptance criteria for a future UI package

1. Exact identity and expiry are always visible for futures.
2. Every value has source cadence and legal availability evidence.
3. TWN/TX, NQ/NDX, TSM/2330 and VIX spot/futures are never conflated.
4. Missing, stale, market-closed and capture-gap states are distinguishable.
5. Coverage, quality and promotion are separate.
6. Cross-market comparisons use contract-defined normalized measures.
7. No future data enters a historical/replay view.
8. Accessibility and responsive layout pass the future UI package’s review.
9. Safety fields are fixed and no execution surface exists.
