import { readP0LiveTicks } from './p0-market-engine.mjs';
import { sessionExcursions } from './market-state-outcome-contract.mjs';
import { digest } from './market-state-forward-shadow.mjs';

const DAY_START_UTC = '00:45:00.000Z';
const DAY_END_UTC = '05:45:00.000Z';

function validContract(value) {
  if (!/^\d{6}$/.test(value || '')) throw new Error('FORWARD_SHADOW_OUTCOME_ACTUAL_CONTRACT_REQUIRED');
  return value;
}

export async function collectForwardLargeMoveOutcome({ ledgerFile, tradeDate, actualContract, outcomeContract, collectedAt = new Date().toISOString() }) {
  const contractCode = validContract(actualContract);
  const tickRead = await readP0LiveTicks({ ledgerFile, tradeDate, contractCode });
  const startAt = `${tradeDate}T${DAY_START_UTC}`;
  const endAt = `${tradeDate}T${DAY_END_UTC}`;
  const sessionEndAt = `${tradeDate}T13:45:00+08:00`;
  if (Date.parse(collectedAt) < Date.parse(sessionEndAt)) {
    return Object.freeze({ state: 'UNAVAILABLE', unavailableReason: 'OUTCOME_WINDOW_NOT_COMPLETE', sourceLineage: tickRead.source || null });
  }
  const ticks = (tickRead.ticks || []).filter((tick) => tick.exchangeTimestamp >= startAt && tick.exchangeTimestamp < endAt);
  if (tickRead.sourceState !== 'AVAILABLE' || !ticks.length) {
    return Object.freeze({ state: 'UNAVAILABLE', unavailableReason: 'OUTCOME_SOURCE_UNAVAILABLE', sourceLineage: tickRead.source || null });
  }
  if (ticks.some((tick) => tick.contractCode !== contractCode)) throw new Error('FORWARD_SHADOW_OUTCOME_CONTRACT_MISMATCH');
  const open = ticks[0].price;
  const close = ticks.at(-1).price;
  const high = Math.max(...ticks.map((tick) => tick.price));
  const low = Math.min(...ticks.map((tick) => tick.price));
  const values = sessionExcursions({ sessionOpen: open, sessionHigh: high, sessionLow: low, sessionClose: close });
  const latestReceivedAt = ticks.map((tick) => tick.receivedTimestamp).filter(Boolean).sort().at(-1);
  if (!latestReceivedAt) return Object.freeze({ state: 'UNAVAILABLE', unavailableReason: 'OUTCOME_RECEIVED_TIMESTAMP_UNAVAILABLE', sourceLineage: tickRead.source });
  if (Date.parse(ticks.at(-1).exchangeTimestamp) < Date.parse(`${tradeDate}T13:44:50+08:00`)) {
    return Object.freeze({ state: 'UNAVAILABLE', unavailableReason: 'OUTCOME_SESSION_CLOSE_COVERAGE_INCOMPLETE', sourceLineage: tickRead.source });
  }
  const outcomeAvailableAt = new Date(Math.max(Date.parse(sessionEndAt), Date.parse(latestReceivedAt))).toISOString();
  const sourceEvidence = ticks.map(({ eventId, exchangeTimestamp, receivedTimestamp, price, volume }) => ({ eventId, exchangeTimestamp, receivedTimestamp, price, volume }));
  const outcomeSourceHash = digest(sourceEvidence);
  return Object.freeze({
    state: 'AVAILABLE',
    outcome: {
      outcomeContract,
      outcomeAvailableAt,
      actualContract: contractCode,
      sessionReturnBps: values.sessionReturnBps,
      outcomeSourceLineage: {
        sourceClass: 'SHIOAJI_APPEND_ONLY_LIVE_LEDGER',
        sourceLedger: ledgerFile,
        tradeDate,
        session: 'DAY',
        actualContract: contractCode,
        observationStartAt: startAt,
        observationEndAt: endAt,
        firstExchangeTimestamp: ticks[0].exchangeTimestamp,
        lastExchangeTimestamp: ticks.at(-1).exchangeTimestamp,
        latestReceivedAt,
        tickCount: ticks.length,
      },
      outcomeSourceHash,
    },
  });
}
