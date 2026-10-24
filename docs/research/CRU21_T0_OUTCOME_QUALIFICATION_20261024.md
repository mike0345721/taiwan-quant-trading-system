# Risk missing values, T0 linkage and corpus qualification

Owner scope: fix missing risk inputs first, advance read-only data qualification and
signal-to-Outcome linkage using the single frozen T0 baseline. This branch is stacked
on PR96 `936c20b4939e416d25565f3c3a0947e58dfd5b13`; no UI, server, collector,
scheduler, broker route, frozen specification or original ledger is edited.

## Risk contract

`null`, undefined, blanks, booleans, objects, arrays and non-finite values remain
unknown. Real zero and numeric database strings remain valid. A risk level requires
at least one evaluable observation: VIX change, VIX plus threshold, ATM IV plus
threshold, or skew plus threshold. Missing thresholds cannot become zero or imply
normal risk. Missing short-position operands cannot become a synthetic change.
An all-missing database summary yields `unknown` and 資料不足，暫停採取方向部位.
Existing high/medium/low thresholds are unchanged; this is not a trading rule.

## Fixed baseline linkage

`scripts/run-t0-outcome-qualification.mjs` reads the existing T0 artifacts and paper
ledger. Repository closeout pins bind the historical manifest and ledger bytes;
each job hash and strict session identity is checked. All ledger events must match
the frozen state-machine reconstruction, including payloads and intent IDs. Every
cost view is recomputed with the existing frozen cost implementation, including
its original rounding. PR96's separate conservative replay cost convention is not
substituted. Input files are hashed again after the linkage to detect changes.

The output includes every fixed baseline session, intent/event ID, side, entry,
exit, stop, MFE, signed MAE and positive MAE magnitude; fees, tax, slippage, gross
and net exit P&L; hypothetical net liquidation extrema; and diagnostic rule tags.
MFE/MAE cover entry through the frozen strategy exit as required by T0. No-trade
rows retain null trade metrics while remaining in the denominator. Actual realized
P&L is null because the source is paper replay. Failure tags are rule diagnostics,
not proven causal explanations. Extrema timestamps were not stored, so remain null.
For stop exits, the later scheduled-horizon P&L is also null, not reconstructed from
the already closed trade. A future raw-path extension must preserve this distinction.

Legacy `breakoutConfirmedAt` stores the confirmation bar START. The new projection
retains that field as `legacyConfirmationBarStartAt`, and exposes the completed
bar time (+5 minutes) as `signalAvailableAt`. This is historical logical availability,
not a measured forward receipt. The frozen source is not rewritten. All projected
rows have `forwardEligible=false` and `oosEligible=false`.

## Corpus qualification boundary

Stage 1 enumerates only the specified `data/live-events` root and bounded existing
audit metadata. File dates remain calendar dates, not guessed trading sessions.
Optional prior session screening is bound to its existing local receipt and marked
historical/unrevalidated. Previous classifications are not promoted to current ones.
A missing assessment stays null, not zero eligible days and not an automatic Reject.

An optional tail probe reads at most 1 MiB, validates each complete record hash and
local chain continuity, and reuses canonical `projectGovernedL5` at each historical
receipt time. The sample does not attest the complete file, omitted prefix,
collector losses, session boundaries, native sequence, CVD, Pressure, Response or
Path completeness. The calendar hash is exposed; the frozen base mapping does not
revalidate later emergency exceptions. Market session eligibility remains null.
No historical quote is described as currently fresh or LIVE.

Full A/B/C/D classification and incremental depth/no-trade OOS value remain pending.
Do not treat Stage 1, a valid field sample, or 137 old T0 sessions as their acceptance.
The existing CRU56/CRU34/CRU50 semantic contracts and frozen statistical gates remain
unchanged; this implementation introduces no second Flow/CVD formula or new strategy.

## Reproduce

Node 22+; dependency installation follows the repository lockfile. Create the
isolated `data/research-validation` directory first. Use a NEW output filename:

```powershell
node scripts/run-t0-outcome-qualification.mjs 'D:/Taiwan stock/standalone-v1' data/research-validation/t0-qualification-NEW.json 'D:/Taiwan stock/standalone-v1/data/research/microstructure-corpus-audit-v1/run-2026-09-15T12-07-02-569Z/session-screening.json' 2026-10-22
```

Use `-` for no prior screening, or omit both optional arguments for metadata only.
The output must be a new JSON file directly inside this checkout's isolated
research-validation root. Overwrites, outside outputs and missing/hash-mismatched
baseline sources fail closed. No writes to the source root are performed.
Exit 0 means the historical linkage ran successfully with an explicitly pending
microstructure qualification. Exit 2 indicates blocked input/probe/output. Exit 0
never means complete corpus eligibility, positive edge or OOS validation.

Focused validation:

```powershell
node --test tests/v362-risk.test.mjs tests/t0-outcome-linkage.test.mjs tests/research-corpus-inventory.test.mjs tests/microstructure-outcome-research-v1.test.mjs tests/research-replay-outcome.test.mjs tests/research-incremental-oos.test.mjs tests/research-outcome-cli.test.mjs tests/six-axis-shadow.test.mjs
npm run security:scan
```

Initial real-source run: 137 sessions, 133 linked signals, 4 no-trade sessions;
all five cost views match frozen results. The 86 calendar files total 125,099,110,549
bytes. Historical screening contains 14 rows: 12 applicable and 2 previously
excluded for market closure. These counts are inventory, not qualified sample size.
Final exact-HEAD evidence and review verdicts belong in the delivery receipt/PR.

## Remaining acceptance

1. Revalidate the best existing session-prefix receipts with current governed
   calendar/exception and same-contract continuity evidence, then replay existing
   canonical CVD/Pressure/Response/Path semantics under a bounded read plan.
2. Assign A/B/C/D only to assessed sessions, with eligible windows and reason codes;
   keep unknown/unassessed records separate and preserve failed evidence.
3. Join qualified pre-signal depth/Flow to the fixed baseline without modifying its
   entry, stop, exit, denominator or costs. Obtain genuinely new/untouched samples
   before any incremental OOS inference; no matrix expansion or parameter search.
4. Extrema timestamps and post-stop scheduled-horizon metrics require bound raw-path
   evidence. Do not fill them from aggregate bars or claim they are complete now.

Safety: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`,
`orderRoutesEnabled=false`. Draft only. Product Owner approval required before merge.
