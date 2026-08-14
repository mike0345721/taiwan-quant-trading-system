# DW-4 Evidence Conflict Monitor V1

Status: **THREE-AXIS CONTRACT CANDIDATE — UI NOT IMPLEMENTED / EVIDENCE NOT PROMOTED**

Captured at: 2026-08-14 Asia/Taipei

DW-4 summarizes already-governed evidence. It does not produce a score, confidence, BUY/SELL, recommendation, risk veto, order, or execution action. DW-2 remains the price-detail source and DW-3 remains the event-detail source.

## Corrected summary model

Conflict, coverage, and trust are independent axes. A quality limitation in one family cannot erase valid directional conflict among other eligible families.

### `conflictState`

| State | Deterministic meaning |
|---|---|
| `ALIGNED_UP` | Eligible directional evidence contains up and no down/internal conflict. |
| `ALIGNED_DOWN` | Eligible directional evidence contains down and no up/internal conflict. |
| `MIXED` | Eligible evidence contains both directions or an internal conflict. |
| `NO_DIRECTIONAL_EVIDENCE` | No eligible up/down/internal directional evidence exists. |

Only eligible directional evidence participates: source legally available, freshness legal, `availableAt` legal, quality contract permits directional use, and promotion state is `ELIGIBLE`.

### `coverageState`

| State | Deterministic meaning |
|---|---|
| `COMPLETE` | Every expected family has eligible evidence. |
| `PARTIAL` | At least one, but not every, expected family has eligible evidence. |
| `INSUFFICIENT` | No expected family has eligible evidence. |

The output retains `expectedEvidenceFamilies`, `eligibleEvidenceFamilies`, `unavailableEvidenceFamilies`, `staleEvidenceFamilies`, `qualityExcludedFamilies`, `promotionExcludedFamilies`, and `missingEvidenceFamilies`, plus transparent counts. Counts are not converted to confidence.

### `dataTrustState`

| State | Deterministic meaning |
|---|---|
| `PASS` | Coverage is complete and all expected families pass trust and promotion gates. |
| `DEGRADED` | Eligible evidence remains, but one or more families are unavailable, stale, missing, or not promoted. |
| `QUALITY_INSUFFICIENT` | Eligible evidence remains, while one or more expected families are excluded by quality. |
| `BLOCKED` | No eligible evidence remains, or an explicit snapshot-level safety/data contract blocks the snapshot. |

`BLOCKED` is not a directional state. `UNAVAILABLE`, `STALE`, and `QUALITY_INSUFFICIENT` are never converted to `NEUTRAL`.

## Evidence observation contract

Every evidence observation separates:

- `directionState`: `SUPPORTS_UP`, `SUPPORTS_DOWN`, `NEUTRAL`, `CONFLICT_INTERNAL`, `NOT_ELIGIBLE`
- `availabilityState`: `AVAILABLE`, `UNAVAILABLE`, `STALE`
- `qualityState`: `PASS`, `QUALITY_INSUFFICIENT`, `UNKNOWN`
- `promotionState`: `ELIGIBLE`, `RAW_ONLY`, `RESEARCH_ONLY`, `NOT_PROMOTED`

An observation may assert a direction only when all eligibility gates pass. There are no hidden weights or silent imputations.

## Known TX example

If Price is excluded because `TIMESTAMP_LINEAGE_INSUFFICIENT`, while Breadth/Futures/Options support up and Global supports down, the summary is:

```text
conflictState=MIXED
coverageState=PARTIAL
dataTrustState=QUALITY_INSUFFICIENT
qualityExcludedFamilies=Price
```

The known TX timestamp limitation remains visible; the DW-2 chart contract is unchanged.

## Evidence families and promotion

V1 families are Price Structure, Participation, Futures/Institutional, Options Context, and Global/FX. Data Trust is an axis, not a hidden directional vote.

Collection is not promotion:

`RAW_COLLECTION → COVERAGE_AUDIT → QUALITY_AUDIT → AVAILABLE_AT_AUDIT → DETERMINISTIC_REPLAY → DESCRIPTIVE_VALIDATION → OWNER_REVIEW → DW4_EVIDENCE_CANDIDATE`

IX0001 live breadth and TXO live chain remain `RAW_ONLY`. Neither can emit `SUPPORTS_UP` or `SUPPORTS_DOWN` under this PR.

## Future UI contract

The future DW-4 UI must show three separate rows:

```text
證據衝突：MIXED
完整度：PARTIAL
資料信任：QUALITY_INSUFFICIENT
```

Copy for ChatGPT may include the three axes and eligible/excluded/unavailable/stale/quality-warning lists, but never a magic confidence.

## Safety

`formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`, and `orderRoutesEnabled=false`. No Market State change, Forward Shadow mutation, strategy/risk promotion, broker route, Paper Trading, or automated trading is authorized.
