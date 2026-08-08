export function v3OutcomeKey(record) {
  return `${record?.decisionVersion || ''}|${record?.signalDate || ''}|${record?.horizonDays || ''}`;
}

export function validResolvedOutcome(record, { requireStrictOhlc = false } = {}) {
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  if (!record || !positive(record.entryOpen) || !positive(record.exitClose)) return false;
  if (record.recordType === 'correction' || requireStrictOhlc) {
    if (!positive(record.pathHigh) || !positive(record.pathLow)) return false;
    const open = Number(record.entryOpen);
    const close = Number(record.exitClose);
    const high = Number(record.pathHigh);
    const low = Number(record.pathLow);
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return false;
    if (record.ohlcValidation?.strict !== true) return false;
  }
  return true;
}

export function materializeV3OutcomeLedger(records = []) {
  const effective = new Map();
  const errors = [];
  let corrections = 0;
  for (const [index, record] of records.entries()) {
    const key = v3OutcomeKey(record);
    if (key.includes('||') || key.endsWith('|')) {
      errors.push(`row_${index + 1}_key_invalid`);
      continue;
    }
    if (record.recordType === 'correction') {
      corrections += 1;
      const prior = effective.get(key);
      if (!prior) errors.push(`row_${index + 1}_correction_without_prior`);
      if (record.supersedesKey !== key) errors.push(`row_${index + 1}_supersedes_key_invalid`);
      if (!record.correctionReason) errors.push(`row_${index + 1}_correction_reason_missing`);
      if (prior?.resolvedAt && record.supersedesResolvedAt !== prior.resolvedAt) {
        errors.push(`row_${index + 1}_supersedes_version_invalid`);
      }
      if (!validResolvedOutcome(record, { requireStrictOhlc: true })) {
        errors.push(`row_${index + 1}_corrected_outcome_invalid`);
        continue;
      }
    } else if (effective.has(key)) {
      errors.push(`row_${index + 1}_duplicate_without_correction`);
      continue;
    }
    effective.set(key, record);
  }
  return { records: [...effective.values()], byKey: effective, corrections, errors };
}

const COMPARABLE_FIELDS = [
  'entryOpen', 'exitClose', 'pathHigh', 'pathLow', 'returnPct', 'absoluteMovePct',
  'gapPct', 'realizedRangePct', 'longMfePct', 'longMaePct', 'directionalReturnPct',
  'directionCorrect', 'entryDate', 'exitDate', 'txContract',
];

function sameValue(left, right) {
  if (left == null && right == null) return true;
  if (typeof left === 'number' || typeof right === 'number') {
    return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
      && Math.abs(Number(left) - Number(right)) <= 1e-10;
  }
  return left === right;
}

export function outcomeNeedsCorrection(prior, recomputed) {
  if (!prior || !recomputed) return false;
  // Legacy records did not persist pathHigh/pathLow. Derived excursion fields are
  // still compared, so a previously polluted zero OHLC is detected without
  // forcing an unnecessary correction for every valid legacy row.
  return COMPARABLE_FIELDS.some((field) => {
    if ((field === 'pathHigh' || field === 'pathLow') && prior[field] == null) return false;
    return !sameValue(prior[field], recomputed[field]);
  });
}

export function correctionRecord(prior, recomputed, reason) {
  const key = v3OutcomeKey(recomputed);
  return {
    ...recomputed,
    recordType: 'correction',
    supersedesKey: key,
    supersedesResolvedAt: prior?.resolvedAt || null,
    correctionReason: reason,
    correctedAt: new Date().toISOString(),
    researchOnly: true,
    executionAuthorized: false,
  };
}
