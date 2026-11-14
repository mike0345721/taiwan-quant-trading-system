# TWN Source Candidates

> Work package: CRU-37
> Decision status: OWNER / VENDOR / LICENSING DECISION REQUIRED
> No source activation, registration, purchase, scraping, or data collection is authorized by this document.

## 1. Required instrument

The target is the actual SGX FTSE Taiwan Index Futures product with product code `TWN`, not TAIFEX `TX`, SGX micro `MTWN`, an index CFD, or a synthetic Taiwan proxy. The official product page specifies a USD-denominated contract, `US$40 × index`, 0.25-point outright tick, serial and quarterly contract months, and separate T/T+1 sessions. It also names market-data vendors and vendor symbols. See the [SGX TWN product page](https://www.sgx.com/derivatives/products/twnfc?cc=MTWN).

Any selected source must provide actual contract code, expiry, source timestamps, trade date/session semantics, and a lawful path for automated research storage and replay.

## 2. Candidate comparison

`UNKNOWN` means no persisted entitlement, contract, API specification or written permission was found. Suitability values are an evidence result, not a recommendation to register or buy.

| Candidate | Realtime | Delayed | Historical | Granularity | Contract identity | Rollover support | License | Non-display usage | Redistribution | Public cost | Suitability | Current decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SGX Data Direct / direct derivatives feed | Possible official service; exact entitlement `UNKNOWN` | Covered product class; interface `UNKNOWN` | Covered product class; interface/history `UNKNOWN` | Tick/quote/reference potentially; exact package `UNKNOWN` | Expected authoritative TWN directory; not verified locally | `UNKNOWN` | Direct SGX agreement/declaration required | Required and fee-bearing for automated quantitative use | Separate agreement required | `UNKNOWN` | `UNKNOWN` | Preferred truth candidate; blocked |
| SGX historical / EOD data service | No | Possible; `UNKNOWN` | Possible EOD/historical; depth `UNKNOWN` | 1m/daily/settlement/OI all `UNKNOWN` | Must provide actual TWN expiry | `UNKNOWN` | Required; exact historical terms `UNKNOWN` | Machine storage/replay status `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Ask SGX for exact product/interface/retention rights |
| Trading Technologies | `UNKNOWN`; product page only names TWN vendor | `UNKNOWN` | `UNKNOWN` | Tick/quote/1m/daily `UNKNOWN` | TWN named; expiry mapping `UNKNOWN` | `UNKNOWN` | Vendor + SGX entitlement `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Technical/licensing response required |
| Market Prizm | `UNKNOWN`; product page only names TWN vendor | `UNKNOWN` | `UNKNOWN` | Tick/quote/1m/daily `UNKNOWN` | `TWNmyy` named; expiry semantics unverified | `UNKNOWN` | Vendor + SGX entitlement `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Technical/licensing response required |
| Activ Financial | `UNKNOWN`; product page only names TWN/TWNTI vendor | `UNKNOWN` | `UNKNOWN` | Tick/quote/1m/daily `UNKNOWN` | TWN and session tickers named; mapping unverified | `UNKNOWN` | Vendor + SGX entitlement `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Technical/licensing response required |
| SIX Financial | `UNKNOWN`; product page only names session symbols | `UNKNOWN` | `UNKNOWN` | Tick/quote/1m/daily `UNKNOWN` | Session-specific symbols named; expiry mapping unverified | `UNKNOWN` | Vendor + SGX entitlement `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Technical/licensing response required |
| CQG | `UNKNOWN`; product page only names TWN/MTWN/TWNTI | `UNKNOWN` | `UNKNOWN` | Tick/quote/1m/daily `UNKNOWN` | Product identity named; contract mapping unverified | `UNKNOWN` | Vendor + SGX entitlement `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Technical/licensing response required |
| Colt Technology Services | `UNKNOWN`; product page names TWNTI only | `UNKNOWN` | `UNKNOWN` | Tick/quote/1m/daily `UNKNOWN` | Outright TWN availability `NOT_VERIFIED` | `UNKNOWN` | Vendor + SGX entitlement `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Not eligible until outright TWN is proven |
| Broker API carrying SGX derivatives (illustrative: IBKR) | Possible; actual API entitlement `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Tick/quote/bar `UNKNOWN` for intended entitlement | Must expose actual TWN contracts; unverified | `UNKNOWN` | Broker + SGX terms `UNKNOWN` | Automated persistence status `UNKNOWN` | `UNKNOWN` | IBKR display page lists SGX Derivatives L1 SGD 2/month; total/API/NDU cost `UNKNOWN` | `UNKNOWN` | Owner may request bounded vendor review; no account action |
| SGX website delayed prices/chart | Human display only | Public delayed/EOD display | Limited visible chart; machine history `UNKNOWN` | Display chart | Visible product/contract selection | Not machine-governed | Website terms only; machine license not proven | `NOT_APPROVED` | `NOT_APPROVED` | Public display | `UNKNOWN` | Reject as collector; no scraper |
| Generic free API / CFD / ETF proxy | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Provider-dependent | Not actual TWN unless proven | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Often free/unknown | `UNKNOWN` | Reject for canonical TWN; proxy requires separate identity and Owner decision |

The SGX policy basis is the [Market Data Policy effective 1 July 2026](https://cdn.databp.com/tenants/sgx/documents/2ae33c20-3d4c-11f1-9fd6-43b28f5cb868/Singapore%20Exchange%20Limited%20(SGX)%20Market%20Data%20Policy%20(Effective%201%20July%202026).pdf). It explicitly covers SGX Equity Derivatives and real-time, delayed, EOD and historical variants; it also treats automated access, quantitative analysis, AI/ML and model training as non-display usage and applies declaration, reporting and fees. Public broker pricing reference: [IBKR market-data pricing](https://www.interactivebrokers.com/en/pricing/market-data-pricing.php).

## 3. Mandatory vendor questions

The Owner should obtain written answers before any implementation:

1. Does the entitlement cover actual TWN futures, every listed expiry, contract reference data, Tick, BidAsk, OHLCV, settlement, volume and OI?
2. Are exchange `eventTime`, trade date/session, native sequence or source message ID supplied?
3. Does the license permit automated internal research, durable local raw storage, deterministic replay, derived research features and audit evidence?
4. Which SGX declaration, non-display, display, redistribution, derived-data and connectivity fees apply to one local research application?
5. Are delayed/EOD and historical entitlements separate? What history, corrections and corporate/index-methodology changes are delivered?
6. What API, reconnect, throttling, snapshot, gap-recovery and symbol-directory behavior is guaranteed?
7. What retention, deletion, audit-log and user/device/site reporting obligations apply?

## 4. Minimum acceptance gate

A candidate remains `BLOCKED_SOURCE_NOT_GOVERNED` until all of these are evidenced:

- actual TWN identity and contract directory;
- written machine/non-display usage rights for the intended design;
- complete recurring and one-time cost disclosure;
- event/receive/availability semantics;
- SGX T/T+1 trade-date and holiday behavior;
- expiry and rollover source fields;
- reconnect and missed-interval observability;
- local raw retention and deterministic replay rights;
- no broker-order dependency and no order route;
- Owner approval of the exact provider, entitlement and bounded implementation scope.

## 5. Recommended disposition

`TWN_SOURCE_SELECTION = OWNER_DECISION_REQUIRED`.

```text
SOURCE_AND_LICENSE_BOUNDARY_AUDIT = PASS
SOURCE_AND_LICENSE_IMPLEMENTATION_GATE = BLOCKED
TWN_SOURCE_READINESS = BLOCKED_SOURCE_NOT_GOVERNED
PERSONAL_RESEARCH_SUITABILITY = UNKNOWN
INTERNAL_NON_DISPLAY_SUITABILITY = UNKNOWN
PRODUCT_REDISTRIBUTION_SUITABILITY = UNKNOWN
```

The boundary passes because the audit identified the licensing gate and performed no unauthorized access. It does not mean any candidate source is licensed or ready.

The technically preferred route is an SGX-authorized direct or vendor feed with explicit non-display research rights. Cost remains `UNKNOWN` until a written quote/use declaration is obtained. CRU-37 must not implement against an unlicensed website or silently substitute TX, MTWN, a CFD, ETF, or synthetic series.
