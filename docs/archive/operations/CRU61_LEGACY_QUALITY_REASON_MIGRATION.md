# CRU-61 legacy quality-reason preservation

Scope: PR #110 candidate engineering, based on
`34585218f273224a98316e142b1ea91270e87763`. Related review:
https://github.com/mike0345721/taiwan-quant-trading-system/pull/110#discussion_r4499549647

## Reproduced defect

The real producer adapter writes a legacy `.producer-fragment`, then migrates it
to its private SQLite history. With ticks received at 01:00, 01:02 and 01:03,
where the last tick's event time is 01:01, the original snapshot carries
`LATE_TRADE_CLOSED_BAR_NOT_REWRITTEN`. The previous migration copied quotes,
points and trades but omitted the reasons table. The same cutoff lost that
warning and changed its snapshot ID, even though the compact metadata retained
the warning. This was reproduced using synthetic inputs and native SQLite in
the cloud environment, not by accessing a running market-data service.

## Preservation contract

- Migration now includes a fourth, bounded reason phase under the existing
  2,000-record transaction budget. Cursor and rows commit together; publication
  waits for every phase. A restart resumes the cursor and does not duplicate rows.
- Reasons with original positive integer ledger ordinals keep their exact
  ordinal, available time, segment and code. Existing time and physical-prefix
  limits continue to apply to queries.
- Missing ordinals are never inferred from timestamps or replaced by zero.
  Their original metadata remains in `legacyReasons`; once their timestamp is
  reached, queries explicitly show `LEGACY_QUALITY_REASON_PREFIX_UNPROVEN`.
  The specific warning is exposed only when the whole retained legacy segment
  prefix is within the physical knowledge bound. An invalid available time
  remains unproven rather than becoming a precisely timed historical event.
- Already-migrated SQLite checkpoints can read the evidence preserved in compact
  metadata. A known original ordinal must match a retained point's segment and
  available time; indexed rows remain authoritative. No source-file rewrite or
  modification of old SQLite integrity receipts is needed.
- On upgrade, retained evidence and its prefix ceiling are frozen before new
  events are appended. The ceiling is capped by the published checkpoint's
  ordinal, even if private pending derivation already contains more points.
  Matching pending segments inherit this evidence only within the same source
  and cumulative origin. Ceiling queries use each checkpoint's own origin,
  including when a private derivation has already switched the active origin.
  Resuming an older release cannot move earlier warnings or carry them across
  a rolling-overlap reset.

## Verification

Permanent native-SQLite integration regressions in
`tests/market-observation-producer.test.mjs` cover:

1. Exact snapshots before/at the warning cutoff, restart, repeated reads and
   unchanged source/legacy bytes.
2. Missing ordinal, physical-prefix restriction and a trailing quote.
3. Separate contract segments.
4. A 1,600-warning migration interrupted inside the reason phase, with no
   published checkpoint until completion.
5. An injected transaction failure, rollback and successful retry.
6. Valid older SQLite checkpoint shapes with missing reason rows, both with and
   without ordinals, followed by new events and restart.
7. An older pending derivation (published ordinal 3 / private ordinal 503)
   completed after upgrade, preserving the historical snapshot.
8. A rolling-overlap reset to origin 4, interrupted during derivation and resumed
   from disk, without carrying warnings from the previous origin.

Relevant regression command:

```sh
node --test --test-reporter=tap tests/market-observation-producer.test.mjs tests/market-observation-store.test.mjs tests/market-observation-core.test.mjs tests/market-observation-source.test.mjs tests/market-observation-staged-input.test.mjs
```

## User-visible outcome and limits

After an authorized deployment of the candidate, upgrading a retained cache
will preserve applicable data-quality warnings in the observation snapshot,
CVD quality reasons and summary. Old evidence whose physical position cannot
be established is explicitly uncertain. This does not recover missing raw
market records or certify the accuracy of any historical market dataset.

This change does not provide a newly verified daily-use URL. Production version
pairing, actual browser login, desktop/mobile use, live observations, daily
writer, journal persistence, capacity and rollback remain separate acceptance
work. Synthetic regression success is not MSI, browser, LIVE or deployment
acceptance. No main merge, deployment, service, schedule, TLS/trust-policy or
order-route change is part of this repair.

`researchOnly=true`, `formalWeight=0`, `executionAuthorized=false`,
`orderRoutesEnabled=false`; AI remains disabled by the Owner.
