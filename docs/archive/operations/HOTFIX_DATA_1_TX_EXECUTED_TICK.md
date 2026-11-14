# HOTFIX-DATA-1 — TX Executed Tick Capability

Status: Level 3 Engineering APPROVE; Product Owner review required. Do not merge from this document.

## Confirmed root cause

On 2026-08-26 the bridge subscribed successfully to separate `TIC/v1/FOP/*/TFE/{contract}` (Tick) and `QUO/v1/FOP/*/TFE/{contract}` (BidAsk) topics for TXFI6, MXFI6, and TMFI6. The installed runtime was Shioaji 1.7.2 and its FOP v1 Tick callback accepts one `TickFOPv1` argument, matching the bridge registration.

The bridge log then recorded provider event 12 (`Session reconnecting`) followed by event 13 (`Session reconnected`) twice, but no subsequent FOP subscription acknowledgements. The bridge only handled the separate session-down callback. It did not react to reconnect event 13, did not re-subscribe either FOP capability, and continued to label the original subscribe calls `RESTORED`. After that lifecycle break, BidAsk delivery resumed while Tick delivery did not. The ledger, queue, and callback instrumentation showed no drops, callback errors, or writer errors; the full 2026-08-26 ledger scan contained zero `futures_tick`. The exact proven disappearance boundary is therefore provider delivery after session reconnect and before the registered Tick callback, not normalization, enqueue, writer, ledger, reader, or chart derivation.

The independent repair re-subscribes both Tick and BidAsk after provider reconnect event 13, resets delivery proof and retry budget for the new subscription generation, and performs at most three quote-type-specific retries. The 0/5/20-second values are minimum backoff delays; every successful subscribe returns to a fresh 30-second delivery grace. Subscribe return, callback acceptance, and durable ledger append are distinct facts, and delivery becomes `LIVE` only after a valid event is appended.

## Capability contract

| Field | Contract |
|---|---|
| Capability | `TX_EXECUTED_TICK` |
| Producer | Shioaji FOP v1 Tick callback |
| Provider identity | `TXFR1` subscription alias resolved by Shioaji to the governed actual TX target contract (for the incident, `TXFI6`) |
| Required identity | `productFamily=TX`, `subscriptionAlias=TXFR1`, `targetCode`, `actualContract` |
| Required time | legal provider `eventTime`/`datetime` plus append-time `receivedAt` |
| Required value | executed `price` (`close`) and executed `executedVolume` (`volume`) |
| Simulation | provider `simtrade` is preserved and never rewritten |
| Storage | new `kind=futures_tick` rows appended to the daily hash-chained live-event ledger; historical rows are never rewritten |
| Reader | `readTxLiveEventLedger` accepts only actual TX, non-duplicate `futures_tick` rows |
| API | `/api/v1/tx-chart` returns the governed chart contract and remains unavailable when no eligible Tick exists |
| Health dependency | Tick subscription, delivery timestamp, freshness, missing/stale state, retry count, and recovery state are independent from BidAsk |
| Failure semantics | `MISSING`, `STALE`, or `FAILED` produces product `PARTIAL` and bridge `DEGRADED / MISSING_REQUIRED_QUOTE_TYPE`; it is never neutralized or replaced with BidAsk-derived values |
| Safety | `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, `orderRoutesEnabled=false` |

## Affected consumer matrix

“After” below is focused fixture/integration evidence. Real-production acceptance remains pending the bounded smoke procedure.

| Consumer | Class | Source capability | Expected behavior | Observed before | Observed after | Result |
|---|---|---|---|---|---|---|
| TX last price / terminal header / Market Pulse price | Direct | TX executed Tick | Latest eligible actual-contract execution | Unavailable | Same normalized Tick identity produces `lastPrice` | PASS (test) |
| 1m/5m OHLC K-line | Derived | TX executed Tick | Bars only from executions | No bars | Representative callbacks produce non-empty 1m and 5m bars | PASS (vertical test) |
| Tick-derived bar volume | Derived | TX executed Tick volume | Sum executed volume only | Unavailable | Fixture volumes 2+3 aggregate to 5 | PASS (vertical test) |
| Session VWAP | Derived | Tick price × executed volume | Same session and contract as chart | Unavailable | Built by existing governed chart pipeline | PASS (test) |
| Night High / Low | Derived | Eligible NIGHT Tick prices | Same actual contract; unavailable without Tick | Unavailable | Existing chart level contract receives restored Tick rows | PASS (existing + vertical path) |
| Current Day High / Low | Derived | Eligible DAY Tick prices | Same actual contract; unavailable without Tick | Unavailable | Existing chart level contract receives restored Tick rows | PASS (existing + vertical path) |
| Opening Range | Derived | DAY Tick executions in governed window | No fabricated range | Unavailable | Existing derivation receives restored Tick rows when applicable | PASS (existing + vertical path) |
| Market Change chart markers / TX source facts | Derived | Governed TX chart identity | Markers align to the same chart contract | No TX chart identity | Existing marker join receives the restored chart identity | PASS (existing contract; production smoke pending) |
| Data Health `txTick` | Direct health | Tick quote-type delivery | Missing Tick is explicit even with live BidAsk | False green at product level | `deliveryState=MISSING`, `UNAVAILABLE`, `MISSING_REQUIRED_QUOTE_TYPE` | PASS (negative test) |
| Data Health `txBidAsk` | Direct health | BidAsk quote-type delivery | Remains independently visible | Flowing but masked by combined state | `deliveryState=LIVE` remains visible while Tick is missing | PASS (negative test) |
| Dashboard chart/readiness health | Derived health | TX executed Tick → chart | Unavailable with zero Tick; ready only with bars | Correctly unavailable | Still fails closed for BidAsk-only and becomes ready with Tick fixture | PASS (negative + vertical tests) |
| Public preview / DW4 descriptive evidence | Derived | Governed chart payload | Same lastPrice/VWAP/OR identity; descriptive only | Unavailable | Existing sanitized payload path consumes restored chart | PASS (existing contract; production smoke pending) |
| EOD institutional positioning, options OI, Global Context, IX0001 leadership | Independent | Independent sources | No change | Independent | Unchanged | NOT_APPLICABLE |

## Health false-positive repair

The former product row had one `state` and one `lastObservedAt`. Any callback for the product advanced it, so BidAsk alone proved the entire `[Tick, BidAsk]` list healthy. Each TX/MTX/TMF row now exposes `quoteTypeHealth.Tick` and `quoteTypeHealth.BidAsk` with subscription state, subscribed time, last observation, freshness, delivery state, retry evidence, and recovery state. Product and bridge state are derived from those required capabilities. A current sibling stream plus a missing/stale required quote type cannot be `RESTORED` or `HEALTHY`.

## Shioaji Pro Reference Audit

Reference: Sinotrade/shioaji-pro-app commit `76ac168b7c16c42b6e0c62f171c107c0567b4e58` (AGPL), inspected read-only in a temporary clean-room clone. No source was copied.

- Relevant failure modes: an SSE/runtime connection may remain up while subscriptions require replay; upstream client maintenance/rebuild can silently lose market-data subscriptions; successful subscribe response does not prove delivery; reconnect retries can fail independently by quote type.
- Useful patterns: key subscriptions by contract and quote type, register only after acknowledged subscribe success, replay registrations after reconnect, use bounded retries, and expose connection/heartbeat/event-rate/subscription diagnostics separately.
- Difference here: this bridge uses native Python callbacks and an append-only ledger, not the reference app's aggregate HTTP/SSE architecture.
- Adopted conceptually: Tick and BidAsk capability separation, acknowledgement-versus-delivery truth, reconnect replay, bounded quote-type recovery, and explicit freshness diagnostics.
- Intentionally not adopted: AGPL implementation code, UI, order features, generalized stream registry, HTTP/SSE transport, and unrelated application architecture.

## Validation evidence

- `python -m py_compile broker/shioaji_readonly_bridge.py broker/live_event_ledger.py`: PASS.
- Affected ledger, chart, runtime, launcher, Health/Data Trust, workspace, and preview suite: 75/75 PASS.
- Vertical capability test: two representative valid FOP Tick callbacks append without changing prior ledger bytes, preserve governed identity/time/price/volume/`simtrade`, and produce non-empty governed 1m and 5m bars with total volume 5.
- Negative contracts: BidAsk-only cannot create a Tick chart or healthy Tick capability; malformed Tick and queue-full events do not append or advance delivery proof; `PENDING`/`UNKNOWN`, dual-stream silence, stale streams, exhausted-generation recovery, duplicate reconnect notification, and reconnect/watchdog overlap all fail closed or recover within their bounded contract.
- `git diff --check`: PASS. `npm run security:scan`: PASS (no common hardcoded secrets).
- Full repository suite: the hotfix tests pass. The remaining 16 failures are pre-existing `ENOENT` failures for absent frozen/research artifacts in the isolated worktree (F3 governance artifacts, factor reports, T0 jobs/gates/manifests, and restricted frozen models). Those immutable artifacts were not recreated or copied for this hotfix.
- Candidate fixture browser smoke: authenticated Trader Terminal rendered real Lightweight Charts canvases and consistent TXFI6 last price, volume, VWAP, and 1m/5m API identity; browser console had no blocking warning/error. The fixture carried all four safety invariants. This is not real-production acceptance.

## Level 3 Engineering Review

| Reviewer | B / S / N result | Final verdict |
|---|---|---|
| Current Agent | No remaining findings after self-review and focused validation | APPROVE |
| Independent Codex | Reproduced false-green cases for pre-ledger delivery proof, dual-stream silence, pending freshness, and generation recovery; every blocking case was fixed and re-reviewed | APPROVE |
| Third Independent Reviewer | Reproduced dual-stream stale, pending/unknown delivery, retry-generation, reconnect concurrency, duplicate-generation, and malformed Tick cases; every blocking case was fixed and re-reviewed | APPROVE |

Final re-review confirms: delivery proof follows durable append; malformed/dropped events fail closed; active-session missing/stale recovery is bounded; off-session state is `SESSION_CLOSED`; reconnect generations reset retry budget and serialize subscribe calls; duplicate event 13 cannot replay twice in one generation; rapid distinct 12→13 generations are not discarded; `PENDING/UNKNOWN` delivery cannot become healthy or visually live. Engineering APPROVE does not authorize merge or production runtime activation.

## Production validation plan

Run only after Owner authorizes the candidate runtime deployment and during an active TX session:

1. Snapshot current `/health`, candidate commit, Shioaji version, resolved `TXFR1 → actualContract`, ledger byte length/hash of the existing last row, and event counters. Do not edit the ledger.
2. Start one candidate read-only bridge instance. Confirm the four safety invariants and no second 8790 listener.
3. Observe a real TX execution. Confirm `quoteTypeHealth.Tick.lastObservedAt` advances independently of BidAsk and product state is not inferred from BidAsk.
4. Tail only newly appended bytes and confirm a new `futures_tick` row with TX family, the same actual contract, legal event time, received time, price, executed volume, preserved `simtrade`, and the four safety invariants. Confirm the previous final row bytes/hash are unchanged.
5. Query `/api/v1/tx-chart?timeframe=1m&mode=LIVE` and `5m`: require `sourceEventCount>0`, `actualContract` equal to the ledger target, and `bars.length>0`.
6. Confirm `lastPrice`, bar close, volume, VWAP, applicable high/low and Opening Range all use the same chart identity. No dependent surface may display a different contract.
7. Open Trader Terminal at desktop viewport and a narrower supported viewport. Confirm real candles, last price, volume/VWAP, and Data Health agree; inspect console/network for blocking errors.
8. Force only a controlled test/reconnect if separately authorized. Confirm event 13 causes Tick and BidAsk re-subscription and fresh per-type delivery proof. Do not simulate an outage against production without approval.
9. Save bounded evidence (health JSON, new-row sample with secrets absent, API JSON, screenshots, console result). Production acceptance remains a Product Owner decision.

## Known limitations

- Native provider sequence is unavailable, so packet-loss certainty remains `UNKNOWN_NO_NATIVE_SEQUENCE`.
- A successful reconnect re-subscribe still needs post-subscription delivery proof; health remains pending/degraded rather than assuming success.
- The 30-second delivery grace and 300-second per-quote staleness window are deliberately bounded operational defaults. They apply only while the governed TX calendar says market data should be active; off-session freshness is `SESSION_CLOSED` and does not consume retry budget. Changing these values requires evidence, not UI preference.
- This implementation cannot prove an undocumented provider-internal reason for why Tick alone failed to resume. It proves the reconnect boundary and repairs the missing lifecycle handling.

## Explicitly out of scope

No BidAsk-derived executions or volume, new provider, dashboard redesign, TXO/IX0001 activation, Market State or strategy change, research promotion, trading signal, broker order/position/execution capability, historical ledger rewrite, unrelated refactor, AGPL code copy, or generalized Agent Skill.

NEXT candidate only: a project-specific `trading-data-contract-audit` engineering skill requiring Capability → Producer → Contract → Storage → Consumers → Health → Failure modes → Vertical integration test → Production smoke. It is not implemented by this hotfix.

Draft only. Product Owner approval required before merge.
