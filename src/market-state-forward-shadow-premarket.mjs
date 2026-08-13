const DECISION_TIME = '08:30:00+08:00';

export function governedPremarketDecisionAt(tradeDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('FORWARD_SHADOW_TRADE_DATE_INVALID');
  return `${tradeDate}T${DECISION_TIME}`;
}

export function premarketDecisionWaitMs({ tradeDate, now }) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('FORWARD_SHADOW_NOW_INVALID');
  return Math.max(0, Date.parse(governedPremarketDecisionAt(tradeDate)) - nowMs);
}

export async function waitForPremarketDecisionBoundary({ tradeDate, now }, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const waitMs = premarketDecisionWaitMs({ tradeDate, now });
  if (waitMs > 15 * 60 * 1000) throw new Error('FORWARD_SHADOW_DECISION_BOUNDARY_WAIT_OUT_OF_RANGE');
  if (waitMs > 0) await sleep(waitMs);
  return Object.freeze({ decisionAt: governedPremarketDecisionAt(tradeDate), waitMs });
}
