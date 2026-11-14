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

CRU-38 is a **readiness decision**, not an acquisition task. Per the work-item completion boundary, a source may finish V1 as `LICENSE_UNKNOWN`, `HISTORICAL_ONLY`, `RESEARCH_ONLY`, `DELAYED_ONLY` or `NOT_USABLE` if the decision and remaining gate are explicit. A vendor sales interaction is not required merely to close Source Readiness V1.

## 2. First governed research question

The first Cross-Market falsification target remains:

`TWN 14:00-15:00 repricing -> TX 15:00 night-open response`

The first test does **not** require Tick/BBO/Depth. Actual-contract 1-minute price data is sufficient for normalized repricing, lead/lag, reversal and catch-up analysis. If volume/RVOL becomes part of the formal test, volume semantics must also be complete enough for that use.

Therefore:

- Tick/BBO/Depth purchase is not currently justified.
- A price-only pilot may use a lower-fidelity source only if the limitation is explicit.
- Formal volume / microstructure claims require a source whose trade/quote completeness supports them.

## 3. Vendor/source decision matrix

| Candidate | Market role | Canonical identity | Historical depth | Contract / roll identity | Completeness | Timestamp semantics | License / retention | Automation / delivery | Public cost evidence | V1 disposition |
|---|---|---|---|---|---|---|---|---|---|---|
| **Barchart Premier** | TWN + NQ cheap pilot | Actual SGX TWN is addressable under Barchart root `T1`; expired contracts are individually addressable. Actual CME NQ is also carried. | Intraday down to 1-minute, advertised approximately 10 years where symbol history exists; TWN inception is inside that window. | Individual expired futures contracts or Nearby continuous. Nearby rolls by volume/OI. | **Limited for formal volume/flow**: downloadable intraday data includes trades qualifying as a `new last price`; block and other trade types can be excluded from intraday download volume. | Futures downloads use Chicago Central Time. | Default site/Premier use is personal, non-commercial. Redistribution/commercial use requires written permission. Automated extraction/bots from the website are prohibited. | Manual/static CSV downloads; commercial OnDemand API is a separate product. | Premier USD 29.95/month; annual USD 239.95; trial/limits subject to current plan terms. | **RESEARCH_ONLY** — optional Owner-only price-path sanity check; not canonical T&S / Pressure / volume evidence. |
| **Portara / CQG** | TWN primary historical candidate; possible NQ single-vendor 1m path | Dedicated actual SGX `TWN` dataset; CQG provenance. Dedicated E-mini Nasdaq-100 `ENQ (NQ)` dataset. | TWN 2020-07-20 to current. NQ 1999-06-21 to current. | Individual contracts; continuous series can use volume/OI/calendar roll and multiple adjustment methods. | 1-minute intraday with trade volume; Trades Only and Level 1 bid/ask products also exist for TWN/NQ. | Timezone/session can be formatted; tick data is millisecond-granularity; sample defaults can use Chicago local time. | Public material supports local research/database workflows, but exact TWN/NQ purchased-file retention, internal quantitative use, future commercial use and redistribution rights still require written terms. | One-off file delivery and optional local downloader/update workflow. | Public generic one-off full-history 1m ranges exist, but exact TWN/NQ product/license quote must be confirmed before spend. | **LICENSE_UNKNOWN** — strongest minimum-sufficient TWN candidate; possible same-vendor TWN+NQ path pending written terms. |
| **Tick Data LLC** | TWN / NQ higher-fidelity institutional candidate | Catalog explicitly lists SGX FTSE Taiwan Index Futures `TWN` and CME Nasdaq-100 E-mini `NQ`. | TWN trades + quotes Aug-2020 to present. NQ trades Jul-1999 to present; quotes Jan-2010 to present. | Front/back-month and as-traded files; custom continuous series can be built with TickWrite/TickAPI. | Tick-by-tick trades and Level I bid/ask; 1-minute trades-only option also offered. | Millisecond timestamps since July 2011. | Order/dataset-specific license, purchased-file retention and future commercial use require written review. | ASCII delivery; licensed API/S3; TickWrite/TickAPI tooling. | Quote required; no trustworthy public TWN/NQ order price established by this audit. | **LICENSE_UNKNOWN** — higher-fidelity upgrade only if a concrete Tick/L1 research question justifies it. |
| **CME DataMine** | NQ preferred official canonical history | Official CME source; NQ identity, contract/security/reference metadata and exchange semantics. | Broad historical product families; exact NQ start date is product/dataset dependent and was not resolved from public static catalog pages. | Strong official contract / reference identity. | Time & Sales, Top of Book, Market Depth, MBO and other products depending purchase. | Dataset/version dependent; newer quote products include high-resolution UTC timestamps and sequence fields while older vintages differ. | Ordering asks intended use, including non-viewable/non-display use. License requirements are use-dependent. | Official DataMine REST API after entitlement; file delivery also available. | Exact NQ dataset/order price not reliably exposed on public static pages in this audit. | **LICENSE_UNKNOWN** — preferred official NQ canonical upgrade; do not default to BBO/Depth until a hypothesis needs it. |
| **Nasdaq Global Index Watch / SOX history** | SOX daily context | Official PHLX Semiconductor Index `SOX`. | Official historical index-value page; SOX began 1993-12-01. | Index identity; no futures-roll problem. | Daily index values / O-H-L-C context, not intraday tick evidence. | Trade-date daily index semantics. | Public display/download is not automatically a grant for automated durable redistribution or commercial product use. | Web historical download / index site. | No purchase required for manual public historical inspection; machine/commercial rights must follow Nasdaq terms. | **HISTORICAL_ONLY** — strong official daily research context; do not relabel as intraday. |
| **Nasdaq GIDS** | SOX intraday candidate | Official Nasdaq Global Index Data Service; carries real-time and historical Nasdaq index data. | Real-time + historical index/constituent data. | Official index identity. | Intraday index dissemination, frequency varies by index/product. | Official feed/API timestamps under GIDS specifications. | Current Nasdaq policy is licensing-driven. New delayed GIDS licenses ceased being offered from 2026-09-01; real-time/EOD remain alternatives. Benchmarking/investment-product use requires appropriate approval/license. | Direct feed, authorized data providers, REST / streaming cloud delivery subject to sales onboarding. | Current price is sales/contract dependent; stale historical fee sheets must not be treated as current. | **LICENSE_UNKNOWN** and **DEFER** — technically available, but incremental value beyond NQ + SOX daily is not yet proven. |
| **CBC NT$/US$ Closing Rate** | USD/TWD daily context | Official Central Bank of the Republic of China NT$/US$ closing-rate series. | Long historical daily series. | Daily economic-series identity; no futures roll. | Daily closing rate only. | Published daily date/value; not intraday `availableAt` evidence unless publication-time semantics are separately captured. | Official public historical series; automation/product rights still must follow source terms if operationalized. | Public official web history. | Public official source. | **HISTORICAL_ONLY** — preferred official daily FX context; must never be relabelled as intraday. |
| **CQGFX-I / Portara `IUSDTWD`** | USD/TWD intraday context candidate | USD/TWD indicative OTC FX index/context series; **not an actual traded tape**. | Intraday history from 1998-03-03 to current in Portara catalog. | FX index/indicative series identity; no exchange-contract roll. | Indicative quote-derived context, not executed trades. | Exact source/vintage/timezone semantics must be frozen; historical source composition must not be assumed from current marketing material. | Purchased-data/internal-research/retention rights require written terms. | Historical file/download workflow via Portara/CQG. | Exact quote/license not fixed by this audit. | **LICENSE_UNKNOWN / RESEARCH_ONLY candidate** — usable only as explicitly labelled indicative FX context. |

## 4. Priority-scope disposition

| Master Dataset ID | Minimum sufficient role for V1 | Best current source path | V1 readiness | Remaining gate |
|---|---|---|---|---|
| `twn_futures` | Actual-contract 1-minute price; volume only if its semantics are adequate | Portara/CQG 1m first; Tick Data upgrade; Barchart price-only pilot | **LICENSE_UNKNOWN** with historical availability PASS | Exact quote + retention/internal-research/non-display/correction terms before acquisition |
| `nq_futures` | 1-minute / Trades context before any BBO/Depth | Portara 1m as possible same-vendor path; CME DataMine as preferred official canonical upgrade | **LICENSE_UNKNOWN** with historical availability PASS | Decide whether NQ is required in first protocol; then exact cost/license for minimum dataset |
| `sox_daily` | Daily semiconductor regime/context | Nasdaq official SOX history | **HISTORICAL_ONLY** | Operational machine-use/retention terms only if automated ingestion is later authorized |
| `sox_intraday_candidate` | Only if it adds value beyond NQ + SOX daily | Nasdaq GIDS | **LICENSE_UNKNOWN / DEFER** | Incremental-value research justification first; then current sales/license terms |
| `usdtwd_daily` | Official daily FX context | CBC NT$/US$ closing-rate history | **HISTORICAL_ONLY** | Preserve as daily only; publication-time semantics needed for strict point-in-time use |
| `usdtwd_intraday_candidate` | Explicitly defined indicative intraday FX context, not trade tape | CQGFX-I/Portara candidate; LSEG remains alternative candidate | **LICENSE_UNKNOWN / RESEARCH_ONLY candidate** | Freeze economic object/source vintage + license/retention/timestamp semantics |

## 5. TWN conclusion

The historical-availability blocker is closed:

`TWN_HISTORICAL_AVAILABILITY = PASS_MULTIPLE_ACTUAL_TWN_SOURCES`

Actual TWN history from inception in 2020 is publicly documented by multiple independent sources.

Current acquisition hierarchy:

1. **Portara/CQG 1-minute actual-contract history** — preferred first governed candidate if written license/retention terms and exact quote are acceptable.
2. **Barchart Premier** — optional cheap/manual Owner-only price-path pilot, but not final volume/flow evidence.
3. **Tick Data** — higher-fidelity upgrade when a concrete Tick/L1 hypothesis justifies the cost.
4. **IBKR** — useful recent-history / possible forward comparison source, but not a sole 3-5+ year history because expired futures older than two years are unavailable under current IBKR historical policy.

No source is approved for production collection by this matrix.

## 6. NQ conclusion

`NQ_HISTORICAL_AVAILABILITY = PASS_MULTIPLE_SOURCES`

Portara now provides an important additional path:

- Dedicated E-mini Nasdaq-100 `ENQ (NQ)` history starts 1999-06-21 and runs to current.
- Daily, 1-minute intraday, Tick Trades Only and Tick Level 1 are listed.
- 1-minute data includes trade volume; individual/continuous contracts and configurable roll/timezone formatting are available.
- This means a **single-vendor TWN + NQ 1-minute historical path is technically possible** if written licensing is acceptable.

That does **not** demote CME DataMine as the official-canonical NQ source. It changes the cost/engineering tradeoff:

- If the first protocol only needs TWN, do not buy NQ just for convenience.
- If TWN + NQ are both required, same-vendor Portara formatting may reduce ingestion/normalization work.
- CME DataMine remains the preferred official upgrade when exchange-canonical metadata or deeper NQ microstructure is needed.
- Tick Data remains the higher-fidelity third-party alternative.

Current states:

`NQ_PORTARA_HISTORY_START = VERIFIED_1999_06_21`

`NQ_PORTARA_1M = VERIFIED_AVAILABLE`

`PORTARA_TWN_NQ_SINGLE_VENDOR_1M = POSSIBLE_PENDING_WRITTEN_LICENSE`

`NQ_CANONICAL_SOURCE = CME_DATAMINE_STRONG_PENDING_COST_LICENSE`

## 7. USD/TWD semantic narrowing

- Portara/CQG publishes `IUSDTWD` under `CQGFX-I` with intraday history from 1998-03-03.
- CQG documentation describes the CQG FX Index / Comprehensive FX family as **indicative, not traded**; the index is quote-derived rather than an exchange trade tape.
- Current CQG Global FX material describes institutional contributors, but current composition must not be silently projected backward onto every historical `CQGFX-I` vintage.

Therefore:

`USDTWD_CQGFXI_ECONOMIC_OBJECT = INDICATIVE_OTC_FX_INDEX_NOT_TRADED`

It may be useful as a Cross-Market FX context series if exact source/vintage semantics are frozen, but it is **not** an actual USD/TWD trade tape and must not be labelled as one.

Current state:

- `USDTWD_CQGFXI_HISTORY = AVAILABLE_1998_PRESENT`
- `USDTWD_CQGFXI_CONTEXT_CANDIDATE = YES_PENDING_SOURCE_VINTAGE_LICENSE`
- `USDTWD_CQGFXI_CANONICAL_FOR_ACTUAL_TRADES = NO`
- CBC daily closing rate remains the preferred official daily context source.

## 8. SOX boundary

Official Nasdaq evidence confirms:

- SOX has an official historical index-value page and began on 1993-12-01.
- Nasdaq GIDS provides real-time and historical index data with direct/provider/cloud delivery.
- As of 2026-09-01, GIDS delayed data is no longer offered to **new** clients; real-time and EOD offerings remain alternatives.
- Nasdaq index-data usage is licensing-governed, including benchmarking/investment-product use.

The product decision remains unchanged:

- SOX daily official history is sufficient for current daily semiconductor context.
- SOX intraday is technically obtainable, but it remains deferred until incremental value beyond NQ + SOX daily is demonstrated.
- No current sales quote is needed to close V1 while the requirement itself is deferred.

`SOX_DAILY_OFFICIAL_HISTORY = AVAILABLE`

`SOX_INTRADAY_GIDS = AVAILABLE_BUT_LICENSE_COST_SALES_REQUIRED`

`SOX_INTRADAY = DEFER_PENDING_INCREMENTAL_VALUE`

## 9. Written-terms checklist before any Owner acquisition gate

### Portara/CQG TWN 1-minute

Need written confirmation only when Owner is ready to consider acquisition:

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

### Portara/CQG NQ 1-minute

If NQ is included in the same first protocol, also confirm:

1. Exact NQ one-off price for 1-minute individual-contract history.
2. Whether TWN + NQ may be retained under the same internal-research license model.
3. Contract/reference and rollover fields delivered for NQ.
4. Whether data-vintage/correction semantics differ from TWN.

### CME DataMine NQ

Need confirmation only before selecting it for acquisition:

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

## 10. Storage / replay boundary

CRU-38 Storage Phase 0 remains accepted with limitation:

- Current physical capacity shortage: **NO**.
- Storage confidence: **WARNING_DUE_TO_LOW_CONFIDENCE** because only one strict `NORMAL_COMPLETE` sample was available.
- `DAILY_GROWTH_MODEL = NOT_VERIFIED`.
- TWN/NQ Tick storage capacity remains UNKNOWN and is not needed for the minimum-sufficient 1-minute historical plan.
- Historical vendor files must not be mixed with forward system-knowledge evidence. Backfilled market paths cannot reconstruct what the system knew at decision time.

No database/storage replatforming is authorized by CRU-38.

## 11. Current recommendation

Do **not** purchase yet as part of CRU-38 V1.

Source Readiness V1 has now answered the question it was created to answer: the priority markets are not blocked by lack of historical availability, and the remaining acquisition gates are explicit.

If the Owner later authorizes a data-purchase decision, the first commercial check should be **Portara TWN 1-minute actual-contract history** because it is the current minimum-sufficient candidate for the first TWN->TX falsification. If NQ is part of the same protocol, obtain a combined Portara TWN+NQ quote/license comparison against CME DataMine NQ.

Tick/L1 remains an upgrade, not a default requirement.

## 12. Source references

### Barchart

- Historical download semantics: https://www.barchart.com/stocks/quotes/%24MNXR/historical-download
- Membership / current Premier pricing: https://www.barchart.com/membership-comparison
- Terms: https://www.barchart.com/solutions/legal/terms
- TWN history page: https://www.barchart.com/futures/quotes/T1%2A0/historical-prices

### Portara / CQG

- TWN Tick / 1m / L1 catalog: https://portaracqg.com/futures/tto/twn
- NQ / ENQ catalog: https://portaracqg.com/futures/tto/enq
- MNQ catalog: https://portaracqg.com/futures/int/mnq
- Intraday catalog: https://portaracqg.com/historical-intraday-futures-data/
- Intraday pricing: https://portaracqg.com/pricing/
- Tick/L1 pricing info: https://portaracqg.com/pricing-tick-level-1-data/
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

### Nasdaq

- SOX official history: https://indexes.nasdaq.com/Index/History/SOX
- SOX official overview: https://indexes.nasdaq.com/index/Overview/SOX
- GIDS: https://www.nasdaq.com/products/global-indexes/data/gids
- 2026 GIDS policy update: https://www.nasdaqtrader.com/TraderNews.aspx?id=DN2026-5

### Central Bank of the Republic of China

- NT$/US$ Closing Rate: https://www.cbc.gov.tw/en/lp-700-2-2-40.html

## 13. V1 completion gate

`CRU38_STORAGE_EVIDENCE = PASS_WITH_LIMITATION`

`CRU38_SOURCE_READINESS_MATRIX = PASS`

`TWN_HISTORICAL_AVAILABILITY = PASS`

`TWN_SOURCE_DISPOSITION = LICENSE_UNKNOWN__PORTARA_1M_PREFERRED_MINIMUM_CANDIDATE`

`NQ_HISTORICAL_AVAILABILITY = PASS`

`NQ_SOURCE_DISPOSITION = LICENSE_UNKNOWN__PORTARA_1M_OR_CME_DATAMINE`

`SOX_DAILY_SOURCE_DISPOSITION = HISTORICAL_ONLY__OFFICIAL_NASDAQ`

`SOX_INTRADAY_SOURCE_DISPOSITION = LICENSE_UNKNOWN__DEFER_PENDING_INCREMENTAL_VALUE`

`USDTWD_DAILY_SOURCE_DISPOSITION = HISTORICAL_ONLY__OFFICIAL_CBC`

`USDTWD_INTRADAY_SOURCE_DISPOSITION = LICENSE_UNKNOWN__INDICATIVE_CONTEXT_ONLY`

`TICK_BBO_PURCHASE_NECESSITY = NOT_YET_JUSTIFIED`

`OWNER_PURCHASE_DECISION_REQUIRED = YES_FOR_ANY_ACQUISITION`

`PURCHASE = NOT_AUTHORIZED`

`COLLECTION_IMPLEMENTATION = NOT_AUTHORIZED`

`CRU38_COMPLETION_CANDIDATE = READY_FOR_GPT_OWNER_REVIEW`
