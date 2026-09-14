# CRU-54 Phase C — Change-first Relationship Layer V1

Owner authorization: Linear ba844355-4685-4872-8e30-f6f032ea1b14.
GPT Phase B PASS: ed67c969-e072-47c2-b68c-9015856a2c02.
Continue accepted B `7f6bd0f8f8f4ae0a638bdc40513fdc5850f3caa9`, same branch/PR68.
Formal main/runtime remains `d3702315b46a1a6c23384338ae40904b8bc589c2`.

## Golden path and isolation

Accepted A immutable generation + accepted B chart bundle + same hash-verified raw
prefix (explicit offline preparation only) -> unchanged CRU34 canonical and window
functions -> bounded C projection -> memory-only API -> Relationship / Change Bar /
K / Volume / cumulative CVD / delta micro-pane / Timeline. No second accumulator.

The Phase C scope manifest is the actual file allowlist. A files and governed
CRU34/CRU44/chart/calendar/production files are unchanged. B server adds an optional
memory projection endpoint; absent C data, its B behavior is retained. C has separate
assets/launcher so original B UI and artifacts remain reproducible.

| Resource | Access |
| --- | --- |
| Primary `data/live-events` explicitly A-bound file | READ ONLY exact prefix, <=64MiB, during preparation only |
| Candidate `data/cru54-private/output` | READ ONLY accepted A generations/pointers |
| Candidate `data/cru54-private/chart` | READ ONLY accepted B bundles |
| Governed config/canonical/CRU34/44/price modules | READ ONLY frozen dependency semantics |
| Candidate `data/cru54-private/relationship` | New content-hash sealed C bundles, atomic no-clobber publication |
| Candidate `data/cru54-private/fixtures`, `evidence`, `candidate-runtime` | Isolated ignored synthetic inputs, evidence, private session receipt |
| Formal runtime, Scheduler, SQLite, CRU52/CRU9/raw/evidence roots | No writes or runtime control |

Preparation and startup verify A/B identities; C bundles also bind exact C/frozen
derivation file hashes. Startup recomputes projection from sealed canonical context
and A series, without reading raw. Requests only access memory. Missing/corrupt/
changed source or projection fails closed; no fallback to an unrelated bundle.
Private canonical payload contains only fields consumed by unchanged CRU34 functions.
No raw/checkpoint/token is sent to the browser or uploaded remotely.

## One cutoff, two clocks

Every observation has one real TX tick cutoff: sourceLedgerIdentity,
cutoffLedgerOrdinal, cutoffRecordHash and cutoff.availableAt. Metric inputs are
physical prefix records <= that ordinal and availableAt. Window anchor is the real
cutoff eventTime. Emission/decision time is cutoff.availableAt, never eventTime.
Historical observations are evaluated independently at their own physical prefix;
later delayed earlier-event records cannot change those observations.

All inputs also share actualContract/tradeDate/session/continuityEpoch and accepted
A segment ordinal fence. Identity A->B->A cannot pool disjoint A portions even when
canonical continuityEpoch matches. Prior eligible quote context is limited to the
same identity since the last identity/segment boundary, preserving quote cross-check.

Current W=(anchor-W,anchor]; previous W=(anchor-2W,anchor-W]. Prior evidence uses the
same actual cutoff lineage and a shifted evaluation bound passed to the unchanged
CRU34 window builder. The bound descriptor is never a fabricated tick or earlier
decision. Pressure, response and path use the same membership and physical order.
CRU44 registry supplies all six window lengths; CRU34 path minimum3 ticks/max30s
gap and complete-classification formal direction gate remain unchanged.

## Delta, partial windows and equal-window comparison

For each accepted cumulative point in the selected event-time window, read its
BUY-SELL cumulative difference from its preceding physical point in the SAME A
segment; sum those differences. This supports non-contiguous physical membership
for delayed earlier events. It never sorts the series, reclassifies tick_type or
creates a persistent CVD accumulator. First point uses the accepted segment origin.
When a cumulative point is null because of invalid evidence, do not recover its
value from numeric counters. Null solely due to no classified history may contribute
zero classified increment; a whole UNKNOWN-only window keeps delta=null.
UNKNOWN volume remains a separate frozen Pressure field.

Whenever delta and unchanged CRU34 netAggressiveFlowProxy exist, exact equality is
required; any mismatch aborts preparation. This is the same executed-flow evidence
family, not two independent votes.

Full observed-window support requires BOTH event-anchor elapsed span and the CRU44
available-time warmup span to reach W (2W for previous). Their minimum is displayed.
It does not prove capture completeness. Short windows keep descriptive observed
values with PARTIAL/WINDOW_INCOMPLETE and observed seconds / required seconds.
Never label a 43-second fragment as a complete15m delta. Prior comparisons require
both supported equal windows in the same segment and valid corresponding numbers;
otherwise explicit "前窗不可比較". Magnitude comparisons: opposite nonzero signs ->
方向翻轉; absolute greater/less/equal -> 較前窗放大/較前窗縮小/持平.
No normalization, strength score, percentile, z-score or predictive acceleration.

## Deterministic relationship rules (ordered)

1. Illegal/missing cutoff, accepted CVD invalid gap or unavailable window -> UNAVAILABLE.
2. Determine descriptive relation once using delta sign vs frozen price displacement:
   nonzero flow + zero displacement -> PRESSURE_RESPONSE_MISMATCH;
   same nonzero signs -> ALIGNED; opposite signs -> OPPOSITE_DIVERGENCE.
3. Incomplete observed window, classifiedCoverage!=1, frozen quality!=READY, zero
   classified flow, or insufficient combination -> MIXED_OR_QUALITY_LIMITED.
   Where available, retain the descriptive relation underneath with explicit quality
   limitation; this never becomes Formal Direction or Promotion.
4. Clean ALIGNED becomes ALIGNED_BUT_WEAKENING only when previous equal window is
   complete/READY, prior flow and response share current directions, and at least
   one is strictly smaller: absolute delta, absolute displacement, or Path Efficiency.
   No threshold or score; any one deterioration suffices, documented as descriptive.
5. Otherwise retain clean ALIGNED / MISMATCH / OPPOSITE.

Pressure ratio is displayed with classifiedCoverage and its unchanged formal
direction gate. Path gaps/regression/insufficient ticks/zero path remain explicit.
Capture unproven does not erase valid descriptive evidence or authorize promotion.

## Bounded timeline, histogram and markers

At most1024 accepted physical tick observations,25000 canonical events,256 transitions,
2MiB/frame and32MiB sealed bundle. All budgets fail explicitly, no silent sampling
of relationship states. Six bounded frames prepared once; no request derivation.
Identical consecutive codes collapse. Initial state/segment restart is not an event;
same-code collapse never joins different segments. Quality/unavailable transitions
are retained in Timeline. Current source tail invalidation is explicitly unavailable;
historical observations retain their lawful earlier cutoff identity.
Invalid/missing/non-monotonic availability stays as an untimed unavailable observation;
it cannot create a timeline event (in particular null never becomes epoch zero),
and breaks state-transition comparison until a lawful new observation starts.

Histogram values are selected-window rolling cumulative differences at availableAt,
not another CVD level or additive disjoint bars. Overlapping values MUST NOT be summed.
Partial points are amber and labelled. Nulls are whitespace; separate segments stay
separate. Same-millisecond display coalesces to final physical value only, as in B.

High-value K markers require a real transition between clean descriptive states.
Place on first existing same-identity bar START >= decision availableAt, wholly
inside the accepted segment's observed availability bounds, with no other segment
overlap. If no such bar, omit marker; Timeline retains exact decision time/ordinal.
Do not use an earlier containing candle. At most the latest8 eligible markers and
latest8 timeline events are shown, with totals and omission reason visible.
Markers are circles with state-transition text, never trade arrows/predictions.

## API, launcher, UI and tests

`node scripts/prepare-cvd-relationship.mjs <A-runId> <B-bundleHash>`.
`node scripts/start-cvd-relationship.mjs <C-bundleHash>` requires clean exact isolated
worktree, local vendor and verified bundles. Loopback3054 exclusively; no takeover.
Only a positively identified prior CRU54 candidate may be replaced during delivery.
Existing Host/Origin/session/8h expiry/CSP/no-store guards are retained.
GET/api/cvd returns accepted B chart plus current loaded identity.
GET/api/relationship?timeframe=1m|5m|15m|30m|1h|4h returns bounded summary/current/prior,
comparisons, physical observations, timeline, safe markers, lineage, bounds and truth.
GET/api/identity identifies ISOLATED_PHASE_C. Bad query400,unauth401,origin403,
missing projection503, no write/order endpoints. Both API payloads must match
head/generation/semantic/cutoff before rendering.

First screen: Relationship -> Change Bar -> dominant K -> Volume -> CVD -> delta.
Cumulative level is secondary. Details expose lineage/observed origin/capture/clock
differences; Timeline uses system-could-know time. Loading failures clear old facts.
Real DAY/NIGHT partial and synthetic relationship cases are reported separately.
Mandatory A/B regression, as-of/parity/identity/partial/prior/state/transition/marker/
memory-only API tests, independent Level3 review, CI and1920/1536/1366 browser checks.

No Phase D, handoff, predictions, strategy/execution, formal deployment or Merge.
No L5/Product Ready or Owner acceptance claim.
Stop CRU54_PHASE_C_CHANGE_RELATIONSHIP_READY_FOR_GPT_REVIEW.
`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`.
`LOCAL_ONLY_RESULT=NOT_COMPLETE`.
