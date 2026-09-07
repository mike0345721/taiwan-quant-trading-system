import { contractMonthFromLiveCode } from './v310-forward-operations.mjs';

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

export function normalizeTxEodContractMonth(value) {
  const contract = clean(value);
  return contract && /^\d{6}$/.test(contract) ? contract : null;
}

export function txLiveContractMonth(liveContract, tradeDate) {
  const code = clean(liveContract);
  if (!code || !/^TXF[A-L]\d$/.test(code)) return null;
  if (typeof tradeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return null;
  return contractMonthFromLiveCode(code, tradeDate);
}

export function compareTxContractIdentity({
  liveContract,
  liveContractMonth = null,
  tradeDate,
  eodContract,
} = {}) {
  const rawLiveContract = clean(liveContract);
  const canonicalLiveMonth = normalizeTxEodContractMonth(liveContractMonth)
    || txLiveContractMonth(rawLiveContract, tradeDate);
  const canonicalEodMonth = normalizeTxEodContractMonth(eodContract);

  if (!rawLiveContract || !canonicalLiveMonth || !canonicalEodMonth) {
    return Object.freeze({
      compatible: false,
      state: 'UNAVAILABLE',
      reason: 'CONTRACT_IDENTITY_INCOMPLETE',
      liveContract: rawLiveContract,
      liveContractMonth: canonicalLiveMonth,
      eodContractMonth: canonicalEodMonth,
    });
  }

  const compatible = canonicalLiveMonth === canonicalEodMonth;
  return Object.freeze({
    compatible,
    state: compatible ? 'COMPATIBLE' : 'MISMATCH',
    reason: compatible ? null : 'ACTUAL_CONTRACT_MISMATCH',
    liveContract: rawLiveContract,
    liveContractMonth: canonicalLiveMonth,
    eodContractMonth: canonicalEodMonth,
  });
}
