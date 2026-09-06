# CRU-41 Cross-Market Data Acquisition Decision V1

> Date: 2026-09-06  
> Parent: CRU-13  
> Input: CRU-38 Source Readiness V1 + Master Data Requirements V1  
> Scope: decision preparation only. No vendor contact, registration, purchase, paid entitlement, collector, runtime, scheduler, strategy, risk or execution change.  
> Safety: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`.

## 1. Owner decision update

Owner direction on 2026-09-06:

> Prefer free resources first. Paid historical market data is **not rejected in principle**; it should be purchased only when the project can show that the paid data is necessary or provides enough incremental research/product value to justify the cost. At the current stage, the known paid TWN options are not yet justified.

This changes the acquisition decision from an immediate vendor-quote gate to a **free-first / paid-conditional** policy.

Current governing states:

`PAID_HISTORICAL_DATA = CONDITIONAL_FUTURE_OPTION`

`FREE_FIRST = REQUIRED`

`VENDOR_CONTACT = NOT_AUTHORIZED_AT_CURRENT_GATE`

`OWNER_SPEND_DECISION = DEFER_PENDING_VALUE_JUSTIFICATION`

`MAX_CURRENT_INCREMENTAL_DATA_SPEND = 0`

The zero-spend state is a **current-gate limit**, not a permanent budget rule.

## 2. First governed hypothesis

`TWN 14:00–15:00 repricing -> TX 15:00 night-open response`

The minimum data needed to test this hypothesis rigorously remains:

- canonical actual SGX TWN identity;
- actual expiry / contract identity;
- 1-minute OHLC price path;
- full T / T+1 session coverage around 14:00–15:00;
- stable timezone/session semantics;
- lawful retention/replay for research.

Tick, BBO, Level 1, Depth and MBO are **not required** for the first falsification.

`TICK_BBO_DEPTH_REQUIRED = NO_FOR_FIRST_PROTOCOL`

## 3. Free-source audit result

The current public/free landscape is useful, but it does **not** yet provide a verified governed substitute for multi-year actual-contract TWN 1-minute history.

| Free / near-free path | What is available | Why it is not yet the formal answer |
|---|---|---|
| **SGX official product / delayed-price pages** | Canonical TWN identity, contract specs, delayed current prices, OHLC/volume/OI fields and downloadable delayed-price tables | Public evidence does not establish multi-year 1-minute historical coverage, durable automated retention, or deterministic replay rights for the required study |
| **SGX public charts / settlement history** | Official daily/settlement context | Daily data cannot test 14:00–15:00 intraday repricing |
| **Investing.com free historical TWN page** | Free daily OHLC/volume display | Identified as CFD/derived presentation and daily-only; not canonical SGX actual-contract 1-minute evidence |
| **Barchart** | Actual TWN contracts and long 1-minute capability exist | The needed intraday download capability is tied to paid Premier/commercial products; not free, and default downloadable intraday is not complete Time & Sales |
| **Public/community datasets if found later** | Potential exploratory data | Must not enter formal research until provenance, identity, timestamp semantics, license, retention and contract mapping are verified |

Current conclusion:

`FREE_GOVERNED_TWN_MULTIYEAR_1M = NOT_VERIFIED`

This does **not** mean the data does not exist somewhere for free. It means no source has yet passed the project truth gate for the required use.

## 4. Paid-source disposition

Paid sources remain technically viable **future options**, but are deferred at the current stage because their incremental value has not yet been demonstrated relative to free/owned alternatives.

Candidates retained for future reconsideration:

- Portara/CQG TWN 1m;
- Tick Data TWN trades / quotes;
- Barchart Premier;
- paid CME DataMine NQ;
- paid SOX intraday GIDS;
- paid USD/TWD intraday feeds.

Current state:

`PORTARA_TWN = DEFER_PENDING_VALUE_JUSTIFICATION`

`TICKDATA_TWN = DEFER_PENDING_VALUE_JUSTIFICATION`

`BARCHART_PREMIER = DEFER_PENDING_VALUE_JUSTIFICATION`

A paid-source gate may be reopened only when at least one of the following is true:

1. no lawful free/owned source can answer a high-value governed hypothesis;
2. a free source exists but fails a material truth requirement that the paid source resolves;
3. the expected research/product value of the paid dataset is high enough to justify its full cost, license and integration burden;
4. a downstream validated research result specifically requires higher fidelity such as Tick/L1/BBO/Depth.

Until then, no quote request is needed.

## 5. NQ decision

NQ remains **deferred** from the first protocol.

Reasons:

1. The first hypothesis is specifically TWN -> TX.
2. Buying or adding NQ increases scope before TWN incremental value is established.
3. Existing free/daily global context can remain a control layer during early exploratory work.
4. If TWN-only evidence later survives, intraday NQ can be reconsidered using free sources first, then paid sources if the added control value is justified.

`NQ_FIRST_PROTOCOL_NECESSITY = DEFER`

## 6. Free-first research path

The project should now proceed in this order:

### Path A — exploit already-free official data

Use free official data where it is already sufficient:

- TX / TXO: TAIFEX official historical downloads and existing governed project data;
- SOX daily: official Nasdaq historical context;
- USD/TWD daily: official CBC closing-rate history;
- SGX TWN daily/delayed official data: identity / settlement / coarse regime context only.

### Path B — search for a lawful free TWN intraday source

A candidate may proceed only if it can satisfy:

1. actual TWN, not CFD/proxy;
2. 1-minute or better;
3. contract-month / expiry identity;
4. usable 14:00–15:00 T+1 coverage;
5. known timezone;
6. multi-year history or a useful bounded historical window;
7. lawful local retention and replay;
8. stable provenance.

Until then it remains exploratory only.

### Path C — if no governed free multi-year 1m source exists

Do **not** automatically buy data.

Instead choose between:

- **DEFER the TWN historical falsification** while retaining the hypothesis;
- **ACCUMULATE forward TWN evidence later** only if an already-owned / no-incremental-cost lawful feed becomes available;
- use official daily TWN context for lower-granularity research questions that do not pretend to answer the 14:00–15:00 intraday hypothesis;
- **REOPEN PAID ACQUISITION** only when the expected incremental value of TWN 1m is high enough to justify the price and licensing burden.

Historical absence must never be replaced with synthetic certainty.

## 7. What not to do

- Do not scrape SGX merely because the webpage is public.
- Do not relabel Investing.com CFD/derived data as canonical TWN.
- Do not buy Portara, Barchart, Tick Data, CME DataMine or GIDS under the current CRU-41 gate.
- Do not interpret that deferral as a permanent ban on paid data.
- Do not substitute daily data for the intraday TWN->TX hypothesis.
- Do not infer missing intraday history from settlement data.
- Do not create a new collector unless a separate Owner gate authorizes it.

## 8. Cost-value decision

Free-first is the current default because the project has not yet demonstrated that paid TWN history produces enough incremental value to justify acquisition.

The prior Portara public range around USD 220–330 per commodity remains useful as future reference. It is **not** a current spend target and is **not** considered permanently unacceptable.

Current state:

`COST_VALUE_DECISION = DEFER_UNTIL_INCREMENTAL_VALUE_JUSTIFIED`

`MAX_CURRENT_INCREMENTAL_DATA_SPEND = 0`

Future decision rule:

> Pay only when the expected incremental research/product value is materially greater than the full acquisition, licensing, integration and maintenance cost, and when a free/owned substitute cannot answer the governed question with adequate truth.

## 9. Astra review decision

Astra is **not needed now** for vendor selection because no paid vendor selection is being made.

Its higher-value future use would be either:

- after a genuinely free TWN source is found and needs adversarial semantic review; or
- when a paid acquisition gate is reopened with a concrete research-value case plus exact terms/cost.

`ASTRA_ADVERSARIAL_REVIEW = NOT_RUN_NOT_NEEDED_AT_CURRENT_GATE`

## 10. Owner decision packet

### Current recommendation

**Use free resources first and do not acquire paid TWN/NQ historical data at the current stage.**

Paid data remains a valid future option if it becomes necessary or can demonstrate enough incremental value.

### Current gate state

`TWN_ACQUISITION_RECOMMENDATION = DEFER_CURRENT_PAID_FREE_FIRST`

`NQ_FIRST_PROTOCOL_NECESSITY = DEFER`

`MINIMUM_SUFFICIENT_PACKAGE = TWN_ACTUAL_CONTRACT_1M_IF_GOVERNED_SOURCE_FOUND`

`FREE_GOVERNED_TWN_MULTIYEAR_1M = NOT_VERIFIED`

`LICENSE_GAP_LIST = PASS`

`COST_VALUE_DECISION = DEFER_UNTIL_INCREMENTAL_VALUE_JUSTIFIED`

`ASTRA_ADVERSARIAL_REVIEW = NOT_RUN_NOT_NEEDED_AT_CURRENT_GATE`

`OWNER_VENDOR_CONTACT_DECISION = DO_NOT_CONTACT_PAID_VENDOR_NOW`

`OWNER_SPEND_DECISION = DEFER_PENDING_VALUE_JUSTIFICATION`

## 11. Next research gate

The next bounded work should be **Free Cross-Market Data Feasibility**, not a paid quotation exercise.

Completion question:

> Can we obtain lawful, canonical, reproducible TWN intraday evidence at zero incremental cost, or must the 1-minute historical hypothesis remain deferred / later reopen a paid acquisition gate?

Possible valid outcomes:

- `FREE_TWN_1M = PASS`
- `FREE_TWN_1M = EXPLORATORY_ONLY`
- `FREE_TWN_1M = NOT_AVAILABLE / NOT_VERIFIED`

Any of these is acceptable if truthfully evidenced.

A `NOT_AVAILABLE / NOT_VERIFIED` result does not automatically authorize purchase. It only creates the evidence needed to decide whether the research value is high enough to justify reopening paid acquisition.

## 12. Public references checked

- SGX FTSE Taiwan Index Futures product / delayed market information: https://www.sgx.com/derivatives/products/twnfc
- SGX delayed futures prices: https://www.sgx.com/derivatives/delayed-prices-futures
- Investing.com SGX FTSE Taiwan Futures historical page: https://www.investing.com/indices/sgx-ftse-taiwan-futures-historical-data
- Barchart TWN historical-download capability: https://www.barchart.com/futures/quotes/T1X26/historical-download
- Portara TWN historical catalog (paid, future conditional option): https://portaracqg.com/futures/int/twn
