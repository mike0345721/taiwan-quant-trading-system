# CRU-36 — Snapshot Materialization Foundation V1

Status: **IMPLEMENTATION CONTRACT / RESEARCH ONLY**
Linear: **CRU-36**
Approved base: `d1073da524e1d24d24dcfe6fc621884c69d69406`

## 1. Scope

Phase A implements this bounded historical path:

```text
governed immutable ledger
  -> unchanged buildTxIntradayResearchSnapshot()
  -> cru34-snapshot-contract-v1 semantic payload
  -> cru34-snapshot-artifact-v1 immutable artifact
  -> bounded read-only adapter
```

Phase B defines the future live path only. It does not activate a collector hook, subscription,
worker, checkpoint consumer, live producer, or `sourceMode=LIVE` output.

The safety boundary remains:

```text
formalWeight=0
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

## 2. Snapshot Contract V1

`cru34-snapshot-contract-v1` is the stable consumer-facing semantic payload. It contains:

- `sourceMode`, which is exactly `HISTORICAL` in Phase A;
- target identity: `instrument`, `actualContract`, `tradeDate`, `session`, `continuityEpoch`;
- time and lineage: `availableAt`, cutoff ordinal/hash, max-used ordinal/hash, and
  `sourceLedgerIdentity`;
- `primary60s`, `context300s`, and horizon-indexed `pressure`, `response`, and
  `pathEfficiency`;
- `quality`, `qualityReasons`, `promotionState`, `methodology`, and `limitations`;
- the four safety fields.

The payload does not contain `usedEvents`, raw ledger rows, a local source path, credentials,
account identifiers, or private runtime metadata. A later live producer must emit the same
semantic fields. Live-only operational fields such as lag or checkpoint position belong outside
the semantic research values and must not require CRU-35 to reinterpret Pressure, Response, or
Path Efficiency.

## 3. Semantic hash, artifact identity, and artifact hash

The implementation distinguishes three identities:

1. `semanticContentHash` is SHA-256 over canonical, recursively key-sorted JSON for the complete
   semantic payload. It includes governed identity, lineage, both windows, quality, promotion,
   methodology, limitations, and safety. It excludes the operational envelope, including
   `materializedAt`. Identical source and cutoff therefore produce an identical semantic hash.
2. `artifactIdentity` is a deterministic SHA-256 identity over artifact/contract versions,
   source mode, contract/session/trade-date/epoch identity, cutoff ordinal/hash,
   `sourceLedgerIdentity`, and `semanticContentHash`. It identifies semantic equality, not a
   writer attempt.
3. `artifactHash` is SHA-256 over the complete canonical artifact except the `artifactHash` field
   itself. It includes the operational envelope. Two first writes in separate empty stores may
   have the same semantic identity but different artifact hashes if `materializedAt` differs.

Once an artifact identity has been accepted in a store, a repeated materialization reuses the
validated accepted bytes. It never overwrites them merely to change operational metadata.

## 4. Immutable storage and publication

Artifact files are named by an exact-identity selection key, zero-padded cutoff ordinal, and full
artifact-identity digest. Publication is:

```text
exclusive temporary file
  -> complete canonical write
  -> fsync/close
  -> parse and full hash/identity validation
  -> atomic same-directory hard-link publication that cannot replace an existing name
  -> remove temporary link
  -> read and validate accepted artifact
```

Temporary files do not end in `.json` and are never candidates. Existing accepted files are
validated before reuse. A corrupt or conflicting existing file fails closed and is not repaired
or overwritten automatically. Real raw ledgers and produced runtime artifacts remain local and
are not repository artifacts.

## 5. Historical materializer

The CLI requires all of these inputs:

- governed ledger path;
- artifact root;
- one or more explicit physical cutoff ordinals;
- persisted expected full-file SHA-256;
- exact expected contract, trade date, session, and continuity epoch;
- governed trading-calendar path used by the existing session/trade-date resolver;
- explicit instrument tick size.

The reader hashes the complete source file while retaining only the physical prefix through the
largest requested cutoff. File size and modification time must remain stable across the read.
The expected SHA-256 must match. Each cutoff calls the unchanged merged CRU-34 snapshot export.
An unavailable CRU-34 result is not packaged as a valid historical artifact. The job records only
safe scale, hash, identity, timing, size, and quality summaries.

## 6. Bounded read-only adapter and truth states

The adapter module does not import CRU-34, the governed ledger reader, the chart cache, Shioaji,
or a `/latest` client. It reads at most one bounded artifact after deterministic selection.

Selection requires exact contract schema, `actualContract`, `tradeDate`, `session`, and
`continuityEpoch`. Candidates are scoped by their deterministic selection key and ordered by
physical cutoff ordinal. The newest exact-identity candidate is authoritative. If it is corrupt,
the adapter returns `UNAVAILABLE`; it never silently falls back to an older artifact.

Phase A truth states are:

- `HISTORICAL`: a valid exact-identity artifact, with no caller-supplied stale cutoff breached;
- `STALE`: a valid exact-identity artifact whose `availableAt` is older than an explicit
  caller-supplied freshness cutoff;
- `UNAVAILABLE`: missing, corrupt, oversized, incompatible, hash-invalid, identity-invalid, or
  no exact-identity artifact.

There is no implicit freshness threshold in V1. `LIVE` and `CURRENT` cannot be produced.

## 7. Phase B — future live-ready architecture (design only)

### 7.1 Process and failure domains

```text
Shioaji collector
  -> append-only governed ledger

independent projection worker
  -> verified checkpoint + bounded rolling state
  -> same Snapshot Contract V1 with sourceMode=LIVE
  -> atomic bounded read artifact/API

Dashboard
  -> read-only artifact/API
```

The collector performs no CRU-34 calculation and never waits for the projection worker. The
durable ledger is the recovery queue and source of truth. A worker or UI crash therefore does not
stop collection. No unbounded in-memory message queue is introduced.

### 7.2 Checkpoint storage and fields

The future checkpoint lives beside, but separately from, emitted snapshots in a local
content-addressed projection root. It uses an independently versioned schema and atomic immutable
publication plus one small replaceable pointer to the latest verified checkpoint.

The checkpoint stores:

- checkpoint schema/version and checkpoint hash;
- `sourceLedgerIdentity` plus the immutable ledger segment/file identity;
- `lastVerifiedLedgerOrdinal` and `lastVerifiedRecordHash`;
- `actualContract`, `tradeDate`, `session`, and `continuityEpoch`;
- last verified `availableAt` and event-time watermark;
- canonical rolling 60-second and 300-second state sufficient to reproduce every CRU-34 semantic
  output, including eligible Tick/BidAsk observations and continuity/availability status;
- materializer implementation/contract versions;
- last emitted snapshot identity/hash;
- operational counters such as processed ordinal, without promoting them into research meaning.

### 7.3 Restart validation and bounded suffix replay

On restart the worker:

1. validates checkpoint schema, safety boundary, canonical hash, and implementation compatibility;
2. confirms ledger identity and recomputes/verifies the checkpoint anchor at
   `lastVerifiedLedgerOrdinal`/`lastVerifiedRecordHash`;
3. rejects any contract, trade-date, session, or continuity-epoch mismatch;
4. restores rolling state only after all checks pass;
5. consumes the durable physical suffix from `lastVerifiedLedgerOrdinal + 1`;
6. preserves physical order and `availableAt=receivedAt` without timestamp sorting;
7. prunes rolling observations only after they are outside the 300-second horizon and cannot
   affect the 60-second horizon;
8. emits a new snapshot only after its complete cutoff is verified and atomically persisted.

If verification fails, the checkpoint is quarantined logically and no live-looking snapshot is
served. Recovery follows an explicit governed policy: find an earlier independently verified
checkpoint for the same immutable source identity or perform full GENESIS replay. It never resumes
from unverifiable in-memory state.

### 7.4 Boundary invalidation

- Reconnect or Tick/BidAsk partial recovery ends the joined continuity epoch. Rolling joined state
  is invalidated and warms up again only from lawful evidence in the new epoch.
- A changed `continuityEpoch` invalidates prior joined Tick/BidAsk state.
- Contract rollover starts a new projection identity; no prior-contract observation enters a new
  window.
- Session rollover closes the old session projection and starts a separately identified state.
- Trade-date rollover closes the prior trade-date projection even when wall-clock dates or night
  session timestamps are adjacent.

Checkpoints never cross these identity boundaries. Their old files remain immutable evidence.

### 7.5 Lag, backpressure, and stale behavior

The worker derives:

```text
lagRecords = ledgerLatestOrdinal - materializerProcessedOrdinal
lagMs = max(0, ledgerLatestAvailableAt - snapshot.availableAt)
```

It reads a bounded batch directly from the durable ledger, commits a verified checkpoint, then
continues. No unbounded queue is kept in memory. If append rate exceeds processing rate, the
collector continues, lag grows visibly, and the last snapshot becomes `STALE`/operationally
degraded according to a separately approved policy. V1 intentionally freezes no numeric lag
threshold without runtime evidence.

Snapshot emission is policy-driven after verified progress (for example, a bounded interval or
ordinal batch) and coalesces intermediate UI writes without dropping ledger truth. `availableAt`
comes from the maximum input availability actually used. Checkpoints use the same complete-write,
flush, validate, atomic-publish sequence as snapshots.

## 8. Full replay versus incremental equivalence contract

For the same source identity and cutoff, tests must compare canonical semantic fields exactly—not
approximately—between full GENESIS replay and verified-checkpoint plus bounded suffix replay:

- buy/sell/unknown/classified volume, net aggressive-flow proxy, Pressure Ratio, and Classified
  Coverage for 60s and 300s;
- Best Quote matched/unavailable volumes and coverage;
- best-quote classifications, conflict count, and conflict rate;
- response start/end price, point/tick displacement, and direction relation;
- Path Efficiency value/status/reason;
- quality status and ordered/deduplicated reasons;
- promotion state, methodology, limitations, and safety fields;
- actual contract, trade date, session, and continuity epoch;
- available-at, cutoff/max-used ordinal/hash, and source-ledger identity.

`semanticContentHash` must be identical. Operational fields such as `materializedAt`, writer
attempt metadata, checkpoint write time, and measured lag are excluded from semantic equality and
may differ. A mismatch is a blocking failure; there is no generic tolerance or “close enough.”

## 9. Explicit exclusions

This package does not modify CRU-34 formulas, provider classification, UNKNOWN handling, the 100%
coverage direction gate, quote eligibility, physical ordering, timestamps, continuity, Price
Response, Path Efficiency, or promotion semantics. It does not change the Shioaji collector,
subscriptions, bridge, Dashboard UI, Market Control, Market State, strategy, risk, broker, order,
position, or execution behavior.
