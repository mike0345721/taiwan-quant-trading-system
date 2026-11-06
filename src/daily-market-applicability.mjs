import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolveGovernedTradingDay, resolvePreviousGovernedTradingDate } from './market-state-forward-shadow-calendar.mjs';
import { loadOperatingCalendar } from './operating-calendar.mjs';

// Classify the requested date before testing row presence. Never substitute the
// last stored date for today, and never treat uncovered dates as missing data.
export function inspectDailyMarket({ tradeDate, databasePath, calendarPath, observedAt = null, exceptionEvidencePath = null, allowCandidate = false }) {
  let day, calendar;
  try {
    calendar = loadOperatingCalendar(calendarPath, { exceptionPaths: exceptionEvidencePath ? [exceptionEvidencePath] : [], allowCandidate });
    day = resolveGovernedTradingDay(calendar, tradeDate);
  } catch { return { status: 'UNKNOWN', tradeDate, applicability: 'UNKNOWN', reasonCode: 'CALENDAR_UNVERIFIED' }; }
  const identity = { tradeDate, calendarHash: calendar.fileHash,
    calendarExceptionHash: day.exceptionEvidence?.evidenceFileHash || null,
    applicability: day.officialTradingDay ? 'EXPECTED' : 'NOT_EXPECTED' };
  if (!day.officialTradingDay) return { ...identity, status: 'NOT_EXPECTED', reasonCode: 'MARKET_CLOSED',
    closureReasonCode: day.exceptionEvidence ? 'EXCHANGE_EMERGENCY_CLOSURE' : 'SCHEDULED_MARKET_HOLIDAY' };
  // Regular-session daily close, not NIGHT events or an official publication SLA.
  // This is diagnostic only: row presence and every existing release gate remain intact.
  const validTime = typeof observedAt === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(observedAt)
    && Number.isFinite(Date.parse(observedAt));
  const sessionCloseAt = `${tradeDate}T13:45:00+08:00`;
  const beforeClose = validTime && Date.parse(observedAt) >= Date.parse(`${tradeDate}T00:00:00+08:00`)
    && Date.parse(observedAt) < Date.parse(sessionCloseAt);
  let expectedCompletedTradeDate = validTime && Date.parse(observedAt) >= Date.parse(sessionCloseAt) ? tradeDate : null;
  if (beforeClose) {
    try { expectedCompletedTradeDate = resolvePreviousGovernedTradingDate(calendar, tradeDate); }
    catch { expectedCompletedTradeDate = null; }
  }
  Object.assign(identity, { observedAt: validTime ? observedAt : null, session: 'DAY', sessionCloseAt,
    dueState: beforeClose ? 'NOT_DUE' : 'UNKNOWN',
    reasonCode: beforeClose ? 'DAY_SESSION_NOT_ENDED' : 'PUBLICATION_TIME_UNVERIFIED',
    expectedCompletedTradeDate: validTime ? expectedCompletedTradeDate : null, officialPublishedAt: null,
    completedDateRow: { tradeDate: validTime ? expectedCompletedTradeDate : null, status: 'UNKNOWN' } });
  let db;
  try {
    if (!fs.existsSync(databasePath)) return { ...identity, status: 'UNKNOWN' };
    db = new DatabaseSync(databasePath, { readOnly: true });
    const row = db.prepare('SELECT trade_date FROM market_daily WHERE trade_date = ? LIMIT 1').get(tradeDate);
    if (identity.expectedCompletedTradeDate) {
      const completed = identity.expectedCompletedTradeDate === tradeDate ? row
        : db.prepare('SELECT trade_date FROM market_daily WHERE trade_date = ? LIMIT 1').get(identity.expectedCompletedTradeDate);
      identity.completedDateRow.status = completed ? 'PRESENT' : 'MISSING';
    }
    return { ...identity, status: row?.trade_date === tradeDate ? 'VALID' : 'MISSING' };
  } catch { return { ...identity, status: 'UNKNOWN' }; }
  finally { db?.close(); }
}
