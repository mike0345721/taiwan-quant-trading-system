# Research depth receipt cutoff

The authenticated research endpoint freezes `now` before loading Flow and the
latest quote. A live ledger can advance during those reads. Previously the
bounded quote reader selected the newest record even when its receipt occurred
after that frozen cutoff, and the unchanged L5 gate correctly rejected it as
`SOURCE_TIME_NOT_KNOWN_AS_OF`.

## Observed failure

On 2026-11-02, a read-only reproduction using the endpoint's read order froze
the cutoff at `10:21:19.330+08:00`. It then selected an exchange timestamp of
`10:21:19.331` and a receipt of `10:21:19.336+08:00`. The read completed 13 ms
after the cutoff. The same quote failed at the original cutoff and passed at
the later time. This establishes an acquisition race; it does not justify
relaxing future-source or clock checks.

## Reader behavior

The reader retains the frozen cutoff and its existing 1 MiB, current-day-only
read. It verifies each candidate TX quote's record hash and zoned receipt time,
then skips only receipts later than the cutoff. Nanosecond precision is kept.
The first record already received at the cutoff is returned unchanged.

The reader does not search past an arrived quote's quality failure. Source
time later than receipt, stale data, wrong identity, invalid depth, duplicate
or sequence-gap evidence still fail the original L5 gate. A malformed receipt
or invalid record hash fails closed, including when the record claims a future
receipt. An older selected quote keeps its original source time and expiry.
No timestamp, raw ledger, eligibility threshold, authentication boundary,
broker behavior, or trading permission changes.

## Verification

- Reader and L5 regression: 22 passed, 0 failed; new regression cases cover the
  append race, exact cutoff and 1 ns future receipt, corrupted later records,
  genuine source-clock errors, stale selected data and malformed receipt time.
- Isolated authenticated HTTP regression: 1 passed, including login, protected
  GET, no-store response, rejected POST and logout/CSRF checks.
- Synthetic browser regression: 2 passed at 390 px and 1366 px, including
  clearing expired values and retaining unavailable research outcomes.

These are engineering checks. Real candidate deployment and subsequent live
browser verification are separate and must not be inferred from this report.
