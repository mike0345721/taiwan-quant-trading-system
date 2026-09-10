# CRU-44 15m + 30m Governed Local Data Audit

Status: PASS

Scope: CRU-44 15m and 30m only

Approved base: `9768dd9df5b506f519b52cc1baf7bf9acb551f4c`

## Frozen source identity

- Ledger artifact: `2026-09-09.ndjson`
- Frozen byte cutoff: `935162526`
- Source identity: `sha256:af6e10b93c17fca3cc23eec97b72cf7584a6223011f9cdffa4c811960291ad9d`
- Cutoff ledger ordinal: `681308`
- Cutoff record hash: `13dcd9f71b69e5e497b91b5ebcabab2ee1d38e17f3fb23b16dc16911bafa4e13`
- Identity: `2026-09-09 / DAY / TXFI6`
- Ordering: physical append order; no `eventTime` sort

The audit reads the governed ledger and writes only to a separate CRU-44 candidate runtime root. The Owner runtime at `D:\Taiwan stock\approved-main-runtime` is not read as a development worktree and is not modified.

## Compatibility and determinism

- CRU-34 semantic payload hash: `db86660d3ced0bb04ae905a986c7d916c93f9ad8bfa9fe70e1c6fa4b0da5f114`
- CRU-44 compatibility binding hash: identical
- `primary60sUnchanged`: `true`
- `context300sUnchanged`: `true`
- Incremental content hash: `41a616875ce36edb9db742946b7b38e48336ac25c4d126363bcd779d2c9e8872`
- Replayed rolling-reference content hash: identical
- Restart at the same frozen cutoff: `NO_COMPLETE_SUFFIX` in `443.323 ms`

## Independent promotion evidence

| Window | Pressure | Classified coverage | Response | Path | Maximum gap | Frozen threshold | Eligible |
|---|---:|---:|---:|---:|---:|---:|---:|
| 15m | `QUALITY_INSUFFICIENT` with measured evidence | `0.972630173564753` | `READY` | `READY` | `11827 ms` | `30000 ms` | yes |
| 30m | `QUALITY_INSUFFICIENT` with measured evidence | `0.9731113956466069` | `READY` | `READY` | `12209 ms` | `30000 ms` | yes |

The frozen snapshot is `STALE` only because its cutoff was deliberately held fixed while the live ledger continued to append. Staleness is kept separate from research quality. Coverage below 1 remains `QUALITY_INSUFFICIENT`; it is not promoted into a formal direction.

The full GENESIS pass used 15 bounded batches. Across 14 evidence-bearing batch cutoffs, the windows were evaluated independently:

- 15m: 1 warming sample, 13 pressure/response samples, 8 Path-ready samples, 5 lawful long-gap failures.
- 30m: 2 warming samples, 12 pressure/response samples, 7 Path-ready samples, 5 lawful long-gap failures.
- DAY: all eligible 15m (8) and 30m (7) cutoffs were Path-ready.
- NIGHT: all five sampled cutoffs retained lawful pressure/response evidence and independently failed Path on the frozen long-gap rule.
- No event-time regression was observed in this frozen artifact; synthetic regression, equal-time physical order, delayed earlier event, reconnect epoch, contract/session/trade-date boundary, and partial-coverage cases are covered by automated tests.

## Resource envelope

- Maximum rolling canonical events during GENESIS: `25663`
- Compact checkpoint: `13396145 bytes`
- Snapshot: `13973 bytes`
- Frozen scan maximum batch size: `67108864 bytes / 100000 records`
- GENESIS batch latency (audit-sized batches): p50 `5642 ms`, p95/p99/max `11272 ms`
- Restart validation rolling events: `15449`

The batch timing above is an audit backfill profile, not a live-poll latency claim. Live processing resumes from the checkpoint and consumes only the appended suffix.

## Safety

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`
- No 1h, 4h, TradingDay, CVD, Relative Intensity, Absorption, Market Control, or Market State implementation is included.
