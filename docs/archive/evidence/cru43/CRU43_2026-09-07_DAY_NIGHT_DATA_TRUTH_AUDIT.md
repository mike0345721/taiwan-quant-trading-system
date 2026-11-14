# CRU-43 2026-09-07 DAY / NIGHT Data Truth Audit

Status: `PASS_WITH_UNKNOWN_HISTORICAL_RUNTIME_CAUSE`

This audit is bounded to the existing governed ledger, the persisted final CRU-34 live checkpoint, and the frozen CRU-34 continuity semantics. It does not infer facts from the Owner screenshot and does not alter the collector, Shioaji subscription, broker, or CRU-34 formulas.

## Evidence identity

- Ledger: `data/live-events/2026-09-07.ndjson`
- Ledger size: `1,635,479,685` bytes
- Physical records: `1,190,606`
- First raw record: ordinal `1`, `bridge_started`, received `2026-09-07T08:21:29.917079+08:00`, record hash prefix `759bc95e`
- Last raw record: ordinal `1,190,606`, `TXFI6 futures_bidask`, received `2026-09-07T23:59:59.944043+08:00`, exchange timestamp `2026-09-08T00:00:00.124+08:00`, record hash prefix `7add17f1`
- Persisted checkpoint: `data/runtime/cru34-live/2026-09-07.checkpoint.json`

## DAY evidence

DAY is evaluated from TX event time `08:45:00` through `13:45:00` Asia/Taipei.

| Evidence | Result |
|---|---|
| TX Tick count | `29,733` |
| TX BidAsk count | `130,644` |
| First DAY TX event | ordinal `1,796`, Tick, exchange `08:45:00.061` |
| Last DAY TX Tick | ordinal `729,093`, exchange `13:44:59.668`, received `13:45:00.305496`, total volume `42,750` |
| Last DAY TX BidAsk | ordinal `729,123`, exchange `13:45:00.099`, received `13:45:00.316314` |
| 13:45 terminal coverage | `PASS` |
| Exact 13:45 projection processed ordinal / lag | `UNKNOWN` — the rolling checkpoint was overwritten and no immutable 13:45 version remains |

The terminal Tick and BidAsk records prove lawful TX coverage through the DAY close. They do not prove that every other Dashboard data lane was complete.

## NIGHT evidence

NIGHT is evaluated from the actual TX night-session events beginning at `15:00:00` Asia/Taipei. Two pre-open BidAsk snapshots received near `14:50` with exchange time `00:00:00` are excluded from the night count.

| Evidence | Result |
|---|---|
| TX Tick count | `6,480` |
| TX BidAsk count | `103,817` |
| First NIGHT TX Tick | ordinal `730,195`, exchange `15:00:00.091`, received `14:59:59.738230` |
| Final checkpoint identity | `TXFI6`, trade date `2026-09-08`, session `NIGHT`, continuity epoch `TX:1` |
| Final checkpoint processed ordinal | `1,190,597` |
| Final ledger source ordinal | `1,190,606` |
| Final lag | `9` records / `12,364` bytes; suffix hash-chain verification `PASS` |
| Final rolling evidence | `82` events, first ordinal `1,187,916` at `23:54:31.374790`, last Tick ordinal `1,190,494` at `23:59:39.193571`; the 300-second warm-up span is complete |

Full-ledger TX totals are `36,507` Tick records and `235,058` BidAsk records.

## Continuity / recovery

- Continuity epoch timeline: `TX:1` from ordinal `17` through the final checkpoint.
- `bridge_started`: `1`.
- Successful subscription provider events: `11`.
- `subscriptions_ready`: `1`, generation `1`.
- `session_down`, `bridge_stopped`, reconnect/resubscribe break events: `0`.
- Reconnect count: `0`.
- Recovery or partial-recovery events: none.
- Ledger-reported `sequenceGap > 0`: `0`.
- Duplicates: `0`.
- Safety violations: `0`.

The raw provider sequence is `null`; therefore the zero ledger-reported gaps cannot be promoted into proof of exchange packet continuity.

## Owner-observed 15:45 `WARMING_UP / TX:16`

Verdict: `UNKNOWN`.

The retained evidence contradicts, but cannot reconstruct, the exact runtime state visible near 15:45:

- the current ledger contains night-session TX data from 15:00 onward and TX BidAsk records at 15:45;
- the governed continuity reconstruction yields `TX:1` for the full ledger, with no reconnect or epoch-break event;
- after 45 minutes of same-session ticks, the current worker's 300-second warm-up condition would ordinarily be complete;
- the exact 15:45 projection snapshot, checkpoint, runtime source identity, processed ordinal, and lag were not immutably retained.

Consequently:

- normal session reset: excluded as the explanation for `TX:16`;
- reconnect / epoch reset: not supported by the retained ledger;
- sequence gap / partial recovery: not supported by the retained ledger;
- projection lag at 15:45: `UNKNOWN`;
- exact root cause: `UNKNOWN`.

Reading a different or stale checkpoint/runtime is a possible inference, not evidence, and is not recorded as the cause.

## Reproduction

Use streaming NDJSON parsing in physical append order; do not sort by event time. Relevant bounded spot checks:

```powershell
rg -n -m 30 -F '2026-09-07T13:45' data/live-events/2026-09-07.ndjson
rg -n -m 16 -F '2026-09-07T15:45' data/live-events/2026-09-07.ndjson
Get-Content -LiteralPath data/runtime/cru34-live/2026-09-07.checkpoint.json -Raw | ConvertFrom-Json
```

Safety remains `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, and `orderRoutesEnabled=false`.
