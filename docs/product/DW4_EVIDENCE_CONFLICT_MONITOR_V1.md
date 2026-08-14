# DW-4 Evidence Conflict Monitor V1

Status: **CONTRACT CANDIDATE — NOT PROMOTED**

Captured at: 2026-08-14 Asia/Taipei

Authority: Product Owner decision; implementation remains Draft PR only.

## Purpose

DW-4 answers whether the currently available evidence is aligned, mixed, insufficient, stale, or quality-blocked. It does not calculate a bullish/bearish score and does not produce BUY, SELL, entry, exit, order, position, or execution instructions.

DW-4 summarizes evidence already governed elsewhere. Price detail remains in DW-2; event detail remains in DW-3. DW-4 must link to those facts instead of duplicating their engines.

## Evidence states

| State | Meaning |
|---|---|
| `SUPPORTS_UP` | A promoted, time-aligned evidence contract supports upward direction. |
| `SUPPORTS_DOWN` | A promoted, time-aligned evidence contract supports downward direction. |
| `NEUTRAL` | A valid evidence contract is available and is explicitly neutral. |
| `CONFLICT_INTERNAL` | One evidence family is internally contradictory. |
| `UNAVAILABLE` | The required evidence is absent or cannot be legally used. |
| `STALE` | Evidence exists but is outside its governed freshness contract. |
| `QUALITY_INSUFFICIENT` | Evidence exists but does not pass its governed quality contract. |

`UNAVAILABLE`, `STALE`, and `QUALITY_INSUFFICIENT` are never converted to `NEUTRAL`.

## Top-level conflict states

| State | Transparent rule |
|---|---|
| `QUALITY_BLOCKED` | At least one required V1 evidence item is `QUALITY_INSUFFICIENT`. |
| `INSUFFICIENT_EVIDENCE` | A required V1 item is `UNAVAILABLE` or `STALE`, or no required evidence exists. |
| `MIXED` | Valid required evidence includes both directions, or `CONFLICT_INTERNAL`. |
| `ALIGNED_UP` | Valid required directional evidence supports only up. |
| `ALIGNED_DOWN` | Valid required directional evidence supports only down. |

The precedence above is explicit. There are no hidden weights, confidence numbers, magic scores, or silent imputation.

## V1 evidence families

1. **Price structure** — TX price, session VWAP, frozen DAY Opening Range, session high/low.
2. **Participation** — governed TWSE breadth; intraday IX0001 breadth remains a raw candidate until its coverage and semantics are frozen.
3. **Futures / institutional** — foreign cash, same-contract futures OI and basis under their governed publication contract.
4. **Options context** — EOD OI/PCR/strike structure; intraday chain/IV/skew remain research collection candidates.
5. **Global / FX** — SOX, NDX proxy, VIX, and daily USD/TWD with explicit EOD/delayed/proxy labels.
6. **Data Trust** — freshness, source trade date, availableAt, quality, and collector health.

## Example

If price structure is `SUPPORTS_UP`, governed breadth is `SUPPORTS_DOWN`, futures is `NEUTRAL`, options is `SUPPORTS_UP`, and global is `SUPPORTS_DOWN`, the result is `MIXED`. No score is produced.

If TX price exists but its timestamp lineage remains insufficient, the price family is `QUALITY_INSUFFICIENT` and the top-level result is `QUALITY_BLOCKED`; the chart can still remain visible under its existing research-quality contract.

## Promotion gate

Collection is not promotion. Every new source must pass, in order:

`RAW_COLLECTION → COVERAGE_AUDIT → QUALITY_AUDIT → AVAILABLE_AT_AUDIT → DETERMINISTIC_REPLAY → DESCRIPTIVE_VALIDATION → OWNER_REVIEW → DW4_EVIDENCE_CANDIDATE`

Only a later explicit Product Owner decision may promote a candidate to formal DW-4 evidence. Nothing in this document changes Market State, Forward Shadow, a strategy, a risk veto, or execution authorization.

## Safety invariants

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`
- no broker route
- no automated trading
