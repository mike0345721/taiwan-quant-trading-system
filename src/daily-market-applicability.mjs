import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadGovernedTradingCalendar, resolveGovernedTradingDay } from './market-state-forward-shadow-calendar.mjs';

// Classify the requested date before testing row presence. Never substitute the
// last stored date for today, and never treat uncovered dates as missing data.
export function inspectDailyMarket({ tradeDate, databasePath, calendarPath }) {
  let day, calendar;
  try {
    calendar = loadGovernedTradingCalendar(calendarPath);
    day = resolveGovernedTradingDay(calendar, tradeDate);
  } catch { return { status: 'UNKNOWN', tradeDate, applicability: 'UNKNOWN', reasonCode: 'CALENDAR_UNVERIFIED' }; }
  const identity = { tradeDate, calendarHash: calendar.fileHash, applicability: day.officialTradingDay ? 'EXPECTED' : 'NOT_EXPECTED' };
  if (!day.officialTradingDay) return { ...identity, status: 'NOT_EXPECTED', reasonCode: 'MARKET_CLOSED' };
  let db;
  try {
    if (!fs.existsSync(databasePath)) return { ...identity, status: 'UNKNOWN' };
    db = new DatabaseSync(databasePath, { readOnly: true });
    const row = db.prepare('SELECT trade_date FROM market_daily WHERE trade_date = ? LIMIT 1').get(tradeDate);
    return { ...identity, status: row?.trade_date === tradeDate ? 'VALID' : 'MISSING' };
  } catch { return { ...identity, status: 'UNKNOWN' }; }
  finally { db?.close(); }
}
