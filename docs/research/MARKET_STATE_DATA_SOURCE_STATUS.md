# Market State Data Source Status

> Work package: CRU-13  
> Status: RESEARCH DATA COLLECTION ONLY  
> `formalWeight=0` · `researchOnly=true` · `executionAuthorized=false`

## Collection-ready with existing assets

### TX historical flow proxy

Source: previously purchased TAIFEX historical futures trade-summary ZIP files.

Known local coverage from the latest audit: 116 trading days, 2026-01-02 through 2026-06-30.

Permitted use:

- exact TX trade-price path;
- matched volume using TAIFEX `B+S / 2` semantics;
- 5-minute aggregation;
- **estimated** tick-rule signed volume / cumulative flow proxy.

Hard limitation:

The files do not contain Bid/Ask or true aggressor side. The derived series must remain named `tickRuleCvd` / flow proxy and must never be silently merged with Shioaji Bid/Ask-cross classified live flow.

### Taiwan leadership raw price path

Source: Shioaji stock Tick subscription.

Initial collection basket is a bounded market-cap leadership seed. It is raw price evidence only. It is **not** official current TAIEX weighting and cannot by itself produce official TSMC / Top-10 index-point contribution.

### TXO intraday quote surface

Source: Shioaji TXO Bid/Ask subscriptions.

Collection plan:

- two nearest eligible expiries;
- ATM-centered bounded strike band;
- Call and Put pair retention;
- contract metadata stored with quote evidence.

The raw surface is intended for future IV / skew derivation after timestamp and coverage audits. No IV/skew signal is authorized at collection time.

### TX / MTX / TMF live order-flow evidence

The existing read-only Shioaji bridge already records futures Tick and BidAsk events when it is running. These remain a separate higher-quality forward series for future quote-cross classification and CVD-quality audits.

## Requires source entitlement or owner-provided credential

### Official TAIEX constituent weights

Required for true TSMC / Top-10 index contribution.

Preferred official source: TWSE TAIEX Constituents simplified-weight file or equivalent governed official file.

Do not approximate official weight from a static market-cap seed when reporting `TSMC Contribution` or `Top-10 Contribution`.

### True NQ futures intraday

A governed real futures source is still required. `NDX_PROXY`, QQQ, CFD, or an unlabeled public continuous proxy must not be renamed to NQ.

Required contract fields include at minimum actual/continuous contract identity, expiry/roll semantics, event timestamp, received timestamp, and source provenance.

### Intraday USD/TWD

A governed FX source/API credential is still required. The source must expose sufficiently frequent timestamps and allow stale/holiday/session handling.

## Promotion boundary

Data collection does not confer product authority.

```text
Raw Collection
→ Coverage / Quality Audit
→ availableAt Audit
→ Deterministic Replay
→ Descriptive Validation
→ Owner Review
→ Shadow State Candidate
```

No collected series may become a formal Market State vote, Strategy Permission, Risk Veto, position rule, or execution input without the later gates above.
