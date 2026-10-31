import fs from 'node:fs';
import { digest } from './market-state-forward-shadow.mjs';

function date(value, code) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error(code);
  return value;
}

function withoutFileHash(payload) {
  const { fileHash: _fileHash, ...body } = payload;
  return body;
}

export function loadGovernedTradingCalendar(filePath, exceptionEvidencePath = null) {
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
  if (!/^[a-f0-9]{64}$/.test(payload.fileHash || '') || digest(withoutFileHash(payload)) !== payload.fileHash) {
    throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_FILE_HASH_MISMATCH');
  }
  const coverageStart = date(payload.coverageStart, 'FORWARD_SHADOW_TRADING_CALENDAR_COVERAGE_INVALID');
  const coverageEnd = date(payload.coverageEnd, 'FORWARD_SHADOW_TRADING_CALENDAR_COVERAGE_INVALID');
  const classified = [...tradingDates, ...nonTradingDates].sort();
  if (classified[0] !== coverageStart || classified.at(-1) !== coverageEnd) throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_COVERAGE_INVALID');
  for (let time = Date.parse(`${coverageStart}T00:00:00Z`), end = Date.parse(`${coverageEnd}T00:00:00Z`); time <= end; time += 86_400_000) {
    if (!classified.includes(new Date(time).toISOString().slice(0, 10))) throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_COVERAGE_GAP');
  }
  const exceptions = new Map();
  if (exceptionEvidencePath) {
    if (!fs.existsSync(exceptionEvidencePath)) throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_EXCEPTION_EVIDENCE_MISSING');
    const exceptionBytes = fs.readFileSync(exceptionEvidencePath);
    const evidence = JSON.parse(exceptionBytes.toString('utf8'));
    if (evidence.schemaVersion !== 'taifex-official-calendar-exception-v1' || evidence.sourceType !== 'TAIFEX_OFFICIAL_EXCEPTION_EVIDENCE' || evidence.ownerApproved !== true) {
      throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_EXCEPTION_GOVERNANCE_INVALID');
    }
    if (!/^[a-f0-9]{64}$/.test(evidence.sourceHash || '') || !/^[a-f0-9]{64}$/.test(evidence.fileHash || '') || digest(withoutFileHash(evidence)) !== evidence.fileHash) {
      throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_EXCEPTION_HASH_INVALID');
    }
    // New source-backed emergency evidence validates both the source summary and
    // the enclosing approval artifact; never infer a trading day from a bad file.
    if (evidence.sourceEvidence && digest(evidence.sourceEvidence) !== evidence.sourceHash) {
      throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_EXCEPTION_SOURCE_HASH_INVALID');
    }
    if (!Array.isArray(evidence.exceptions)) {
      throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_EXCEPTION_SET_INVALID');
    }
    if (evidence.approvalScope === 'ISOLATED_RESEARCH_CANDIDATE_ONLY'
        && (evidence.formalWeight !== 0 || evidence.researchOnly !== true
          || evidence.executionAuthorized !== false || evidence.orderRoutesEnabled !== false)) {
      throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_EXCEPTION_SAFETY_INVALID');
    }
    for (const item of evidence.exceptions) {
      const exceptionDate = date(item.tradeDate, 'FORWARD_SHADOW_TRADING_CALENDAR_EXCEPTION_DATE_INVALID');
      if ((!tradingDates.includes(exceptionDate) && !nonTradingDates.includes(exceptionDate))
          || typeof item.officialTradingDay !== 'boolean'
          || exceptions.has(exceptionDate)) {
        throw new Error('FORWARD_SHADOW_TRADING_CALENDAR_EXCEPTION_SET_INVALID');
      }
      exceptions.set(exceptionDate, Object.freeze({ ...item, evidenceFileHash: evidence.fileHash }));
    }
  }
  return Object.freeze({ payload, fileHash: payload.fileHash, physicalFileHash: digest(bytes), tradingDates: new Set(tradingDates), nonTradingDates: new Set(nonTradingDates), exceptions });
}

export function resolveGovernedTradingDay(calendar, tradeDate) {
  date(tradeDate, 'FORWARD_SHADOW_TRADE_DATE_INVALID');
  if (calendar?.pendingCandidateDates?.has(tradeDate)) throw Error('OPERATING_CALENDAR_CANDIDATE_NOT_ACTIVATED');
  const exception = calendar.exceptions.get(tradeDate);
  if (exception) return Object.freeze({ officialTradingDay: exception.officialTradingDay === true, state: exception.officialTradingDay === true ? 'TRADING_DAY_EXCEPTION' : 'NON_TRADING_DAY_EXCEPTION', sourceHash: calendar.payload.sourceHash, fileHash: calendar.fileHash, exceptionEvidence: exception });
  if (calendar.tradingDates.has(tradeDate)) return Object.freeze({ officialTradingDay: true, state: 'TRADING_DAY', sourceHash: calendar.payload.sourceHash, fileHash: calendar.fileHash });
  if (calendar.nonTradingDates.has(tradeDate)) return Object.freeze({ officialTradingDay: false, state: 'NON_TRADING_DAY', sourceHash: calendar.payload.sourceHash, fileHash: calendar.fileHash });
  throw new Error('FORWARD_SHADOW_TRADING_DAY_NOT_COVERED');
}

export function resolvePreviousGovernedTradingDate(calendar, tradeDate) {
  const current = resolveGovernedTradingDay(calendar, tradeDate);
  if (current.officialTradingDay !== true) throw new Error('FORWARD_SHADOW_CURRENT_DATE_NOT_TRADING_DAY');
  const coverageStart = calendar.payload.coverageStart;
  for (
    let time = Date.parse(`${tradeDate}T00:00:00Z`) - 86_400_000;
    time >= Date.parse(`${coverageStart}T00:00:00Z`);
    time -= 86_400_000
  ) {
    const candidate = new Date(time).toISOString().slice(0, 10);
    if (resolveGovernedTradingDay(calendar, candidate).officialTradingDay === true) return candidate;
  }
  throw new Error('FORWARD_SHADOW_PREVIOUS_TRADING_DATE_NOT_COVERED');
}
