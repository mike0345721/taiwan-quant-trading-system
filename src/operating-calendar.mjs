import fs from 'node:fs';
import path from 'node:path';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';

// Overlay operating-day evidence without rewriting the frozen base or historical
// chart calendar. Conflicting evidence requires a new explicit governance decision.
export function loadOperatingCalendar(calendarPath, { exceptionPaths = [], allowCandidate = false } = {}) {
  const base = loadGovernedTradingCalendar(calendarPath);
  const bundled = path.join(path.dirname(calendarPath), 'taifex-emergency-closure-20261023.json');
  const paths = [...new Set([...exceptionPaths.filter(Boolean), ...(fs.existsSync(bundled) ? [bundled] : [])])];
  const exceptions = new Map(base.exceptions);
  const pendingCandidateDates = new Set();
  for (const evidencePath of paths) {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const overlay = loadGovernedTradingCalendar(calendarPath, evidencePath);
    if (evidence.approvalScope === 'ISOLATED_RESEARCH_CANDIDATE_ONLY' && !allowCandidate) {
      for (const date of overlay.exceptions.keys()) pendingCandidateDates.add(date);
      continue;
    }
    for (const [date, item] of overlay.exceptions) {
      const prior = exceptions.get(date);
      if (prior && JSON.stringify(prior) !== JSON.stringify(item))
        throw Error('OPERATING_CALENDAR_EXCEPTION_CONFLICT');
      exceptions.set(date, item);
    }
  }
  return Object.freeze({ ...base, exceptions, pendingCandidateDates });
}
