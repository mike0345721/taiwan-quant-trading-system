import crypto from 'node:crypto';
import { buildBasisTermRows, calendarDays, thirdWednesday } from '../v2/src/basis-term-structure.mjs';
import { analyzeUnivariate, buildUnivariatePairs } from './phase-a-univariate.mjs';
import { runLowCostNegativeControls } from './phase-a-negative-controls.mjs';
import {
  PHASE_A_METHODS,
  buildEvidenceBlocks,
  buildRedundancyClusters,
  freezeF3Candidates,
  runStrongControls,
  runTransparentWalkForward,
} from './phase-a-round2-3.mjs';

export const CONTRACT_SENSITIVE_FACTORS = Object.freeze([
  'close_basis_bps',
  'basis_change_1d_bps',
  'basis_change_5d_bps',
  'basis_level_z60',
  'term_spread_bps',
  'term_change_1d_bps',
  'term_change_5d_bps',
  'term_change_z60',
  'days_to_near_expiry',
  'rollover_risk',
  'contract_changed',
  'near_contract_oi',
]);

const BASIS_FIELDS = Object.freeze({
  close_basis_bps: 'closeBasisBps',
  basis_change_1d_bps: 'basisChange1dBps',
  basis_change_5d_bps: 'basisChange5dBps',
  basis_level_z60: 'basisLevelZ60',
  term_spread_bps: 'termSpreadBps',
  term_change_1d_bps: 'termChange1dBps',
  term_change_5d_bps: 'termChange5dBps',
  term_change_z60: 'termChangeZ60',
});

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function numberOrNull(value) {
  return finite(value) ? Number(value) : null;
}

function sameValue(left, right, tolerance = 1e-12) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left === null || left === undefined) && (right === null || right === undefined);
  }
  if (finite(left) && finite(right)) return Math.abs(Number(left) - Number(right)) <= tolerance;
  return left === right;
}

export function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function indexBy(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

function selectionRecord(set, role) {
  return set?.records?.find((row) => row.contractRole === role) || null;
}

export function pp1DaySelections(selectionSets, affectedTradeDates) {
  const affected = new Set(affectedTradeDates);
  return selectionSets
    .filter((set) => set.sessionId?.endsWith('-DAY') && affected.has(set.sessionId.slice(0, 10)))
    .map((set) => {
      const research = selectionRecord(set, 'SELECTED_RESEARCH');
      const next = selectionRecord(set, 'NEXT_MONTHLY');
      return {
        tradeDate: set.sessionId.slice(0, 10),
        sessionId: set.sessionId,
        selectionSetId: set.selectionSetId,
        selectedResearchContract: research?.contractCode || null,
        nextMonthlyContract: next?.contractCode || null,
        selectionQualityState: research?.qualityState || 'UNAVAILABLE',
        selectionReason: research?.selectionReason || null,
        fallbackReason: research?.fallbackReason || null,
        selectedContractExpiryDate: research?.selectedContractExpiryDate || null,
        featureAvailableAt: research?.timestampLineage?.featureAvailableAt || null,
        policySpecHash: set.policySpecHash,
        policyVersion: set.policyVersion,
      };
    })
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

function selectedContractRows(contractRows, selectionByDate) {
  return contractRows.map((row) => {
    const selection = selectionByDate.get(row.trade_date);
    if (!selection || row.product !== 'TX' || !/^\d{6}$/.test(String(row.contract))) return row;
    return { ...row, is_active: row.contract === selection.selectedResearchContract ? 1 : 0 };
  });
}

function buildReconciledOiRows({ oldOiRows, contractRows, selectionByDate }) {
  const contractByKey = new Map(contractRows
    .filter((row) => row.product === 'TX' && /^\d{6}$/.test(String(row.contract)))
    .map((row) => [`${row.trade_date}:${row.contract}`, row]));
  const output = [];
  let priorContract = null;
  for (const old of [...oldOiRows].sort((left, right) => left.trade_date.localeCompare(right.trade_date))) {
    const selection = selectionByDate.get(old.trade_date);
    const contract = selection?.selectedResearchContract || old.near_contract;
    const contractRow = contractByKey.get(`${old.trade_date}:${contract}`) || null;
    const expiry = selection?.selectedContractExpiryDate
      ? new Date(`${selection.selectedContractExpiryDate}T00:00:00Z`)
      : thirdWednesday(contract);
    const days = expiry ? calendarDays(old.trade_date, expiry) : null;
    const nearOi = selection ? numberOrNull(contractRow?.open_interest) : numberOrNull(old.near_contract_oi);
    const contractChanged = priorContract && contract ? (priorContract !== contract ? 1 : 0) : 0;
    const rolloverRisk = finite(days) ? (Number(days) <= 2 ? 1 : 0) : Number(old.rollover_risk || 0);
    output.push({
      ...old,
      near_contract: contract || null,
      near_contract_oi: nearOi,
      research_oi: nearOi,
      days_to_near_expiry: finite(days) ? Number(days) : null,
      rollover_risk: rolloverRisk,
      contract_changed: contractChanged,
      quality_status: nearOi === null ? 'missing_near_oi'
        : contractChanged ? 'contract_changed'
          : rolloverRisk ? 'rollover_window'
            : 'clean',
      reconciliationSelectionQualityState: selection?.selectionQualityState || null,
    });
    priorContract = contract || priorContract;
  }
  return output;
}

export function buildReconciledSourceSeries({
  contractRows,
  spotRows,
  oldBasisRows,
  oldOiRows,
  selections,
}) {
  const selectionByDate = indexBy(selections, 'tradeDate');
  const rebuiltBasis = buildBasisTermRows(
    selectedContractRows(contractRows, selectionByDate),
    spotRows.map((row) => ({ trade_date: row.trade_date, twii_close: row.twii_close })),
  );
  const basisByDate = indexBy(rebuiltBasis, 'tradeDate');
  const oldBasisByDate = indexBy(oldBasisRows, 'trade_date');
  const oiRows = buildReconciledOiRows({ oldOiRows, contractRows, selectionByDate });
  const oiByDate = indexBy(oiRows, 'trade_date');
  const oldOiByDate = indexBy(oldOiRows, 'trade_date');

  const values = new Map();
  for (const factorId of CONTRACT_SENSITIVE_FACTORS) values.set(factorId, new Map());
  const sourceDates = [...new Set([
    ...oldBasisRows.map((row) => row.trade_date),
    ...oldOiRows.map((row) => row.trade_date),
  ])].sort();
  for (const tradeDate of sourceDates) {
    const basis = basisByDate.get(tradeDate);
    const oi = oiByDate.get(tradeDate);
    for (const [factorId, field] of Object.entries(BASIS_FIELDS)) {
      values.get(factorId).set(tradeDate, {
        value: numberOrNull(basis?.[field]),
        sourceContract: basis?.nearContract || null,
      });
    }
    values.get('days_to_near_expiry').set(tradeDate, { value: numberOrNull(oi?.days_to_near_expiry), sourceContract: oi?.near_contract || null });
    values.get('rollover_risk').set(tradeDate, { value: numberOrNull(oi?.rollover_risk), sourceContract: oi?.near_contract || null });
    values.get('contract_changed').set(tradeDate, { value: numberOrNull(oi?.contract_changed), sourceContract: oi?.near_contract || null });
    values.get('near_contract_oi').set(tradeDate, { value: numberOrNull(oi?.near_contract_oi), sourceContract: oi?.near_contract || null });
  }

  const changedSourceDates = new Set();
  for (const tradeDate of sourceDates) {
    const oldBasis = oldBasisByDate.get(tradeDate);
    const oldOi = oldOiByDate.get(tradeDate);
    const oldValues = {
      close_basis_bps: oldBasis?.close_basis_bps,
      basis_change_1d_bps: oldBasis?.basis_change_1d_bps,
      basis_change_5d_bps: oldBasis?.basis_change_5d_bps,
      basis_level_z60: oldBasis?.basis_level_z60,
      term_spread_bps: oldBasis?.term_spread_bps,
      term_change_1d_bps: oldBasis?.term_change_1d_bps,
      term_change_5d_bps: oldBasis?.term_change_5d_bps,
      term_change_z60: oldBasis?.term_change_z60,
      days_to_near_expiry: oldOi?.days_to_near_expiry,
      rollover_risk: oldOi?.rollover_risk,
      contract_changed: oldOi?.contract_changed,
      near_contract_oi: oldOi?.near_contract_oi,
    };
    for (const factorId of CONTRACT_SENSITIVE_FACTORS) {
      if (!sameValue(oldValues[factorId], values.get(factorId).get(tradeDate)?.value)) changedSourceDates.add(tradeDate);
    }
  }
  return { values, rebuiltBasis, oiRows, changedSourceDates: [...changedSourceDates].sort() };
}

export function patchCanonicalFeatures(featureRows, sourceSeries) {
  const sensitive = new Set(CONTRACT_SENSITIVE_FACTORS);
  return featureRows.map((row) => {
    if (!sensitive.has(row.factorId)) return row;
    const revised = sourceSeries.values.get(row.factorId)?.get(row.sourceTradeDate);
    if (!revised) return { ...row, value: null, qualityState: 'MISSING_VALUE', qualityReason: 'PP1 reconciled source missing' };
    return {
      ...row,
      value: revised.value,
      sourceContract: revised.sourceContract,
      qualityState: revised.value === null ? 'MISSING_VALUE' : 'PASS',
      qualityReason: revised.value === null ? 'PP1 reconciled source value missing' : null,
      formula: `${row.formula || row.factorId}; PP1 contract policy reconciled`,
    };
  });
}

function qualitySummary(rows, factorId) {
  const selected = rows.filter((row) => row.factorId === factorId);
  const qualityCounts = {};
  for (const row of selected) qualityCounts[row.qualityState] = (qualityCounts[row.qualityState] || 0) + 1;
  const validObservations = selected.filter((row) => row.qualityState === 'PASS' && finite(row.value)).length;
  return {
    observations: selected.length,
    validObservations,
    coveragePct: selected.length ? Number((validObservations / selected.length * 100).toFixed(4)) : 0,
    qualityCounts,
    qualityState: validObservations > 0 && !(qualityCounts.AVAILABLE_AT_VIOLATION || 0) ? 'PASS' : 'FAIL',
  };
}

export function rerunSensitiveRound1({ featureRows, targetRows, oldA12ByKey, randomSeed }) {
  const targets = [...new Set([...oldA12ByKey.values()].map((row) => row.targetId))].sort();
  const a12 = [];
  const a13 = [];
  for (const factorId of CONTRACT_SENSITIVE_FACTORS) {
    for (const targetId of targets) {
      const old = oldA12ByKey.get(`${factorId}::${targetId}`);
      if (!old) throw new Error(`original_a12_missing:${factorId}:${targetId}`);
      const descriptive = analyzeUnivariate({ factorId, targetId, featureRows, targetRows });
      const pairs = buildUnivariatePairs({ factorId, targetId, featureRows, targetRows });
      const controls = runLowCostNegativeControls({
        factorId,
        targetId,
        evaluationRows: pairs.evaluation,
        a12Result: descriptive,
        globalSeed: randomSeed,
      });
      a12.push(descriptive);
      a13.push({ ...controls, fold: pairs.split });
    }
  }
  return { a12, a13 };
}

function applyHolmToCombined(studies) {
  const output = studies.map((study) => ({ ...study, holm: study.holm ? { ...study.holm } : null }));
  const targetIds = [...new Set(output.map((study) => study.targetId))];
  for (const targetId of targetIds) {
    const family = output.filter((study) => study.targetId === targetId && finite(study.empiricalP))
      .sort((left, right) => left.empiricalP - right.empiricalP || left.studyId.localeCompare(right.studyId));
    let priorAdjusted = 0;
    for (let index = 0; index < family.length; index += 1) {
      const adjustedP = Math.max(priorAdjusted, Math.min(1, family[index].empiricalP * (family.length - index)));
      priorAdjusted = adjustedP;
      family[index].holm = {
        familySize: family.length,
        rank: index + 1,
        threshold: PHASE_A_METHODS.alpha / (family.length - index),
        adjustedP,
        passed: adjustedP <= PHASE_A_METHODS.alpha,
      };
    }
  }
  for (const study of output) {
    study.strongControlPass = Object.values(study.checks || {}).every(Boolean) && Boolean(study.holm?.passed);
    study.promotionEligible = false;
  }
  return output;
}

function changedBlockIds(oldBlocks, newBlocks, sensitiveFactors) {
  const oldMap = new Map(oldBlocks.map((row) => [row.blockId, row]));
  const newMap = new Map(newBlocks.map((row) => [row.blockId, row]));
  const ids = new Set([...oldMap.keys(), ...newMap.keys()]);
  return [...ids].filter((id) => {
    const old = oldMap.get(id);
    const revised = newMap.get(id);
    if (stableHash(old || null) !== stableHash(revised || null)) return true;
    return [...(old?.sourceFactors || []), ...(old?.factors || [])].some((factor) => sensitiveFactors.has(factor));
  }).sort();
}

export function reconcileDownstream({
  oldFeatureRows,
  newFeatureRows,
  targetRows,
  targetSpec,
  thresholdsByTarget,
  oldA13Eligible,
  newSensitiveA13,
  oldRedundancy,
  oldEvidenceBlocks,
  oldWalkForward,
  oldStrongControls,
  oldCandidates,
  randomSeed,
}) {
  const sensitive = new Set(CONTRACT_SENSITIVE_FACTORS);
  const eligible = oldA13Eligible.filter((row) => !sensitive.has(row.factorId));
  eligible.push(...newSensitiveA13.filter((row) => row.computeAllocationEligible));
  const redundancy = buildRedundancyClusters(newFeatureRows);
  const evidenceBlocks = buildEvidenceBlocks({ featureRows: newFeatureRows, a13Results: eligible, redundancy });
  const affectedBlockIds = changedBlockIds(oldEvidenceBlocks.blocks, evidenceBlocks.blocks, sensitive);
  const affectedBlocks = evidenceBlocks.blocks.filter((row) => affectedBlockIds.includes(row.blockId) && row.status === 'READY');
  const rerunWalkForward = runTransparentWalkForward({
    featureRows: newFeatureRows,
    targetRows,
    targetSpec,
    evidenceBlocks: { ...evidenceBlocks, blocks: affectedBlocks },
    thresholdsByTarget,
  });
  const unaffectedStudies = oldWalkForward.studies.filter((study) => !affectedBlockIds.includes(study.blockId));
  const combinedWalkForward = { ...oldWalkForward, studies: [...unaffectedStudies, ...rerunWalkForward.studies].sort((a, b) => a.blockId.localeCompare(b.blockId) || a.modelId.localeCompare(b.modelId)) };
  const rerunStrong = runStrongControls({ ...rerunWalkForward, studies: rerunWalkForward.studies }, randomSeed);
  const unaffectedStrong = oldStrongControls.studies.filter((study) => !affectedBlockIds.includes(study.blockId));
  const combinedStrong = { ...oldStrongControls, studies: applyHolmToCombined([...unaffectedStrong, ...rerunStrong.studies]) };
  const candidates = freezeF3Candidates(combinedStrong, CONTRACT_SENSITIVE_FACTORS);
  return {
    redundancy,
    evidenceBlocks,
    affectedBlockIds,
    rerunWalkForward,
    combinedWalkForward,
    rerunStrong,
    combinedStrong,
    candidates,
    oldCandidates,
    oldFeatureRows,
  };
}

export function diffRows(oldFeatureRows, newFeatureRows) {
  const oldByKey = new Map(oldFeatureRows.map((row) => [`${row.decisionTradeDate}:${row.factorId}`, row]));
  const changes = [];
  for (const row of newFeatureRows) {
    if (!CONTRACT_SENSITIVE_FACTORS.includes(row.factorId)) continue;
    const old = oldByKey.get(`${row.decisionTradeDate}:${row.factorId}`);
    if (!old) continue;
    if (sameValue(old.value, row.value)
      && old.sourceContract === row.sourceContract
      && old.qualityState === row.qualityState
      && old.availableAt === row.availableAt) continue;
    changes.push({
      factorId: row.factorId,
      sourceTradeDate: row.sourceTradeDate,
      decisionTradeDate: row.decisionTradeDate,
      oldValue: old.value,
      newValue: row.value,
      oldContract: old.sourceContract,
      newContract: row.sourceContract,
      oldQualityState: old.qualityState,
      newQualityState: row.qualityState,
      oldAvailableAt: old.availableAt,
      newAvailableAt: row.availableAt,
    });
  }
  return changes.sort((left, right) => left.factorId.localeCompare(right.factorId) || left.decisionTradeDate.localeCompare(right.decisionTradeDate));
}

export function factorQuality(rows) {
  return CONTRACT_SENSITIVE_FACTORS.map((factorId) => ({ factorId, ...qualitySummary(rows, factorId) }));
}

export function summarizeStudy(study) {
  if (!study) return null;
  return {
    studyId: study.studyId || `${study.blockId}__${study.modelId}`,
    blockId: study.blockId,
    targetId: study.targetId,
    modelId: study.modelId,
    factors: study.factors,
    rowCount: study.rowCount ?? study.oosRows ?? null,
    foldCount: study.foldCount ?? null,
    aggregate: study.aggregate || null,
    positiveFoldShare: study.positiveFoldShare ?? null,
    empiricalP: study.empiricalP ?? null,
    holm: study.holm || null,
    strongControlPass: study.strongControlPass ?? null,
    digest: stableHash(study),
  };
}

export function sameReconciliationValue(left, right) {
  return sameValue(left, right);
}
