# CRU-55 performance candidate: pre-measurement contract

Authority: CRU-55 Owner continuation `515ded53-7552-4942-b7ba-91fc4d0017f3` and the 2026-09-23 implementation request. Base approved main `1ad9ec7c1814e401f8352048638f0a398bcf74fe`. PR72 is a separate unmerged updater and is not modified.

The provisional engineering targets are fixed before candidate measurement: frozen 62,000-record cold process to latest DAY authenticated API <=180 seconds; after complete catch-up, >=30 minutes at declared representative observed rate with append-to-API p95<=5s/p99<=10s, same-page visibility p95<=10s and no unexplained >30s publication gap; 2x normal rate for 60s drains to pre-burst backlog within 120s. They are not a formal SLA, full-day acceptance or Owner approval. Unpublished/timed-out samples remain in the denominator. No change to an existing stricter threshold is authorized.

Use identical original input hashes, order, cutoffs and append schedules, fresh output state, and sequential baseline/candidate runs. Record process startup separately from uncontrolled OS file cache. Preserve original receivedAt/available_at. Record experiment append/publication/API/browser clocks separately. Small fragments do not establish representative 1.95GB or natural DAY/NIGHT capacity.

Every actual publication still verifies the full original prefix and required prior evidence under the existing protection contract. Preserve integer/category results exactly, existing floating-point tolerance, missing/UNKNOWN, identity, continuity, six windows, chart, Relationship, Session and lawful Handoff. Resolver/output identifiers may differ and must not be falsified.

No merge, formal 8787 switch, formal binding/writer, collector interruption, formal raw lease, frozen contract change or execution authorization. Safety: formalWeight=0, researchOnly=true, executionAuthorized=false, orderRoutesEnabled=false.
