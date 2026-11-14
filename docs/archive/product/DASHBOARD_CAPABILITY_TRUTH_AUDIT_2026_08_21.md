# Dashboard Capability Truth Audit — 2026-08-21

Captured at: `2026-08-21T10:48:36+08:00`  
Formal endpoint audited: `http://127.0.0.1:8787/`  
Approved main at audit start: `3a6031bf2aa3203dfd6bd44dab7b2d383a81637a`  
Scope: current-workspace identity repair and evidence-based capability inventory only.

This document is a captured operational/product checkpoint. It does not authorize a collector, evidence promotion, strategy, risk, execution, or production activation. Linear remains the live CURRENT/NEXT authority.

## 1. Executive truth

- The formal chart had a coherent current identity: `2026-08-21 / TXFI6 / DAY`.
- The Decision Snapshot did not. It selected chart `tradeDate`, historical Forward `sessionId=2026-08-12-DAY`, and an EOD/batch contract. That tuple never described one governed observation.
- The repaired contract accepts the atomic `tradeDate / actualContract / session` identity from the governed TX chart only. Missing or internally inconsistent chart identity fails closed.
- Historical Forward status remains immutable and separate: latest official status is `2026-08-12 / MISSED / NO_LEGAL_PREMARKET_SNAPSHOT`. No later legal lifecycle was found in the active official run. Current project status also reports scheduler readiness unavailable and runtime-binding drift; this is historical research/operational lifecycle status, not today's market state.
- The current dashboard contains useful live price structure and descriptive batch context. It does not contain promoted directional evidence, true CVD, true Top-10 contribution, true NQ, live TXO intelligence, or a contrary-evidence derivation.
- Unattended collection readiness is `PARTIAL`: 8787 and the 8790 market-data-only bridge are healthy now, but the 8791 supervisor is not activated and the queried formal Scheduled Tasks were unavailable to the current process.

## 2. Current identity contract

`CURRENT WORKSPACE` and `FORWARD RESEARCH STATUS` are separate namespaces.

### Current workspace

Source: `GOVERNED_TX_CHART`

Required atomic fields:

- `tradeDate`
- `actualContract`
- `session`

Rules:

1. All three fields must exist on the governed chart.
2. Any non-empty bar-level identity must equal the chart root identity.
3. Historical Forward state and EOD/batch contracts never fill current identity fields.
4. An incomplete or mixed identity becomes `UNAVAILABLE` with `CURRENT_CHART_IDENTITY_INCOMPLETE` or `CURRENT_CHART_IDENTITY_MISMATCH`.
5. Copy for ChatGPT carries the same locked snapshot identity and its source/reason.

### Forward research status

Role: `HISTORICAL_RESEARCH_STATUS` plus `RESEARCH_LIFECYCLE` observability.

- Latest official trade date: `2026-08-12`
- Official status: `MISSED`
- Reason: `NO_LEGAL_PREMARKET_SNAPSHOT`
- Last successful stage: `TRADING_DAY_CHECK`
- Failed stage: `INPUT_AVAILABILITY_CHECK`
- Evidence source: official append-only Forward ledger
- Active runtime lineage: `market-state-v1-2026-08-11-recovery-0a85ab8`

The old record remains visible and must not be hidden or rewritten. Suggested label: `Forward Shadow 歷史研究狀態（最新正式紀錄：2026-08-12 MISSED）`.

## 3. Evidence captured

### Runtime

| Item | Observed truth |
|---|---|
| 8787 | Reachable; runtime identity `VERIFIED`; runtime commit matched approved main before this branch fix |
| 8790 | Healthy, `market_data_only`, one observed bridge PID, writer PASS. Formal validation restart exposed the existing parent-child coupling described below. |
| Required subscriptions | TX, MTX, TMF, 2330, IX0001 all RESTORED |
| 8791 | Not active; continuity supervisor production activation remains Owner-gated |
| Native sequence | `UNAVAILABLE` |
| Packet-loss certainty | `UNKNOWN_NO_NATIVE_SEQUENCE` |
| Timestamp lineage | `QUALITY_INSUFFICIENT`; bounded project-status tail observed 27 violations |

### Current chart

All chart frames used the current `2026-08-21 / TXFI6 / DAY` governed identity at capture time.

| Frame | Status | Bars | Notes |
|---|---:|---:|---|
| 1m | READY | 119 | Live/replay-deterministic chart derivation |
| 5m | READY | 24 | Default Decision Workspace chart |
| 15m | READY | 8 | Same governed anchor |
| 30m | READY | 4 | Same governed anchor |
| 1h | READY | 2 | Same governed anchor |
| 4h | READY | 1 | Same governed anchor |
| 1D | FORMING | 1 | `NIGHT_PLUS_DAY`, complete observed session coverage, day window still forming |

Across frames: `futureDataViolations=0`; quality remains `QUALITY_INSUFFICIENT` because timestamp lineage is not proven. DAY Opening Range was READY (`45073 / 44833`) under Frozen T0 `08:45–09:00`. DAY session VWAP and session high/low were available. RVOL was not implemented.

### Batch and research data

`data/latest.json` at capture: `asOfDate=2026-08-21`, generated at `2026-08-21T02:46:27.374Z`.

- Market overview: Yahoo Finance, `2026-08-21`, current; TWII/OTC, USD/TWD and VIX context.
- Taiwan VIX: TAIFEX TAIWAN VIX, `2026-08-20`, pending publication/stale.
- Breadth: TWSE/TPEx, `2026-08-20`, pending publication/stale; listed `778/228/59`, OTC `485/293/89`.
- Cash institutional: TWSE BFI82U, `2026-08-20`, EOD/stale.
- Futures market: TAIFEX official futures CSV, `2026-08-21`, batch current; only a night `202609` row in the snapshot. It is not the live chart identity.
- Futures institutional: TAIFEX Institutional, `2026-08-19`, EOD/stale. Foreign net `-81,501`; trust net `74,789`; dealer net `2,562`.
- Options: TAIFEX official options CSV, `2026-08-20`, EOD; selected weekly `202608F3`, OI P/C `0.9036`, call wall `47500`, put wall `43000`, max pain `44600`.
- Research SQLite: SOX through `2026-08-20` (`11800.0186`, +0.5264%); NDX proxy through `2026-08-20`; USD/TWD through `2026-08-21`. These rows are research/batch context, not true intraday NQ.

## 4. Futures institutional zero-delta finding

The institutional values are not real-time. They are EOD TAIFEX institutional data, and the current source is stale at `2026-08-19`.

`foreignNetDelta=0` is **not proven true zero**. `src/market-data.mjs` emits literal zero when no different comparable previous trade date is available and separately emits `deltaAvailable=false`. Here the current and comparison snapshots both resolve to the same stale data date, so comparison is unavailable. The DW-4 descriptive card currently prints the numeric sentinel without checking `deltaAvailable`; this is a truthful-display defect to fix separately, not authorization to change the source or infer a delta.

## 5. Capability matrix

Priority meanings: P0 current-truth bug; P1 already-have-data/low-cost truthful wiring; P2 high-value collection or activation; P3 source gap; P4 future intelligence.

| Priority | Capability | Visible today | Actually usable | Mode/source | Latest identity | Quality / promotion | Problem | Exact next action | Linear |
|---|---|---|---|---|---|---|---|---|---|
| P0 | Current workspace identity | Yes | No before fix; candidate fixed | Governed TX chart | `2026-08-21/TXFI6/DAY` | Chart quality insufficient; identity is descriptive | Mixed chart, historical Forward and batch identities | Merge this bounded identity fix after Owner review | CRU-21 |
| P0 | Futures institutional daily change | Yes | No as currently rendered | TAIFEX Institutional EOD | `2026-08-19` | STALE, NOT_PROMOTED | `0` is unavailable sentinel while `deltaAvailable=false` | Gate display on `deltaAvailable`; show unavailable reason | CRU-21 |
| P0 | Forward Shadow role | Yes | Historical status only | Official immutable Forward ledger | `2026-08-12/DAY/MISSED` | HISTORICAL_ONLY | Can be mistaken for today's state | Relabel as historical research/lifecycle status; do not backfill | CRU-21 / CRU-23 |
| P0 | Live-source Data Health identity | Data Health/detail | Not truthful as current identity | Current bridge health + `2026-07-30` acceptance audit | UI shows old `TXFH6/MXFH6/TMFH6` audit identity while bridge is on `*FI6` | Mixed historical capability/current freshness | `auditedLiveRecord` combines current bridge timestamp with historical audit counts/contracts | Split current subscription identity from historical capability acceptance | CRU-21 / CRU-26 |
| P0 | Copy structured Data Health lineage | Copy for ChatGPT | Identity fields usable; technical lineage overexposed | Snapshot Data Health | Current snapshot plus historical/runtime paths | MANUAL_ONLY | Includes canonical absolute filesystem paths and the mixed live-source audit identity | Add a Copy allowlist/sanitizer; retain hashes/status without local paths | CRU-21 |
| P1 | TX current price | Yes | Yes, descriptive | Shioaji TX executed ticks | `2026-08-21/TXFI6/DAY` | LIVE; QUALITY_INSUFFICIENT; NOT_PROMOTED | Timestamp lineage warning | Keep chart usable and warning visible | CRU-21 |
| P1 | TX 1m–4h | Yes | Yes | Deterministic chart aggregation | Same current identity | READY; QUALITY_INSUFFICIENT | None beyond lineage | Continue current chart contract | CRU-21 |
| P1 | TX 1D | Yes | Yes as forming bar | NIGHT+DAY trade-date bar | `2026-08-21/TXFI6/NIGHT_PLUS_DAY` | FORMING; QUALITY_INSUFFICIENT | Must not show READY before close | Keep governed coverage/window states | CRU-21 |
| P1 | DAY VWAP | Yes | Yes | Exact TX tick session VWAP | `2026-08-21/TXFI6/DAY` | AVAILABLE; NOT_PROMOTED | Session-only, not combined 1D | Keep explicit DAY/NIGHT label | CRU-21 |
| P1 | Opening Range | Yes | Yes | Frozen T0 DAY 08:45–09:00 | `2026-08-21/TXFI6/DAY` | READY; NOT_PROMOTED | Night OR not applicable | Preserve Frozen contract | CRU-21 |
| P1 | Session high/low | Yes | Yes | Governed chart ticks | Current chart identity | AVAILABLE; descriptive | None | Keep identity-locked | CRU-21 |
| P4 | RVOL | Yes as empty/unavailable | No | TX tick prerequisite exists | Current raw | DERIVATION_NOT_IMPLEMENTED | No derivation contract | Owner-authorized research/derivation later | CRU-13 |
| P1 | IX0001 breadth raw | Via Data Health/detail | Raw usable | Existing 8790 IX0001 `index_quote` | Current DAY callbacks | COLLECTING_RAW / RAW_VALIDATED candidate; NOT_PROMOTED | Formal family currently falls back to stale EOD breadth | Finish governed coverage/availableAt audit before wiring | CRU-13 |
| P1 | EOD breadth counts | Yes | Yes, descriptive only | TWSE/TPEx batch | `2026-08-20` | STALE; NOT_PROMOTED | Not live breadth | Label EOD/stale explicitly | CRU-21 |
| P1 | TX Tick/BidAsk | Data Health | Raw usable | Existing 8790 single bridge/writer | TXFI6, current session | LIVE_RAW; timestamp quality insufficient | No promoted flow derivation | Continue collection; no second collector | CRU-13 |
| P1 | MTX/TMF Tick/BidAsk | Data Health | Raw usable | Existing 8790 single bridge/writer | Current contracts/session | LIVE_RAW | Not a productized pressure metric | Continue collection | CRU-13 |
| P2 | Aggressive buy/sell estimate | Technical placeholder | No current product | TX tick prerequisite | Current raw | DERIVATION_NOT_IMPLEMENTED | Provider aggressor truth/native sequence absent | Define and validate proxy contract; never call it true CVD | CRU-13 |
| P2 | Estimated CVD | Technical placeholder | No | Same raw prerequisite | Current raw | DERIVATION_NOT_IMPLEMENTED | Historical provider-classified research exists, no current product | Coverage and descriptive validation before promotion | CRU-13 |
| P3 | Real CVD | No | No | No authoritative aggressor-side/native-sequence source | — | SOURCE_GAP | Cannot infer real CVD from heuristic ticks | Owner source decision if real CVD is required | CRU-13 |
| P2 | Tick Rule Flow Proxy | Not on current workspace | Historical/research only | Historical Shioaji tick classification | Historical runs | RESEARCH_ONLY | Not a current governed product | Keep distinct from real CVD; validate current derivation separately | CRU-13 |
| P2 | Order Book Pressure / opening flow | Placeholder/detail | No | TX BidAsk raw exists | Current raw | DERIVATION_NOT_IMPLEMENTED | No governed calculation | Separate research contract and replay audit | CRU-13 |
| P1 | 2330 Tick / realtime price | Data Health/raw, not contribution | Raw usable | Existing 8790 subscription | Current session | COLLECTING_RAW; NOT_PROMOTED | Not wired as leadership evidence | Governed descriptive wiring only after identity/coverage audit | CRU-13 |
| P3 | TSMC contribution | No | No | Needs weight/divisor/methodology | — | SOURCE_GAP | 2330 price is not index contribution points | Obtain governed effective-date methodology inputs | CRU-13 |
| P3 | Top-10 price basket | No | No | Only 2330 is subscribed | — | SOURCE_GAP | No bounded constituent set | Owner-authorized source/collection contract | CRU-13 |
| P3 | Top-10 membership/weights/contribution | No | No | No effective-date official source integrated | — | SOURCE_GAP | Membership, weights and divisor absent | Source and licensing decision | CRU-13 |
| P1 | Cash institutional | Yes | Yes, descriptive | TWSE BFI82U EOD | `2026-08-20` | STALE; NOT_PROMOTED | Not intraday | Explicit EOD/stale label | CRU-21 |
| P1 | Futures OI / positioning | Yes | Yes, descriptive | TAIFEX official batch | market `2026-08-21`; institutional `2026-08-19` | EOD; mixed freshness; NOT_PROMOTED | Different source dates must remain visible | Preserve per-source identity and freshness | CRU-21 |
| P1 | Basis | Present in existing snapshot/product | Descriptive when batch fields exist | TAIFEX futures batch | Source-specific EOD/session | BATCH; NOT_PROMOTED | Not live institutional evidence | Keep batch label and null when absent | CRU-21 |
| P3 | Intraday institutional proxy | No | No | No governed source | — | SOURCE_GAP | EOD values cannot impersonate live positioning | Owner source decision | CRU-13 |
| P1 | Options OI/PCR/walls/max pain | Yes | Yes, descriptive | TAIFEX options CSV EOD | `2026-08-20/202608F3` | AVAILABLE EOD; NOT_PROMOTED | Not live chain | Keep EOD label and expiry identity | CRU-21 |
| P2 | TXO live raw | Data Health technical status | No production data | Candidate in existing bridge, default off | None active | OFF_BY_OWNER_GATE / IMPLEMENTED_NOT_DEPLOYED | Zero active subscriptions | Separate off-hours Owner activation review | CRU-13 |
| P2 | TXO weekly/strike BidAsk coverage | No | No today | Candidate bounded universe | None active | IMPLEMENTED_NOT_DEPLOYED | Production collection not activated | Capacity/continuity validation then Owner gate | CRU-13 |
| P4 | ATM IV / 25D skew | Not formal current family | Research EOD only | Calculated Black-76 research pipeline | Through prior EOD research | RESEARCH_ONLY / NOT_PROMOTED | Raw live synchronization not active | Validate assumptions and replay before any evidence candidacy | CRU-13 |
| P3 | Provider Greeks | No | No | No provider Greeks source | — | SOURCE_GAP | A pricing library is not provider data | Keep MISSING until source exists | CRU-13 |
| P4 | Delta/Gamma/DEX/GEX/Gamma Flip/Dealer Map | No formal current output | No | Some calculation/research code may exist | Historical/research only | UNIMPLEMENTED as current product / NOT_PROMOTED | No live validated inputs or Owner promotion | Separate future research package | — |
| P1 | VIX | Yes | Yes, descriptive | Yahoo Finance market overview | current/delayed quote context | DELAYED; NOT_PROMOTED | Not guaranteed exchange realtime | Label provider and delay | CRU-21 |
| P1 | Taiwan VIX | Data Health/source detail | Descriptive EOD | TAIFEX TAIWAN VIX | `2026-08-20` | STALE | Awaiting publication | Preserve source date | CRU-21 |
| P1 | SOX | Not in current Decision Workspace family | Available in research DB | EOD research ingestion | `2026-08-20` | BATCH/RESEARCH_ONLY | Collected but not wired to formal workspace | Low-cost truthful read-only wiring after Owner scope | CRU-13 |
| P1 | NDX proxy | Yes as proxy label | Yes, descriptive proxy | Research/Yahoo-style daily source | `2026-08-20` | PROXY_ONLY; NOT_PROMOTED | Must never be called true NQ | Keep explicit proxy label | CRU-13 |
| P3 | True NQ futures | No | No | No existing authorized futures source | — | SOURCE_GAP | Contract/expiry/rollover source absent | Owner vendor/access decision | CRU-13 |
| P1 | USD/TWD daily/delayed | Yes | Yes, descriptive | Market overview + research DB | `2026-08-21` | DELAYED/BATCH; NOT_PROMOTED | Not governed intraday FX | Label cadence | CRU-13 |
| P3 | Intraday USD/TWD | No | No | No authorized intraday source integrated | — | SOURCE_GAP | Daily/delayed value cannot impersonate intraday | Owner source decision | CRU-13 |
| P1 | conflictState / coverageState / dataTrustState | Yes | Yes as descriptive governance summary | DW-4 three-axis contract | Current snapshot | IMPLEMENTED; no directional evidence promoted | Often `NO_DIRECTIONAL_EVIDENCE/INSUFFICIENT/BLOCKED` | Keep axes separate | CRU-21 |
| P1 | Current-market fact summary | Yes | Yes | Deterministic current facts | Current locked snapshot | IMPLEMENTED; descriptive only | Not a recommendation | Keep Copy contract safety flags | CRU-21 |
| P4 | Strongest contrary evidence | Yes as unavailable | No | No derivation code | — | UNIMPLEMENTED | `CONTRARY_EVIDENCE_DERIVATION_NOT_IMPLEMENTED`; additionally no promoted eligible family set | Define evidence eligibility and derivation in future Owner package | CRU-21 |
| P4 | Direction / global alignment / risk | Visible as unavailable | No current legal state | Forward Market State would be source | Latest official is 2026-08-12 MISSED | HISTORICAL_ONLY / unavailable | No legal current Forward STATE | Restore future lifecycle operationally; never synthesize current state | CRU-23 |
| P4 | Entry quality | Placeholder | No | None | — | UNIMPLEMENTED | No governed contract | Future product decision | — |
| P4 | Expected vs actual response | Not usable | No | Outcome/research contracts only | Historical | RESEARCH_ONLY | Not current workspace intelligence | Future descriptive validation package | — |
| P4 | Path efficiency / market control | Not usable as current decision fact | No | Historical outcome/research formulas | Historical | RESEARCH_ONLY | No current promoted derivation | Future Owner decision | — |
| P1 | Market Change Feed | Yes | Yes, descriptive | Governed chart events | Current chart identity | IMPLEMENTED; no recommendation | OR/VWAP/session extrema and data-trust events only | Keep event IDs and source facts intact | CRU-21 |
| P1 | Copy for ChatGPT | Yes | Yes after identity fix | Immutable manual snapshot text | Current locked identity | MANUAL_ONLY | Before fix inherited mixed identity | Verify actual clipboard against chart tuple | CRU-21 |
| P1 | Manual Journal | Yes | Yes, manual local append-only | Decision journal | User-created entries | MANUAL_ONLY | No automated trading | Preserve auth/CSRF and local-only semantics | CRU-21 |
| P1 | 8787 formal dashboard | Yes | Yes | Node formal runtime | Governed runtime commit | HEALTHY | UI lacks visible version badge | Follow-up badge only when truthful approved/main/start fields exist | CRU-21 |
| P1 | 8790 Shioaji bridge | Data Health | Yes | Existing market-data-only runtime | Current subscriptions | HEALTHY; writer PASS | No persistent supervisor active | Keep single instance; Owner-gated activation separately | CRU-26 |
| P2 | 8791 continuity supervisor | No | No production use | Merged implementation | Not active | OFF_BY_OWNER_GATE | Production activation not approved | Separate off-hours activation review | CRU-26 |
| P2 | Windows unattended restart | Operational only | Partial | Daily launcher/current local runtime | Machine-local | PARTIAL | Supervisor inactive; tasks unavailable in this audit context | Prove task/autostart persistence under proper Windows identity | CRU-26 |

## 6. Buy/sell pressure answer

What exists today:

- Real raw prerequisites: TX/MTX/TMF executed ticks and BidAsk, collected by the existing single 8790 bridge/writer.
- A historical provider-classified order-flow research path exists, and a future heuristic/tick-rule proxy is technically possible.
- Current Decision Workspace estimated CVD and order-book pressure are explicitly `DERIVATION_NOT_IMPLEMENTED`.

What does not exist today:

- No authoritative real CVD product.
- No governed current aggressive buy/sell score.
- No promoted order-book pressure or opening-flow evidence.
- No native sequence proof; therefore packet loss remains unknown.

## 7. Options/dealer answer

EOD options context is available and descriptive. TXO live-chain code is a default-off candidate and production subscriptions are not active. Calculated IV/skew belongs to research and is not live promoted evidence. Provider Greeks are absent. Current formal DEX, GEX, Gamma Flip, Dealer Map, or dealer-pressure intelligence is unavailable; existing calculations/research code must not be presented as live provider truth.

## 8. CRU-13 checkpoint

| Track | Primary status | Proof |
|---|---|---|
| TX CVD / aggressive flow | `COLLECTING_RAW` | 8790 TX Tick/BidAsk and append-only live ledger; derivation remains unimplemented |
| TSMC + Top-10 | `COLLECTING_RAW` for 2330 only; Top-10 `SOURCE_GAP` | 8790 2330 subscription; no other Top-10 set/weights/methodology |
| Intraday USD/TWD | `SOURCE_GAP` | Only daily/delayed market overview and research DB rows exist |
| True NQ futures | `SOURCE_GAP` | NDX is explicitly proxy-only; no NQ contract/expiry/rollover source |
| Intraday options IV/skew | `IMPLEMENTED_NOT_DEPLOYED` for TXO raw candidate; IV/skew `PLANNED_ONLY` as live product | TXO health is STOPPED_EXPECTED/default-off; EOD research derivation exists |

Collection does not imply promotion.

## 9. Visible empty-state treatment

| UI area | Truth | Recommendation |
|---|---|---|
| NO_TRADE / readiness | Governed safety/readiness, not a signal | `KEEP_VISIBLE` |
| Current identity | Real chart identity after fix | `KEEP_VISIBLE` |
| Forward Shadow | Historical research lifecycle | `KEEP_VISIBLE`, relabel historical role |
| Five DW-4 families | Descriptive values plus independent availability/quality/promotion | `KEEP_VISIBLE`; move raw reason codes to technical detail |
| Futures daily delta `0` | Unavailable comparison sentinel | `KEEP_VISIBLE` only after rendering unavailable instead of zero |
| RVOL | Derivation not implemented | `COLLAPSE` or `MOVE_TO_TECHNICAL_DETAIL` |
| Estimated CVD / order-book pressure | Raw prerequisite only; derivation absent | `MOVE_TO_TECHNICAL_DETAIL` |
| Strongest contrary evidence | Derivation absent | `COMPACT`; show human reason and technical code on expand |
| Direction/global/risk | No legal current Forward STATE | `KEEP_VISIBLE` as unavailable with historical separation |
| TXO live raw | Owner gate off | `MOVE_TO_TECHNICAL_DETAIL` until activated |
| Provider Greeks / DEX / GEX / dealer map | Source gap or future research | `HIDE_UNTIL_AVAILABLE` in daily workspace |
| True NQ / Top-10 contribution / intraday FX | Source gaps | `HIDE_UNTIL_AVAILABLE` or technical backlog detail |
| Version/runtime badge | Backend identity truthful; human badge absent | `KEEP_VISIBLE` in future bounded UX follow-up |

## 10. Version and operations finding

The health mechanism truthfully exposes the runtime commit and verification state. The current UI does not visibly expose Product Version, approved/main commit, runtime commit, started-at, and sync state together. Result: `VISIBLE_VERSION_BADGE_MISSING`.

No badge is added in this branch because the current workspace payload does not carry all truthful approved/main/start-time fields. Adding it would require a new UI/runtime contract beyond the optional trivial-change boundary.

Unattended status: `PARTIAL`.

- Current 8787 and 8790 are healthy.
- Existing bridge subscriptions and writer are healthy; session recovery information remains truthful.
- 8791 is not active by Owner gate.
- Formal Scheduled Tasks were not discoverable from the current process, so task persistence, triggers, account, and last result cannot be marked PASS.
- One-month unattended continuity therefore remains unproven.

### Formal validation operational observation

The formal 8787 candidate was restarted from the bounded feature commit to prove the repaired UI and Copy contract. The existing `launcher.mjs` owns a bridge child and terminates it from its process-exit hook. Consequently the scoped 8787 restart also replaced the otherwise healthy 8790 bridge (`PID 46472` to `PID 25212`). This was not a CRU-26 supervisor activation; 8791 remained stopped and only one bridge existed after the restart.

The bounded ledger tail shows the last pre-restart event at `10:55:42.192616+08:00`, new bridge start at `10:55:45.444709+08:00`, subscriptions ready at `10:55:48.992565+08:00`, and market records resuming at `10:55:48.993006+08:00`. This is an observed interruption window, not proof of missing-tick count. Native sequence is unavailable, so packet-loss certainty remains `UNKNOWN_NO_NATIVE_SEQUENCE`.

This coupling means a Dashboard-only restart is not operationally isolated. A future Owner-authorized operational fix should separate formal 8787 lifecycle from the already-running 8790 bridge; this audit does not implement that change.

### Actual Copy verification

The actual clipboard generated on formal 8787 carried the repaired current identity exactly: `2026-08-21 / TXFI6 / DAY`, `identityState=AVAILABLE`, `source=GOVERNED_TX_CHART`. It also preserved all safety fields and `NOT A TRADING SIGNAL`.

Two separate follow-ups remain:

1. The descriptive institutional daily delta is still printed as `0` even though its comparison is unavailable.
2. The structured Data Health section includes local absolute manifest paths and historical `2026-07-30` futures-audit contract/count identity. Copy is manual/local, but the payload should still use an explicit safe allowlist and keep historical capability evidence distinct from current runtime observation.

## 11. Safety invariants

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`
- No broker/order route added.
- No BUY/SELL or system direction added.
- No evidence promoted.
- No Forward, P0, T0, Frozen, SQLite, or raw-ledger evidence changed by this work.
