# CRU-61 structure and volume profile rules V1

This implements the Owner's 2026-11-04 CRU-61 candidate scope on the preserved
PR109 daily-use baseline `356d49500229410e826039672e16b0a36e2a0edf`. It does not
change existing CVD classification, source collection, official runtime, sample
promotion, or trading authorization. All results are research observations.

## Common boundary

Both pure cores require an exact `actualContract / tradeDate / session /
continuityEpoch / sourceLedgerIdentity` identity. Contract, DAY/NIGHT, trade-date,
source-generation or continuity changes require a separate state. A calendar
midnight alone does not reset an otherwise identical NIGHT segment. Callers must
use existing governed calendar and canonicalization; these cores do not infer
missing identities. Values must be actual finite numbers, never coercible nulls
or strings. Time must be an ISO timestamp with explicit timezone.

Appending copies the input state. Errors return no partially advanced state.
JSON round-trip continuation has the same result as a single full append. No
clock, file, network, collector, OHLC-to-trade synthesis or broker route exists
in these cores. Snapshot `cutoff` filters by availability; later data cannot alter
earlier snapshots. Passing a batch containing rows after an explicit append
cutoff fails rather than silently consuming future rows.

## Volume Profile

Input is existing CRU34 canonical `futures_tick` with usable identity and durable
availability, record hash, advancing physical ordinal, positive executed
`payload.close / payload.volume`. Simulated and marked duplicate rows are
rejected. Direction is irrelevant: lawful UNKNOWN executions count toward
volume. Quote matching or directional coverage is not capture completeness.
Canonical ordinals remain authoritative; late event timestamps do not reorder
observations. Timestamp extrema are displayed separately from first/last physical
availability.

- Default bins are one price unit, anchored at zero, `[floor(price/binSize) *
  binSize, (floor(price/binSize)+1) * binSize)`. Decimal inputs use their shortest
  round-trip decimal representation and integer quotient arithmetic, avoiding
  floating-point boundary drift. Bin size is explicit and versioned.
- POC is the maximum-volume bin's lower price. A tie selects the lower price.
- Default value area is 70% of observed executed volume. Start at POC, compare
  the immediately adjacent lower/upper bin, include the larger-volume side;
  equal volumes include the lower side first. Expand one bin per step until
  target volume is reached. VAL is included lower edge, VAH is **exclusive upper
  edge**. Zero-volume bins between observed prices are included geometrically.
- HVN means bins at least 70% of POC volume; LVN means bins at most 20%. These
  fixed descriptive thresholds include ties. They are neither optimized local
  extrema nor trading signals.
- Every eligible trade is included exactly once. The sum of bins equals total
  eligible executed volume. Empty input has null total/POC/VA, not zero. A zero
  bin inside the observed range is an observed price-bin count, not invented
  missing market data.
- Default output is `OBSERVED_FRAGMENT / partial=true`. A complete-session
  designation requires independently qualified evidence with matching identity,
  source artifact hash, proven start and capture completeness, matching first and
  last physical ordinals and total volume, and session end/proof availability no
  later than cutoff. The core validates correspondence; the adapter must verify
  the artifact and its qualification. The accepted evidence is retained.
- Prior complete profile selection is separate: same actual contract, different
  session identity, qualified proof and its cutoff already available. No proof
  means unavailable. End-of-session profiles cannot replace earlier event inputs.

Budgets: 25,000 input trades per append, 250,000 retained contributions, at most
20,000 bins across the entire price range. Normal append increments bins; current
snapshot reads bins and bounded metadata. An explicitly historical snapshot
reconstructs only its bounded prefix. No API should call it repeatedly over
unbounded history. Profile volume is成交量分布, not holdings, remaining inventory,
dealer cost, or the identity of buyers/sellers.

## Market Structure

Input is existing, confirmed closed OHLC with `time`, `endTime`, closure
`availableAt >= endTime`, exact identity and `closed=true`. Default period is 1m;
1m/5m/15m/30m/1h/4h are supported independently. Bar end must equal time plus the
declared width. Bars cannot overlap; availability cannot regress. An omitted bar
creates an explicit `STRUCTURE_RESET`, closes active inference as unavailable,
and requires fresh confirmation. No interpolation crosses the gap.

- Default pivot uses two bars left and two right. High/low must be strictly above/
  below every neighbor; ties are not pivots. `anchorTime` is the pivot bar, while
  `confirmedTime` and `availableAt` are the rightmost confirmation bar's end and
  actual closure availability. Historical chart anchoring is not earlier knowledge.
- Break means a strictly higher/lower closed price than the latest unbroken
  confirmed swing. Initial or same-direction break is BOS; opposite to the last
  confirmed break direction is CHOCH. Each pivot can break once. It is a
  deterministic price-structure convention, not an assertion of hidden orders.
- Sweep high/low means wick strictly crosses a confirmed swing, while the same
  bar closes at or back inside it. Equality at the close counts as reclaimed.
  It confirms only at that bar's closure. Repeated sweeps remain separate events.
- A later close back through a broken level emits `BREAK_FAILED` referencing the
  original event. It does not rewrite BOS/CHOCH or invent an opposite confirmed
  trend; a subsequent opposite break is needed for CHOCH.
- FVG uses three adjacent closed bars: third low above first high (UP), or third
  high below first low (DOWN). The strict wick gap is the zone. Anchor is first
  bar; confirmation is third close. FVG does not prove that no trades occurred.
- Order Block is the latest opposing body candle among the 12 immediately
  preceding bars within the current continuous segment, created only after
  BOS/CHOCH. UP uses last close<open; DOWN uses last close>open. Zone is full wick
  low/high; doji is not opposing. It does not identify institutional orders.
- Active UP zone invalidates on close strictly below its lower edge; DOWN on
  close strictly above upper edge. An FVG whose wick reaches the far edge without
  an adverse close becomes FILLED. Fill/invalidation are terminal; later price
  does not rewrite them. Order Blocks use close invalidation only. Gap/reset
  makes existing active zones UNAVAILABLE rather than assuming price invalidation.

Creation and every lifecycle transition are separate append-only event records.
Snapshots replay only already-available transitions. Exposed zones have their
own anchor, confirmation, availability and invalidation/fill/unavailable times.
Default cap is 20,000 bars; 256 active zones and 256 active unfailed breaks, with
explicit resource errors rather than dropping history. Terminal zones leave the
active scan but remain in bounded event history. No confidence, probability,
three-vote score, BUY/SELL or strategy promotion is produced.

## Verification scope

`node --test tests/volume-profile-core.test.mjs tests/market-structure-core.test.mjs`
checks conservation, bins/POC/VA ties, UNKNOWN, missing data, identity boundaries,
cross-midnight continuation, full/incremental/JSON restart parity, every historical
prefix, delayed pivots, BOS/CHOCH/sweeps, FVG/OB lifecycle, gaps and bounded failure.
These are synthetic engineering tests, not LIVE/history evidence, source
qualification or demonstrated trading effectiveness. Adapter/UI tests and real
data acceptance are separate deliverables.

## Existing Producer fragment adapter

`cvd-canonical-fragment.mjs` consumes the existing CRU34 Producer's validated
rolling canonical events, not overlapping Flow sums. It calls the same extracted
`accumulateCanonicalCvdEvents` and semantic projection as the raw CRU54 accumulator.
The selector is the existing CRU34 physical-order/identity/availability/quote-age
predicate. A single batched lookup selects one lawful quote per tick; the unchanged
Pressure function still calculates classification and cross-check. Identity-return
boundaries cannot reuse quotes that were cleared in between.

The initial observation starts at no more than the last 20,000 canonical events.
Its exact ordinal/time is disclosed; it never claims a session-open anchor.
Subsequent updates require the last consumed tick ordinal/hash to overlap
and consume only events newer than the highest consumed canonical ordinal. The
tick is the continuity witness because Producer retention may legally prune an
unused quote; the suffix cursor never regresses when that trailing quote disappears.
An older private cache without explicit tick-anchor fields recovers its witness
from the last sealed CVD series point. A missing tick overlap or source generation change
starts an explicitly labeled new fragment. A same-source rollback or conflicting
anchor/hash is an error. Terminal reconnect or invalid physical availability
removes the current CVD value without rewriting earlier history. The retained
250,000-point / 25,000-quote limits fail explicitly; there is no silent resetting
of cumulative CVD on timeframe change or resource pressure.

The quote limit is a **sustained-observation capacity limit**, not just a per-call
budget. Quotes accumulate across refreshes inside a segment. When the next quote
would exceed 25,000, `CVD_QUOTE_STATE_BUDGET` prevents publishing a partially
advanced derived checkpoint; the existing checkpoint is retained and the affected
request is unavailable. This version does not certify all-day LIVE capacity.
Arbitrarily removing quotes older than two seconds is not safe for future ticks
with regressing event timestamps, so the limit is not hidden by pruning, lowering
quality gates or moving the CVD origin.

`market-observation-producer.mjs` reads only the explicitly supplied existing
checkpoint path, at most 96 MiB. It validates canonical JSON spelling, sorted
unique keys, bounded nesting/record sizes, original safety flags and original
checkpoint checksum directly over bytes. It parses metadata and at most the last
20,000 event spans, not the full potentially large JSON object. The reduced tail
gets its own checksum, alongside the original checkpoint checksum, physical-byte
SHA256, retained ordinal range and original/retained counts; these identities are
never interchangeable. No original checksum is relabeled as a reduced artifact's
checksum. This read is not a raw-ledger re-scan or a new collector.

Private derived checkpoint writes are capped at 64 MiB and atomically renamed.
Warm unchanged source metadata avoids rehash/recount; after process restart the
persisted derived cache is checked and the source bytes are revalidated before
continuation. Missing/corrupt sources fail explicitly instead of reusing old data
as a successful update. `complete=true` in this adapter means the selected
Producer fragment suffix is caught up; profile capture remains partial and
session completeness remains unproven. Final API freshness uses source time,
not cache time or the latest request time.

LIVE requests may use `staged:true`: the first bounded request validates source
bytes and retains the reduced tail privately in memory, returning
`VERIFIED_SOURCE_PENDING_DERIVATION` with no observation state. A subsequent
request derives and persists that verified input. This leaves the existing
worker's 8-second deadline and 256-MiB limit unchanged. Clearing or losing the
worker cache requires verification again; there is no separate collector/listener.
If Producer publishes newer data between stages, the already-verified input can
still be derived, but the response is `complete:false` with
`newerPublicationPending:true` and `PRODUCER_VERIFIED_FRAGMENT_BEHIND_PUBLICATION`.
The next request verifies the newer publication. This prevents starvation without
presenting an older cutoff as caught up. Source-time TTL, selected identity and
quality restrictions still apply, and a missing source path returns an error.
