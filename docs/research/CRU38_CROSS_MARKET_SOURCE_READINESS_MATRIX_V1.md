# CRU-38 Cross-Market Source Readiness Matrix V1

> Date: 2026-09-06  
> Work item: CRU-38  
> Scope: Historical-first source / license / timestamp / replay readiness only.  
> Safety: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false`.  
> This document does **not** authorize purchase, registration, scraping, collector activation, runtime mutation, strategy promotion, or execution.

## 1. Decision objective

CRU-38 determines whether the first Cross-Market datasets can be obtained lawfully and with sufficient semantics **before** any collector implementation.

Current priority Master Dataset IDs:

- `twn_futures`
- `nq_futures`
- `sox_daily`
- `sox_intraday_candidate`
- `usdtwd_daily`
- `usdtwd_intraday_candidate`

Historical-first ordering:

`Research question -> minimum sufficient granularity -> existing/official/vendor history -> identity/license/timestamp/replay -> cost -> only then forward collection if a real gap remains`

## 2. First governed research question

The first Cross-Market falsification target remains:

`TWN 14:00-15:00 repricing -> TX 15:00 night-open response`

The first test does **not** require Tick/BBO/Depth. Actual-contract 1-minute price data is sufficient for normalized repricing, lead/lag, reversal and catch-up analysis. If volume/RVOL becomes part of the formal test, volume semantics must also be complete enough for that use.

Therefore:

- Tick/BBO/Depth purchase is not currently justified.
- A price-only pilot may use a lower-fidelity source only if the limitation is explicit.
- Formal volume / microstructure claims require a source whose trade/quote completeness supports them.

## 3. Source decision matrix

| Candidate | Market role | Canonical identity | Historical depth | Contract / roll identity | Completeness | Timestamp semantics | License / retention | Automation / delivery | Public cost evidence | Current disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| **Barchart Premier** | TWN + NQ cheap pilot | Actual SGX TWN is addressable under Barchart root `T1`; expired contracts are individually addressable. Actual CME NQ is also carried. | Intraday down to 1-minute, advertised approximately 10 years where symbol history exists; TWN inception is inside that window. | Individual expired futures contracts or Nearby continuous. Nearby rolls by volume/OI. | **Limited for formal volume/flow**: Barchart says intraday downloads include only trades qualifying as a `new last price`, excluding block and other trade types that can contribute to daily volume. | Futures downloads use Chicago Central Time. | Default site/Premier use is personal, non-commercial. Redistribution/commercial use requires written permission. Automated extraction/bots from the website are prohibited. | Manual/static CSV downloads; commercial OnDemand API is a separate product. | Premier USD 29.95/month; annual USD 239.95; 30-day trial; up to 250 downloads/day. | `RESEARCH_ONLY_PILOT_CANDIDATE` for Owner-only price-path falsification. **Not** canonical Time & Sales / Pressure / volume source. |
| **Portara / CQG** | TWN primary historical candidate; possible NQ / FX history | Dedicated actual SGX `TWN` dataset; CQG provenance. Individual contracts and continuous series supported. | TWN 2020-07-20 to current. | Individual contracts; continuous series can use volume/OI/calendar roll and multiple adjustment methods. | 1-minute intraday includes trade volume; Trades Only and Level 1 bid/ask products also exist. | Exchange/local timezone can be selected; tick default is millisecond; samples commonly use Chicago time unless reformatted. | Public material supports local database / trading-development-team workflows, but exact TWN purchased-dataset retention, internal research, future commercial reuse and redistribution rights still require written terms. | One-off FTP; optional local Portara downloader / update workflow. | Generic one-off full-history 1m pricing: USD 220-330 per commodity. PortaraNinja TWN storefront shows USD 330-1,005 depending selected data option. Exact TWN product/license tier requires confirmation. | `STRONG_HISTORICAL_CANDIDATE_PENDING_WRITTEN_TERMS`. Current best balance candidate for the first TWN governed 1m study. |
| **Tick Data LLC** | TWN / NQ higher-fidelity institutional candidate | Catalog explicitly lists SGX FTSE Taiwan Index Futures `TWN` and CME Nasdaq-100 E-mini `NQ`. | TWN trades + quotes Aug-2020 to present. NQ trades Jul-1999 to present; quotes Jan-2010 to present. | Front/back-month and as-traded files; custom continuous series can be built with TickWrite/TickAPI. | Tick-by-tick trades and Level I bid/ask; 1-minute trades-only option also offered. | Millisecond timestamps since July 2011. | Order/dataset-specific license, purchased-file retention and future commercial use require written review. | ASCII delivery; licensed API/S3; TickWrite/TickAPI tooling. | Quote required; no trustworthy public TWN/NQ order price found in this audit. | `STRONG_INSTITUTIONAL_CANDIDATE_PENDING_QUOTE_LICENSE`. Upgrade path if the research proves Tick/L1 is necessary. |
| **CME DataMine** | NQ preferred official canonical history | Official CME source; NQ identity, contract/security/reference metadata and exchange semantics. | Broad historical product families. Exact NQ start date remains product/dataset dependent and was not resolved from public static catalog pages. | Strong official contract / reference identity. | Time & Sales, Top of Book, Market Depth, MBO and other products depending purchase. | Dataset/version dependent. Public CME documentation shows older Time & Sales/BBO vintages differ from newer formats; modern BBO includes high-resolution UTC timestamp and sequence fields. | Ordering explicitly asks intended use, including non-viewable/non-display use. License requirements are use-dependent. | Official DataMine REST API after entitlement; file delivery also available. | Exact NQ dataset/order price not reliably exposed on public static pages in this audit. | `PREFERRED_OFFICIAL_NQ_CANONICAL_PENDING_CATALOG_COST_LICENSE`. Do not default to BBO/Depth until a hypothesis needs it. |

## 4. TWN conclusion

The historical-availability blocker is closed:

`TWN_HISTORICAL_AVAILABILITY = PASS_MULTIPLE_ACTUAL_TWN_SOURCES`

Actual TWN history from inception in 2020 is publicly documented by multiple independent sources.

Current acquisition hierarchy:

1. **Portara/CQG 1-minute actual-contract history** — preferred first governed candidate if written license/retention terms and exact quote are acceptable.
2. **Barchart Premier** — optional cheap/manual Owner-only price-path pilot, but not final volume/flow evidence.
3. **Tick Data** — higher-fidelity upgrade when a concrete Tick/L1 hypothesis justifies the cost.
4. **IBKR** — useful recent-history / possible forward comparison source, but not a sole 3-5+ year history because expired futures older than two years are unavailable under current IBKR historical policy.

No source is approved for production collection by this matrix.

## 5. NQ conclusion

`NQ_HISTORICAL_AVAILABILITY = PASS_MULTIPLE_SOURCES`

- CME DataMine remains the preferred official canonical upgrade path.
- Tick Data offers deep actual NQ trade/quote history.
- Barchart can support cheap 1-minute Owner-only pilot work but inherits the same download-completeness/license limits.
- Do not buy BBO/Depth merely because it exists. For global context / price-path validation, start with the minimum sufficient price/trade dataset.

Current state:

`NQ_CANONICAL_SOURCE = CME_DATAMINE_STRONG_PENDING_COST_LICENSE`

## 6. USD/TWD semantic narrowing

A new candidate was identified:

- Portara/CQG publishes `IUSDTWD` under `CQGFX-I` with intraday history from 1998-03-03.
- CQG documentation describes the CQG FX Index / Comprehensive FX family as **indicative, not traded**; the index is based on the midpoint of indicative bid/ask pricing.
- Current CQG Global FX material describes institutional pricing sourced from tier-1 banks and non-bank market makers, but this must not be silently assumed to describe every historical `CQGFX-I` vintage.

Therefore:

`USDTWD_CQGFXI_ECONOMIC_OBJECT = INDICATIVE_OTC_FX_INDEX_NOT_TRADED`

It may be useful as a Cross-Market FX context series if the exact source/vintage semantics are frozen, but it is **not** an actual USD/TWD trade tape and must not be labelled as one.

Current state:

- `USDTWD_CQGFXI_HISTORY = AVAILABLE_1998_PRESENT`
- `USDTWD_CQGFXI_CONTEXT_CANDIDATE = YES_PENDING_SOURCE_VINTAGE_LICENSE`
- `USDTWD_CQGFXI_CANONICAL_FOR_ACTUAL_TRADES = NO`
- CBC daily closing rate remains the preferred official daily context source.

## 7. SOX boundary

- SOX daily official history remains sufficient for current daily context.
- SOX intraday remains deferred until the project proves incremental value beyond NQ + SOX daily.

`SOX_INTRADAY = DEFER_PENDING_INCREMENTAL_VALUE`

## 8. Written-terms checklist before Owner purchase gate

### Portara/CQG TWN 1-minute

Need written confirmation of:

1. Exact TWN one-off price for full 2020-present 1-minute data.
2. Individual-contract files included, with explicit expiry/contract identity.
3. Volume field semantics and whether all qualifying exchange trades are represented in 1-minute bars.
4. Exchange-time delivery / timezone / DST behavior across T and T+1 sessions.
5. Whether raw purchased files may be stored indefinitely on Owner local storage.
6. Whether derived research datasets / backtest results may be retained indefinitely.
7. Whether Owner-only internal quantitative research / replay is permitted.
8. Whether future commercial/product use would require a new license.
9. Whether any SGX non-display or exchange fee is included, waived, or separately required for a one-off historical purchase.
10. Correction policy and whether historical files can be regenerated/revised after delivery.

### CME DataMine NQ

Need confirmation of:

1. Minimum sufficient NQ dataset and exact available start date.
2. One-time historical price for the desired date range.
3. Contract/reference/SecDef fields included.
4. Internal quantitative/non-display research license obligations.
5. Retention/replay rights for purchased files.
6. Whether derived research datasets may be persisted.
7. Timestamp/sequence semantics for the selected vintage.

### Tick Data

Need only if Portara/CME cannot satisfy the research question or if Tick/L1 becomes required:

1. TWN/NQ quote for requested granularity/date range.
2. Purchased-file retention and internal research rights.
3. API/S3/TickAPI licensing dependency.
4. Correction/revision and contract-metadata semantics.

## 9. Current recommendation

Do **not** purchase yet.

The next high-value action is a written terms/quote check for **Portara TWN 1-minute actual-contract history**. The public generic range of USD 220-330 per commodity is low enough that Portara may dominate a Barchart-first path once license and exact TWN price are confirmed.

If Portara written terms are acceptable, the recommended first historical acquisition would be:

`TWN actual-contract 1-minute + trade volume, 2020-07-20 to present`

for the bounded TWN->TX price-discovery falsification. Tick/L1 remains an upgrade, not a default requirement.

## 10. Source references

### Barchart

- Historical download semantics: https://www.barchart.com/stocks/quotes/%24MNXR/historical-download
- Membership / current Premier pricing: https://www.barchart.com/membership-comparison
- Terms: https://www.barchart.com/solutions/legal/terms
- TWN history page: https://www.barchart.com/futures/quotes/T1%2A0/historical-prices

### Portara / CQG

- TWN Tick / 1m / L1 catalog: https://portaracqg.com/futures/tto/twn
- Intraday pricing: https://portaracqg.com/pricing/
- Tick/L1 pricing info: https://portaracqg.com/pricing-tick-level-1-data/
- PortaraNinja catalog: https://portaraninja.com/historical-intraday-tick-data/
- CQG historical-data overview: https://www.cqg.com/products/historical-data
- CQG FX semantics: https://help.cqg.com/qtrader/25/Documents/cqgdata.htm
- USD/TWD intraday listing: https://portaracqg.com/forex/int/iusdtwd

### Tick Data LLC

- Futures product: https://www.tickdata.com/product/historical-futures-data/
- Available futures catalog: https://www.tickdata.com/historical-market-data-products/futures-data/available-futures-data/

### CME Group

- DataMine API: https://www.cmegroup.com/datamine/datamine-api.html
- Historical data types: https://www.cmegroup.com/cn-s/market-data/how-to-get-historical-data.html
- DataMine ordering / use-of-information workflow: https://www.cmegroup.com/tools-information/webhelp/data-services-portal/Content/Ordering-CME-Datamine-Products.html
- Market-data policy / licensing: https://www.cmegroup.com/market-data/license-data/market-data-policy-education-center.html

## 11. Gate state

`CRU38_SOURCE_MATRIX_V1 = PASS_DRAFT`

`TWN_HISTORICAL_AVAILABILITY = PASS`

`TWN_MINIMUM_SUFFICIENT_SOURCE = STRONG_CANDIDATE_PORTARA_1M_PENDING_WRITTEN_TERMS`

`NQ_HISTORICAL_AVAILABILITY = PASS`

`NQ_CANONICAL_SOURCE = CME_DATAMINE_STRONG_PENDING_COST_LICENSE`

`USDTWD_INTRADAY_OBJECT_DEFINITION = PARTIAL_PASS_INDICATIVE_CONTEXT_IDENTIFIED`

`SOX_INTRADAY = DEFER_PENDING_INCREMENTAL_VALUE`

`TICK_BBO_PURCHASE_NECESSITY = NOT_YET_JUSTIFIED`

`OWNER_PURCHASE_DECISION_READY = NOT_YET`

`PURCHASE = NOT_AUTHORIZED`

`COLLECTION_IMPLEMENTATION = NOT_AUTHORIZED`
