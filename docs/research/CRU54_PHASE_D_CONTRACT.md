# CRU-54 Phase D — Market Handoff V1

Owner authorization daed163c-9390-41b7-a5f5-58be5717a3e7; GPT C PASS
06cc94fa-e5f5-4966-8eb7-1ee1a717058e. Continue exact accepted C
`73ae59772d14a7fb5553a8a43702be302044da9c`, same isolated branch / Draft PR68.
Approved formal main/runtime remains `d3702315b46a1a6c23384338ae40904b8bc589c2`.
Deferred Session Context decision125cf5c6 is a later follow-up after D review,
not part of this implementation. No Phase E, Merge or production rollout.

## Golden path and bounded scope

Accepted A/B/C artifacts -> unchanged C startup verification -> sealed canonical
prefix + accepted selected-window summaries -> existing governed session/calendar
resolver -> strict pairing -> price-only gap -> deterministic Handoff -> sealed D
bundle -> memory-only isolated API -> compact Market Handoff + accepted C UI.

Actual file allowlist: CRU54_PHASE_D_SCOPE.json. A/B/C calculation and artifact
code, frozen CRU34/44 and calendar are unchanged. C display copy and existing
candidate server receive only the optional D surface. C launcher still works.
No new classification, accumulation, provider, collector or TradingDay definition.

| Root | Access |
| --- | --- |
| Candidate data/cru54-private/output, chart, relationship | READ ONLY accepted artifacts |
| config/taifex-official-calendar-2026.json and existing session/CRU34/44 modules | READ ONLY |
| Primary data/live-events | No D reads; existing bounded A/B/C preparation only if explicitly invoked |
| Candidate data/cru54-private/handoff | New immutable hash-named D bundle |
| Candidate data/cru54-private/fixtures, evidence, candidate-runtime | New isolated ignored fixtures, evidence, private session receipt |
| approved-main-runtime, formal raw/evidence/SQLite, Scheduler, CRU52/9 | No mutation or control |

D preparation/startup never open raw. C dependencies rederive from their sealed
canonical context and A generation. D binds exact prior/current C hashes, D code,
session resolver and governed calendar file hashes. Startup checks/rederives once;
requests never load files or materialize. C32MiB input bound retained, D1MiB bundle,
128KiB/frame; all six frames, no unbounded scan. Atomic wx/fsync/link no-clobber
publication; failed publication leaves previous artifacts intact.

## Pairing and endpoint truth

Both sides must have TX actual month identity, lawful current C cutoff lineage,
matching A/B/C generation/semantic/sourceCutoff, and one usable continuous segment.
V1 refuses multiple/invalid/terminal-broken segments rather than inferring which
one represented the session open/close. This is a bounded limitation, not a new
continuity rule. Prior and current retain distinct segment origins and CVD values.

Resolve each side origin and cutoff through unchanged classifyTxChartSession:

* NIGHT -> DAY requires same governed tradeDate, resolver-proven prior NIGHT and
  a strictly later DAY start. Friday NIGHT -> Monday DAY is supported by the
  existing official calendar; do not infer a next calendar day.
* DAY -> next NIGHT resolves calendar-D15:00 through that SAME function and requires
  identical resulting NIGHT sessionId and governed tradeDate.
* Different actualContract, mixed real/synthetic provenance, missing lineage,
  nonadjacency, outside-calendar or unusable segment -> UNAVAILABLE/NOT_COMPARABLE.
* Prior terminal evidence must already be available at current cutoff. No past
  Handoff history or markers are generated; accepted C timeline stays unchanged.

Price endpoints come from the verified C canonical prefix with corresponding
accepted physical observations in that segment. Require lawful TX executed trade,
positive finite price/volume, usable identity/lineage, availableAt>=eventTime,
availableAt<=current side cutoff, and existing resolver/session bounds. Preserve
physical order; an eligible price time regression refuses the side. First/last
mean first/last lawful OBSERVED prices in this sealed fragment, not a claim of
official session open/close or complete capture. Excluded prices cannot be restored
from CVD, window displacement or OHLC interpolation. No quote prices.

`gapPoints = current.firstPrice.price - prior.lastPrice.price`, only after pairing
and price chronology/availability pass. Missing price -> null with exact reason.
Zero is a lawful flat price gap. Gap is explicitly OBSERVED_FRAGMENT endpoint
evidence; UI detail exposes both endpoint times and physical hash lineage.

Closed gap bounds are prior resolver sessionEnd -> current resolver sessionStart.
Inside this interval interpolation=false, cvd/volume/pressure/pathEfficiency=null.
No combined path/curve, cross-gap CVD subtraction or cross-gap Path computation.

## Evidence and deterministic precedence

Use SAME selected1m/5m/15m/30m/1h/4h C window for both sides. Prior terminal and
current evidence objects are copied unchanged, including deltaCvd, Price Response,
Pressure, Path, coverage, partial/observedSpan/requiredSpan, quality and lineage.
Pressure and delta are ONE family. Cumulative CVD remains a secondary per-side
value; it is not used to derive direction or Handoff change.

Clean direction requires accepted ALIGNED or ALIGNED_BUT_WEAKENING, complete
observed window, frozen quality READY, classifiedCoverage===1, exact delta/net-flow
parity, nonzero same-sign delta and Price Response. Capture remains UNPROVEN.
No threshold or formal direction gate changes.

Ordered rules, frozen before review:

1. Invalid/missing pair or price -> UNAVAILABLE.
2. Clean prior and clean opposite current -> OPPOSITE_TAKEOVER.
3. Clean prior, nonzero opposite-sign gap -> PRIOR_SESSION_REJECTED. "Clearly
   opposite" means an exact strictly opposite price sign; no magnitude threshold.
   This opening observation takes precedence over same-direction continuation,
   but never over clean opposite takeover. Current can still be partial; its
   limitation stays visible. This is not a reversal prediction.
4. Clean matching directions + accepted current ALIGNED_BUT_WEAKENING ->
   CONFIRMED_BUT_WEAKENING. No additional weakening rule is invented.
5. Clean matching directions -> CONFIRMED_CONTINUATION.
6. Otherwise lawful pair -> UNCONFIRMED_OR_CONFLICT with explicit limitations.

## Owner-facing copy freeze

| Relationship enum | First screen / Timeline / safe K marker |
| --- | --- |
| ALIGNED | 力價同步中 |
| ALIGNED_BUT_WEAKENING | 同向但轉弱 |
| PRESSURE_RESPONSE_MISMATCH | 力價不同步 |
| OPPOSITE_DIVERGENCE | 力價反方向 |
| MIXED_OR_QUALITY_LIMITED | 證據有分歧 |
| UNAVAILABLE | 暫無法判讀 |

| Handoff enum | Label |
| --- | --- |
| CONFIRMED_CONTINUATION | 延續獲確認 |
| CONFIRMED_BUT_WEAKENING | 延續但轉弱 |
| PRIOR_SESSION_REJECTED | 前勢遭拒絕 |
| OPPOSITE_TAKEOVER | 反向已接手 |
| UNCONFIRMED_OR_CONFLICT | 尚未獲確認 |
| UNAVAILABLE | 暫無法判讀 |

Compact first screen: previous | dashed closed gap | current. Same-window price
and delta, five-character relation, source kind, partial/coverage and exact failure
reason. Dominant current K/Volume/CVD/delta panes stay separate from prior context.
No arrow wall or new Handoff K markers. Detail keeps technical evidence.

## Commands, verification and stop

`node scripts/prepare-cvd-handoff.mjs <prior-C-hash|none> <current-C-hash>`
`node scripts/start-cvd-handoff.mjs <D-hash>`
`node scripts/audit-cru54-phase-d.mjs`

Clean isolated exact branch/HEAD, local vendor, loopback3054 exclusive binding,
private8h session/Host/Origin/CSP protections retained. Only positively identified
own CRU54 candidate can be replaced. GET/api/handoff adds current binding, selected
frame, prior/current evidence, pair/gap/reason and method; no write/order routes.
UI checks current HEAD/generation/semantic/cutoff/frame before showing Handoff.

Known real DAY2026-09-07 and NIGHTtradeDate2026-09-14 must refuse adjacency.
Synthetic state fixtures explicitly SYNTHETIC; never presented as real acceptance.
Verify all six states, dates/rollover/missing prices/lineage/partial/as-of, no raw
requests, A/B/C regressions, artifact integrity and publication failures. Level3
current plus two independent review contexts at exact final HEAD, CI, real and
synthetic API/browser evidence at1920x1080/1536x864/1366x768, unchanged formal proof.

GitHub -> Linear -> read-back. Engineering only; not Phase E/L5/Owner acceptance.
Stop CRU54_PHASE_D_MARKET_HANDOFF_READY_FOR_GPT_REVIEW.
formalWeight=0; researchOnly=true; executionAuthorized=false; orderRoutesEnabled=false.
LOCAL_ONLY_RESULT=NOT_COMPLETE.
