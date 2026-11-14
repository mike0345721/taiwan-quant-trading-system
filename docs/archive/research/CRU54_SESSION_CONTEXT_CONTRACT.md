# CRU-54 Session Context V1

Owner READY 1dec2ff0-8cdd-4dd4-8e11-d95526c71403, D GPT PASS
70498cab-3fbd-47d3-a834-fc23cda79a25, deferred decision125cf5c6.
Continue exact accepted D b012da2b78b5b603004e438017d7b1a0585a0e16,
same isolated branch / Draft PR68. Formal main/runtime stays d3702315b46a1a6c23384338ae40904b8bc589c2.
Actual allowlist: CRU54_SESSION_CONTEXT_SCOPE.json. No Phase E or Merge.

## Semantics and producer chain

Validated A generation/cumulative series + unchanged accepted C sealed canonical
context and B charts → one lawful session/segment → frozen CRU34/44 pressure,
response and path functions → bounded Session Context seal → startup verification
→ memory-only API and compact background row. No new classifier/accumulator,
TradingDay, provider, formal producer or raw reader.

V1 inherits D's strict single-segment envelope. Multiple/broken segments, mixed
identity, invalid lineage/null gaps or accepted hash/binding mismatch fail closed.
All tick membership is the exact physical series origin through last trade cutoff.
Earlier same-identity quotes may support unchanged frozen quote cross-check only.
Origin and cutoff retain both eventTime and availableAt. Events are not sorted.

Context delta = accepted current cumulative value minus the accepted segment's
pre-first-trade baseline zero. First trade is included, not subtracted away. No
classified volume means null, not zero. CVD and total/buy/sell/UNKNOWN volumes
must equal frozen pressure evidence over the same inclusive observed interval.
No same tick is accumulated again. Pressure and delta are one evidence family.

The existing frozen response/path calculation receives this same fenced interval,
using windowMs=lastEventMs-originEventMs+1 to include the first tick, with unchanged
minimum tick and maximum path-gap rules. It is not a registered fixed timeframe.
The accepted canonical availableAt semantics are preserved, including local-clock
skew tolerated by CRU34. D's stricter availableAt>=eventTime price endpoint check
is retained separately: Price delta can be null while frozen Response/CVD remain
available. No endpoint is reconstructed from Response, bars or CVD.

## Scope and proof

Scope is SESSION_TO_NOW only when BOTH validated accepted A segment and B chart
carry sessionStartProven=true and the observed origin matches the existing resolver
sessionStart. Otherwise lawful evidence is OBSERVED_SEGMENT_TO_NOW, with exact
origin; invalid evidence is UNAVAILABLE. Matching the opening timestamp alone
never creates proof. The current production A producer always sets false; this
follow-up adds no proof producer. True proof branches are explicitly synthetic
tests only. Capture completeness stays UNPROVEN even in those fixtures.

Labels: DAY｜本日盤中累積 / NIGHT｜本夜盤累積 require positive proof;
otherwise DAY｜觀測累積 / NIGHT｜觀測累積. Invalid scope: 暫無法判讀.
No inference of full-session capture, official open/close or missing history.

Context complete=true means the supplied observed interval is evaluated, never
capture completeness or a complete fixed window. No 1h/4h warmup gate applies.
Fixed 1m/5m/15m/30m/1h/4h artifacts, warming/partial flags and timelines stay
unchanged. Context Relationship reuses accepted classifier with no previous
equal-window comparison; it does not invent session-to-now weakening thresholds.

## Handoff and opening truth

Session Context is primary prior/current background. Existing D pairing, calendar,
contract and price endpoint checks remain. Fixed-window evidence is retained as
recentChange detail, never used to pretend the session background is complete.
DAY/NIGHT CVD and Path remain independent. Gap activity stays null/no interpolation.

Gap is always labeled 觀測片段端點差. D has no independently proven official prior
close, so even current-start proof does not establish official close→open gap.
If legacy D classification would emit PRIOR_SESSION_REJECTED, this runtime fails
closed to UNCONFIRMED_OR_CONFLICT / OFFICIAL_OPEN_CLOSE_BOUNDARIES_UNPROVEN.
This conservative guard is authorized; no new official-close proof is invented.
Clean opposite takeover retains precedence and descriptive continuation can still
be observed. Invalid session context invalidates Handoff. Old accepted D projection
and its tests remain frozen; the new Session Context runtime applies this guard.

## Read/write map and boundaries

| Input / output | Access |
| --- | --- |
| Candidate data/cru54-private/output, chart, relationship | Read-only accepted artifacts |
| Existing calendar/session/CRU34/44 code | Read-only; unchanged |
| Formal raw/data/evidence/SQLite and approved-main-runtime | No writes; no Session Context raw reads |
| data/cru54-private/session-context | New hash-named immutable bundles |
| data/cru54-private/fixtures, evidence, candidate-runtime | Isolated ignored new fixtures/receipts/screenshots |
| Scheduler/CRU52/CRU9/formal process or ports | No control or mutation |

C input32MiB, Session Context bundle1MiB, six bounded Handoff frames, accepted
1024-point/25000-event limits retained. Startup rederives from sealed inputs once;
request handlers have no fs/materializer/classifier dependency. Code/calendar hashes
bind the artifact. Atomic wx/fsync/link publication preserves older artifacts on error.
Existing loopback3054, private8h auth, Host/Origin/CSP and clean exact HEAD checks stay.
Only positively identified own isolated candidate may be replaced.

GET /api/session-context has no timeframe/query. GET /api/handoff continues to
accept fixed frame as recent-change detail. Generation/semantic/cutoff binding and
freshness remain explicit. Pinned historical data never becomes LIVE.

## Verification and delivery

Focused context, true/false DAY/NIGHT proof, UNKNOWN, identity/continuity/lineage,
CVD/volume/pressure parity, path/response fences, opening rejection guard, fixed
window independence, raw/filesystem traps, artifact corruption/publication and
A/B/C/D regressions. Final exact-head CI and Level3 current + two independent
reviews. Real DAY and NIGHT + clearly labeled synthetic browser at1920x1080,
1536x864,1366x768; K stays dominant, no overflow/blocking console errors.

Commands: node scripts/prepare-cvd-session-context.mjs <prior-C-hash|none> <current-C-hash>
and node scripts/start-cvd-session-context.mjs <bundle-hash>.
Scope audit: node scripts/audit-cru54-session-context.mjs.
GitHub → Linear → remote read-back. Notion only for new material durable semantics.
Stop CRU54_SESSION_CONTEXT_V1_READY_FOR_GPT_REVIEW. Engineering only, not Phase E,
L5 Product Ready or Owner acceptance. No deployment, Merge or automatic follow-up.
formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false.
LOCAL_ONLY_RESULT=NOT_COMPLETE.
