import { resolveGovernedTradingDay } from './market-state-forward-shadow-calendar.mjs';

const TAIPEI = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function dateBefore(value) {
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function localParts(now) {
  const parts = Object.fromEntries(TAIPEI.formatToParts(now)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// Civil-day emergency closures suppress quote expectations, never prior-night
// historical event identity (10/22 NIGHT remains historical when 10/23 closes).
export function assessTaifexMarketSession(now, calendar) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return Object.freeze({ state: 'UNAVAILABLE', marketShouldBeActive: false, reasonCode: 'CALENDAR_UNVERIFIED' });
  }
  const local = localParts(now);
  let tradingDay;
  try {
    tradingDay = resolveGovernedTradingDay(calendar, local.date);
  } catch {
    return Object.freeze({ state: 'UNAVAILABLE', marketShouldBeActive: false, reasonCode: 'CALENDAR_UNVERIFIED' });
  }
  // 00:00-04:59 belongs to the previous trading day's NIGHT session.
  // A civil-day typhoon closure must not erase the still-open prior night.
  if (local.minutes < 5 * 60) {
    try {
      if (resolveGovernedTradingDay(calendar, dateBefore(local.date)).officialTradingDay === true) {
        return Object.freeze({ state: 'NIGHT', marketShouldBeActive: true });
      }
    } catch {
      return Object.freeze({ state: 'UNAVAILABLE', marketShouldBeActive: false, reasonCode: 'CALENDAR_UNVERIFIED' });
    }
  }
  if (!tradingDay.officialTradingDay) {
    const exceptional = tradingDay.state === 'NON_TRADING_DAY_EXCEPTION';
    return Object.freeze({
      state: 'MARKET_CLOSED',
      marketShouldBeActive: false,
      reasonCode: exceptional ? 'EXCHANGE_EMERGENCY_CLOSURE' : 'SCHEDULED_MARKET_HOLIDAY',
      calendarDate: local.date,
      evidenceFileHash: exceptional ? tradingDay.exceptionEvidence?.evidenceFileHash || null : null,
    });
  }
  if (local.minutes >= 8 * 60 + 45 && local.minutes < 13 * 60 + 45) {
    return Object.freeze({ state: 'DAY', marketShouldBeActive: true });
  }
  if (local.minutes >= 15 * 60) {
    return Object.freeze({ state: 'NIGHT', marketShouldBeActive: true });
  }
  return Object.freeze({ state: 'SESSION_CLOSED', marketShouldBeActive: false });
}
