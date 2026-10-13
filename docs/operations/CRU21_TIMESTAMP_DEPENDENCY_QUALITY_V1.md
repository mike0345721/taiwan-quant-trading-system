# CRU-21 timestamp dependency quality V1

The subsequent Owner-scoped [source-time structure contract](CRU21_SOURCE_TIME_STRUCTURE_V1.md)
adds a separate LIVE descriptive calculation capability. All quality restrictions
and the `restoresTargets=false` meaning of this module's clean-window observation
remain unchanged; that observation alone never grants the new capability.

Scope: repair inconsistent per-value quality after the existing timestamp-lineage
session gate has restricted a chart. This is NOT a new trading rule, clock
correction, acceptable-skew tolerance, or permission to promote a session.

## Invariants

- Raw ledger records and all prices, OHLC, volume, VWAP values, and availableAt
  values are unchanged. The conservative max(received, exchange) policy remains.
- A bar containing a known adverse timestamp is restricted. Independent later
  clean bars are not falsely relabelled as containing that old event.
- Session cumulative VWAP and high/low retain restrictions from all known inputs
  they depend on. A clean suffix does not repair them.
- Opening Range depends only on its frozen 08:45-inclusive / 09:00-exclusive
  inputs. Restricted OR cannot claim READY; later violations do not contaminate
  the earlier frozen range. Day and night dependency scopes remain separate.
- Prior-day references are governed independently, never rewritten by this fix.
- Exact closing-boundary events follow the existing preceding-bucket semantics.
- Known violations from another contract cannot annotate this contract's values;
  the existing overall session gate is not loosened by this helper.

## Descriptive local-window assessment

`timestampDependencyQuality.recentWindow` checks the last 12 consecutive completed
5-minute bars after the last known violation, their existing quality, identity,
bar adjacency, and current source freshness. Missing/forming/stale evidence or a
new violation prevents `CLEAN_LOCAL_BARS_OBSERVED`.

This state reports only observed timestamp and existing bar quality. It does NOT
certify feed completeness, native sequence coverage, true exchange clock accuracy,
local structure importance, or trading edge. `restoresSessionQuality=false` and
`restoresTargets=false` are unconditional. The existing target/threshold/R:R gate
stays in place. Automatic local-only target recovery needs a separately reviewed
source-dependency contract and is NOT activated by this repair.

## Verification

`node --test tests/chart-timestamp-dependency-quality.test.mjs`

Regression coverage includes dirty-to-clean and clean-to-dirty transitions,
forming/missing bars, stale sources, raw-byte preservation, frozen OR windows,
exact close, day/night isolation, future exclusion and immutable input objects.
