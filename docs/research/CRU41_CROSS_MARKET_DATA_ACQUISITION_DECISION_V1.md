# CRU-41 Cross-Market Data Acquisition Decision V1

> Date: 2026-09-06  
> Parent: CRU-13  
> Input: CRU-38 Source Readiness V1 + Master Data Requirements V1  
> Scope: decision preparation only. No vendor contact, registration, purchase, paid entitlement, collector, runtime, scheduler, strategy, risk or execution change.  
> Safety: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`.

## 1. Decision question

The first acquisition decision is not “which vendor has the most data?” It is:

> What is the minimum lawful historical package required to falsify the first Cross-Market hypothesis without overbuying microstructure data?

First governed hypothesis:

`TWN 14:00–15:00 repricing -> TX 15:00 night-open response`

## 2. Minimum sufficient dataset

For the first falsification, the minimum sufficient TWN dataset is:

- canonical actual SGX TWN contract identity;
- individual expiry identity, not a silently stitched synthetic-only series;
- 1-minute OHLC price path;
- trade volume only if the vendor can explain the bar-volume semantics adequately;
- full T / T+1 session coverage relevant to 14:00–15:00;
- stable timezone/session mapping;
- 2020-07-20 to current is sufficient because TWN inception is 2020;
- lawful local retention and deterministic replay for Owner-only quantitative research.

Not required for the first falsification:

- Tick-by-tick trades;
- Bid/Ask;
- Level 1;
- Depth;
- MBO;
- a new live collector.

`TICK_BBO_DEPTH_REQUIRED = NO_FOR_FIRST_PROTOCOL`

## 3. NQ necessity decision

NQ should **not** be bundled into the first acquisition merely because Portara can supply it in the same format.

Reasoning:

1. The first question is specifically offshore-Taiwan repricing into TX night open.
2. TWN is the causal/structural comparison object for that first falsification.
3. NQ is useful as a global-technology-context covariate, but it is not required to determine whether TWN contains incremental information over TX itself.
4. Buying NQ at the same time increases ingestion, normalization and licensing scope before the TWN hypothesis has demonstrated value.
5. Existing daily global context can remain sufficient during the first TWN-only falsification.

Decision:

`NQ_FIRST_PROTOCOL_NECESSITY = DEFER`

NQ should move to acquisition only if either:

- the TWN-only study shows an effect that needs global-tech confound control; or
- a separately governed hypothesis explicitly requires intraday NQ.

## 4. Candidate comparison

| Candidate | Best role | Strength | Limitation | Decision |
|---|---|---|---|---|
| **Portara / CQG TWN 1m** | First governed TWN historical acquisition | Actual TWN; 2020-07-20 to current; individual/continuous; 1m + volume; timezone formatting; public one-off full-history pricing range | Exact TWN quote, retention/internal-research/non-display/correction terms still need written confirmation | **Preferred acquisition candidate** |
| **Barchart Premier** | Cheap manual sanity check | Low monthly cost; long 1m history; actual expired futures contracts addressable | Default personal/non-commercial; website automation prohibited; downloadable intraday stream is not complete Time & Sales | **Do not use as formal canonical acquisition** |
| **Tick Data LLC** | Higher-fidelity upgrade | Actual TWN trades + quotes from Aug-2020; Tick/L1 | Quote/license required; fidelity exceeds first hypothesis need | **Defer** |
| **Portara / CQG NQ 1m** | Same-vendor NQ later | NQ history from 1999; same 1m delivery model | Not needed in first protocol | **Defer** |
| **CME DataMine NQ** | Official NQ canonical upgrade | Official CME identity/reference; T&S/BBO/Depth/MBO options | Exact dataset price/license product-dependent; not needed yet | **Defer** |

## 5. Current public cost evidence

Portara publicly advertises one-off 1-minute full-history futures data around **USD 220–330 per commodity**, with individual or continuous files, roll service, timezone formatting and FTP delivery.

Important boundary:

- This is public generic pricing evidence, **not** an exact TWN quote.
- It is not proof that our intended internal quantitative use, indefinite local retention, replay, future derived-data retention or future commercial reuse are licensed.
- No purchase should be approved from the public price alone.

Provisional spend logic:

`PUBLIC_JUSTIFIED_TWN_1M_BAND = USD_220_TO_330`

If an exact TWN one-off quote is materially above the currently advertised full-history band, the acquisition should return to Owner review rather than being accepted automatically.

This is not a standing budget authorization.

## 6. Written terms required before any purchase decision

Portara/CQG must confirm in writing:

1. exact one-off price for TWN 2020-07-20 to current, 1-minute, individual-contract files;
2. contract/expiry identity fields and delivery layout;
3. bar-volume semantics and whether any trade classes are excluded;
4. timezone / DST / T and T+1 session treatment;
5. right to retain raw purchased files indefinitely on Owner local storage;
6. right to retain derived datasets and backtest outputs;
7. Owner-only internal quantitative research / replay permission;
8. whether SGX non-display or exchange fees apply to this historical purchase/use;
9. whether future commercial/product use requires a separate license;
10. correction/revision policy and whether delivered historical files may later be regenerated or changed.

Until these are answered:

`PORTARA_TWN_LICENSE = LICENSE_UNKNOWN`

## 7. Acquisition recommendation

Current recommendation:

`TWN_ACQUISITION_RECOMMENDATION = PROCEED_TO_WRITTEN_TERMS_GATE`

This means:

- do not buy yet;
- do not register or enable a paid feed yet;
- do not request Tick/L1;
- do not bundle NQ yet;
- ask only for the minimum TWN 1m actual-contract package and the ten written terms above after Owner explicitly authorizes vendor contact.

If written terms are acceptable and the exact price remains near the published one-off band, the recommended first acquisition becomes:

`TWN actual-contract 1-minute, 2020-07-20 -> current`

for the bounded TWN->TX falsification study.

## 8. What not to buy now

- NQ just because the same vendor carries it;
- TWN Tick / Level 1 / Depth;
- SOX intraday GIDS;
- USD/TWD paid intraday feed;
- recurring live subscriptions when a one-off historical package is sufficient;
- Barchart as formal canonical volume/pressure evidence.

## 9. Cost-value decision

The research value of TWN historical data is high enough to justify proceeding to a terms/quote gate because it directly tests a unique Taiwan-specific cross-market hypothesis and cannot be reconstructed from TX alone.

However, the value is **not** high enough to justify an institutional Tick/L1 package before 1-minute evidence establishes incremental predictive/explanatory value.

`COST_VALUE_DECISION = PASS_FOR_TERMS_GATE_ONLY`

## 10. Astra adversarial review contract

Astra, if used, must review this decision packet as an independent adversarial auditor.

It must **not** redesign project governance, invent a new data architecture, or expand the first protocol.

It should attack only:

1. whether TWN 1-minute is truly sufficient for the stated hypothesis;
2. whether NQ is being deferred correctly;
3. hidden licensing / retention / point-in-time risks;
4. vendor lock-in / correction risks;
5. whether the spend threshold is justified;
6. whether any cheaper lawful source makes Portara unnecessary;
7. whether the first study can be run without purchase at all.

Allowed findings:

- BLOCKING
- SIGNIFICANT
- NON_BLOCKING

Current status:

`ASTRA_ADVERSARIAL_REVIEW = NOT_RUN`

## 11. Owner decision packet

### Recommended next action

Authorize **vendor contact only** for Portara/CQG TWN 1-minute written terms and exact quote.

### Do not authorize yet

- payment;
- data purchase;
- account entitlement;
- paid download;
- import;
- collector/runtime work.

### Current gate state

`TWN_ACQUISITION_RECOMMENDATION = PASS`

`NQ_FIRST_PROTOCOL_NECESSITY = DEFER`

`MINIMUM_SUFFICIENT_PACKAGE = PASS_TWN_1M_ONLY`

`LICENSE_GAP_LIST = PASS`

`COST_VALUE_DECISION = PASS_FOR_TERMS_GATE_ONLY`

`ASTRA_ADVERSARIAL_REVIEW = NOT_RUN`

`OWNER_VENDOR_CONTACT_DECISION = PENDING`

`OWNER_SPEND_DECISION = NOT_READY`

## 12. Public source references

- Portara TWN historical data: https://portaracqg.com/futures/int/twn
- Portara pricing: https://portaracqg.com/pricing/
- Portara NQ history: https://portaracqg.com/futures/tto/enq
- Barchart historical download documentation: https://help.barchart.com/support/solutions/articles/242748-how-can-i-download-historical-data-
- Barchart terms: https://www.barchart.com/terms
- CME DataMine licensing: https://www.cmegroup.com/market-data/license-data.html
- CME historical/non-display licensing FAQ: https://www.cmegroup.com/market-data/distributor/files/cme-group-data-licensing-policy-guidelines-and-non-display-licensing-faq.pdf
