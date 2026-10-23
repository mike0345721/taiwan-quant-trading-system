# BLAVE-inspired validation QA closeout

PR95 extends PR92 without broker, model, network, ledger writes or production promotion. The adapter is independently implemented; no third-party strategy or performance claim is adopted.

Purged walk-forward now requires valid non-overlapping chronological OOS folds, finite predictions, unique valid dates inside exactly one fold and per-fold sample counts matching testDays. Repeated folds and 24 null/duplicate observations cannot satisfy the structural gate. The readonly CLI rejects a data-root junction escaping the isolated worktree before reading input.

A successful structural gate means OOS_STRUCTURE_CHECK_ONLY. It does not authenticate the dataset, establish sufficient forward evidence, prove positive EV or authorize trading. PR90 sampled lower-bound outcomes remain unsuitable for full costed-trade replay. Missing complete governed entry/exit paths remain BLOCKED; no artificial replacement corpus is produced.

Rollback: retain input files and receipts unchanged; inspect previous QA e5e1aedc1ff561e4e418c82344ffcaa9da590b36 in a separate worktree. No production switch occurred. The original PR92 base is 1def44f6528f27dad2d292ab4882173a9815c964. All receipts retain formalWeight=0, researchOnly=true, executionAuthorized=false, orderRoutesEnabled=false.
