import fs from 'node:fs';
import { digest } from './market-state-forward-shadow.mjs';

function date(value, code) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error(code);
  return value;
}

export function loadGovernedTradingCalendar(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_NOT_CONFIGURED');
  const bytes = fs.readFileSync(filePath);
  const payload = JSON.parse(bytes.toString('utf8'));
  if (payload.schemaVersion !== 'taifex-governed-trading-calendar-v1') {
    throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_SCHEMA_INVALID');
  }
  if (payload.sourceType !== 'TAIFEX_OFFICIAL_CALENDAR_SNAPSHOT' || payload.ownerApproved !== true) {
    throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_GOVERNANCE_INVALID');
  }
  if (!Array.isArray(payload.tradingDates) || !Array.isArray(payload.nonTradingDates)) {
    throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_DATES_REQUIRED');
  }
  const tradingDates = payload.tradingDates.map((value) => date(value, 'FORWARD_SHADOW_TRADING_DATE_INVALID'));
  const nonTradingDates = payload.nonTradingDates.map((value) => date(value, 'FORWARD_SHADOW_NON_TRADING_DATE_INVALID'));
  if (new Set(tradingDates).size !== tradingDates.length || new Set(nonTradingDates).size !== nonTradingDates.length) {
    throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_DUPLICATE_DATE');
  }
  if (tradingDates.some((value) => nonTradingDates.includes(value))) {
    throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_CONFLICT');
  }
  if (!/^[a-f0-9]{64}$/.test(payload.sourceHash || '')) throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_SOURCE_HASH_REQUIRED');
  return Object.freeze({ payload, fileHash: digest(bytes), tradingDates: new Set(tradingDates), nonTradingDates: new Set(nonTradingDates) });
}

export function resolveGovernedTradingDay(calendar, tradeDate) {
  date(tradeDate, 'FORWARD_SHADOW_TRADE_DATE_INVALID');
  if (calendar.tradingDates.has(tradeDate)) return Object.freeze({ officialTradingDay: true, state: 'TRADING_DAY', sourceHash: calendar.payload.sourceHash, fileHash: calendar.fileHash });
  if (calendar.nonTradingDates.has(tradeDate)) return Object.freeze({ officialTradingDay: false, state: 'NON_TRADING_DAY', sourceHash: calendar.payload.sourceHash, fileHash: calendar.fileHash });
  throw new Error('FORWARD_SHADOW_TRADING_DAY_NOT_COVERED');
}
