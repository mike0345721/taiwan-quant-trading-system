# CRU-54 Phase B — isolated CVD read projection and chart

Owner authorization: Linear ba0d3168-f92e-4556-a1e8-f371734bd0ec, 2026-09-14.
GPT Phase A PASS: 7f136171-490f-45c9-b753-5168968eae0b.
Continue the same branch and Draft PR68 from accepted Phase A
`c0949e045611df06624931dc08f47f1d01491c7c`; approved main remains
`d3702315b46a1a6c23384338ae40904b8bc589c2`. No merge/rebase/cherry-pick.

## Golden path and data roots

Verified Phase A immutable generation -> bounded offline price/context preparation
-> sealed chart bundle -> startup validation -> memory-only read API -> one chart
with K-line, thin Volume pane and independent CVD Y-scale, sharing horizontal time/range.
This is an isolated historical feature candidate, not the complete Dashboard or live feed.

All fourteen Phase B files are additive in CRU54_PHASE_B_SCOPE.json. Phase A's ten
accepted files and existing CRU34/CRU44/chart/runtime/server/public/package/test-lane
implementations remain unchanged. Phase A's historical scope audit retains its original
meaning; use `node scripts/audit-cru54-phase-b.mjs` for this phase.

| Root / resource | Access / purpose |
| --- | --- |
| Primary data/live-events, explicitly bound NDJSON | READ ONLY during explicit preparation, same consumed prefix only |
| Candidate data/cru54-private/output/runId | READ ONLY Phase A generation and pointer |
| Candidate config + unchanged chart/canonical modules | READ ONLY governed semantics |
| Candidate data/cru54-private/chart | New content-hash bundle, atomic no-clobber publication |
| Candidate data/cru54-private/fixtures | Synthetic fault-test inputs only |
| Candidate data/cru54-private/evidence | New engineering receipts/screenshots only |
| Candidate data/cru54-private/candidate-runtime | Private session bootstrap receipt, ignored; never upload tokens |
| Candidate node_modules | Locked existing lightweight-charts5.2.0 dependency installed locally |
| Approved runtime, SQLite, CRU52/CRU9 evidence, Scheduler | No writes, no binding, no new collector/process control |

## Preparation and bounded projection

Phase A has no price field. Explicit preparation reads at most64MiB of its exact
source prefix, verifies byte hash/cutoff/source binding, then reuses unchanged
buildOneMinuteBars/aggregateChartBars for price context. CVD values are selected
directly from Phase A semantic series: no new sum/classification/materializer.
Price's existing timestamp exclusions are counted and disclosed; its lawful ticks
may differ from CVD. No availability timestamp repair or fake K/Volume value.

Maximum16 segments,4000 CVD display points total,1000 price bars per timeframe,
2MiB response per frame,12MiB prepared bundle,128MiB inherited Phase A generation.
Over-budget inputs fail explicitly, never silently drop a segment/reset an origin.
Selection retains physical first/last and bucket min/max, plus every null transition;
too many gap transitions fail the point budget. CVD physical ordering is never sorted
by event time. Equal availableAt milliseconds display the final physical value only,
with coalescing disclosed; full accumulation and immutable history stay in Phase A.

Each segment is drawn independently; null points split paths. Reconnect/quote-only
terminal invalidation keeps currentCvd=null while the previous visible curve is
labelled historical. Regressive/missing plotting time produces an explicit blank
segment, distinct from its semantic value. CVD axis uses canonical availableAt;
price bars use the existing exchange-event bucket time. Both share chronological
horizontal coordinates and retain this clock distinction visibly.

Origin raw eventTime and availableAt are retained alongside canonical numeric epoch
fields for display. Browser timezone cannot reinterpret a timezone-less Taipei stamp.
`sessionStartProven=false` renders “actual time 起算｜觀測片段”, never “從開盤累積”.
Scope remains OBSERVED_FRAGMENT; classifiedCoverage != capture completeness.

## API and runtime

`node scripts/prepare-cvd-chart.mjs <phase-a-run-id>` creates a new verified bundle.
`node scripts/start-cvd-candidate.mjs <bundle-hash>` requires a clean exact candidate
worktree and its own installed vendor asset. It loads/verifies the bundle against
the current Phase A pointer and recomputes only presentation once at startup.
The server retains six bounded frames and fixed assets in memory. No request has
a ledger path, fs read, raw scan, generation parse, CVD calculation or data write.
Advancing the pinned source requires explicit new preparation and candidate restart.

Port3054 binds only127.0.0.1, exclusive; occupied port fails, no takeover. Exact Host,
Origin and Sec-Fetch-Site checks prevent cross-site access. A random per-process local
bootstrap secret exchanges at POST/session for HttpOnly SameSite=Strict cookie;
API requires the session, bounded POST body and server-side8-hour expiration.
The token is in an ignored local session receipt, never in logs/PR. URL fragment
bootstrap is removed immediately from page history. No formal credentials/auth routes
are imported or relaxed. Static login shell contains no market data. CSP/no-store/
no-sniff/no-referrer/frame-deny are applied. No POST data/order routes exist.

- GET/api/identity: loaded exact HEAD, isolated mode, safety and zero-request-raw-read contract.
- GET/api/cvd?timeframe=1m|5m|15m|30m|1h|4h: identity/contract/date/session/continuity,
  observed origin, scope/sessionStartProven/capture, currentCvd, bounded segments and
  bars, independent buy/sell/unknown totals, coverage/quality, current and last-trade
  availability, freshness/reasons, generation/semantic/prefix/cutoff hashes.
- Unknown timeframe/query400; unauthenticated/expired401; hostile origin403;
  unknown route404; unsupported method405; missing projection503 with reason.
- Missing/corrupt/mismatched startup artifacts fail before binding, not stale fallback.

Freshness uses lastTradeAvailableAt and current availability; request time only assesses
age. Fixed historical generations never become LIVE. STALE, partial, unknown and
unavailable are explained. No bare dash means missing data. Timeframe changes only
price aggregation; the CVD series/origin/cutoff/final endpoint remain identical.

## Verification and limits

Focused tests cover semantic endpoint/UNKNOWN/origin/segments/null/clock/budgets,
HTTP auth/origin/query/failure behavior, zero request fs access, and isolated artifact
preparation/integrity/atomic-failure retry. Relevant existing chart regressions and
CI are required. Artifact CI uses a separate local clone/worktree to avoid racing
Phase A's existing worktree test; no isolation bypass or changed CI lanes.
Real governed DAY and NIGHT data are checked separately from synthetic faults.
Browser checks use the same loaded candidate, all six timeframes, shared panes,
negative states and representative desktop viewports. Screenshots/receipts remain
private locally; sanitized findings/hashes/commands are reported on PR68 then Linear
with read-back. Level3 independent semantic and security/I/O review applies.

Finite sample limits remain: not full-session capture, not all-day capacity, no
cross-file/midnight continuity certification. NIGHT may have no legal price bars
under existing clock checks; display blank with exclusion reason, not substituted
price. Sampling/coalescing is presentation loss, never deletion from Phase A.
No periodic producer refresh, full Dashboard integration or L5 Product Ready claim.

Stop at CRU54_PHASE_B_API_CVD_CHART_READY_FOR_GPT_REVIEW. No Phase C/D, Change Bar,
Relationship, Handoff, Options, interpretation/signals, Strategy/Risk/Position,
Broker/Order/Execution, Merge or formal rollout.

`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`.
`LOCAL_ONLY_RESULT=NOT_COMPLETE`.
