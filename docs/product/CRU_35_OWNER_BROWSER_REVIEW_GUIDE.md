# CRU-35 Owner Browser Review Guide

This is a bounded, read-only Product Owner review of Observed Flow Evidence. It does not authorize trading, production promotion, a live materializer, or any order route. Expected review time: 10 minutes or less.

## Start the exact local review runtime

Open PowerShell and run:

```powershell
cd "D:\Taiwan stock\standalone-v1\data\worktrees\cru35-observed-flow-evidence-ui-preview-v1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-cru35-owner-review.ps1" -ProjectRoot "D:\Taiwan stock\standalone-v1\data\worktrees\cru35-observed-flow-evidence-ui-preview-v1" -PrerequisiteRoot "D:\Taiwan stock\standalone-v1" -ArtifactPath "D:\Taiwan stock\standalone-v1\data\live-events\derived\cru34-snapshot-v1\a316d2f80f6b6ed1e406814e.0000000000163114.aab98ea7a48086bfd7f5c8aae9e1298137a929c6021b9fa80a14a5ce8532e7d9.json" -Port 8788
```

The launcher validates the artifact through the governed CRU-36 reader before starting. Open `http://127.0.0.1:8788/`, sign in with the existing local review password, and keep the PowerShell window open. Press `Ctrl+C` when finished.

## Review checklist

- Market Pulse remains first, Observed Flow is immediately after it, Leadership follows, and the K-line remains the primary surface.
- Observed Flow visibly says `RESEARCH`, `NOT A TRADING SIGNAL`, and `NOT PROMOTED`.
- `60s` and `300s` each show Observed Pressure Ratio, Price Response, and Path Efficiency even while Evidence Quality is `QUALITY_INSUFFICIENT`.
- Classified Coverage, source state, actual contract, trade date, session lineage in the drawer, and `availableAt` are understandable and truthful.
- `查看證據 >` opens the existing right drawer. It includes raw pressure volumes, conflict/cross-check fields, response values, quality reasons, lineage, artifact hashes, methodology, and limitations.
- `Esc` closes the drawer and focus returns to the trigger.
- Copy Snapshot / Ask GPT includes the bounded Observed Flow summary and does not imply a recommendation.
- Check 1920, 1680, 1536, 1440, and 1366 widths. There must be no horizontal overflow, clipping, card overlap, or unreadable text.

## Expected truth for the supplied artifact

- Source: `HISTORICAL`, contract `TXFI6`, trade date `2026-08-28`, session `DAY`.
- Evidence Quality: `QUALITY_INSUFFICIENT`; reason `PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE`.
- Formal Direction: `NOT PROMOTED`; formal weight remains zero.
- The values are descriptive research evidence only. They are not BUY/SELL, Market State, a recommendation, or an execution authorization.

If the artifact is missing, altered, or invalid, the launcher must stop. If a refresh fails after a successful load, the UI must clear old Observed Flow values and show an explicit unavailable reason. Do not approve if prior values remain visible or the UI silently returns to Ready.
