# CRU-21 source-time structure calculation contract

Scope: the Owner's time-quality / targets / R:R package. Candidate only; this
does not approve PR82, deployment, trading, or the whole product.

## Basis

Shioaji documents futures `time` as trade time and `datetime` as date/time.
Its market-data guide states callback datetimes are Taiwan market datetimes:

- https://sinotrade.github.io/tutor/market_data/streaming/futures/
- https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md

The bridge preserves that field and separately records local callback receipt.
`receivedAt < exchangeTimestamp` establishes clock disagreement. It neither
identifies the faulty clock nor establishes a true error bound; it does not by
itself demonstrate incorrect price buckets in the provider's time coordinates.
The former single PASS gate also disabled 5m ranges, pivots, levels and R:R.
This revision separates **current descriptive geometry in reported source-time
coordinates** from cross-clock chronology assurance. No clock accuracy is claimed.

## Additive capability and retained evidence

`structureEligibility`: schema `source-time-structure-v1`, basis
`REPORTED_SOURCE_TIME_GEOMETRY`, scope `LIVE_DESCRIPTIVE_ONLY`, state
`ELIGIBLE` or `BLOCKED`. This is calculation eligibility, never a quality upgrade.

Original timestamps, OHLC, volume, VWAP, qualityStatus, reasons, anomaly counts
and raw bytes stay unchanged. Cumulative VWAP/session extremes remain restricted
when their inputs contain anomalies. The separate capability describes the full
observed input set, without discarding old inputs or clearing their restrictions.
Existing `max(receivedAt, exchangeTimestamp)` availability remains in effect.
There is **no new clock-skew tolerance**, correction or session PASS relabeling.

LIVE-current 5m eligibility requires:

- The named executed-TX source, one matching actual contract/date/session, no
  rollover, and only the known timestamp restriction (or existing PASS).
  Missing/unknown quality, identity, recorded gaps or future violations reject it.
- Original records with matching product/code/target, positive price/volume,
  both source and raw receipt timestamps, closed execution flags and no recorded
  sequence gap. Payload and envelope agree at sub-ms precision; source time never
  goes backward (ties allowed). Input count and latest price/time match the chart.
- Included effective availability is at/before cutoff. Both latest source time
  and **raw receipt** meet the existing 120-second freshness limit. Effective
  availability alone cannot hide stale receipt; this is not clock synchronization.
- A completed bar has a real same-source event at/after its end, already received.
  `completionAvailableAt` binds that witness's effective availability. Pivots use
  all three completion witnesses; missing/forming bars cannot supply a pivot.
- Each value keeps its own identity, availability and quality checks. DAY OR
  needs its fixed input window and completion witness. NIGHT OR and missing prior
  references remain unavailable. No fabricated reference data.

REPLAY, explicit asOf and other timeframes gain no capability; their existing
per-value behavior stays unchanged. The cache does not certify a durable historic
knowledge-prefix cutoff. Feed completeness remains `UNKNOWN_NO_NATIVE_SEQUENCE`;
local gap=0 does not prove complete exchange capture.

Derived tick cache v2 preserves raw `sequenceGap` rather than coercing unknown
to zero. Legacy v1 caches are rebuilt from the untouched ledger before the new
capability can rely on them. This affects only derived caches in the selected
runtime's cacheRoot; it never rewrites raw Ledger or Producer checkpoints.

## Consumer impact and limits

Ranges, three-bar pivots, post-formation reactions, confluence, nodes and targets
may use this separate capability. Range scaling, ranking, CONTEXT exclusion and
directional boundaries stay unchanged. No target is extrapolated to fill a card.

R:R remains directional reward from confirmation to target divided by absolute
distance from confirmation to invalidation. It is price geometry, not win rate,
EV, entry advice or executable risk. Missing eligible directional target keeps
target=null and ratio=null with specific dependency/selection reasons.

Cross-clock restricted charts cannot satisfy price confirmation. Tick/Quote
matching, delay estimates, physical order and Flow quality gain no exception.
Execution/order flags remain false, formalWeight=0, researchOnly=true. Browser
display requires matching fresh chart/watch identities and both new capabilities;
it visibly retains clock restrictions. Bounded context preserves this scope.

## Verification

Focused tests cover unchanged evidence; delayed/future completion witnesses;
missing timestamps; sub-ms conflicts/regression; identity/sequence/unknown quality;
stale raw receipt; OR; REPLAY unchanged; qualified geometry and empty target
reasons; price/Flow not promoted; UI identity/freshness and visible warnings.

Actual acceptance must identify the same exact candidate SHA in real HTTP API
and browser, report real targets/ratios including null, retained limitations and
protected runtime identities. A direct loader run is not HTTP/browser evidence.
Synthetic PASS never proves market recovery. Clock synchronization stays unverified.
