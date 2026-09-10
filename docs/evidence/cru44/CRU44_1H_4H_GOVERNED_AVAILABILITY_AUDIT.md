# CRU-44 1h / 4h Governed Availability Audit

## Gate

`CRU44_1H_4H_SEMANTIC_DECISION_REQUIRED`

This checkpoint does not claim Owner Preview readiness. The frozen
`MAX_PATH_GAP_MS=30_000` contract was not changed.

## Source identity

- Approved base: `9770b072758532ecd3feabfb25d1213f431560e2`
- Governed ledger: `2026-09-09.ndjson`
- Physical bytes verified: `2,745,991,217`
- Source ledger identity: `sha256:af6e10b93c17fca3cc23eec97b72cf7584a6223011f9cdffa4c811960291ad9d`
- Final cutoff ordinal: `2,000,235`
- Final cutoff record hash: `6164c46886f194de04703981049856bb75004b9486f7f9051ebc754c78049856`
- Final identity: `TXFI6 / tradeDate 2026-09-10 / NIGHT / continuityEpoch TX:6`
- Sampling unit: one observation per 64 MiB verified physical-ledger batch; counts are
  deterministic audit checkpoints, not uniformly spaced market-time samples.

## Frozen-semantics availability

| Window | Samples | Warming | Complete envelopes | Path READY | LONG_GAP | Event-time regression |
|---|---:|---:|---:|---:|---:|---:|
| 1h | 41 | 11 | 30 | 16 | 14 | 0 |
| 4h | 41 | 34 | 7 | 2 | 5 | 0 |

Session breakdown:

| Session | Window | Complete envelopes | Path READY | LONG_GAP |
|---|---|---:|---:|---:|
| DAY | 1h | 12 | 12 | 0 |
| DAY | 4h | 2 | 2 | 0 |
| NIGHT | 1h | 18 | 4 | 14 |
| NIGHT | 4h | 5 | 0 | 5 |

At the final cutoff, 1h had lawful pressure and price response but Path Efficiency
failed closed with `QUALITY_INSUFFICIENT_LONG_GAP`: observed maximum gap
`32,723 ms` versus allowed `30,000 ms`. The final 4h envelope was
`WARMING_UP_WINDOW_INCOMPLETE` after continuity changes and exposed no partial value.

This is a substantive long-window availability constraint. Owner semantic direction
is required before promotion: retain the current component-wise presentation
(pressure/response may remain visible while Path fails closed), narrow the package,
or choose another explicitly governed policy in a later authorization. This audit does
not authorize widening the gap threshold, substituting a shorter window, or fabricating
a complete 4h value.

## Determinism, compatibility, and bounded resources

- Incremental 1h/4h content hash exactly matched the bounded rolling reference.
- The extension hash exactly matched the frozen CRU-34 semantic payload hash.
- `primary60sUnchanged=true`; `context300sUnchanged=true`.
- Physical append order remains the only observation order.
- Maximum rolling canonical events: `42,736`.
- Final compact checkpoint: `9,374,521 bytes`.
- Final snapshot: `16,061 bytes`.
- 64 MiB audit batch latency: p50 `3,183 ms`, p95 `6,398 ms`, p99/max `17,109 ms`.
- No-suffix restart: `NO_COMPLETE_SUFFIX` in `178 ms`.
- Market-data writer remains a separate process/failure domain; the audit consumed the
  append-only ledger and did not write to or block the writer.

Checkpoint compaction retains all futures ticks, the exact best-quote observations
actually consumed by frozen pressure semantics, and the bounded 2-second quote tail
needed by a future tick. Adversarial tests prove the compact checkpoint produces an
exactly equal multi-window payload to full GENESIS replay.

## Safety

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`

