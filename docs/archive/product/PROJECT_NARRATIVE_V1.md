# Project Narrative V1

> Status: CURRENT NARRATIVE / GOVERNANCE DESCRIPTION  
> Date: 2026-09-06  
> Authority: This document describes project identity and operating philosophy. It does **not** authorize scope. Linear remains the only CURRENT/NEXT source; Owner decisions outrank this document.

## 1. What this project is

This project is a Taiwan-market quantitative research and decision system centered on TX / TXO, designed to turn market evidence into a governed chain of reasoning rather than a black-box directional predictor.

Canonical narrative:

> **Data Truth → Position → Pressure → Expected vs Actual Response → Cross-Market → Path Efficiency → Market Control → Market State → Decision / Strategy Candidate → Risk → Paper / Future Execution → Outcome / Reconciliation / Failure Evidence → Research**

The product is not merely a chip-flow dashboard and is not yet an automated trading system.

## 2. Product mission

Build a system that can answer, with evidence:

1. What is the current market state?
2. What positions / structures may be exerting pressure?
3. What flow or price response was expected?
4. What response actually occurred?
5. Did offshore / global markets confirm or contradict the local move?
6. Was the price path efficient or effort-heavy?
7. Who appears to have market control, and with what confidence?
8. Which validated strategy, if any, is eligible in this state?
9. What does Risk allow, reduce, or veto?
10. What happened afterward, and did the evidence have repeatable EV?

## 3. Core principles

### Truth before Intelligence

> **Truth cannot be discounted; Intelligence can mature progressively.**

The following must remain strict and fail-closed:

- source identity;
- canonical instrument / contract / expiry;
- tradeDate / session / timezone;
- eventTime / receivedAt / availableAt;
- missing / unknown semantics;
- sequence / continuity / reconnect evidence;
- immutable raw hash / lineage;
- replay legality;
- license / entitlement / usage eligibility.

The following may mature progressively, but may not pretend to be validated:

- Expected Response;
- Market Control;
- Market State;
- Confidence / contradiction;
- strategy suitability;
- Dealer / Gamma scenarios.

### Risk-first

> **Survival > Win Rate > Return.**

A high win rate is not a product goal if tail loss, leverage, liquidity, data integrity or operational failure can destroy the account.

Long-term architecture requires Risk to have veto authority over Strategy and Execution.

### No Fake Intelligence

- A table existing does not mean a dataset is AVAILABLE.
- A dataset existing does not mean it is licensed, complete or point-in-time valid.
- A model existing does not mean it has Edge.
- A dashboard card existing does not mean the underlying capability is promoted.
- Unknown must stay Unknown, not 0 / Neutral.
- Public OI cannot be relabeled as true Dealer Position / Dealer Cost.

### Evidence over narrative

No persisted evidence = `NOT_VERIFIED`.

Historical data can reconstruct market paths; it cannot reconstruct what the system actually knew at that time unless governed point-in-time evidence exists.

## 4. Data philosophy — Acquisition & Evidence, not collection for collection's sake

The Data capability chooses the smallest governed source that can answer the research question.

Acquisition modes:

```text
Official Download
Historical Vendor
Existing Data
Forward Capture
Derived
Own Record
        ↓
Canonicalization
        ↓
Quality / Lineage
        ↓
Replay
```

### Historical-first

Before building a new collector:

1. identify the canonical Dataset ID;
2. state the research question and `required_by` dependency;
3. determine minimum sufficient granularity;
4. check existing / official / vendor historical availability;
5. check identity, license, timestamp, retention, replay and cost;
6. only Forward Collect the remaining necessary gap.

Do not default to Tick / BBO / Depth when 1m / Daily is sufficient.

### Master Data Requirements

The canonical requirement registry is:

- `config/data-requirements-v1.json`
- `docs/data/MASTER_DATA_REQUIREMENTS_V1.md`

New datasets must enter the Master before they enter formal research or collection implementation.

## 5. Market Intelligence model

### Position

Who is structurally exposed and where?

Examples: institutions, futures OI, TXO strike/expiry OI, large-trader structure, future governed Greeks / positioning estimates.

### Pressure

What observable effort is occurring now?

Examples: executed trade proxies, CVD-style evidence, quote cross-checks, volume intensity, volatility / options structure.

### Expected vs Actual Response

The most important comparison is not just whether pressure is bullish or bearish, but whether price responds as expected.

Examples:

- strong buy effort + strong upside response → confirmation candidate;
- strong buy effort + weak / negative response → effort-failure / absorption candidate;
- weak observed effort + large move → hidden / external driver candidate.

These remain research labels until validated.

### Cross-Market

Cross-market evidence explains repricing and contradiction; it does not automatically generate Buy / Sell.

Current primary research candidates:

- SGX TWN;
- CME NQ;
- SOX;
- USD/TWD;
- versioned Taiwan index weights / contribution.

TX / TWN point values are not a direct arbitrage spread. Canonical identity and normalized-return semantics must be respected.

### Path Efficiency

Measure how directly price travels relative to total path length. This is descriptive evidence, not a standalone signal.

### Market Control / Market State

Market State should summarize evidence, conflicts, uncertainty and strategy suitability. It must not become a mystical directional oracle.

## 6. Research philosophy

Research exists to reject weak ideas, not protect them.

Promotion path:

```text
Hypothesis
→ Frozen Protocol
→ Historical Backtest
→ OOS / Walk-Forward
→ Stress / Ablation / Cost
→ Forward Evidence
→ Owner Review
→ Shadow Candidate
→ Paper
→ Small Capital
→ Production
```

Negative results are first-class evidence.

No retuning, threshold rescue, backfill or role redefinition is allowed merely because a result is disappointing.

## 7. Current lanes

### Product lane

`CRU-5 P0 Forward Paper Validation`

Current blocker: `CRU-9` fresh eligible real-trading-day acceptance.

Then:

`CRU-10 5-Day Smoke → CRU-11 20-Day Operational Gate`.

### Isolated research lane

`CRU-38 Cross-Market Source Readiness V1`.

It uses Master Dataset IDs and Historical-first evaluation. Source research does not itself authorize purchase, registration, scraping, collection or formal model weight.

## 8. Capability boundaries

### Current / functional foundations

- governed official Taiwan market data;
- local dashboard / research APIs;
- Shioaji market-data-only bridge foundation;
- deterministic replay and point-in-time research tooling;
- TX pressure / response / path evidence;
- options structure / OI / IV research foundations;
- observed-flow decision surfaces;
- paper / forward observer infrastructure;
- Master Data Requirements registry;
- Cross-Market semantics and source-readiness framework.

### Not yet promoted

- formally validated strategy;
- formal Market Control / Market State trading dependency;
- Risk Engine V1;
- trading-grade position / reconciliation;
- live broker execution.

## 9. Product maturity path

```text
Stage 1  Owner-only Research & Paper
→ Stage 2 Owner Small Capital
→ Stage 3 Closed Beta
→ Stage 4 Multi-user Product
→ Stage 5 Commercial Operations
```

Each stage must earn the next stage through evidence, not aspiration.

## 10. AI / Agent roles

- **Owner**: final authority on product, scope, promotion and merge.
- **ChatGPT**: project brain / PM / reviewer / research designer / connected-source operator.
- **Codex**: local runtime engineer, implementation, Windows / SQLite / Shioaji / browser and local evidence work.
- **Agent**: temporary executor, not a permanent department.
- **Department / Domain**: long-term capability boundary.

LLMs must not become the single point of failure for real-time core risk or execution.

## 11. Source of Truth

- Notion: Vision, Owner Decisions, Architecture, Research Conclusions.
- Linear: only CURRENT / NEXT, Work Packages, Bugs, Blockers, Acceptance State.
- GitHub main: Owner-approved implementation and specs.
- Immutable Manifest / Ledger / Frozen Artifact: evidence.
- Local Runtime / Preservation: operational truth.

A stale roadmap/status document never overrides current Linear or immutable evidence.

## 12. Safety invariants

```text
formalWeight=0          # for unpromoted research capability
researchOnly=true
executionAuthorized=false
orderRoutesEnabled=false
```

Any future change to execution authorization requires a separate explicit Owner decision and appropriate Data / Strategy / Risk / Position / Operations gates.
